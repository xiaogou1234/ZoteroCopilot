var ENDPOINT_BASE = "/zero-mcp";
var PREF_BRANCH = "extensions.zeroMcpPlugin.";
var PLUGIN_VERSION = "0.1.1";

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

ZeroMcpPlugin = {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,

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

  async startup() {
    ensureOperationalDefaults();
    registerEndpoints();
    await maybeAutoStartMcp(this);
  },

  onMainWindowLoad({ window }) {},

  onMainWindowUnload({ window }) {},

  shutdown() {
    if (getPrefsBranch().getBoolPref("mcpManagedByPlugin", false) && !getKeepHelperRunning()) {
      stopManagedMcpProcesses(getMcpExecutablePath());
      getPrefsBranch().setBoolPref("mcpManagedByPlugin", false);
    }
    unregisterEndpoints();
    idempotencyCache.clear();
    writeQueue = Promise.resolve();
    this.initialized = false;
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
  let dataPath = getZoteroDataDirectoryPath();
  if (!dataPath) {
    return "";
  }
  try {
    let directory = Zotero.File.pathToFile(dataPath);
    directory.append("buffer");
    return directory.path;
  } catch (error) {
    return "";
  }
}

function defaultManagedMcpExecutablePath(includeConfigured) {
  let explicit = getPrefsBranch().getStringPref("mcpExecutablePath", "").trim();
  if (includeConfigured && explicit) {
    return explicit;
  }

  let profilePath = getProfileDirectoryPath();
  if (profilePath) {
    return profilePath + "\\zotero-mcp.exe";
  }
  return "";
}

function ensureOperationalDefaults() {
  if (!hasUserPref("mutationsEnabled")) {
    setBoolPref("mutationsEnabled", true);
  }

  if (!hasUserPref("autoStartMcp")) {
    setBoolPref("autoStartMcp", true);
  }

  if (!hasUserPref("keepHelperRunning")) {
    setBoolPref("keepHelperRunning", true);
  }

  if (!getSharedSecret()) {
    setStringPref("sharedSecret", generateSharedSecret());
  }

  if (!getPrefsBranch().getStringPref("bufferDirectory", "").trim()) {
    let bufferPath = defaultBufferDirectory();
    if (bufferPath) {
      setStringPref("bufferDirectory", bufferPath);
    }
  }

}

function getMutationsEnabled() {
  return getPrefsBranch().getBoolPref("mutationsEnabled", true);
}

function getKeepHelperRunning() {
  return getPrefsBranch().getBoolPref("keepHelperRunning", true);
}

function getSharedSecret() {
  return getPrefsBranch().getStringPref("sharedSecret", "");
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

function getAutoStartMcp() {
  return getPrefsBranch().getBoolPref("autoStartMcp", true);
}

function getMcpExecutablePath() {
  let configured = getPrefsBranch().getStringPref("mcpExecutablePath", "").trim();
  return configured;
}

function getManagedMcpPid() {
  return getPrefsBranch().getStringPref("mcpManagedPid", "").trim();
}

function getLocalMcpPort() {
  let raw = getPrefsBranch().getStringPref("localMcpPort", "8000").trim();
  let port = parseInt(raw || "8000", 10);
  if (!port || port < 1 || port > 65535) {
    return 8000;
  }
  return port;
}

function getLocalMcpBaseURL() {
  return "http://127.0.0.1:" + getLocalMcpPort();
}

function getLocalMcpURL() {
  return getLocalMcpBaseURL() + "/mcp";
}

function getLocalBridgeProxyURL() {
  return getLocalMcpBaseURL() + ENDPOINT_BASE;
}

function setManagedMcpPid(pid) {
  getPrefsBranch().setStringPref("mcpManagedPid", pid ? String(pid) : "");
}

async function maybeAutoStartMcp(plugin) {
  if (!getAutoStartMcp()) {
    return;
  }

  if (await isLocalMcpReachable()) {
    return;
  }

  try {
    await ensureManagedMcpRunning();
  } catch (error) {
    Zotero.logError(error);
  }
}

async function isLocalMcpReachable() {
  try {
    let response = await fetch(getLocalMcpURL(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: "{}",
    });
    return !!response;
  } catch (error) {
    return false;
  }
}

async function ensureManagedMcpRunning() {
  if (await isLocalMcpReachable()) {
    return true;
  }

  let executablePath = getMcpExecutablePath();
  if (!executablePath) {
    plugin.log("Local MCP driver path is empty; skipping auto-start");
    return false;
  }
  stopManagedMcpProcesses(executablePath);
  startManagedMcpProcess();

  if (await waitForLocalMcp(12, 500)) {
    plugin.log("Local MCP became reachable after startup");
    return true;
  }

  plugin.log("Retrying local MCP startup once more");
  stopManagedMcpProcesses(executablePath);
  startManagedMcpProcess();
  return waitForLocalMcp(12, 500);
}

async function waitForLocalMcp(maxAttempts, delayMs) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isLocalMcpReachable()) {
      return true;
    }
    await new Promise(function (resolve) {
      Services.tm.dispatchToMainThread(function () {
        Zotero.Promise.delay(delayMs).then(resolve);
      });
    });
  }
  return isLocalMcpReachable();
}

function startManagedMcpProcess() {
  let executablePath = getMcpExecutablePath();
  if (!executablePath) {
    throw new Error("Missing MCP executable path");
  }

  let powershell = getWindowsPowerShellPath();
  let process = Components.classes["@mozilla.org/process/util;1"]
    .createInstance(Components.interfaces.nsIProcess);
  process.init(powershell);
  process.startHidden = true;

  let pidFile = createTempPidFilePath("zero-mcp-start");
  setManagedMcpPid("");
  let args = ["-NoProfile", "-Command", buildManagedMcpCommand(executablePath, pidFile)];
  process.runw(true, args, args.length);
  getPrefsBranch().setBoolPref("mcpManagedByPlugin", true);
  readManagedPidFromFile(pidFile);
  return null;
}

function stopManagedMcpProcesses(executablePath) {
  let cleanedExecutable = _clean_optional_text(executablePath) || getMcpExecutablePath() || "";
  if (!cleanedExecutable) {
    return;
  }

  let powershell = getWindowsPowerShellPath();
  let process = Components.classes["@mozilla.org/process/util;1"]
    .createInstance(Components.interfaces.nsIProcess);
  process.init(powershell);
  process.startHidden = true;

  let target = escapeForPowerShell(cleanedExecutable);
  let managedPid = getManagedMcpPid();
  let command = managedPid
    ? [
        "$pidToStop=" + parseInt(managedPid, 10),
        "Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue",
        "$target='" + target + "'",
        "Get-CimInstance Win32_Process -Filter \"name = 'zotero-mcp.exe'\" | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ].join("; ")
    : [
        "$target='" + target + "'",
        "Get-CimInstance Win32_Process -Filter \"name = 'zotero-mcp.exe'\" | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ].join("; ");

  let args = ["-NoProfile", "-Command", command];
  try {
    process.runw(true, args, args.length);
    getPrefsBranch().setBoolPref("mcpManagedByPlugin", false);
    setManagedMcpPid("");
  } catch (error) {
    Zotero.logError(error);
  }
}

function buildManagedMcpCommand(executablePath, pidFile) {
  let command = escapeForPowerShell(executablePath);
  let bridgeURL = escapeForPowerShell(getLocalBridgeProxyURL());
  let bridgeToken = escapeForPowerShell(getSharedSecret());
  let localMcpPort = String(getLocalMcpPort());
  return [
    "$env:ZOTERO_NO_CLAUDE='true'",
    "$env:ZOTERO_LOCAL='true'",
    "$env:ZOTERO_LIBRARY_ID='0'",
    "$env:ZOTERO_DESKTOP_BRIDGE_TIMEOUT='120'",
    "$env:ZOTERO_DESKTOP_BRIDGE_PROXY_TIMEOUT='120'",
    "$env:ZOTERO_DESKTOP_BRIDGE_URL='" + bridgeURL + "'",
    "$env:ZOTERO_DESKTOP_BRIDGE_TOKEN='" + bridgeToken + "'",
    "$proc = Start-Process -FilePath '" + command + "' -ArgumentList 'serve','--transport','streamable-http','--host','127.0.0.1','--port','" + localMcpPort + "' -WindowStyle Hidden -PassThru",
    "$proc.Id | Set-Content -Path '" + escapeForPowerShell(pidFile) + "' -Encoding UTF8",
  ].join("; ");
}

function createTempPidFilePath(prefix) {
  let tempFile = Services.dirsvc.get("TmpD", Components.interfaces.nsIFile);
  tempFile.append((prefix || "zero-mcp") + "-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".txt");
  return tempFile.path;
}

function readManagedPidFromFile(path) {
  if (!path) {
    return;
  }
  try {
    let file = Zotero.File.pathToFile(path);
    if (!file.exists()) {
      return;
    }
    let pid = String(Zotero.File.getContents(path) || "").trim();
    if (pid) {
      setManagedMcpPid(pid);
    }
    file.remove(false);
  } catch (error) {
    Zotero.logError(error);
  }
}

function getWindowsCommandPath(name) {
  let windir = Services.dirsvc.get("WinD", Components.interfaces.nsIFile);
  let file = windir.clone();
  file.append("System32");
  file.append(name);
  if (!file.exists()) {
    throw new Error("Missing Windows command: " + name);
  }
  return file;
}

function getWindowsPowerShellPath() {
  let windir = Services.dirsvc.get("WinD", Components.interfaces.nsIFile);
  let file = windir.clone();
  file.append("System32");
  file.append("WindowsPowerShell");
  file.append("v1.0");
  file.append("powershell.exe");
  if (!file.exists()) {
    throw new Error("Missing Windows PowerShell executable");
  }
  return file;
}

function escapeForPowerShell(value) {
  return String(value || "").replace(/'/g, "''");
}

function generateSharedSecret() {
  if (typeof crypto !== "undefined" && crypto && crypto.getRandomValues) {
    let bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  let uuid = Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
  return (uuid + uuid).slice(0, 48);
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
    autoStartMcp: getAutoStartMcp(),
    managedMcpPid: getManagedMcpPid() || null,
    mcpExecutablePath: getMcpExecutablePath() || null,
    bufferDirectory: getBufferDirectory() || null,
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
