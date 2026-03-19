var ENDPOINT_BASE = "/zero-mcp";
var PREF_BRANCH = "extensions.zeroMcpPlugin.";
var PLUGIN_VERSION = "0.3.0";

var registeredEndpointPaths = [];
var writeQueue = Promise.resolve();
var idempotencyCache = new Map();

var SUPPORTED_OPERATIONS = [
  "health",
  "resolveCollectionPath",
  "createCollection",
  "deleteCollection",
  "batchCreateCollections",
  "batchDeleteCollections",
  "createCollectionNote",
  "createChildNote",
  "importPdfToCollection",
  "importIdentifierToCollection",
  "importBibtexToCollection",
  "batchImportPdfsToCollection",
  "moveItemsBetweenCollections",
  "removeItemFromCollection",
  "deleteItem",
  "batchUpdateTags",
];

var SUPPORTED_IMPORT_MODES = ["imported_file", "linked_file"];
var SUPPORTED_DUPLICATE_POLICIES = [
  "error",
  "attach_to_existing",
  "add_existing_to_collection",
  "skip",
];
var HELPER_MONITOR_INTERVAL_MS = 4000;
var helperOperationQueue = Promise.resolve();
var helperRuntimeState = createDefaultHelperRuntimeState();

ZeroMcpPlugin = {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,
  _helperMonitorTimer: null,
  _shuttingDown: false,
  _shutdownPromise: null,

  init({ id, version, rootURI }) {
    if (this.initialized) {
      return;
    }
    this.id = id;
    this.version = version || PLUGIN_VERSION;
    this.rootURI = rootURI;
    this.initialized = true;
    PLUGIN_VERSION = this.version;
  },

  log(message) {
    ZeroMcpPluginCommon.log("plugin", message);
  },

  async startup() {
    ensureOperationalDefaults();
    registerEndpoints();
    this._shuttingDown = false;
    this.attachToMainWindow();
    this.startHelperMonitor();
    try {
      await this.ensureHelperForCurrentConfig("zotero-startup");
    } catch (error) {
      ZeroMcpPluginCommon.logError(error);
    }
  },

  onMainWindowLoad({ window }) {
    attachPluginControllerToWindow(window);
  },

  onMainWindowUnload({ window }) {
    detachPluginControllerFromWindow(window);
  },

  attachToMainWindow() {
    try {
      if (typeof Zotero !== "undefined" && Zotero && typeof Zotero.getMainWindow === "function") {
        let mainWindow = Zotero.getMainWindow();
        if (mainWindow) {
          attachPluginControllerToWindow(mainWindow);
        }
      }
    } catch (error) {}
  },

  detachFromMainWindow() {
    try {
      if (typeof Zotero !== "undefined" && Zotero && typeof Zotero.getMainWindow === "function") {
        let mainWindow = Zotero.getMainWindow();
        if (mainWindow) {
          detachPluginControllerFromWindow(mainWindow);
        }
      }
    } catch (error) {}
  },

  getHelperRuntimeState() {
    return cloneJSON(buildHelperRuntimeStateSnapshot());
  },

  async refreshHelperRuntimeState(reason) {
    return this._runHelperOperation(() => refreshHelperRuntimeState(reason || "manual-refresh"));
  },

  async ensureHelperForCurrentConfig(reason, options) {
    return this._runHelperOperation(() =>
      ensureHelperForCurrentConfig(reason || "manual-ensure", options || {})
    );
  },

  async restartHelperForConfigChange(changeType, nextConfig, previousConfig) {
    return this._runHelperOperation(() =>
      restartHelperForConfigChange(changeType, nextConfig || {}, previousConfig || {})
    );
  },

  async applyExecutablePathChange(nextPath) {
    return this._runHelperOperation(async () => {
      let previous = buildHelperConfigSnapshot();
      let normalizedPath = String(nextPath || "").trim();
      setStringPref("mcpExecutablePath", normalizedPath);
      let current = buildHelperConfigSnapshot({ executablePath: normalizedPath });

      if (!normalizedPath) {
        try {
          await stopManagedHelper("helper-path-cleared", { config: previous });
        } catch (error) {
          ZeroMcpPluginCommon.logError(error);
        }
        clearManagedHelperState();
        updateHelperRuntimeState({
          helperState: "idle",
          statusMessageKey: "helper-path-missing",
          lastErrorCode: "",
          config: current,
        });
        return buildHelperRuntimeStateSnapshot();
      }

      if (!previous.executablePath) {
        return ensureHelperForCurrentConfig("helper-path-selected", { config: current });
      }

      let inspection = await inspectHelperPort(current.port, current.executablePath);
      if (inspection.kind === "healthy-helper") {
        return adoptHealthyHelper(inspection, current, "available");
      }
      return ensureHelperForCurrentConfig("helper-path-updated", {
        config: current,
        inspection: inspection,
      });
    });
  },

  async applyPortChange(nextPort) {
    return this.restartHelperForConfigChange(
      "port",
      { port: parseInt(ZeroMcpPluginCommon.normalizePort(nextPort, 8000), 10) },
      buildHelperConfigSnapshot()
    );
  },

  async applySharedSecretChange(nextToken) {
    return this.restartHelperForConfigChange(
      "token",
      { token: String(nextToken || "") },
      buildHelperConfigSnapshot()
    );
  },

  async testOrRecoverHelper(reason) {
    return this._runHelperOperation(() => testOrRecoverHelper(reason || "manual-test"));
  },

  async stopManagedHelper(reason, options) {
    return this._runHelperOperation(() =>
      stopManagedHelper(reason || "manual-stop", options || {})
    );
  },

  startHelperMonitor() {
    if (this._helperMonitorTimer) {
      return;
    }
    this._helperMonitorTimer = setInterval(() => {
      if (this._shuttingDown) {
        return;
      }
      this._runHelperOperation(() => maybeRecoverManagedHelper()).catch((error) => {
        ZeroMcpPluginCommon.logError(error);
      });
    }, HELPER_MONITOR_INTERVAL_MS);
  },

  stopHelperMonitor() {
    if (!this._helperMonitorTimer) {
      return;
    }
    clearInterval(this._helperMonitorTimer);
    this._helperMonitorTimer = null;
  },

  _runHelperOperation(fn) {
    helperOperationQueue = helperOperationQueue.then(fn, fn);
    return helperOperationQueue;
  },

  async shutdown() {
    if (this._shutdownPromise) {
      return this._shutdownPromise;
    }

    this._shuttingDown = true;
    this.stopHelperMonitor();
    this._shutdownPromise = (async () => {
      try {
        await this.stopManagedHelper("zotero-shutdown", { onShutdown: true });
      } catch (error) {
        ZeroMcpPluginCommon.logError(error);
      } finally {
        this.detachFromMainWindow();
        unregisterEndpoints();
        idempotencyCache.clear();
        writeQueue = Promise.resolve();
        helperOperationQueue = Promise.resolve();
        helperRuntimeState = createDefaultHelperRuntimeState();
        this.initialized = false;
        this._shutdownPromise = null;
      }
    })();

    return this._shutdownPromise;
  },
};

function registerEndpoints() {
  registerEndpoint("/health", "health", false, handleHealth, false);
  registerEndpoint(
    "/collections/resolve",
    "resolveCollectionPath",
    false,
    handleResolveCollectionPath
  );
  registerEndpoint("/collections/create", "createCollection", true, handleCreateCollection);
  registerEndpoint("/collections/delete", "deleteCollection", true, handleDeleteCollection);
  registerEndpoint(
    "/collections/batch-create",
    "batchCreateCollections",
    true,
    handleBatchCreateCollections
  );
  registerEndpoint(
    "/collections/batch-delete",
    "batchDeleteCollections",
    true,
    handleBatchDeleteCollections
  );
  registerEndpoint(
    "/notes/create-collection-note",
    "createCollectionNote",
    true,
    handleCreateCollectionNote
  );
  registerEndpoint(
    "/notes/create-child-note",
    "createChildNote",
    true,
    handleCreateChildNote
  );
  registerEndpoint("/items/import-pdf", "importPdfToCollection", true, handleImportPdfToCollection);
  registerEndpoint(
    "/items/import-identifier",
    "importIdentifierToCollection",
    true,
    handleImportIdentifierToCollection
  );
  registerEndpoint(
    "/items/import-bibtex",
    "importBibtexToCollection",
    true,
    handleImportBibtexToCollection
  );
  registerEndpoint(
    "/items/batch-import-pdf",
    "batchImportPdfsToCollection",
    true,
    handleBatchImportPdfsToCollection
  );
  registerEndpoint(
    "/items/move-between-collections",
    "moveItemsBetweenCollections",
    true,
    handleMoveItemsBetweenCollections
  );
  registerEndpoint(
    "/items/remove-from-collection",
    "removeItemFromCollection",
    true,
    handleRemoveItemFromCollection
  );
  registerEndpoint("/items/delete", "deleteItem", true, handleDeleteItem);
  registerEndpoint("/items/batch-update-tags", "batchUpdateTags", true, handleBatchUpdateTags);
}

function unregisterEndpoints() {
  for (let path of registeredEndpointPaths) {
    delete Zotero.Server.Endpoints[path];
  }
  registeredEndpointPaths = [];
}

function registerEndpoint(path, operation, mutating, handler, requireAuth) {
  let fullPath = ENDPOINT_BASE + path;
  Zotero.Server.Endpoints[fullPath] = function () {};
  Zotero.Server.Endpoints[fullPath].prototype = {
    supportedMethods: ["POST"],
    supportedDataTypes: ["application/json"],
    permitBookmarklet: false,
    init: async function (requestData) {
      if (requireAuth !== false) {
        let authError = authenticateRequest(requestData);
        if (authError) {
          return toHttpResponse(authError);
        }
      }

      let data = requestData.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        data = {};
      }

      if (mutating && !getMutationsEnabled()) {
        return toHttpResponse(
          errorBody(
            403,
            "MUTATIONS_DISABLED",
            "Mutation operations are disabled in zero-mcp-plugin preferences"
          )
        );
      }

      try {
        if (!mutating) {
          return toHttpResponse(await handler(data, requestData));
        }

        return await withWriteLock(async function () {
          let cacheKey = buildCacheKey(operation, data.idempotencyKey);
          if (cacheKey && idempotencyCache.has(cacheKey)) {
            return toHttpResponse(cloneJSON(idempotencyCache.get(cacheKey)));
          }

          let response = normalizeResponse(await handler(data, requestData));
          if (cacheKey) {
            idempotencyCache.set(cacheKey, cloneJSON(response));
          }
          return toHttpResponse(response);
        });
      } catch (error) {
        Zotero.logError(error);
        return toHttpResponse(errorToResponse(error));
      }
    },
  };
  registeredEndpointPaths.push(fullPath);
}

function withWriteLock(fn) {
  let next = writeQueue.then(fn, fn);
  writeQueue = next.catch(function () {});
  return next;
}

function normalizeResponse(response) {
  if (!response || typeof response !== "object" || response.status === undefined) {
    return okBody(response || {});
  }
  return response;
}

function okBody(body, status) {
  let payload = body ? cloneJSON(body) : {};
  if (payload.ok === undefined) {
    payload.ok = true;
  }
  return {
    status: status || 200,
    body: payload,
  };
}

function errorBody(status, code, message, details) {
  return {
    status: status,
    body: {
      ok: false,
      error: {
        code: code,
        message: message,
        details: details === undefined ? null : details,
      },
    },
  };
}

function errorToResponse(error) {
  return errorBody(
    error && error.status ? error.status : 500,
    error && error.code ? error.code : "INTERNAL_ERROR",
    error && error.message ? error.message : "Unexpected zero-mcp-plugin error",
    error && error.details !== undefined ? error.details : null
  );
}

function toHttpResponse(response) {
  let normalized = normalizeResponse(response);
  return [normalized.status, "application/json", JSON.stringify(normalized.body)];
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function bridgeError(status, code, message, details) {
  let error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details === undefined ? null : details;
  return error;
}

function buildCacheKey(operation, idempotencyKey) {
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return null;
  }
  return operation + ":" + idempotencyKey;
}

function authenticateRequest(requestData) {
  let configuredToken = getSharedSecret();
  if (!configuredToken) {
    return errorBody(
      503,
      "BRIDGE_TOKEN_NOT_CONFIGURED",
      "Set extensions.zeroMcpPlugin.sharedSecret before using the mutation bridge"
    );
  }

  let authorization = getHeader(requestData, "authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return errorBody(
      401,
      "UNAUTHORIZED",
      "A Bearer token is required for zero-mcp-plugin bridge requests"
    );
  }

  let providedToken = authorization.slice("Bearer ".length);
  if (providedToken !== configuredToken) {
    return errorBody(
      401,
      "UNAUTHORIZED",
      "The provided Bearer token does not match the configured bridge secret"
    );
  }
  return null;
}

function getHeader(requestData, headerName) {
  if (!requestData || !requestData.headers) {
    return null;
  }
  let target = headerName.toLowerCase();
  for (let name in requestData.headers) {
    if (name.toLowerCase() === target) {
      return requestData.headers[name];
    }
  }
  return null;
}

function getPrefsBranch() {
  return Services.prefs.getBranch(PREF_BRANCH);
}

function hasUserPref(name) {
  try {
    return getPrefsBranch().prefHasUserValue(name);
  } catch (error) {
    return false;
  }
}

function setBoolPref(name, value) {
  getPrefsBranch().setBoolPref(name, !!value);
}

function setStringPref(name, value) {
  getPrefsBranch().setStringPref(name, String(value || ""));
}

function getProfileDirectoryPath() {
  try {
    return Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
  } catch (error) {
    return "";
  }
}

function getZoteroDataDirectoryPath() {
  try {
    if (Zotero && Zotero.DataDirectory) {
      if (typeof Zotero.DataDirectory.dir === "string" && Zotero.DataDirectory.dir) {
        return Zotero.DataDirectory.dir;
      }
      if (Zotero.DataDirectory.dir && Zotero.DataDirectory.dir.path) {
        return Zotero.DataDirectory.dir.path;
      }
      if (typeof Zotero.DataDirectory.getDir === "function") {
        let directory = Zotero.DataDirectory.getDir();
        if (directory && directory.path) {
          return directory.path;
        }
      }
    }
  } catch (error) {}
  return getProfileDirectoryPath();
}

function getFileLocatorPath(name) {
  try {
    return Services.dirsvc.get(name, Components.interfaces.nsIFile).path;
  } catch (error) {
    return "";
  }
}

function pathExists(path) {
  if (!path) {
    return false;
  }
  try {
    let file = Zotero.File.pathToFile(path);
    return !!file && file.exists() && !file.isDirectory();
  } catch (error) {
    return false;
  }
}

function defaultBufferDirectory() {
  return ZeroMcpPluginCommon.defaultBufferDirectory();
}

function ensureOperationalDefaults() {
  if (!hasUserPref("mutationsEnabled")) {
    setBoolPref("mutationsEnabled", true);
  }

  if (!getSharedSecret()) {
    setStringPref("sharedSecret", ZeroMcpPluginCommon.generateSharedSecret());
  }

  if (!getPrefsBranch().getStringPref("bufferDirectory", "").trim()) {
    let bufferPath = defaultBufferDirectory();
    if (bufferPath) {
      setStringPref("bufferDirectory", bufferPath);
    }
  }
  if (!hasUserPref("helperRecoveryMaxAttempts")) {
    setStringPref("helperRecoveryMaxAttempts", "5");
  }
  if (!hasUserPref("helperRecoveryAttempts")) {
    setStringPref("helperRecoveryAttempts", "0");
  }
  if (!getLastStablePort()) {
    setLastStablePort(String(getLocalMcpPort()));
  }
  if (!getLastStableTokenHash()) {
    setLastStableTokenHash(hashSecret(getSharedSecret()));
  }
}

function attachPluginControllerToWindow(window) {
  try {
    if (window) {
      window.ZeroMcpPlugin = ZeroMcpPlugin;
    }
  } catch (error) {}
}

function detachPluginControllerFromWindow(window) {
  try {
    if (window && window.ZeroMcpPlugin === ZeroMcpPlugin) {
      delete window.ZeroMcpPlugin;
    }
  } catch (error) {}
}

function createDefaultHelperRuntimeState() {
  return {
    desiredPort: 8000,
    desiredTokenHash: "",
    managedPid: null,
    managedByPlugin: false,
    helperState: "idle",
    recoveryAttempts: 0,
    lastErrorCode: "",
    statusMessageKey: "idle",
  };
}

function helperLifecycleError(code, message, details) {
  let error = new Error(message);
  error.code = code;
  error.details = details === undefined ? null : details;
  return error;
}

function helperValidationStatusKey(code) {
  switch (code) {
    case "HELPER_PATH_REQUIRED":
      return "helper-path-missing";
    case "HELPER_PATH_NOT_FOUND":
      return "helper-path-not-found";
    case "HELPER_PATH_IS_DIRECTORY":
      return "helper-path-is-directory";
    case "HELPER_PATH_NOT_EXECUTABLE":
      return "helper-path-not-executable";
    case "HELPER_LAYOUT_INCOMPLETE":
      return "helper-layout-incomplete";
    default:
      return "restart-rollback";
  }
}

function inspectConfiguredHelperPath(config) {
  return ZeroMcpPluginCommon.inspectHelperExecutablePath(config && config.executablePath);
}

function applyHelperValidationFailure(config, validation) {
  let code = validation && validation.code ? validation.code : "HELPER_PATH_INVALID";
  clearManagedHelperState();
  updateHelperRuntimeState({
    helperState: code === "HELPER_PATH_REQUIRED" ? "idle" : "error",
    statusMessageKey: helperValidationStatusKey(code),
    lastErrorCode: code,
    config: config,
  });
}

function requireValidHelperExecutable(config) {
  let validation = inspectConfiguredHelperPath(config);
  if (!validation.ok) {
    applyHelperValidationFailure(config, validation);
    throw helperLifecycleError(
      validation.code,
      validation.message,
      validation.details === undefined ? null : validation.details
    );
  }
  config.executablePath = validation.path || config.executablePath;
  return validation;
}

function hashSecret(value) {
  let input = String(value || "");
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function getMutationsEnabled() {
  return getPrefsBranch().getBoolPref("mutationsEnabled", true);
}

function getSharedSecret() {
  return getPrefsBranch().getStringPref("sharedSecret", "");
}

function getSharedSecretHash() {
  return hashSecret(getSharedSecret());
}

function getBridgeURL() {
  let port = 23119;
  try {
    if (Zotero.Server && Zotero.Server.port) {
      port = Zotero.Server.port;
    }
  } catch (error) {}
  return "http://127.0.0.1:" + port + ENDPOINT_BASE;
}

function getBufferDirectory() {
  let configured = getPrefsBranch().getStringPref("bufferDirectory", "").trim();
  return configured || defaultBufferDirectory();
}

function getDefaultLinkMode() {
  let value = getPrefsBranch().getStringPref("defaultLinkMode", "imported_file");
  if (SUPPORTED_IMPORT_MODES.indexOf(value) !== -1) {
    return value;
  }
  return "imported_file";
}

function getDefaultDuplicatePolicy() {
  let value = getPrefsBranch().getStringPref(
    "defaultDuplicatePolicy",
    "add_existing_to_collection"
  );
  if (SUPPORTED_DUPLICATE_POLICIES.indexOf(value) !== -1) {
    return value;
  }
  return "add_existing_to_collection";
}

function getMcpExecutablePath() {
  return getPrefsBranch().getStringPref("mcpExecutablePath", "").trim();
}

function getManagedByPlugin() {
  return getPrefsBranch().getBoolPref("mcpManagedByPlugin", false);
}

function setManagedByPlugin(value) {
  getPrefsBranch().setBoolPref("mcpManagedByPlugin", !!value);
}

function getManagedMcpPid() {
  return getPrefsBranch().getStringPref("mcpManagedPid", "").trim();
}

function setManagedMcpPid(pid) {
  getPrefsBranch().setStringPref("mcpManagedPid", pid ? String(pid) : "");
}

function getLastKnownManagedCommand() {
  return getPrefsBranch().getStringPref("lastKnownManagedCommand", "").trim();
}

function setLastKnownManagedCommand(command) {
  getPrefsBranch().setStringPref("lastKnownManagedCommand", String(command || "").trim());
}

function getHelperRecoveryMaxAttempts() {
  let raw = getPrefsBranch().getStringPref("helperRecoveryMaxAttempts", "5").trim();
  let parsed = parseInt(raw || "5", 10);
  return parsed >= 0 ? parsed : 5;
}

function getHelperRecoveryAttempts() {
  let raw = getPrefsBranch().getStringPref("helperRecoveryAttempts", "0").trim();
  let parsed = parseInt(raw || "0", 10);
  return parsed >= 0 ? parsed : 0;
}

function setHelperRecoveryAttempts(value) {
  let normalized = Math.max(0, parseInt(String(value || "0"), 10) || 0);
  setStringPref("helperRecoveryAttempts", String(normalized));
}

function resetHelperRecoveryAttempts() {
  setHelperRecoveryAttempts(0);
}

function getLastStablePort() {
  return getPrefsBranch().getStringPref("lastStablePort", "").trim();
}

function setLastStablePort(value) {
  setStringPref("lastStablePort", value);
}

function getLastStableTokenHash() {
  return getPrefsBranch().getStringPref("lastStableTokenHash", "").trim();
}

function setLastStableTokenHash(value) {
  setStringPref("lastStableTokenHash", value);
}

function getLocalMcpPort() {
  let raw = getPrefsBranch().getStringPref("localMcpPort", "8000").trim();
  return parseInt(ZeroMcpPluginCommon.normalizePort(raw, 8000), 10);
}

function getLocalMcpBaseURL(portOverride) {
  let port = portOverride ? parseInt(ZeroMcpPluginCommon.normalizePort(portOverride, 8000), 10) : getLocalMcpPort();
  return "http://127.0.0.1:" + port;
}

function getLocalMcpURL(portOverride) {
  return getLocalMcpBaseURL(portOverride) + "/mcp";
}

function getLocalBridgeProxyURL(portOverride) {
  return getLocalMcpBaseURL(portOverride) + ENDPOINT_BASE;
}

function buildHelperConfigSnapshot(overrides) {
  let config = {
    executablePath: getMcpExecutablePath(),
    port: getLocalMcpPort(),
    token: getSharedSecret(),
  };

  if (overrides && Object.prototype.hasOwnProperty.call(overrides, "executablePath")) {
    config.executablePath = String(overrides.executablePath || "").trim();
  }
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, "port")) {
    config.port = parseInt(ZeroMcpPluginCommon.normalizePort(overrides.port, 8000), 10);
  }
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, "token")) {
    config.token = String(overrides.token || "");
  }

  config.tokenHash = hashSecret(config.token);
  config.managedPid = getManagedMcpPid();
  config.managedByPlugin = getManagedByPlugin();
  return config;
}

function buildHelperRuntimeStateSnapshot(patch) {
  let snapshot = Object.assign({}, createDefaultHelperRuntimeState(), helperRuntimeState, patch || {});
  let config = buildHelperConfigSnapshot(snapshot.config || null);
  delete snapshot.config;
  snapshot.desiredPort = config.port;
  snapshot.desiredTokenHash = config.tokenHash;
  snapshot.managedPid = getManagedMcpPid() || null;
  snapshot.managedByPlugin = getManagedByPlugin();
  snapshot.recoveryAttempts = getHelperRecoveryAttempts();
  return snapshot;
}

function updateHelperRuntimeState(patch) {
  helperRuntimeState = buildHelperRuntimeStateSnapshot(patch);
  return cloneJSON(helperRuntimeState);
}

function persistStableHelperConfig(config) {
  setLastStablePort(String(config.port));
  setLastStableTokenHash(config.tokenHash);
  resetHelperRecoveryAttempts();
}

function markManagedHelper(pid, command, managedByPlugin) {
  let normalizedPid = pid ? String(pid) : "";
  let shouldManage =
    managedByPlugin !== undefined ? !!managedByPlugin : !!(normalizedPid || command);
  setManagedByPlugin(shouldManage);
  setManagedMcpPid(normalizedPid);
  setLastKnownManagedCommand(command || "");
  return updateHelperRuntimeState({
    managedPid: normalizedPid || null,
    managedByPlugin: shouldManage,
  });
}

function clearManagedHelperState() {
  setManagedByPlugin(false);
  setManagedMcpPid("");
  setLastKnownManagedCommand("");
  return updateHelperRuntimeState({
    managedPid: null,
    managedByPlugin: false,
  });
}

async function waitForDelay(delayMs) {
  await Zotero.Promise.delay(delayMs);
}

function isRecognizedHelperHealthPayload(body) {
  if (!body || typeof body !== "object") {
    return false;
  }
  if (body.pluginAvailable === true || body.helperRole === "mcp-adapter") {
    return true;
  }
  if (body.error && body.error.code === "BRIDGE_UPSTREAM_UNAVAILABLE") {
    return true;
  }
  return false;
}

async function probeHelperBridgeHealth(portOverride) {
  let url = getLocalBridgeProxyURL(portOverride) + "/health";
  try {
    let response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ verbose: false }),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (error) {}
    let recognizedHelper = isRecognizedHelperHealthPayload(body);
    return {
      ok: !!(response.ok && recognizedHelper),
      recognizedHelper: recognizedHelper,
      status: response.status,
      body: body,
      url: url,
    };
  } catch (error) {
    return {
      ok: false,
      recognizedHelper: false,
      error: error,
      url: url,
    };
  }
}

async function inspectHelperPort(portOverride, executablePath) {
  let port = parseInt(ZeroMcpPluginCommon.normalizePort(portOverride, 8000), 10);
  let probe = await probeHelperBridgeHealth(port);
  let matchingInfo = await ZeroMcpPluginCommon.findMatchingListeningProcessInfo(port, executablePath);
  let listeningInfo = matchingInfo || (await ZeroMcpPluginCommon.findListeningProcess(port));
  let pid = listeningInfo && listeningInfo.pid ? String(listeningInfo.pid).trim() : "";
  let command = listeningInfo && listeningInfo.command ? String(listeningInfo.command) : "";

  if (probe.ok) {
    return {
      kind: "healthy-helper",
      port: port,
      pid: pid,
      command: command,
      probe: probe,
    };
  }

  if (matchingInfo || probe.recognizedHelper) {
    return {
      kind: "stale-helper",
      port: port,
      pid: pid,
      command: command,
      probe: probe,
    };
  }

  if (listeningInfo && listeningInfo.pid) {
    return {
      kind: "conflict",
      port: port,
      pid: pid,
      command: command,
      probe: probe,
    };
  }

  return {
    kind: "available",
    port: port,
    pid: "",
    command: "",
    probe: probe,
  };
}

async function collectManagedHelperTargets(options) {
  let params = options || {};
  let executablePath = params.executablePath || getMcpExecutablePath();
  let executableInspection = executablePath
    ? ZeroMcpPluginCommon.inspectHelperExecutablePath(executablePath)
    : null;
  if (executableInspection && executableInspection.ok) {
    executablePath = executableInspection.path || executablePath;
  } else if (executableInspection && !executableInspection.ok) {
    executablePath = "";
  }
  let targetsByPid = new Map();

  function addTarget(info, source) {
    if (!info || !info.pid) {
      return;
    }
    let pid = String(info.pid).trim();
    if (!pid || targetsByPid.has(pid)) {
      return;
    }
    targetsByPid.set(pid, {
      pid: pid,
      command: info.command ? String(info.command) : "",
      source: source || "",
    });
  }

  let recordedPid = params.recordedPid || getManagedMcpPid();
  if (recordedPid && (await ZeroMcpPluginCommon.isProcessAlive(recordedPid, executablePath))) {
    addTarget({ pid: recordedPid, command: getLastKnownManagedCommand() }, "recorded");
  }

  let ports = [];
  if (Object.prototype.hasOwnProperty.call(params, "port")) {
    ports.push(params.port);
  }
  if (Object.prototype.hasOwnProperty.call(params, "additionalPort")) {
    ports.push(params.additionalPort);
  }
  if (params.includeCurrentPort) {
    ports.push(getLocalMcpPort());
  }

  for (let port of Array.from(new Set(ports.filter((value) => value !== undefined && value !== null)))) {
    let info = await ZeroMcpPluginCommon.findMatchingListeningProcessInfo(port, executablePath);
    if (info) {
      addTarget(info, "port:" + port);
    }
  }

  if (params.includeAllMatching && executablePath) {
    let matchingInfos = await ZeroMcpPluginCommon.listMatchingProcessInfo(executablePath);
    for (let info of matchingInfos) {
      addTarget(info, "process");
    }
  }

  return Array.from(targetsByPid.values());
}

async function terminateHelperTargets(targets, executablePath) {
  let normalizedTargets = [];
  let seenPids = new Set();
  for (let target of targets || []) {
    if (!target || !target.pid) {
      continue;
    }
    let pid = String(target.pid).trim();
    if (!pid || seenPids.has(pid)) {
      continue;
    }
    seenPids.add(pid);
    normalizedTargets.push(
      Object.assign({}, target, {
        pid: pid,
      })
    );
  }
  if (!normalizedTargets.length) {
    return { closed: true, forced: false };
  }

  for (let target of normalizedTargets) {
    ZeroMcpPluginCommon.terminateProcessTree(target.pid, false);
  }

  let allClosed = true;
  for (let target of normalizedTargets) {
    let closed = await ZeroMcpPluginCommon.waitForProcessExit(target.pid, 2500, executablePath);
    if (!closed) {
      allClosed = false;
    }
  }

  if (allClosed) {
    return { closed: true, forced: false };
  }

  for (let target of normalizedTargets) {
    if (await ZeroMcpPluginCommon.isProcessAlive(target.pid, executablePath)) {
      ZeroMcpPluginCommon.terminateProcessTree(target.pid, true);
    }
  }

  let forcedClosed = true;
  for (let target of normalizedTargets) {
    let closed = await ZeroMcpPluginCommon.waitForProcessExit(target.pid, 1500, executablePath);
    if (!closed) {
      forcedClosed = false;
    }
  }

  return { closed: forcedClosed, forced: true };
}

async function cleanupExtraneousHelperProcesses(config, preservedPid) {
  let normalizedPreservedPid = String(preservedPid || "").trim();
  if (!config || !config.executablePath || !normalizedPreservedPid) {
    return { closed: true, removed: 0, forced: false };
  }

  let targets = await collectManagedHelperTargets({
    executablePath: config.executablePath,
    port: config.port,
    includeCurrentPort: true,
    includeAllMatching: true,
  });
  let staleTargets = targets.filter((target) => String(target.pid || "").trim() !== normalizedPreservedPid);
  if (!staleTargets.length) {
    return { closed: true, removed: 0, forced: false };
  }

  let result = await terminateHelperTargets(staleTargets, config.executablePath);
  return {
    closed: result.closed,
    removed: staleTargets.length,
    forced: result.forced,
  };
}

function adoptHealthyHelper(inspection, config, statusMessageKey) {
  if (!inspection) {
    throw helperLifecycleError("HELPER_NOT_RUNNING", "The helper is not reachable");
  }
  markManagedHelper(inspection.pid, inspection.command || config.executablePath, true);
  persistStableHelperConfig(config);
  updateHelperRuntimeState({
    helperState: "running",
    statusMessageKey: statusMessageKey || "available",
    lastErrorCode: "",
  });
  return buildHelperRuntimeStateSnapshot();
}

function startManagedHelperProcess(config) {
  requireValidHelperExecutable(config);

  updateHelperRuntimeState({
    helperState: "starting",
    statusMessageKey: "starting",
    lastErrorCode: "",
    config: config,
  });
  let result = ZeroMcpPluginCommon.startManagedMcpProcess(config.executablePath, config.port);
  markManagedHelper(result.pid, config.executablePath, true);
  return result;
}

async function isManagedHelperLaunchPending(config, inspection) {
  let managedPid = getManagedMcpPid();
  if (managedPid && (await ZeroMcpPluginCommon.isProcessAlive(managedPid, config.executablePath))) {
    return true;
  }

  if (inspection && inspection.kind === "stale-helper") {
    return true;
  }

  let matchingInfo = await ZeroMcpPluginCommon.findMatchingListeningProcessInfo(
    config.port,
    config.executablePath
  );
  return !!(matchingInfo && matchingInfo.pid);
}

async function waitForHealthyHelper(config, maxAttempts, delayMs) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let inspection = await inspectHelperPort(config.port, config.executablePath);
    if (inspection.kind === "healthy-helper") {
      return inspection;
    }
    if (inspection.kind === "conflict") {
      throw helperLifecycleError(
        "PORT_IN_USE",
        "Port " + config.port + " is occupied by another process",
        { port: config.port, pid: inspection.pid || null }
      );
    }
    await waitForDelay(delayMs);
  }

  let finalInspection = await inspectHelperPort(config.port, config.executablePath);
  if (finalInspection.kind === "healthy-helper") {
    return finalInspection;
  }

  if (await isManagedHelperLaunchPending(config, finalInspection)) {
    return {
      kind: "starting-slow",
      port: config.port,
      pid: finalInspection.pid || getManagedMcpPid() || "",
      command: finalInspection.command || getLastKnownManagedCommand() || config.executablePath,
      probe: finalInspection.probe || null,
    };
  }

  throw helperLifecycleError(
    "HELPER_START_TIMEOUT",
    "The helper did not become reachable on port " + config.port + " in time",
    { port: config.port }
  );
}

async function stopManagedHelper(reason, options) {
  let params = options || {};
  let config = buildHelperConfigSnapshot(params.config || null);
  updateHelperRuntimeState({
    helperState: "stopping",
    statusMessageKey: "stopping",
    lastErrorCode: "",
    config: config,
  });

  let targets = await collectManagedHelperTargets({
    executablePath: params.executablePath || config.executablePath,
    port: Object.prototype.hasOwnProperty.call(params, "port") ? params.port : config.port,
    additionalPort: params.additionalPort,
    includeCurrentPort: params.includeCurrentPort !== false,
    includeAllMatching: params.includeAllMatching !== false,
    recordedPid: params.recordedPid,
  });

  if (!targets.length) {
    clearManagedHelperState();
    updateHelperRuntimeState({
      helperState: "idle",
      statusMessageKey: "stopped",
      lastErrorCode: "",
    });
    return buildHelperRuntimeStateSnapshot();
  }

  let result = await terminateHelperTargets(targets, config.executablePath);
  if (!result.closed) {
    updateHelperRuntimeState({
      helperState: "error",
      statusMessageKey: "stop-failed",
      lastErrorCode: "HELPER_STOP_FAILED",
    });
    throw helperLifecycleError(
      "HELPER_STOP_FAILED",
      "Failed to stop the previously managed helper process"
    );
  }

  clearManagedHelperState();
  updateHelperRuntimeState({
    helperState: "idle",
    statusMessageKey: "stopped",
    lastErrorCode: "",
  });
  return buildHelperRuntimeStateSnapshot();
}

async function ensureHelperForCurrentConfig(reason, options) {
  let config = buildHelperConfigSnapshot((options && options.config) || null);
  updateHelperRuntimeState({
    helperState: "checking",
    statusMessageKey: "checking",
    lastErrorCode: "",
    config: config,
  });

  if (!config.executablePath) {
    clearManagedHelperState();
    updateHelperRuntimeState({
      helperState: "idle",
      statusMessageKey: "helper-path-missing",
      lastErrorCode: "",
    });
    return buildHelperRuntimeStateSnapshot();
  }

  requireValidHelperExecutable(config);

  let inspection = (options && options.inspection) || (await inspectHelperPort(config.port, config.executablePath));
  if (inspection.kind === "healthy-helper") {
    let adopted = adoptHealthyHelper(inspection, config, "available");
    if (inspection.pid) {
      cleanupExtraneousHelperProcesses(config, inspection.pid).catch((error) => {
        ZeroMcpPluginCommon.logError(error);
      });
    }
    return adopted;
  }

  if (inspection.kind === "conflict") {
    updateHelperRuntimeState({
      helperState: "error",
      statusMessageKey: "port-conflict",
      lastErrorCode: "PORT_IN_USE",
      config: config,
    });
    throw helperLifecycleError(
      "PORT_IN_USE",
      "Port " + config.port + " is occupied by another process",
      { port: config.port, pid: inspection.pid || null }
    );
  }

  let staleTargets = await collectManagedHelperTargets({
    executablePath: config.executablePath,
    port: config.port,
    includeCurrentPort: true,
  });
  if (inspection.kind === "stale-helper" && inspection.pid) {
    staleTargets.push({
      pid: inspection.pid,
      command: inspection.command || "",
      source: "stale-port",
    });
  }
  if (staleTargets.length) {
    let staleResult = await terminateHelperTargets(staleTargets, config.executablePath);
    if (!staleResult.closed) {
      updateHelperRuntimeState({
        helperState: "error",
        statusMessageKey: "restart-rollback",
        lastErrorCode: "OLD_HELPER_STILL_RUNNING",
        config: config,
      });
      throw helperLifecycleError(
        "OLD_HELPER_STILL_RUNNING",
        "The previous helper process could not be terminated before restart"
      );
    }
    clearManagedHelperState();
    await waitForDelay(150);
  }

  startManagedHelperProcess(config);
  let readyInspection = await waitForHealthyHelper(config, 16, 500);
  if (readyInspection.kind === "starting-slow") {
    markManagedHelper(readyInspection.pid, readyInspection.command || config.executablePath, true);
    updateHelperRuntimeState({
      helperState: "starting",
      statusMessageKey: "starting-slow",
      lastErrorCode: "",
      config: config,
    });
    return buildHelperRuntimeStateSnapshot();
  }
  let adopted = adoptHealthyHelper(readyInspection, config, "available");
  if (readyInspection.pid) {
    cleanupExtraneousHelperProcesses(config, readyInspection.pid).catch((error) => {
      ZeroMcpPluginCommon.logError(error);
    });
  }
  return adopted;
}

async function refreshHelperRuntimeState(reason) {
  let config = buildHelperConfigSnapshot();
  if (!config.executablePath) {
    clearManagedHelperState();
    updateHelperRuntimeState({
      helperState: "idle",
      statusMessageKey: "helper-path-missing",
      lastErrorCode: "",
      config: config,
    });
    return buildHelperRuntimeStateSnapshot();
  }

  let validation = inspectConfiguredHelperPath(config);
  if (!validation.ok) {
    applyHelperValidationFailure(config, validation);
    return buildHelperRuntimeStateSnapshot();
  }
  config.executablePath = validation.path || config.executablePath;

  let inspection = await inspectHelperPort(config.port, config.executablePath);
  if (inspection.kind === "healthy-helper") {
    let adopted = adoptHealthyHelper(inspection, config, "available");
    if (inspection.pid) {
      cleanupExtraneousHelperProcesses(config, inspection.pid).catch((error) => {
        ZeroMcpPluginCommon.logError(error);
      });
    }
    return adopted;
  }

  if (inspection.kind === "conflict") {
    clearManagedHelperState();
    updateHelperRuntimeState({
      helperState: "error",
      statusMessageKey: "port-conflict",
      lastErrorCode: "PORT_IN_USE",
      config: config,
    });
    return buildHelperRuntimeStateSnapshot();
  }

  if (getManagedByPlugin() && (await isManagedHelperLaunchPending(config, inspection))) {
    updateHelperRuntimeState({
      helperState: "starting",
      statusMessageKey:
        helperRuntimeState.helperState === "restarting" ? "restarting" : "starting-slow",
      lastErrorCode: "",
      config: config,
    });
    return buildHelperRuntimeStateSnapshot();
  }

  clearManagedHelperState();
  updateHelperRuntimeState({
    helperState: "idle",
    statusMessageKey: "idle",
    lastErrorCode: inspection.kind === "stale-helper" ? "HELPER_NOT_HEALTHY" : "",
    config: config,
  });
  return buildHelperRuntimeStateSnapshot();
}

async function maybeRecoverManagedHelper() {
  if (!getManagedByPlugin() || ZeroMcpPlugin._shuttingDown) {
    return buildHelperRuntimeStateSnapshot();
  }

  let config = buildHelperConfigSnapshot();
  if (!config.executablePath) {
    return buildHelperRuntimeStateSnapshot();
  }

  let validation = inspectConfiguredHelperPath(config);
  if (!validation.ok) {
    applyHelperValidationFailure(config, validation);
    return buildHelperRuntimeStateSnapshot();
  }
  config.executablePath = validation.path || config.executablePath;

  let inspection = await inspectHelperPort(config.port, config.executablePath);
  if (inspection.kind === "healthy-helper") {
    if (inspection.pid && inspection.pid !== getManagedMcpPid()) {
      adoptHealthyHelper(inspection, config, "available");
    }
    if (inspection.pid) {
      cleanupExtraneousHelperProcesses(config, inspection.pid).catch((error) => {
        ZeroMcpPluginCommon.logError(error);
      });
    }
    return buildHelperRuntimeStateSnapshot();
  }

  if (await isManagedHelperLaunchPending(config, inspection)) {
    updateHelperRuntimeState({
      helperState: "starting",
      statusMessageKey:
        helperRuntimeState.helperState === "restarting" ? "restarting" : "starting-slow",
      lastErrorCode: "",
      config: config,
    });
    return buildHelperRuntimeStateSnapshot();
  }

  let attempts = getHelperRecoveryAttempts();
  let maxAttempts = getHelperRecoveryMaxAttempts();
  if (attempts >= maxAttempts) {
    updateHelperRuntimeState({
      helperState: "error",
      statusMessageKey: "recovery-exhausted",
      lastErrorCode: "RECOVERY_EXHAUSTED",
      config: config,
    });
    return buildHelperRuntimeStateSnapshot();
  }

  setHelperRecoveryAttempts(attempts + 1);
  updateHelperRuntimeState({
    helperState: "restarting",
    statusMessageKey: "recovery-running",
    lastErrorCode: "HELPER_RECOVERING",
    config: config,
  });

  try {
    return await ensureHelperForCurrentConfig("runtime-recovery");
  } catch (error) {
    if (getHelperRecoveryAttempts() >= maxAttempts) {
      updateHelperRuntimeState({
        helperState: "error",
        statusMessageKey: "recovery-exhausted",
        lastErrorCode: "RECOVERY_EXHAUSTED",
        config: config,
      });
    }
    throw error;
  }
}

async function testOrRecoverHelper(reason) {
  let config = buildHelperConfigSnapshot();
  if (!config.executablePath) {
    clearManagedHelperState();
    updateHelperRuntimeState({
      helperState: "idle",
      statusMessageKey: "helper-path-missing",
      lastErrorCode: "",
      config: config,
    });
    return buildHelperRuntimeStateSnapshot();
  }

  requireValidHelperExecutable(config);

  let inspection = await inspectHelperPort(config.port, config.executablePath);
  if (inspection.kind === "healthy-helper") {
    let adopted = adoptHealthyHelper(inspection, config, "available");
    if (inspection.pid) {
      cleanupExtraneousHelperProcesses(config, inspection.pid).catch((error) => {
        ZeroMcpPluginCommon.logError(error);
      });
    }
    return adopted;
  }

  if (await isManagedHelperLaunchPending(config, inspection)) {
    updateHelperRuntimeState({
      helperState: "starting",
      statusMessageKey: "starting-slow",
      lastErrorCode: "",
      config: config,
    });
    return buildHelperRuntimeStateSnapshot();
  }

  updateHelperRuntimeState({
    helperState: "starting",
    statusMessageKey: "starting",
    lastErrorCode: "",
    config: config,
  });
  return ensureHelperForCurrentConfig(reason || "manual-test");
}

async function restartHelperForConfigChange(changeType, nextConfig, previousConfig) {
  let previous = buildHelperConfigSnapshot(previousConfig || null);
  let candidate = buildHelperConfigSnapshot(Object.assign({}, previous, nextConfig || {}));
  if (candidate.executablePath) {
    requireValidHelperExecutable(candidate);
  }
  let preflight = await inspectHelperPort(candidate.port, candidate.executablePath || previous.executablePath);

  if (changeType === "port" && candidate.port !== previous.port && preflight.kind === "conflict") {
    updateHelperRuntimeState({
      helperState: "error",
      statusMessageKey: "port-conflict",
      lastErrorCode: "PORT_IN_USE",
      config: previous,
    });
    throw helperLifecycleError(
      "PORT_IN_USE",
      "Port " + candidate.port + " is occupied by another process",
      { port: candidate.port, pid: preflight.pid || null }
    );
  }

  updateHelperRuntimeState({
    helperState: "restarting",
    statusMessageKey: "restarting",
    lastErrorCode: "",
    config: candidate,
  });

  let previousPrefs = {
    executablePath: getMcpExecutablePath(),
    port: String(getLocalMcpPort()),
    token: getSharedSecret(),
  };

  setStringPref("mcpExecutablePath", candidate.executablePath);
  setStringPref("localMcpPort", String(candidate.port));
  setStringPref("sharedSecret", candidate.token);

  try {
    let stopTargets = await collectManagedHelperTargets({
      executablePath: previous.executablePath || candidate.executablePath,
      port: previous.port,
      includeCurrentPort: false,
      includeAllMatching: true,
    });
    if (
      changeType !== "port" &&
      preflight.kind === "healthy-helper" &&
      preflight.pid
    ) {
      stopTargets.push({
        pid: preflight.pid,
        command: preflight.command || "",
        source: "current-port",
      });
    }
    if (preflight.kind === "stale-helper" && preflight.pid) {
      stopTargets.push({
        pid: preflight.pid,
        command: preflight.command || "",
        source: "target-port",
      });
    }

    if (stopTargets.length) {
      let stopResult = await terminateHelperTargets(stopTargets, previous.executablePath || candidate.executablePath);
      if (!stopResult.closed) {
        throw helperLifecycleError(
          "OLD_HELPER_STILL_RUNNING",
          "The previous helper process could not be terminated before restart"
        );
      }
      clearManagedHelperState();
      await waitForDelay(150);
    }

    if (!candidate.executablePath) {
      persistStableHelperConfig(candidate);
      clearManagedHelperState();
      updateHelperRuntimeState({
        helperState: "idle",
        statusMessageKey: "helper-path-missing",
        lastErrorCode: "",
        config: candidate,
      });
      return buildHelperRuntimeStateSnapshot();
    }

    if (
      changeType === "port" &&
      candidate.port !== previous.port &&
      preflight.kind === "healthy-helper"
    ) {
      let adopted = adoptHealthyHelper(preflight, candidate, "available");
      if (preflight.pid) {
        cleanupExtraneousHelperProcesses(candidate, preflight.pid).catch((error) => {
          ZeroMcpPluginCommon.logError(error);
        });
      }
      return adopted;
    }

    return await ensureHelperForCurrentConfig("config-change-" + changeType);
  } catch (error) {
    setStringPref("mcpExecutablePath", previousPrefs.executablePath);
    setStringPref("localMcpPort", previousPrefs.port);
    setStringPref("sharedSecret", previousPrefs.token);
    updateHelperRuntimeState({
      helperState: "error",
      statusMessageKey: "restart-rollback",
      lastErrorCode: error.code || "CONFIG_RESTART_FAILED",
      config: previous,
    });
    try {
      await ensureHelperForCurrentConfig("config-rollback-" + changeType, { config: previous });
    } catch (rollbackError) {
      ZeroMcpPluginCommon.logError(rollbackError);
    }
    throw error;
  }
}

function getLibraryID() {
  return Zotero.Libraries.userLibraryID;
}

function splitCollectionPath(collectionPath) {
  if (!collectionPath || typeof collectionPath !== "string") {
    throw bridgeError(400, "VALIDATION_ERROR", "collectionPath must be a non-empty string");
  }
  let segments = collectionPath
    .split("/")
    .map(function (segment) {
      return segment.trim();
    })
    .filter(Boolean);
  if (!segments.length) {
    throw bridgeError(
      400,
      "VALIDATION_ERROR",
      "collectionPath must contain at least one segment"
    );
  }
  return segments;
}

function formatCollectionPath(collection) {
  let names = [];
  let current = collection;
  while (current) {
    names.unshift(current.name);
    current = current.parentID ? Zotero.Collections.get(current.parentID) : null;
  }
  return names.join("/");
}

function getChildrenForParent(libraryID, parentCollection) {
  if (!parentCollection) {
    return Zotero.Collections.getByLibrary(libraryID, false, false);
  }
  if (!parentCollection.id) {
    return [];
  }
  return Zotero.Collections.getByParent(parentCollection.id, false, false);
}

function findCollectionByName(libraryID, parentCollection, name) {
  let matches = getChildrenForParent(libraryID, parentCollection).filter(function (collection) {
    return !collection.deleted && collection.name === name;
  });
  if (matches.length > 1) {
    let parentPath = parentCollection ? formatCollectionPath(parentCollection) : "(root)";
    throw bridgeError(
      409,
      "AMBIGUOUS_COLLECTION_NAME",
      "Multiple collections named '" + name + "' exist under " + parentPath
    );
  }
  return matches.length ? matches[0] : null;
}

async function resolveCollectionByReference(collectionKey, collectionPath, required) {
  let libraryID = getLibraryID();
  if (collectionKey) {
    let collection = await Zotero.Collections.getByLibraryAndKeyAsync(libraryID, collectionKey);
    if (collection) {
      return collection;
    }
    if (required) {
      throw bridgeError(404, "COLLECTION_NOT_FOUND", "No collection found for key " + collectionKey);
    }
    return null;
  }

  if (!collectionPath) {
    if (required) {
      throw bridgeError(
        400,
        "VALIDATION_ERROR",
        "collectionKey or collectionPath must be provided"
      );
    }
    return null;
  }

  let segments = splitCollectionPath(collectionPath);
  let current = null;
  for (let segment of segments) {
    let match = findCollectionByName(libraryID, current, segment);
    if (!match) {
      if (required) {
        throw bridgeError(
          404,
          "COLLECTION_NOT_FOUND",
          "No collection found for path " + collectionPath
        );
      }
      return null;
    }
    current = match;
  }
  return current;
}

async function createCollectionFromPayload(data) {
  let libraryID = getLibraryID();
  let ifExists = data.ifExists || "error";
  let dryRun = !!data.dryRun;
  let createMissingParents = !!data.createMissingParents;

  if (data.path) {
    let segments = splitCollectionPath(data.path);
    let current = null;
    let createdParents = [];

    for (let index = 0; index < segments.length; index++) {
      let segment = segments[index];
      let isFinal = index === segments.length - 1;
      let existing = findCollectionByName(libraryID, current, segment);

      if (existing) {
        if (isFinal) {
          if (ifExists === "return_existing") {
            return okBody({
              created: false,
              createdParents: createdParents,
              warnings: [],
              collectionKey: existing.key,
              path: formatCollectionPath(existing),
            });
          }
          throw bridgeError(
            409,
            "DUPLICATE_COLLECTION",
            "Collection already exists at path " + formatCollectionPath(existing)
          );
        }
        current = existing;
        continue;
      }

      if (!isFinal && !createMissingParents) {
        throw bridgeError(
          404,
          "COLLECTION_NOT_FOUND",
          "Missing parent collection while creating path " + data.path
        );
      }

      let parentKey = current ? current.key : null;
      let nextPath = current ? formatCollectionPath(current) + "/" + segment : segment;
      if (dryRun) {
        if (!isFinal) {
          createdParents.push(nextPath);
          current = {
            key: null,
            id: null,
            name: segment,
            parentID: current && current.id ? current.id : null,
          };
          continue;
        }
        return okBody({
          created: false,
          dryRun: true,
          wouldCreate: true,
          createdParents: createdParents,
          collectionKey: null,
          path: nextPath,
          warnings: [],
        });
      }

      let created = new Zotero.Collection({
        name: segment,
        libraryID: libraryID,
        parentKey: parentKey || false,
      });
      await created.saveTx();
      current = created;
      if (!isFinal) {
        createdParents.push(formatCollectionPath(created));
      }
    }

    return okBody(
      {
        created: true,
        createdParents: createdParents,
        warnings: [],
        collectionKey: current.key,
        path: formatCollectionPath(current),
      },
      201
    );
  }

  if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
    throw bridgeError(
      400,
      "VALIDATION_ERROR",
      "name or path must be provided when creating a collection"
    );
  }

  let parentCollection = await resolveCollectionByReference(
    data.parentCollectionKey,
    data.parentCollectionPath,
    false
  );
  if ((data.parentCollectionKey || data.parentCollectionPath) && !parentCollection) {
    throw bridgeError(
      404,
      "COLLECTION_NOT_FOUND",
      "The specified parent collection could not be resolved"
    );
  }

  let cleanedName = data.name.trim();
  let existing = findCollectionByName(libraryID, parentCollection, cleanedName);
  if (existing) {
    if (ifExists === "return_existing") {
      return okBody({
        created: false,
        createdParents: [],
        warnings: [],
        collectionKey: existing.key,
        path: formatCollectionPath(existing),
      });
    }
    throw bridgeError(
      409,
      "DUPLICATE_COLLECTION",
      "Collection already exists at path " + formatCollectionPath(existing)
    );
  }

  let resolvedPath = parentCollection
    ? formatCollectionPath(parentCollection) + "/" + cleanedName
    : cleanedName;

  if (dryRun) {
    return okBody({
      created: false,
      dryRun: true,
      wouldCreate: true,
      createdParents: [],
      collectionKey: null,
      path: resolvedPath,
      warnings: [],
    });
  }

  let createdCollection = new Zotero.Collection({
    name: cleanedName,
    libraryID: libraryID,
    parentKey: parentCollection ? parentCollection.key : false,
  });
  await createdCollection.saveTx();

  return okBody(
    {
      created: true,
      createdParents: [],
      warnings: [],
      collectionKey: createdCollection.key,
      path: formatCollectionPath(createdCollection),
    },
    201
  );
}

async function ensureCollectionTarget(data) {
  let collection = await resolveCollectionByReference(
    data.targetCollectionKey,
    data.targetCollectionPath,
    false
  );
  if (collection) {
    return { collection: collection, createdTarget: false };
  }
  if (!data.targetCollectionPath || !data.createTargetIfMissing) {
    throw bridgeError(404, "COLLECTION_NOT_FOUND", "The target collection could not be resolved");
  }

  let createResponse = await createCollectionFromPayload({
    path: data.targetCollectionPath,
    createMissingParents: true,
    ifExists: "return_existing",
    dryRun: !!data.dryRun,
  });

  if (data.dryRun) {
    return {
      collection: null,
      createdTarget: true,
      createdTargetPreview: createResponse.body.path,
    };
  }

  collection = await resolveCollectionByReference(null, data.targetCollectionPath, true);
  return { collection: collection, createdTarget: true };
}

function getItemTitle(item) {
  if (!item) {
    return "";
  }
  if (typeof item.getField === "function") {
    return item.getField("title") || "";
  }
  return item.title || "";
}

function normalizeIdentifierForLookup(identifier) {
  let cleaned = String(identifier || "").trim();
  if (!cleaned) {
    return cleaned;
  }

  try {
    if (Zotero.Utilities && typeof Zotero.Utilities.extractIdentifiers === "function") {
      let extracted = Zotero.Utilities.extractIdentifiers(cleaned);
      if (Array.isArray(extracted) && extracted.length) {
        return extracted[0];
      }
    }
  } catch (error) {}

  return cleaned;
}

async function applyImportedItemTags(items, tags) {
  let cleanedTags = (tags || [])
    .filter(function (tag) {
      return typeof tag === "string" && tag.trim();
    })
    .map(function (tag) {
      return tag.trim();
    });
  if (!cleanedTags.length) {
    return;
  }

  for (let item of items || []) {
    if (!item || typeof item.setTags !== "function") {
      continue;
    }
    let existingTags = [];
    try {
      existingTags = (item.getTags ? item.getTags() : [])
        .map(function (entry) {
          return entry && entry.tag ? String(entry.tag).trim() : "";
        })
        .filter(Boolean);
    } catch (error) {}
    let merged = Array.from(new Set(existingTags.concat(cleanedTags)));
    item.setTags(merged);
    await item.saveTx();
  }
}

async function importItemsFromIdentifier(data) {
  let identifier = String(data.identifier || "").trim();
  if (!identifier) {
    throw bridgeError(400, "VALIDATION_ERROR", "identifier must be provided");
  }

  let targetResult = await ensureCollectionTarget(data);
  let translate = new Zotero.Translate.Search();
  let normalizedIdentifier = normalizeIdentifierForLookup(identifier);
  translate.setIdentifier(normalizedIdentifier);
  let translators = await translate.getTranslators();
  if (!translators || !translators.length) {
    throw bridgeError(404, "IDENTIFIER_NOT_FOUND", "No translator could resolve identifier " + identifier);
  }
  translate.setTranslator(translators);

  let importedItems = await translate.translate({
    libraryID: data.dryRun ? false : getLibraryID(),
    collections: data.dryRun || !targetResult.collection ? false : [targetResult.collection.id],
    saveAttachments: !!data.saveAttachments,
  });

  if (!Array.isArray(importedItems) || !importedItems.length) {
    throw bridgeError(404, "IDENTIFIER_NOT_FOUND", "No items were imported for identifier " + identifier);
  }

  if (!data.dryRun) {
    await applyImportedItemTags(importedItems, data.tags);
  }

  return {
    importedItems: importedItems,
    targetResult: targetResult,
    summary: {
      status: data.dryRun ? "dry_run" : "imported",
      dryRun: !!data.dryRun,
      identifier: identifier,
      normalizedIdentifier: typeof normalizedIdentifier === "string"
        ? normalizedIdentifier
        : cloneJSON(normalizedIdentifier),
      importedCount: importedItems.length,
      itemKeys: importedItems.map(function (item) {
        return item && item.key ? item.key : null;
      }).filter(Boolean),
      titles: importedItems.map(getItemTitle).filter(Boolean),
      targetCollectionKey: targetResult.collection ? targetResult.collection.key : null,
      targetCollectionPath: targetResult.collection
        ? formatCollectionPath(targetResult.collection)
        : targetResult.createdTargetPreview || null,
      createdTarget: !!targetResult.createdTarget,
      saveAttachments: !!data.saveAttachments,
      warnings: [
        data.saveAttachments
          ? "Metadata import may save attachments when Zotero can resolve them, but PDF attachment is not guaranteed"
          : "Metadata import does not guarantee a PDF attachment; prefer importPdfToCollection when a PDF is available",
      ],
    },
  };
}

async function importItemsFromBibtex(data) {
  let bibtex = String(data.bibtex || "").trim();
  if (!bibtex) {
    throw bridgeError(400, "VALIDATION_ERROR", "bibtex must be provided");
  }

  let targetResult = await ensureCollectionTarget(data);
  let translate = new Zotero.Translate.Import();
  translate.setString(bibtex);
  let translators = await translate.getTranslators();
  if (!translators || !translators.length) {
    throw bridgeError(400, "TRANSLATOR_NOT_FOUND", "No import translator could parse the provided BibTeX");
  }
  let translator =
    translators.find(function (entry) {
      return entry && entry.label === "BibTeX";
    }) || translators[0];
  translate.setTranslator(translator);

  let importedItems = await translate.translate({
    libraryID: data.dryRun ? false : getLibraryID(),
    collections: data.dryRun || !targetResult.collection ? false : [targetResult.collection.id],
    saveAttachments: !!data.saveAttachments,
  });

  if (!Array.isArray(importedItems) || !importedItems.length) {
    throw bridgeError(400, "IMPORT_EMPTY", "The provided BibTeX did not produce any items");
  }

  if (!data.dryRun) {
    await applyImportedItemTags(importedItems, data.tags);
  }

  return {
    importedItems: importedItems,
    targetResult: targetResult,
    summary: {
      status: data.dryRun ? "dry_run" : "imported",
      dryRun: !!data.dryRun,
      translatorLabel: translator && translator.label ? translator.label : "BibTeX",
      importedCount: importedItems.length,
      itemKeys: importedItems.map(function (item) {
        return item && item.key ? item.key : null;
      }).filter(Boolean),
      titles: importedItems.map(getItemTitle).filter(Boolean),
      targetCollectionKey: targetResult.collection ? targetResult.collection.key : null,
      targetCollectionPath: targetResult.collection
        ? formatCollectionPath(targetResult.collection)
        : targetResult.createdTargetPreview || null,
      createdTarget: !!targetResult.createdTarget,
      saveAttachments: !!data.saveAttachments,
      warnings: [
        data.saveAttachments
          ? "BibTeX import may create linked attachments if attachment fields are present, but PDF attachment is not guaranteed"
          : "BibTeX import is metadata-first and does not guarantee a PDF attachment; prefer importPdfToCollection when a PDF is available",
      ],
    },
  };
}

async function getItemByKey(itemKey) {
  let item = await Zotero.Items.getByLibraryAndKeyAsync(getLibraryID(), itemKey);
  if (!item) {
    throw bridgeError(404, "ITEM_NOT_FOUND", "No item found for key " + itemKey);
  }
  return item;
}

function buildCreators(authors) {
  return (authors || [])
    .filter(function (author) {
      return typeof author === "string" && author.trim();
    })
    .map(function (author) {
      let cleaned = author.trim();
      let parts = cleaned.split(/\s+/);
      if (parts.length <= 1) {
        return { name: cleaned, creatorType: "author" };
      }
      return {
        firstName: parts.slice(0, -1).join(" "),
        lastName: parts[parts.length - 1],
        creatorType: "author",
      };
    });
}

function getFallbackTitle(filePath) {
  let file = Zotero.File.pathToFile(filePath);
  let leafName = file.leafName || "Imported PDF";
  return leafName.replace(/\.pdf$/i, "");
}

async function createParentItem(targetCollection, data) {
  let item = new Zotero.Item("report");
  item.libraryID = getLibraryID();
  item.setField("title", data.title || getFallbackTitle(data.filePath));
  if (data.year) {
    item.setField("date", String(data.year));
  }
  if (data.doi) {
    item.setField("DOI", data.doi);
  }
  let creators = buildCreators(data.authors);
  if (creators.length) {
    item.setCreators(creators);
  }
  if (Array.isArray(data.tags) && data.tags.length) {
    item.setTags(data.tags);
  }
  item.addToCollection(targetCollection.key);
  await item.saveTx();
  return item;
}

async function createAttachmentForItem(parentItem, data) {
  let options = {
    file: data.filePath,
    parentItemID: parentItem.id,
    title: data.title || getFallbackTitle(data.filePath),
  };
  if (data.linkMode === "linked_file") {
    return Zotero.Attachments.linkFromFile(options);
  }
  return Zotero.Attachments.importFromFile(options);
}

function attachmentCandidatesForTopLevel(item) {
  if (item.isAttachment()) {
    return [item];
  }
  return Zotero.Items.get(item.getAttachments()).filter(function (attachment) {
    return attachment && attachment.isFileAttachment();
  });
}

function normalizeForMatch(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function extractYear(value) {
  let match = String(value || "").match(/(19|20)\d{2}/);
  return match ? match[0] : "";
}

function buildDuplicateMatch(reason, item, attachment, extra) {
  return {
    reason: reason,
    itemKey: item ? item.key : null,
    attachmentKey: attachment ? attachment.key : null,
    details: extra || null,
  };
}

async function findDuplicateMatch(data) {
  let topLevelItems = await Zotero.Items.getAll(getLibraryID(), true, false);

  if (data.doi) {
    let targetDOI = normalizeForMatch(data.doi);
    for (let item of topLevelItems) {
      let itemDOI = normalizeForMatch(item.getField("DOI"));
      if (itemDOI && itemDOI === targetDOI) {
        let firstAttachment = attachmentCandidatesForTopLevel(item)[0] || null;
        return {
          item: item,
          attachment: firstAttachment,
          match: buildDuplicateMatch("doi", item, firstAttachment, { doi: data.doi }),
        };
      }
    }
  }

  let incomingHash = await Zotero.Utilities.Internal.md5Async(data.filePath);
  if (incomingHash) {
    for (let item of topLevelItems) {
      let attachments = attachmentCandidatesForTopLevel(item);
      for (let attachment of attachments) {
        let attachmentPath = await attachment.getFilePathAsync();
        if (!attachmentPath) {
          continue;
        }
        let existingHash = await Zotero.Utilities.Internal.md5Async(attachmentPath);
        if (existingHash && existingHash === incomingHash) {
          return {
            item: item,
            attachment: attachment,
            match: buildDuplicateMatch("file_hash", item, attachment, {
              fileHash: incomingHash,
            }),
          };
        }
      }
    }
  }

  if (data.title && data.year) {
    let targetTitle = normalizeForMatch(data.title);
    let targetYear = extractYear(data.year);
    for (let item of topLevelItems) {
      let itemTitle = normalizeForMatch(item.getField("title"));
      let itemYear = extractYear(item.getField("date"));
      if (itemTitle && itemYear && itemTitle === targetTitle && itemYear === targetYear) {
        let firstAttachment = attachmentCandidatesForTopLevel(item)[0] || null;
        return {
          item: item,
          attachment: firstAttachment,
          match: buildDuplicateMatch("title_year", item, firstAttachment, {
            title: data.title,
            year: targetYear,
          }),
        };
      }
    }
  }

  return null;
}

async function ensureItemInCollection(item, targetCollection) {
  let currentIDs = item.getCollections();
  if (currentIDs.includes(targetCollection.id)) {
    return false;
  }
  item.addToCollection(targetCollection.key);
  await item.saveTx();
  return true;
}

function directChildItemsForCollection(collection) {
  if (!collection) {
    return [];
  }

  if (typeof collection.getChildItems === "function") {
    try {
      let children = collection.getChildItems(false, false) || [];
      if (!children.length) {
        return [];
      }
      if (typeof children[0] === "number") {
        return Zotero.Items.get(children).filter(Boolean);
      }
      return children.filter(Boolean);
    } catch (error) {}
  }

  try {
    return (collection.getDescendents(false, null, false) || [])
      .filter(function (entry) {
        return entry && entry.type === "item";
      })
      .map(function (entry) {
        return entry.id ? Zotero.Items.get(entry.id) : null;
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function remainingCollectionKeys(item) {
  return item
    .getCollections()
    .map(function (collectionID) {
      let collection = Zotero.Collections.get(collectionID);
      return collection ? collection.key : null;
    })
    .filter(Boolean);
}

function childItemIDsForItem(item) {
  if (!item) {
    return [];
  }

  try {
    if (typeof item.isRegularItem === "function" && !item.isRegularItem()) {
      return [];
    }
  } catch (error) {
    return [];
  }

  let childIDs = [];
  if (typeof item.getAttachments === "function") {
    try {
      childIDs = childIDs.concat(item.getAttachments() || []);
    } catch (error) {}
  }
  if (typeof item.getNotes === "function") {
    try {
      childIDs = childIDs.concat(item.getNotes() || []);
    } catch (error) {}
  }
  return childIDs.filter(Boolean);
}

async function trashItems(itemIDs) {
  if (Zotero.Items && typeof Zotero.Items.trashTx === "function") {
    await Zotero.Items.trashTx(itemIDs);
    return;
  }

  for (let itemID of itemIDs) {
    let item = Zotero.Items.get(itemID);
    if (!item) {
      continue;
    }
    item.deleted = true;
    await item.saveTx();
  }
}

function ensureImportPathAllowed(filePath) {
  let file = Zotero.File.pathToFile(filePath);
  if (!file.exists()) {
    throw bridgeError(400, "FILE_NOT_FOUND", "File does not exist: " + filePath);
  }
  if (!/\.pdf$/i.test(file.leafName || "")) {
    throw bridgeError(400, "UNSUPPORTED_FILE_TYPE", "Only PDF files are supported in v1");
  }

  let bufferDirectory = getBufferDirectory();
  if (bufferDirectory) {
    let bufferRoot = Zotero.File.pathToFile(bufferDirectory);
    if (bufferRoot.exists()) {
      try {
        if (bufferRoot.path === file.path || bufferRoot.contains(file, true)) {
          return;
        }
      } catch (error) {}
    }
  }

  // Non-buffer imports are allowed as long as the file exists and is a PDF.
}

function collectPdfFilesFromDirectory(directoryPath, recursiveScan) {
  let directory = Zotero.File.pathToFile(directoryPath);
  if (!directory.exists() || !directory.isDirectory()) {
    throw bridgeError(400, "DIRECTORY_NOT_FOUND", "directoryPath must point to an existing directory");
  }

  let files = [];
  let visit = function (folder) {
    let entries = folder.directoryEntries;
    while (entries.hasMoreElements()) {
      let entry = entries.getNext().QueryInterface(Ci.nsIFile);
      if (entry.isDirectory()) {
        if (recursiveScan) {
          visit(entry);
        }
        continue;
      }
      if (/\.pdf$/i.test(entry.leafName || "")) {
        files.push(entry.path);
      }
    }
  };
  visit(directory);
  files.sort();
  return files;
}

async function importSinglePdf(data) {
  ensureImportPathAllowed(data.filePath);
  let targetResult = await ensureCollectionTarget(data);
  let duplicate = await findDuplicateMatch(data);

  if (data.dryRun) {
    let warnings = [];
    if (targetResult.createdTarget) {
      warnings.push("Target collection would be created during a real run");
    }
    return okBody({
      status: duplicate ? "matched_existing" : "dry_run",
      dryRun: true,
      targetCollectionKey: targetResult.collection ? targetResult.collection.key : null,
      targetCollectionPath: targetResult.collection
        ? formatCollectionPath(targetResult.collection)
        : data.targetCollectionPath || null,
      duplicateMatch: duplicate ? duplicate.match : null,
      warnings: warnings,
    });
  }

  let targetCollection = targetResult.collection;
  let warnings = [];
  if (duplicate) {
    if (data.onDuplicate === "error") {
      throw bridgeError(
        409,
        "DUPLICATE_FOUND",
        "A duplicate item was found for the requested import",
        duplicate.match
      );
    }
    if (data.onDuplicate === "skip") {
      return okBody({
        status: "skipped",
        itemKey: duplicate.item.key,
        attachmentKey: duplicate.attachment ? duplicate.attachment.key : null,
        targetCollectionKey: targetCollection.key,
        duplicateMatch: duplicate.match,
        warnings: warnings,
      });
    }

    let addedToCollection = await ensureItemInCollection(duplicate.item, targetCollection);
    if (!addedToCollection) {
      warnings.push("Existing item was already present in the target collection");
    }

    let attachmentKey = duplicate.attachment ? duplicate.attachment.key : null;
    if (data.onDuplicate === "attach_to_existing") {
      if (duplicate.item.isAttachment()) {
        warnings.push(
          "Matched item is a standalone attachment; skipped creating an additional child attachment"
        );
      } else {
        let newAttachment = await createAttachmentForItem(duplicate.item, data);
        attachmentKey = newAttachment.key;
      }
    }

    return okBody({
      status: "matched_existing",
      itemKey: duplicate.item.key,
      attachmentKey: attachmentKey,
      targetCollectionKey: targetCollection.key,
      duplicateMatch: duplicate.match,
      warnings: warnings,
    });
  }

  let parentItem = await createParentItem(targetCollection, data);
  let attachment = await createAttachmentForItem(parentItem, data);
  return okBody(
    {
      status: "imported",
      itemKey: parentItem.key,
      attachmentKey: attachment.key,
      targetCollectionKey: targetCollection.key,
      duplicateMatch: null,
      warnings: warnings,
    },
    201
  );
}

async function handleHealth(data, requestData) {
  let payload = {
    pluginAvailable: true,
    mutationsEnabled: getMutationsEnabled(),
    version: PLUGIN_VERSION,
    architectureMode: "desktop-bridge-first",
    authoritativeWriteLayer: "zotero-desktop-bridge",
    helperRole: "mcp-adapter",
    clientReconnectRequiredAfterHelperRestart: true,
    bridgeURL: getLocalBridgeProxyURL(),
    localMcpURL: getLocalMcpURL(),
    localMcpPort: getLocalMcpPort(),
    helperLifecycleMode: "zotero-session-bound",
    managedMcpPid: getManagedMcpPid() || null,
    managedByPlugin: getManagedByPlugin(),
    mcpExecutablePath: getMcpExecutablePath() || null,
    bufferDirectory: getBufferDirectory() || null,
    helperRecoveryMaxAttempts: getHelperRecoveryMaxAttempts(),
    helperRecoveryAttempts: getHelperRecoveryAttempts(),
    supportedOperations: SUPPORTED_OPERATIONS,
    supportedImportModes: SUPPORTED_IMPORT_MODES,
    supportedDuplicatePolicies: SUPPORTED_DUPLICATE_POLICIES,
    defaultLinkMode: getDefaultLinkMode(),
    defaultDuplicatePolicy: getDefaultDuplicatePolicy(),
    tokenConfigured: !!getSharedSecret(),
  };
  if (data.verbose) {
    payload.libraryID = getLibraryID();
  }
  return okBody(payload);
}

async function handleResolveCollectionPath(data, requestData) {
  let collection = await resolveCollectionByReference(null, data.collectionPath, false);
  if (!collection) {
    return okBody({
      found: false,
      collectionKey: null,
      collectionPath: data.collectionPath || null,
    });
  }
  return okBody({
    found: true,
    collectionKey: collection.key,
    collectionPath: formatCollectionPath(collection),
  });
}

async function handleCreateCollection(data, requestData) {
  return createCollectionFromPayload(data);
}

async function handleDeleteCollection(data, requestData) {
  let collection = await resolveCollectionByReference(data.collectionKey, data.collectionPath, true);
  let path = formatCollectionPath(collection);
  let descendents = collection.getDescendents(false, null, false);
  let subcollections = descendents.filter(function (entry) {
    return entry.type === "collection";
  });
  let collectionItems = descendents.filter(function (entry) {
    return entry.type === "item";
  });

  if (subcollections.length && !data.recursive) {
    throw bridgeError(
      409,
      "COLLECTION_HAS_CHILDREN",
      "Collection has child collections and recursive=false"
    );
  }
  if ((subcollections.length || collectionItems.length) && !data.force) {
    throw bridgeError(
      409,
      "COLLECTION_NOT_EMPTY",
      "Collection is not empty; set force=true to remove the container"
    );
  }

  if (data.dryRun) {
    return okBody({
      deleted: false,
      dryRun: true,
      collectionKey: collection.key,
      path: path,
      affectedSubcollections: subcollections.length,
      affectedMemberships: collectionItems.length,
      warnings: [],
    });
  }

  await collection.eraseTx();
  return okBody({
    deleted: true,
    collectionKey: collection.key,
    path: path,
    affectedSubcollections: subcollections.length,
    affectedMemberships: collectionItems.length,
    warnings: [],
  });
}

async function handleBatchCreateCollections(data, requestData) {
  if (!Array.isArray(data.requests) || !data.requests.length) {
    throw bridgeError(400, "VALIDATION_ERROR", "requests must be a non-empty array");
  }

  let continueOnError = data.continueOnError !== false;
  let results = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let request of data.requests) {
    try {
      let merged = Object.assign({}, request, {
        dryRun: request.dryRun !== undefined ? request.dryRun : !!data.dryRun,
      });
      let response = await createCollectionFromPayload(merged);
      let body = response.body;
      results.push(body);
      if (body.created) {
        created += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      results.push({
        ok: false,
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: error.message || "Unexpected batch create error",
        },
      });
      if (!continueOnError) {
        break;
      }
    }
  }

  return okBody({
    total: data.requests.length,
    created: created,
    skipped: skipped,
    failed: failed,
    results: results,
  });
}

async function handleBatchDeleteCollections(data, requestData) {
  if (!Array.isArray(data.targets) || !data.targets.length) {
    throw bridgeError(400, "VALIDATION_ERROR", "targets must be a non-empty array");
  }

  let continueOnError = data.continueOnError !== false;
  let results = [];
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  for (let target of data.targets) {
    try {
      let merged = Object.assign({}, target, {
        recursive: target.recursive !== undefined ? target.recursive : !!data.recursive,
        force: target.force !== undefined ? target.force : !!data.force,
        dryRun: target.dryRun !== undefined ? target.dryRun : !!data.dryRun,
      });
      let response = await handleDeleteCollection(merged, requestData);
      let body = response.body;
      results.push(body);
      if (body.deleted) {
        deleted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      results.push({
        ok: false,
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: error.message || "Unexpected batch delete error",
        },
      });
      if (!continueOnError) {
        break;
      }
    }
  }

  return okBody({
    total: data.targets.length,
    deleted: deleted,
    skipped: skipped,
    failed: failed,
    results: results,
  });
}

function buildNoteTitle(noteHtml, noteTitle) {
  let explicitTitle = (noteTitle || "").trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  let plainText = String(noteHtml || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plainText ? plainText.slice(0, 120) : null;
}

async function handleCreateCollectionNote(data, requestData) {
  let noteHtml = (data.noteHtml || "").trim();
  if (!noteHtml) {
    throw bridgeError(400, "VALIDATION_ERROR", "noteHtml must be provided");
  }
  if (!data.targetCollectionKey && !data.targetCollectionPath) {
    throw bridgeError(
      400,
      "VALIDATION_ERROR",
      "targetCollectionKey or targetCollectionPath must be provided"
    );
  }

  let collection = await resolveCollectionByReference(
    data.targetCollectionKey,
    data.targetCollectionPath,
    true
  );
  let collectionPath = formatCollectionPath(collection);
  let resolvedTitle = buildNoteTitle(noteHtml, data.noteTitle);

  if (data.dryRun) {
    return okBody({
      created: false,
      dryRun: true,
      noteType: "collection_note",
      noteTitle: resolvedTitle,
      targetCollectionKey: collection.key,
      targetCollectionPath: collectionPath,
      warnings: [],
    });
  }

  let noteItem = new Zotero.Item("note");
  noteItem.libraryID = getLibraryID();
  noteItem.setNote(noteHtml);
  await noteItem.saveTx();
  noteItem.addToCollection(collection.id);
  await noteItem.saveTx();

  return okBody(
    {
      created: true,
      noteType: "collection_note",
      noteKey: noteItem.key,
      noteTitle: resolvedTitle,
      targetCollectionKey: collection.key,
      targetCollectionPath: collectionPath,
      warnings: [],
    },
    201
  );
}

async function handleCreateChildNote(data, requestData) {
  let noteHtml = (data.noteHtml || "").trim();
  let parentItemKey = (data.parentItemKey || "").trim();
  if (!noteHtml) {
    throw bridgeError(400, "VALIDATION_ERROR", "noteHtml must be provided");
  }
  if (!parentItemKey) {
    throw bridgeError(400, "VALIDATION_ERROR", "parentItemKey must be provided");
  }

  let parentItem = await Zotero.Items.getByLibraryAndKeyAsync(getLibraryID(), parentItemKey);
  if (!parentItem || parentItem.deleted) {
    throw bridgeError(404, "ITEM_NOT_FOUND", "No item found for key " + parentItemKey);
  }

  let resolvedTitle = buildNoteTitle(noteHtml, data.noteTitle);
  if (data.dryRun) {
    return okBody({
      created: false,
      dryRun: true,
      noteType: "child_note",
      noteTitle: resolvedTitle,
      parentItemKey: parentItem.key,
      parentItemTitle: parentItem.getDisplayTitle(),
      warnings: [],
    });
  }

  let noteItem = new Zotero.Item("note");
  noteItem.libraryID = getLibraryID();
  noteItem.parentID = parentItem.id;
  noteItem.setNote(noteHtml);
  await noteItem.saveTx();

  return okBody(
    {
      created: true,
      noteType: "child_note",
      noteKey: noteItem.key,
      noteTitle: resolvedTitle,
      parentItemKey: parentItem.key,
      parentItemTitle: parentItem.getDisplayTitle(),
      warnings: [],
    },
    201
  );
}

async function handleImportPdfToCollection(data, requestData) {
  if (!data.filePath || typeof data.filePath !== "string") {
    throw bridgeError(400, "VALIDATION_ERROR", "filePath must be provided");
  }
  if (!data.targetCollectionKey && !data.targetCollectionPath) {
    throw bridgeError(
      400,
      "VALIDATION_ERROR",
      "targetCollectionKey or targetCollectionPath must be provided"
    );
  }
  if (data.linkMode && SUPPORTED_IMPORT_MODES.indexOf(data.linkMode) === -1) {
    throw bridgeError(400, "VALIDATION_ERROR", "Unsupported linkMode value");
  }
  if (data.onDuplicate && SUPPORTED_DUPLICATE_POLICIES.indexOf(data.onDuplicate) === -1) {
    throw bridgeError(400, "VALIDATION_ERROR", "Unsupported onDuplicate value");
  }

  data.linkMode = data.linkMode || getDefaultLinkMode();
  data.onDuplicate = data.onDuplicate || getDefaultDuplicatePolicy();
  data.authors = Array.isArray(data.authors) ? data.authors : [];
  data.tags = Array.isArray(data.tags) ? data.tags : [];
  return importSinglePdf(data);
}

async function handleImportIdentifierToCollection(data, requestData) {
  if (!data.identifier || typeof data.identifier !== "string") {
    throw bridgeError(400, "VALIDATION_ERROR", "identifier must be provided");
  }
  if (!data.targetCollectionKey && !data.targetCollectionPath) {
    throw bridgeError(
      400,
      "VALIDATION_ERROR",
      "targetCollectionKey or targetCollectionPath must be provided"
    );
  }

  data.tags = Array.isArray(data.tags) ? data.tags : [];
  return okBody((await importItemsFromIdentifier(data)).summary, data.dryRun ? 200 : 201);
}

async function handleImportBibtexToCollection(data, requestData) {
  if (!data.bibtex || typeof data.bibtex !== "string") {
    throw bridgeError(400, "VALIDATION_ERROR", "bibtex must be provided");
  }
  if (!data.targetCollectionKey && !data.targetCollectionPath) {
    throw bridgeError(
      400,
      "VALIDATION_ERROR",
      "targetCollectionKey or targetCollectionPath must be provided"
    );
  }

  data.tags = Array.isArray(data.tags) ? data.tags : [];
  return okBody((await importItemsFromBibtex(data)).summary, data.dryRun ? 200 : 201);
}

async function handleBatchImportPdfsToCollection(data, requestData) {
  if (!data.targetCollectionKey && !data.targetCollectionPath) {
    throw bridgeError(
      400,
      "VALIDATION_ERROR",
      "targetCollectionKey or targetCollectionPath must be provided"
    );
  }

  let filePaths = [];
  if (Array.isArray(data.filePaths) && data.filePaths.length) {
    filePaths = data.filePaths.slice();
  } else if (data.directoryPath) {
    filePaths = collectPdfFilesFromDirectory(data.directoryPath, !!data.recursiveScan);
  } else {
    throw bridgeError(400, "VALIDATION_ERROR", "filePaths or directoryPath must be provided");
  }

  let continueOnError = data.continueOnError !== false;
  let results = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let filePath of filePaths) {
    try {
      let response = await importSinglePdf({
        filePath: filePath,
        targetCollectionKey: data.targetCollectionKey || null,
        targetCollectionPath: data.targetCollectionPath || null,
        linkMode: data.linkMode || getDefaultLinkMode(),
        onDuplicate: data.onDuplicate || getDefaultDuplicatePolicy(),
        createTargetIfMissing: !!data.createTargetIfMissing,
        dryRun: !!data.dryRun,
        authors: [],
        tags: [],
      });
      let body = response.body;
      body.filePath = filePath;
      results.push(body);
      if (body.status === "skipped") {
        skipped += 1;
      } else if (body.status === "imported" || body.status === "matched_existing") {
        imported += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      results.push({
        ok: false,
        filePath: filePath,
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: error.message || "Unexpected batch import error",
        },
      });
      if (!continueOnError) {
        break;
      }
    }
  }

  return okBody({
    total: filePaths.length,
    imported: imported,
    skipped: skipped,
    failed: failed,
    results: results,
  });
}

async function handleMoveItemsBetweenCollections(data, requestData) {
  let sourceCollection = await resolveCollectionByReference(
    data.sourceCollectionKey,
    data.sourceCollectionPath,
    true
  );
  let targetCollection = await resolveCollectionByReference(
    data.targetCollectionKey,
    data.targetCollectionPath,
    true
  );

  if (sourceCollection.id === targetCollection.id) {
    throw bridgeError(
      409,
      "SAME_COLLECTION",
      "Source and target collections must be different"
    );
  }

  let moveAll = !!data.moveAll;
  let rawItemKeys = Array.isArray(data.itemKeys) ? data.itemKeys : [];
  let itemKeys = Array.from(
    new Set(
      rawItemKeys
        .map(function (itemKey) {
          return String(itemKey || "").trim();
        })
        .filter(Boolean)
    )
  );

  if (!moveAll && !itemKeys.length) {
    throw bridgeError(400, "VALIDATION_ERROR", "itemKeys must be provided unless moveAll=true");
  }

  if (moveAll) {
    itemKeys = directChildItemsForCollection(sourceCollection).map(function (item) {
      return item.key;
    });
  }

  let continueOnError = data.continueOnError !== false;
  let results = [];
  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (let itemKey of itemKeys) {
    try {
      let item = await getItemByKey(itemKey);
      let currentCollectionIDs = item.getCollections();
      if (currentCollectionIDs.indexOf(sourceCollection.id) === -1) {
        throw bridgeError(
          409,
          "ITEM_NOT_IN_SOURCE_COLLECTION",
          "The specified item is not currently in the source collection"
        );
      }

      let warnings = [];
      let alreadyInTarget = currentCollectionIDs.indexOf(targetCollection.id) !== -1;
      if (alreadyInTarget) {
        warnings.push("Item is already filed in the target collection");
      }

      if (data.dryRun) {
        let projectedCollectionKeys = remainingCollectionKeys(item).filter(function (collectionKey) {
          return collectionKey !== sourceCollection.key;
        });
        if (projectedCollectionKeys.indexOf(targetCollection.key) === -1) {
          projectedCollectionKeys.push(targetCollection.key);
        }
        results.push({
          itemKey: item.key,
          sourceCollectionKey: sourceCollection.key,
          targetCollectionKey: targetCollection.key,
          status: alreadyInTarget ? "already_in_target_moved" : "moved",
          dryRun: true,
          remainingCollectionKeys: projectedCollectionKeys,
          warnings: warnings,
        });
        skipped += 1;
        continue;
      }

      if (!alreadyInTarget) {
        item.addToCollection(targetCollection.key);
      }
      item.removeFromCollection(sourceCollection.key);
      await item.saveTx();

      results.push({
        itemKey: item.key,
        sourceCollectionKey: sourceCollection.key,
        targetCollectionKey: targetCollection.key,
        status: alreadyInTarget ? "already_in_target_moved" : "moved",
        remainingCollectionKeys: remainingCollectionKeys(item),
        warnings: warnings,
      });
      moved += 1;
    } catch (error) {
      failed += 1;
      results.push({
        itemKey: itemKey,
        sourceCollectionKey: sourceCollection.key,
        targetCollectionKey: targetCollection.key,
        status: "failed",
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: error.message || "Unexpected move error",
        },
        warnings: [],
      });
      if (!continueOnError) {
        break;
      }
    }
  }

  return okBody({
    total: itemKeys.length,
    moved: moved,
    skipped: skipped,
    failed: failed,
    sourceCollectionKey: sourceCollection.key,
    targetCollectionKey: targetCollection.key,
    sourceCollectionPath: formatCollectionPath(sourceCollection),
    targetCollectionPath: formatCollectionPath(targetCollection),
    moveAll: moveAll,
    dryRun: !!data.dryRun,
    results: results,
  });
}

async function handleRemoveItemFromCollection(data, requestData) {
  if (!data.itemKey || typeof data.itemKey !== "string") {
    throw bridgeError(400, "VALIDATION_ERROR", "itemKey must be provided");
  }

  let item = await getItemByKey(data.itemKey);
  let collection = await resolveCollectionByReference(data.collectionKey, data.collectionPath, true);
  let currentCollectionIDs = item.getCollections();
  if (currentCollectionIDs.indexOf(collection.id) === -1) {
    throw bridgeError(
      409,
      "ITEM_NOT_IN_COLLECTION",
      "The specified item is not currently in the target collection"
    );
  }

  let warnings = [];
  let projectedRemaining = currentCollectionIDs.filter(function (collectionID) {
    return collectionID !== collection.id;
  });
  if (!projectedRemaining.length) {
    warnings.push("Item will become unfiled after removal from this collection");
  }

  if (data.dryRun) {
    return okBody({
      removed: false,
      dryRun: true,
      itemKey: item.key,
      collectionKey: collection.key,
      remainingCollectionKeys: projectedRemaining
        .map(function (collectionID) {
          let existingCollection = Zotero.Collections.get(collectionID);
          return existingCollection ? existingCollection.key : null;
        })
        .filter(Boolean),
      warnings: warnings,
    });
  }

  item.removeFromCollection(collection.key);
  await item.saveTx();
  return okBody({
    removed: true,
    itemKey: item.key,
    collectionKey: collection.key,
    remainingCollectionKeys: remainingCollectionKeys(item),
    warnings: warnings,
  });
}

async function handleDeleteItem(data, requestData) {
  if (!data.itemKey || typeof data.itemKey !== "string") {
    throw bridgeError(400, "VALIDATION_ERROR", "itemKey must be provided");
  }

  let item = await getItemByKey(data.itemKey);
  let childIDs = childItemIDsForItem(item);
  let collectionKeys = remainingCollectionKeys(item);
  let warnings = [];

  if (collectionKeys.length) {
    warnings.push("Item is currently filed in one or more collections");
  }
  if (childIDs.length) {
    warnings.push("Deleting this item will also trash its child attachments/notes");
  }

  if ((collectionKeys.length || childIDs.length) && !data.force) {
    throw bridgeError(
      409,
      collectionKeys.length ? "ITEM_STILL_FILED" : "ITEM_HAS_CHILDREN",
      collectionKeys.length
        ? "Item is still filed in collections; set force=true to trash it"
        : "Item has child attachments or notes; set force=true to trash it",
      {
        collectionKeys: collectionKeys,
        childItemCount: childIDs.length,
      }
    );
  }

  if (item.deleted) {
    return okBody({
      deleted: false,
      alreadyDeleted: true,
      itemKey: item.key,
      childItemCount: childIDs.length,
      collectionKeys: collectionKeys,
      warnings: warnings,
    });
  }

  if (data.dryRun) {
    return okBody({
      deleted: false,
      dryRun: true,
      wouldTrash: true,
      itemKey: item.key,
      childItemCount: childIDs.length,
      collectionKeys: collectionKeys,
      warnings: warnings,
    });
  }

  await trashItems([item.id]);
  return okBody({
    deleted: true,
    itemKey: item.key,
    childItemCount: childIDs.length,
    collectionKeys: collectionKeys,
    warnings: warnings,
  });
}

async function handleBatchUpdateTags(data, requestData) {
  if (!Array.isArray(data.itemKeys) || !data.itemKeys.length) {
    throw bridgeError(400, "VALIDATION_ERROR", "itemKeys must be a non-empty array");
  }

  let addTags = Array.isArray(data.addTags) ? data.addTags.filter(Boolean) : [];
  let removeTags = Array.isArray(data.removeTags) ? data.removeTags.filter(Boolean) : [];
  if (!addTags.length && !removeTags.length) {
    throw bridgeError(400, "VALIDATION_ERROR", "addTags or removeTags must be provided");
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let results = [];

  for (let itemKey of data.itemKeys) {
    try {
      let item = await getItemByKey(itemKey);
      let currentTags = item.getTags ? item.getTags() : [];
      let normalized = new Map();
      for (let tag of currentTags) {
        if (tag && tag.tag) {
          normalized.set(String(tag.tag).trim(), { tag: String(tag.tag).trim() });
        }
      }

      let changed = false;
      for (let tag of removeTags) {
        let cleaned = String(tag || "").trim();
        if (cleaned && normalized.delete(cleaned)) {
          changed = true;
        }
      }
      for (let tag of addTags) {
        let cleaned = String(tag || "").trim();
        if (cleaned && !normalized.has(cleaned)) {
          normalized.set(cleaned, { tag: cleaned });
          changed = true;
        }
      }

      if (!changed) {
        skipped += 1;
        results.push({ ok: true, itemKey: item.key, updated: false });
        continue;
      }

      if (!data.dryRun) {
        item.setTags(Array.from(normalized.values()));
        await item.saveTx();
      }

      updated += 1;
      results.push({
        ok: true,
        itemKey: item.key,
        updated: !data.dryRun,
        dryRun: !!data.dryRun,
        tags: Array.from(normalized.keys()),
      });
    } catch (error) {
      failed += 1;
      results.push({
        ok: false,
        itemKey: itemKey,
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: error.message || "Unexpected tag update error",
        },
      });
      if (data.continueOnError === false) {
        break;
      }
    }
  }

  return okBody({
    total: data.itemKeys.length,
    updated: updated,
    skipped: skipped,
    failed: failed,
    results: results,
  });
}
