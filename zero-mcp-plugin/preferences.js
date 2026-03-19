var ZeroMcpPluginPreferences = {
  PREF_BRANCH: "extensions.zeroMcpPlugin.",
  DEFAULT_LINK_MODE: "imported_file",
  DEFAULT_DUPLICATE_POLICY: "add_existing_to_collection",
  STATUS_POLL_INTERVAL_MS: 3000,
  FEEDBACK_PLACEHOLDER: "\u00A0",
  initialized: false,
  transientMessageEventsBound: false,
  statusPollTimer: null,
  temporaryStatusMessage: "",
  temporaryStatusLevel: "idle",
  lastRuntimeSnapshot: null,
  statusRefreshInFlight: false,

  init() {
    if (!this.initialized) {
      this.cacheElements();
      this.bindTransientMessageReset();
      this.bindUnload();
      this.ensureDefaults();
      this.loadPrefsIntoUI();
      this.initialized = true;
      this.startStatusPolling();
    }
    this.refreshRuntimeServiceStatus();
  },

  cacheElements() {
    this.root = document.getElementById("zero-mcp-plugin-preferences-root");
    this.status = document.getElementById("zero-mcp-plugin-status");
    this.mcpExecutablePath = document.getElementById("zero-mcp-plugin-mcp-executable-path");
    this.bufferDirectory = document.getElementById("zero-mcp-plugin-buffer-directory");
    this.mutationsEnabled = document.getElementById("zero-mcp-plugin-mutations-enabled");
    this.localMcpPort = document.getElementById("zero-mcp-plugin-local-mcp-port");
    this.sharedSecret = document.getElementById("zero-mcp-plugin-shared-secret");
    this.configActionStatus = document.getElementById("zero-mcp-plugin-config-action-status");
    this.portActionStatus = document.getElementById("zero-mcp-plugin-port-action-status");
    this.tokenActionStatus = document.getElementById("zero-mcp-plugin-token-action-status");
    this.defaultLinkMode = document.getElementById("zero-mcp-plugin-default-link-mode");
    this.defaultDuplicatePolicy = document.getElementById("zero-mcp-plugin-default-duplicate-policy");
    this.feedbackElements = {
      config: this.configActionStatus,
      port: this.portActionStatus,
      token: this.tokenActionStatus,
    };
    this.initializeMessageBoxes();
  },

  initializeMessageBoxes() {
    this.applyStatusBoxStyle(this.status, "idle");
    this.renderActionFeedback("config", "", "idle");
    this.renderActionFeedback("port", "", "idle");
    this.renderActionFeedback("token", "", "idle");
  },

  styleTokens(level) {
    switch (level) {
      case "success":
        return {
          background: "#eef7f1",
          borderColor: "#cfe4d6",
          color: "#22543d",
        };
      case "loading":
        return {
          background: "#eef4fb",
          borderColor: "#cfdced",
          color: "#234a73",
        };
      case "warning":
        return {
          background: "#fff7e8",
          borderColor: "#eed7a3",
          color: "#7a5600",
        };
      case "error":
        return {
          background: "#fdeeee",
          borderColor: "#edcaca",
          color: "#8b2f2f",
        };
      default:
        return {
          background: "#f5f6f7",
          borderColor: "#e3e5e8",
          color: "#4b5563",
        };
    }
  },

  applyStatusBoxStyle(element, level) {
    if (!element) {
      return;
    }
    let tokens = this.styleTokens(level);
    element.style.display = "block";
    element.style.margin = "0 0 12px";
    element.style.padding = "0 12px";
    element.style.borderRadius = "8px";
    element.style.border = "1px solid " + tokens.borderColor;
    element.style.background = tokens.background;
    element.style.color = tokens.color;
    element.style.lineHeight = "40px";
    element.style.minHeight = "40px";
    element.style.maxHeight = "40px";
    element.style.boxSizing = "border-box";
    element.style.whiteSpace = "nowrap";
    element.style.overflow = "hidden";
    element.style.textOverflow = "ellipsis";
    element.dataset.state = level || "idle";
  },

  isInlineFeedback(key) {
    return key === "config" || key === "port";
  },

  applyFeedbackBoxStyle(element, level, key) {
    if (!element) {
      return;
    }
    let tokens = this.styleTokens(level);
    element.style.display = "block";
    if (this.isInlineFeedback(key)) {
      element.style.display = "flex";
      element.style.alignItems = "center";
      element.style.margin = "0 0 0 12px";
      element.style.padding = "0";
      element.style.lineHeight = "24px";
      element.style.minHeight = "24px";
      element.style.maxHeight = "24px";
    } else {
      element.style.display = "flex";
      element.style.alignItems = "center";
      element.style.margin = "6px 0 14px";
      element.style.padding = "0";
      element.style.lineHeight = "24px";
      element.style.minHeight = "24px";
      element.style.maxHeight = "24px";
    }
    element.style.borderRadius = "0";
    element.style.border = "none";
    element.style.background = "transparent";
    element.style.color = tokens.color;
    element.style.boxSizing = "border-box";
    element.style.whiteSpace = "nowrap";
    element.style.overflow = "hidden";
    element.style.textOverflow = "ellipsis";
    element.dataset.state = level || "idle";
  },

  renderMessageBox(element, message, level, kind, key) {
    if (!element) {
      return;
    }
    if (kind === "status") {
      this.applyStatusBoxStyle(element, level);
    } else {
      this.applyFeedbackBoxStyle(element, level, key);
    }
    element.textContent = message || this.FEEDBACK_PLACEHOLDER;
  },

  renderActionFeedback(key, message, level) {
    let element = this.feedbackElements ? this.feedbackElements[key] : null;
    this.renderMessageBox(element, message, level || "idle", "feedback", key);
  },

  bindTransientMessageReset() {
    if (this.transientMessageEventsBound || !this.root) {
      return;
    }

    let reset = () => {
      this.clearTransientFeedback();
    };
    this.root.addEventListener("focusin", reset, true);
    this.root.addEventListener("input", reset, true);
    this.root.addEventListener("change", reset, true);
    this.transientMessageEventsBound = true;
  },

  bindUnload() {
    window.addEventListener("unload", () => {
      this.stopStatusPolling();
    });
  },

  startStatusPolling() {
    if (this.statusPollTimer) {
      return;
    }
    this.statusPollTimer = window.setInterval(() => {
      this.refreshRuntimeServiceStatus(true);
    }, this.STATUS_POLL_INTERVAL_MS);
  },

  stopStatusPolling() {
    if (!this.statusPollTimer) {
      return;
    }
    window.clearInterval(this.statusPollTimer);
    this.statusPollTimer = null;
  },

  getPluginController() {
    try {
      let parentWindow = ZeroMcpPluginCommon.getPickerParentWindow(window);
      if (parentWindow && parentWindow.ZeroMcpPlugin) {
        return parentWindow.ZeroMcpPlugin;
      }
    } catch (error) {}

    try {
      if (typeof Zotero !== "undefined" && Zotero && typeof Zotero.getMainWindow === "function") {
        let mainWindow = Zotero.getMainWindow();
        if (mainWindow && mainWindow.ZeroMcpPlugin) {
          return mainWindow.ZeroMcpPlugin;
        }
      }
    } catch (error) {}

    return null;
  },

  ensureDefaults() {
    if (!this.getStringPref("sharedSecret")) {
      this.setStringPref("sharedSecret", this.generateToken());
    }
    if (!this.getStringPref("bufferDirectory")) {
      let path = this.defaultBufferDirectory();
      if (path) {
        this.setStringPref("bufferDirectory", path);
      }
    }
    if (!this.isAllowedLinkMode(this.getStringPref("defaultLinkMode"))) {
      this.setStringPref("defaultLinkMode", this.DEFAULT_LINK_MODE);
    }
    if (!this.isAllowedDuplicatePolicy(this.getStringPref("defaultDuplicatePolicy"))) {
      this.setStringPref("defaultDuplicatePolicy", this.DEFAULT_DUPLICATE_POLICY);
    }
  },

  loadPrefsIntoUI() {
    this.mcpExecutablePath.value = this.getConfiguredMcpExecutablePath();
    this.bufferDirectory.value = this.getBufferDirectory();
    this.mutationsEnabled.checked = this.getBoolPref("mutationsEnabled", true);
    this.localMcpPort.value = this.getLocalMcpPort();
    this.sharedSecret.value = this.getStringPref("sharedSecret");
    this.defaultLinkMode.value = this.getLinkMode();
    this.defaultDuplicatePolicy.value = this.getDuplicatePolicy();
    this.renderStatus(null);
    this.clearTransientActionMessages();
  },

  async refreshRuntimeServiceStatus(preserveTemporaryStatus) {
    if (this.statusRefreshInFlight) {
      return this.lastRuntimeSnapshot;
    }

    let controller = this.getPluginController();
    if (!controller || typeof controller.refreshHelperRuntimeState !== "function") {
      this.lastRuntimeSnapshot = {
        desiredPort: this.getLocalMcpPort(),
        helperState: "error",
        lastErrorCode: "PLUGIN_CONTROLLER_UNAVAILABLE",
        statusMessageKey: "controller-unavailable",
      };
      this.renderStatus(this.lastRuntimeSnapshot, preserveTemporaryStatus);
      return this.lastRuntimeSnapshot;
    }

    this.statusRefreshInFlight = true;
    try {
      this.lastRuntimeSnapshot = await controller.refreshHelperRuntimeState("preferences-refresh");
    } catch (error) {
      Zotero.logError(error);
      this.lastRuntimeSnapshot = controller.getHelperRuntimeState
        ? controller.getHelperRuntimeState()
        : {
            desiredPort: this.getLocalMcpPort(),
            helperState: "error",
            lastErrorCode: error.code || "STATUS_REFRESH_FAILED",
            statusMessageKey: "restart-rollback",
          };
    } finally {
      this.statusRefreshInFlight = false;
    }

    this.renderStatus(this.lastRuntimeSnapshot, preserveTemporaryStatus);
    return this.lastRuntimeSnapshot;
  },

  renderStatus(snapshot, preserveTemporaryStatus) {
    if (!this.status) {
      return;
    }
    let presentation;
    if (preserveTemporaryStatus && this.temporaryStatusMessage) {
      presentation = {
        message: this.temporaryStatusMessage,
        level: this.temporaryStatusLevel || "idle",
      };
    } else if (this.temporaryStatusMessage) {
      presentation = {
        message: this.temporaryStatusMessage,
        level: this.temporaryStatusLevel || "idle",
      };
    } else {
      presentation = this.presentationForRuntimeState(snapshot || this.lastRuntimeSnapshot);
    }
    this.renderMessageBox(
      this.status,
      presentation && presentation.message,
      (presentation && presentation.level) || "idle",
      "status"
    );
  },

  helperErrorStatusMessage(code) {
    switch (code) {
      case "HELPER_PATH_NOT_FOUND":
        return "未找到所选文件，请重新选择。";
      case "HELPER_PATH_IS_DIRECTORY":
        return "你选择的是文件夹，请选择可执行文件。";
      case "HELPER_PATH_NOT_EXECUTABLE":
        return "当前文件无法运行，请检查是否完整解压。";
      case "HELPER_LAYOUT_INCOMPLETE":
        return "当前目录不完整，请重新解压后再选择。";
      default:
        return "";
    }
  },

  helperErrorActionMessage(code) {
    switch (code) {
      case "HELPER_PATH_IS_DIRECTORY":
        return "请重新选择文件。";
      case "HELPER_LAYOUT_INCOMPLETE":
        return "请重新解压整个目录后再选择。";
      case "HELPER_PATH_NOT_EXECUTABLE":
        return "请确认你选择的是可运行文件。";
      case "HELPER_PATH_NOT_FOUND":
        return "文件可能已被移动，请重新选择。";
      default:
        return "";
    }
  },

  presentationForRuntimeState(snapshot) {
    if (!snapshot) {
      return {
        message: "请先选择本地服务程序。",
        level: "idle",
      };
    }

    switch (snapshot.statusMessageKey) {
      case "available":
        return {
          message: "本地 MCP 服务可用，运行端口 " + snapshot.desiredPort + "。",
          level: "success",
        };
      case "starting":
      case "starting-slow":
      case "checking":
      case "recovery-running":
        return {
          message: "未检测到 MCP 服务，正在尝试启动。",
          level: "loading",
        };
      case "restarting":
        return {
          message: "已更新配置，正在重启 MCP 服务。",
          level: "loading",
        };
      case "port-conflict":
        return {
          message: "端口 " + snapshot.desiredPort + " 已被其他程序占用，请更换端口。",
          level: "warning",
        };
      case "restart-rollback":
      case "recovery-exhausted":
      case "stop-failed":
        return {
          message: "MCP 服务重启失败，已恢复到上一次有效配置。",
          level: "error",
        };
      case "helper-path-missing":
        return {
          message: "请先选择本地服务程序。",
          level: "idle",
        };
      case "helper-path-not-found":
      case "helper-path-is-directory":
      case "helper-path-not-executable":
      case "helper-layout-incomplete":
        return {
          message: this.helperErrorStatusMessage(snapshot.lastErrorCode || ""),
          level: "warning",
        };
      case "controller-unavailable":
        return {
          message: "设置页暂时不可用，请重启 Zotero。",
          level: "error",
        };
      default:
        if (snapshot.helperState === "running") {
          return {
            message: "本地 MCP 服务可用，运行端口 " + snapshot.desiredPort + "。",
            level: "success",
          };
        }
        if (snapshot.lastErrorCode === "PORT_IN_USE") {
          return {
            message: "端口 " + snapshot.desiredPort + " 已被其他程序占用，请更换端口。",
            level: "warning",
          };
        }
        if (this.helperErrorStatusMessage(snapshot.lastErrorCode || "")) {
          return {
            message: this.helperErrorStatusMessage(snapshot.lastErrorCode || ""),
            level: "warning",
          };
        }
        if (snapshot.lastErrorCode) {
          return {
            message: "MCP 服务重启失败，已恢复到上一次有效配置。",
            level: "error",
          };
        }
        return {
          message: "请先选择本地服务程序。",
          level: "idle",
        };
    }
  },

  messageForRuntimeState(snapshot) {
    return this.presentationForRuntimeState(snapshot).message;
  },

  setTemporaryStatus(message, level) {
    this.temporaryStatusMessage = message || "";
    this.temporaryStatusLevel = level || "idle";
    this.renderStatus(this.lastRuntimeSnapshot, true);
  },

  clearTransientActionMessages() {
    this.setConfigActionStatus("", "idle");
    this.setPortActionStatus("", "idle");
    this.setTokenActionStatus("", "idle");
  },

  clearTransientFeedback() {
    this.clearTransientActionMessages();
    this.temporaryStatusMessage = "";
    this.temporaryStatusLevel = "idle";
    this.renderStatus(this.lastRuntimeSnapshot);
  },

  async chooseMcpExecutablePath() {
    let filters = ZeroMcpPluginCommon.isWindows()
      ? [
          ["可执行文件", "*.exe"],
          ["所有文件", "*.*"],
        ]
      : [["所有文件", "*"]];
    let selected = await ZeroMcpPluginCommon.pickFilePath(window, "选择 MCP helper 可执行文件", filters);
    if (!selected) {
      return;
    }
    this.mcpExecutablePath.value = selected;
    await this.applyExecutablePath(selected);
  },

  async resetMcpExecutablePath() {
    this.mcpExecutablePath.value = "";
    await this.applyExecutablePath("");
  },

  async saveMcpExecutablePath() {
    await this.applyExecutablePath(this.mcpExecutablePath.value.trim());
  },

  async applyExecutablePath(value) {
    let normalized = String(value || "").trim();
    let previous = this.getConfiguredMcpExecutablePath();
    let controller = this.getPluginController();

    if (previous !== normalized) {
      this.setStringPref("mcpExecutablePath", normalized);
    }
    this.mcpExecutablePath.value = normalized;

    try {
      if (controller && typeof controller.applyExecutablePathChange === "function") {
        await controller.applyExecutablePathChange(normalized);
      }
      this.setConfigActionStatus(
        normalized ? "路径已保存。" : "已清空路径。",
        "success"
      );
    } catch (error) {
      Zotero.logError(error);

      // Keep the user's selected path even if the helper fails to start.
      if (this.getConfiguredMcpExecutablePath() !== normalized) {
        this.setStringPref("mcpExecutablePath", normalized);
      }
      this.mcpExecutablePath.value = normalized;

      if (error.code === "PORT_IN_USE") {
        this.setTemporaryStatus(
          "端口 " + this.getLocalMcpPort() + " 已被其他程序占用，请更换端口。",
          "warning"
        );
        this.setConfigActionStatus(normalized ? "路径已保存。" : "已清空路径。", "warning");
      } else if (this.helperErrorStatusMessage(error.code || "")) {
        this.setTemporaryStatus(this.helperErrorStatusMessage(error.code || ""), "warning");
        this.setConfigActionStatus(this.helperErrorActionMessage(error.code || ""), "warning");
      } else {
        this.setTemporaryStatus("MCP 服务重启失败，已恢复到上一次有效配置。", "error");
        this.setConfigActionStatus(
          normalized ? "路径已保存，请点击“测试连接”重试。" : "已清空路径。",
          normalized ? "warning" : "success"
        );
      }
    }

    await this.refreshRuntimeServiceStatus(true);
  },

  async chooseBufferDirectory() {
    let selected = await ZeroMcpPluginCommon.pickDirectoryPath(window, "选择文件缓冲目录");
    if (!selected) {
      return;
    }
    this.bufferDirectory.value = selected;
    this.saveBufferDirectory();
  },

  resetBufferDirectory() {
    let value = this.defaultBufferDirectory();
    this.setStringPref("bufferDirectory", value);
    this.bufferDirectory.value = value;
  },

  saveBufferDirectory() {
    let value = this.bufferDirectory.value.trim() || this.defaultBufferDirectory();
    this.setStringPref("bufferDirectory", value);
    this.bufferDirectory.value = value;
  },

  saveMutationsEnabled() {
    this.setBoolPref("mutationsEnabled", !!this.mutationsEnabled.checked);
  },

  async saveLocalMcpPort() {
    let previous = this.getLocalMcpPort();
    let normalized = this.normalizePort(this.localMcpPort.value);
    this.localMcpPort.value = normalized;

    if (String(previous) === String(normalized)) {
      return;
    }

    let controller = this.getPluginController();
    this.setTemporaryStatus("已更新配置，正在重启 MCP 服务。", "loading");

    try {
      if (controller && typeof controller.applyPortChange === "function") {
        await controller.applyPortChange(normalized);
      } else {
        this.setStringPref("localMcpPort", normalized);
      }
      this.setPortActionStatus("端口已更新为 " + normalized + "。", "success");
      this.temporaryStatusMessage = "";
      this.temporaryStatusLevel = "idle";
    } catch (error) {
      Zotero.logError(error);
      this.localMcpPort.value = previous;
      this.setStringPref("localMcpPort", previous);
      if (error.code === "PORT_IN_USE") {
        this.setTemporaryStatus("端口 " + normalized + " 已被其他程序占用，请更换端口。", "warning");
        this.setPortActionStatus("未保存新端口，当前仍使用端口 " + previous + "。", "warning");
      } else {
        this.setTemporaryStatus("MCP 服务重启失败，已恢复到上一次有效配置。", "error");
        this.setPortActionStatus("端口切换失败，当前仍使用端口 " + previous + "。", "error");
      }
    }

    await this.refreshRuntimeServiceStatus(true);
  },

  async resetLocalMcpPort() {
    this.localMcpPort.value = "8000";
    await this.saveLocalMcpPort();
  },

  async regenerateSecret() {
    let controller = this.getPluginController();
    let previous = this.getStringPref("sharedSecret");
    let nextSecret = this.generateToken();
    this.sharedSecret.value = nextSecret;
    this.setTemporaryStatus("已更新配置，正在重启 MCP 服务。", "loading");

    try {
      if (controller && typeof controller.applySharedSecretChange === "function") {
        await controller.applySharedSecretChange(nextSecret);
      } else {
        this.setStringPref("sharedSecret", nextSecret);
      }
      this.sharedSecret.value = this.getStringPref("sharedSecret");
      this.setTokenActionStatus("已生成新令牌。", "success");
      this.temporaryStatusMessage = "";
      this.temporaryStatusLevel = "idle";
    } catch (error) {
      Zotero.logError(error);
      this.sharedSecret.value = previous;
      this.setStringPref("sharedSecret", previous);
      this.setTemporaryStatus("MCP 服务重启失败，已恢复到上一次有效配置。", "error");
      this.setTokenActionStatus("生成失败，当前仍使用原令牌。", "error");
    }

    await this.refreshRuntimeServiceStatus(true);
  },

  async testMcpConnection() {
    let controller = this.getPluginController();
    if (!controller || typeof controller.testOrRecoverHelper !== "function") {
      this.setTemporaryStatus("设置页暂时不可用，请重启 Zotero。", "error");
      return;
    }

    let snapshot = await this.refreshRuntimeServiceStatus();
    if (snapshot && snapshot.helperState === "running") {
      this.setTemporaryStatus("本地 MCP 服务可用，运行端口 " + snapshot.desiredPort + "。", "success");
      return;
    }

    this.setTemporaryStatus("未检测到 MCP 服务，正在尝试启动。", "loading");
    try {
      snapshot = await controller.testOrRecoverHelper("preferences-test");
      this.lastRuntimeSnapshot = snapshot;
      if (snapshot && snapshot.helperState === "running") {
        this.setTemporaryStatus("本地 MCP 服务可用，运行端口 " + snapshot.desiredPort + "。", "success");
      } else {
        this.setTemporaryStatus(
          this.messageForRuntimeState(snapshot),
          this.presentationForRuntimeState(snapshot).level
        );
      }
    } catch (error) {
      Zotero.logError(error);
      if (error.code === "PORT_IN_USE") {
        this.setTemporaryStatus(
          "端口 " + this.getLocalMcpPort() + " 已被其他程序占用，请更换端口。",
          "warning"
        );
      } else if (this.helperErrorStatusMessage(error.code || "")) {
        this.setTemporaryStatus(this.helperErrorStatusMessage(error.code || ""), "warning");
        this.setConfigActionStatus(this.helperErrorActionMessage(error.code || ""), "warning");
      } else {
        this.setTemporaryStatus("MCP 服务重启失败，已恢复到上一次有效配置。", "error");
      }
    }
    this.renderStatus(this.lastRuntimeSnapshot, true);
  },

  copyCodexConfig() {
    this.copyToClipboard(this.buildCodexConfigSnippet());
    this.setConfigActionStatus("已复制 Codex 配置。", "success");
  },

  copyClaudeCodeConfig() {
    this.copyToClipboard(this.buildClaudeCodeConfigSnippet());
    this.setConfigActionStatus("已复制 Claude Code 配置。", "success");
  },

  copyToClipboard(text) {
    let clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Components.interfaces.nsIClipboardHelper);
    clipboard.copyString(text);
  },

  saveDefaultLinkMode() {
    let value = this.defaultLinkMode.value || this.DEFAULT_LINK_MODE;
    this.setStringPref("defaultLinkMode", value);
    this.defaultLinkMode.value = value;
  },

  saveDefaultDuplicatePolicy() {
    let value = this.defaultDuplicatePolicy.value || this.DEFAULT_DUPLICATE_POLICY;
    this.setStringPref("defaultDuplicatePolicy", value);
    this.defaultDuplicatePolicy.value = value;
  },

  buildCodexConfigSnippet() {
    return [
      "[mcp_servers.zotero-mcp]",
      'url = "' + this.getLocalMcpURL() + '"',
      "enabled = true",
    ].join("\n");
  },

  buildClaudeCodeConfigSnippet() {
    return JSON.stringify(
      {
        mcpServers: {
          "zotero-mcp": {
            type: "http",
            url: this.getLocalMcpURL(),
          },
        },
      },
      null,
      2
    );
  },

  getBoolPref(name, fallback) {
    try {
      let value = Zotero.Prefs.get(this.PREF_BRANCH + name, true);
      return value === undefined ? fallback : !!value;
    } catch (error) {
      return fallback;
    }
  },

  getStringPref(name) {
    try {
      let value = Zotero.Prefs.get(this.PREF_BRANCH + name, true);
      return value ? String(value) : "";
    } catch (error) {
      return "";
    }
  },

  setBoolPref(name, value) {
    Zotero.Prefs.set(this.PREF_BRANCH + name, !!value, true);
  },

  setStringPref(name, value) {
    Zotero.Prefs.set(this.PREF_BRANCH + name, String(value || ""), true);
  },

  setConfigActionStatus(message, level) {
    this.renderActionFeedback("config", message, level || "idle");
  },

  setPortActionStatus(message, level) {
    this.renderActionFeedback("port", message, level || "idle");
  },

  setTokenActionStatus(message, level) {
    this.renderActionFeedback("token", message, level || "idle");
  },

  normalizePort(value) {
    return ZeroMcpPluginCommon.normalizePort(value, 8000);
  },

  getConfiguredMcpExecutablePath() {
    return this.getStringPref("mcpExecutablePath").trim();
  },

  getLocalMcpPort() {
    return this.normalizePort(this.getStringPref("localMcpPort") || "8000");
  },

  getLocalMcpBaseURL() {
    return "http://127.0.0.1:" + this.getLocalMcpPort();
  },

  getLocalMcpURL() {
    return this.getLocalMcpBaseURL() + "/mcp";
  },

  getBufferDirectory() {
    let configured = this.getStringPref("bufferDirectory").trim();
    return configured || this.defaultBufferDirectory();
  },

  defaultBufferDirectory() {
    return ZeroMcpPluginCommon.defaultBufferDirectory();
  },

  generateToken() {
    return ZeroMcpPluginCommon.generateSharedSecret();
  },

  getLinkMode() {
    let value = this.getStringPref("defaultLinkMode");
    return this.isAllowedLinkMode(value) ? value : this.DEFAULT_LINK_MODE;
  },

  getDuplicatePolicy() {
    let value = this.getStringPref("defaultDuplicatePolicy");
    return this.isAllowedDuplicatePolicy(value) ? value : this.DEFAULT_DUPLICATE_POLICY;
  },

  isAllowedLinkMode(value) {
    return ["imported_file", "linked_file"].indexOf(value) !== -1;
  },

  isAllowedDuplicatePolicy(value) {
    return ["add_existing_to_collection", "skip", "attach_to_existing", "error"].indexOf(value) !== -1;
  },
};
