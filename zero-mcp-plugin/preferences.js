var ZeroMcpPluginPreferences = {
  PREF_BRANCH: "extensions.zeroMcpPlugin.",
  PLUGIN_VERSION: "0.1.1",
  DEFAULT_LINK_MODE: "imported_file",
  DEFAULT_DUPLICATE_POLICY: "add_existing_to_collection",
  serviceStateLabel: "服务未启动",
  initialized: false,

  init() {
    if (this.initialized) {
      this.refreshDerivedFields();
      this.refreshRuntimeServiceStatus();
      return;
    }

    this.cacheElements();
    this.ensureDefaults();
    this.loadPrefsIntoUI();
    this.initialized = true;
  },

  cacheElements() {
    this.status = document.getElementById("zero-mcp-plugin-status");
    this.mcpExecutablePath = document.getElementById("zero-mcp-plugin-mcp-executable-path");
    this.bufferDirectory = document.getElementById("zero-mcp-plugin-buffer-directory");
    this.mutationsEnabled = document.getElementById("zero-mcp-plugin-mutations-enabled");
    this.autoStartMcp = document.getElementById("zero-mcp-plugin-auto-start-mcp");
    this.keepHelperRunning = document.getElementById("zero-mcp-plugin-keep-helper-running");
    this.localMcpPort = document.getElementById("zero-mcp-plugin-local-mcp-port");
    this.sharedSecret = document.getElementById("zero-mcp-plugin-shared-secret");
    this.tokenActionStatus = document.getElementById("zero-mcp-plugin-token-action-status");
    this.serviceActionStatus = document.getElementById("zero-mcp-plugin-service-action-status");
    this.defaultLinkMode = document.getElementById("zero-mcp-plugin-default-link-mode");
    this.defaultDuplicatePolicy = document.getElementById("zero-mcp-plugin-default-duplicate-policy");
    this.testMcpStatus = document.getElementById("zero-mcp-plugin-test-mcp-status");
  },

  loadPrefsIntoUI() {
    this.mcpExecutablePath.value = this.getConfiguredMcpExecutablePath();
    this.bufferDirectory.value = this.getBufferDirectory();
    this.mutationsEnabled.checked = this.getBoolPref("mutationsEnabled", true);
    this.autoStartMcp.checked = this.getBoolPref("autoStartMcp", true);
    this.keepHelperRunning.checked = this.getBoolPref("keepHelperRunning", true);
    this.localMcpPort.value = this.getLocalMcpPort();
    this.sharedSecret.value = this.getStringPref("sharedSecret");
    this.defaultLinkMode.value = this.getLinkMode();
    this.defaultDuplicatePolicy.value = this.getDuplicatePolicy();
    this.setTokenActionStatus("当前令牌已保留。");
    this.setTestMcpStatus("");
    this.setServiceActionStatus("");
    this.refreshDerivedFields();
    this.refreshRuntimeServiceStatus();
  },

  refreshDerivedFields() {
    if (!this.status) {
      return;
    }
    let parts = [this.serviceStateLabel || "服务未启动", "端口 " + this.getLocalMcpPort()];
    if (this.getConfiguredMcpExecutablePath()) {
      parts.push("已选择驱动器");
    }
    this.status.textContent = "当前状态：" + parts.join(" | ");
  },

  async chooseMcpExecutablePath() {
    let selected = await this.pickFilePath("选择 MCP 驱动器", [
      ["可执行文件", "*.exe"],
      ["所有文件", "*.*"],
    ]);
    if (!selected) {
      return;
    }
    this.setStringPref("mcpExecutablePath", selected);
    this.mcpExecutablePath.value = selected;
    this.refreshDerivedFields();
    this.setTestMcpStatus("已更新 MCP 驱动器路径。");
  },

  resetMcpExecutablePath() {
    this.setStringPref("mcpExecutablePath", "");
    this.mcpExecutablePath.value = "";
    this.refreshDerivedFields();
    this.setTestMcpStatus("已清空 MCP 驱动器路径。");
  },

  saveMcpExecutablePath() {
    let value = this.mcpExecutablePath.value.trim();
    this.setStringPref("mcpExecutablePath", value);
    this.mcpExecutablePath.value = value;
    this.refreshDerivedFields();
  },

  async chooseBufferDirectory() {
    let selected = await this.pickDirectoryPath("选择文件缓冲目录");
    if (!selected) {
      return;
    }
    this.setStringPref("bufferDirectory", selected);
    this.bufferDirectory.value = selected;
    this.refreshDerivedFields();
  },

  resetBufferDirectory() {
    let value = this.defaultBufferDirectory();
    this.setStringPref("bufferDirectory", value);
    this.bufferDirectory.value = value;
    this.refreshDerivedFields();
    this.setTestMcpStatus("已恢复默认缓冲目录。");
  },

  saveBufferDirectory() {
    let value = this.bufferDirectory.value.trim() || this.defaultBufferDirectory();
    this.setStringPref("bufferDirectory", value);
    this.bufferDirectory.value = value;
    this.refreshDerivedFields();
  },

  saveMutationsEnabled() {
    this.setBoolPref("mutationsEnabled", !!this.mutationsEnabled.checked);
  },

  saveAutoStartMcp() {
    this.setBoolPref("autoStartMcp", !!this.autoStartMcp.checked);
  },

  saveKeepHelperRunning() {
    this.setBoolPref("keepHelperRunning", !!this.keepHelperRunning.checked);
    this.refreshDerivedFields();
    this.setTestMcpStatus(
      this.keepHelperRunning.checked
        ? "已开启常驻运行。由插件启动的 MCP 服务在关闭 Zotero 后仍会继续运行。"
        : "已关闭常驻运行。由插件启动的 MCP 服务会在 Zotero 退出时自动关闭。"
    );
    this.setServiceActionStatus("");
  },

  async saveLocalMcpPort() {
    let previous = this.getLocalMcpPort();
    let normalized = this.normalizePort(this.localMcpPort.value);
    let serviceWasReachable = false;

    if (String(previous) !== String(normalized)) {
      let previousProbe = await this.probeMcpConnection("http://127.0.0.1:" + previous + "/mcp");
      serviceWasReachable = previousProbe.ok;
    }

    this.setStringPref("localMcpPort", normalized);
    this.localMcpPort.value = normalized;
    this.refreshDerivedFields();

    if (String(previous) === String(normalized)) {
      this.setServiceActionStatus("端口未变化，当前客户端配置仍然有效。");
      return;
    }

    if (serviceWasReachable) {
      this.setServiceActionStatus("端口已更新为 " + normalized + "，正在自动重启 MCP 服务。");
      try {
        await this.restartManagedMcpProcess();
        this.setServiceActionStatus("端口已更新为 " + normalized + "。请重新复制客户端配置。");
        return;
      } catch (error) {
        this.setServiceActionStatus(
          "端口已更新为 " +
            normalized +
            "，但自动重启失败。请手动关闭并重新启动 MCP 服务，然后重新复制客户端配置。"
        );
        Zotero.logError(error);
        return;
      }
    }

    this.setServiceActionStatus("端口已更新为 " + normalized + "。请重新复制客户端配置。");
  },

  async resetLocalMcpPort() {
    this.localMcpPort.value = "8000";
    await this.saveLocalMcpPort();
  },

  async regenerateSecret() {
    let secret = this.generateToken();
    this.setStringPref("sharedSecret", secret);
    this.sharedSecret.value = secret;
    this.setTokenActionStatus("已生成新令牌，正在重启 MCP 服务...");
    this.setServiceActionStatus("");

    try {
      await this.restartManagedMcpProcess();
      this.setTokenActionStatus("已生成新令牌，并已重启 MCP 服务。");
    } catch (error) {
      this.setTokenActionStatus("已生成新令牌，但重启失败。请手动测试 MCP 服务。");
      Zotero.logError(error);
    }
  },

  async testMcpConnection() {
    this.setTestMcpStatus("正在检测本地 MCP 服务...");

    let probe = await this.probeMcpConnection();
    if (probe.ok) {
      this.setServiceStateLabel("服务已启动");
      this.setTestMcpStatus("本地 MCP 服务可用，HTTP " + probe.status + "。");
      return;
    }

    let driverPath = this.getMcpExecutablePath();
    if (!driverPath) {
      this.setServiceStateLabel("服务未启动");
      this.setTestMcpStatus("未检测到本地 MCP 服务，请先选择 MCP 驱动器路径。");
      if (probe.error) {
        Zotero.logError(probe.error);
      }
      return;
    }

    this.setTestMcpStatus("未检测到本地 MCP 服务，正在尝试启动...");
    try {
      this.startManagedMcpProcess();
    } catch (error) {
      this.setServiceStateLabel("服务未启动");
      this.setTestMcpStatus("启动失败，请检查驱动器路径、端口和权限。");
      Zotero.logError(error);
      return;
    }

    probe = await this.waitForMcpConnection(12, 500);
    if (probe.ok) {
      this.setServiceStateLabel("服务已启动");
      this.setTestMcpStatus("已启动本地 MCP 服务，HTTP " + probe.status + "。");
      return;
    }

    this.setServiceStateLabel("服务未启动");
    this.setTestMcpStatus("未检测到本地 MCP 服务，请检查驱动器路径、端口和进程状态。");
    if (probe.error) {
      Zotero.logError(probe.error);
    }
  },

  async startMcpService() {
    this.setServiceActionStatus("正在启动本地 MCP 服务...");

    let probe = await this.probeMcpConnection();
    if (probe.ok) {
      this.setServiceStateLabel("服务已启动");
      this.setServiceActionStatus("本地 MCP 服务已在运行，HTTP " + probe.status + "。");
      return;
    }

    let driverPath = this.getMcpExecutablePath();
    if (!driverPath) {
      this.setServiceStateLabel("服务未启动");
      this.setServiceActionStatus("未配置 MCP 驱动器路径，无法启动本地 MCP 服务。");
      return;
    }

    try {
      this.startManagedMcpProcess();
    } catch (error) {
      this.setServiceStateLabel("服务未启动");
      this.setServiceActionStatus("启动失败，请检查驱动器路径、端口和权限。");
      Zotero.logError(error);
      return;
    }

    probe = await this.waitForMcpConnection(12, 500);
    if (probe.ok) {
      this.setServiceStateLabel("服务已启动");
      this.setServiceActionStatus("已手动启动本地 MCP 服务，HTTP " + probe.status + "。");
      return;
    }

    this.setServiceStateLabel("服务未启动");
    this.setServiceActionStatus("启动后仍无法连接，请检查驱动器路径、端口和权限。");
    if (probe.error) {
      Zotero.logError(probe.error);
    }
  },

  async stopMcpService() {
    let executablePath = this.getMcpExecutablePath();
    if (!executablePath) {
      this.setServiceActionStatus("未配置 MCP 驱动器路径，无法关闭 MCP 服务。");
      return;
    }

    this.setServiceActionStatus("正在关闭本地 MCP 服务...");
    this.stopManagedMcpProcesses(executablePath);
    let closed = await this.waitForMcpShutdown(8, 300);

    if (closed) {
      this.setServiceStateLabel("服务已关闭");
      this.setServiceActionStatus("已关闭当前 MCP 驱动器对应的服务。");
      return;
    }

    this.setServiceStateLabel("服务未完全关闭");
    this.setServiceActionStatus("已执行关闭指令，但端口仍可访问。");
  },

  copyCodexConfig() {
    this.copyToClipboard(this.buildCodexConfigSnippet());
    this.setTestMcpStatus("已复制 Codex 配置。");
  },

  copyClaudeCodeConfig() {
    this.copyToClipboard(this.buildClaudeCodeConfigSnippet());
    this.setTestMcpStatus("已复制 Claude Code 配置。");
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

  ensureDefaults() {
    if (!this.hasUserPref("mutationsEnabled")) {
      this.setBoolPref("mutationsEnabled", true);
    }
    if (!this.hasUserPref("autoStartMcp")) {
      this.setBoolPref("autoStartMcp", true);
    }
    if (!this.hasUserPref("keepHelperRunning")) {
      this.setBoolPref("keepHelperRunning", true);
    }
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

  getBoolPref(name, fallback) {
    try {
      let value = Zotero.Prefs.get(this.PREF_BRANCH + name, true);
      return value === undefined ? fallback : !!value;
    } catch (error) {
      return fallback;
    }
  },

  hasUserPref(name) {
    try {
      return Services.prefs.prefHasUserValue(this.PREF_BRANCH + name);
    } catch (error) {
      return false;
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

  getManagedMcpPid() {
    return this.getStringPref("mcpManagedPid").trim();
  },

  setManagedMcpPid(pid) {
    this.setStringPref("mcpManagedPid", pid ? String(pid) : "");
  },

  setTokenActionStatus(message) {
    if (this.tokenActionStatus) {
      this.tokenActionStatus.textContent = message || "";
    }
  },

  setServiceActionStatus(message) {
    if (this.serviceActionStatus) {
      this.serviceActionStatus.textContent = message || "";
    }
  },

  setTestMcpStatus(message) {
    if (this.testMcpStatus) {
      this.testMcpStatus.textContent = message || "";
    }
  },

  setServiceStateLabel(label) {
    this.serviceStateLabel = label || "服务未启动";
    this.refreshDerivedFields();
  },

  async refreshRuntimeServiceStatus() {
    let probe = await this.probeMcpConnection();
    this.setServiceStateLabel(probe.ok ? "服务已启动" : "服务未启动");
  },

  normalizePort(value) {
    let parsed = parseInt(String(value || "").trim() || "8000", 10);
    if (!parsed || parsed < 1 || parsed > 65535) {
      return "8000";
    }
    return String(parsed);
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

  getLocalBridgeProxyURL() {
    return this.getLocalMcpBaseURL() + "/zero-mcp";
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

  async probeMcpConnection(url) {
    try {
      let response = await fetch(url || this.getLocalMcpURL(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: "{}",
      });
      return { ok: true, status: response.status };
    } catch (error) {
      return { ok: false, error };
    }
  },

  async waitForMcpConnection(maxAttempts, delayMs) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let probe = await this.probeMcpConnection();
      if (probe.ok) {
        return probe;
      }
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
    return this.probeMcpConnection();
  },

  async waitForMcpShutdown(maxAttempts, delayMs) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let probe = await this.probeMcpConnection();
      if (!probe.ok) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
    let finalProbe = await this.probeMcpConnection();
    return !finalProbe.ok;
  },

  async restartManagedMcpProcess() {
    let executablePath = this.getMcpExecutablePath();
    if (!executablePath) {
      throw new Error("Missing MCP executable path");
    }

    this.stopManagedMcpProcesses(executablePath);
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    this.startManagedMcpProcess();

    let probe = await this.waitForMcpConnection(12, 500);
    if (!probe.ok) {
      throw probe.error || new Error("MCP restart did not become reachable");
    }
    return probe;
  },

  startManagedMcpProcess() {
    let executablePath = this.getMcpExecutablePath();
    if (!executablePath) {
      throw new Error("Missing MCP executable path");
    }

    let powershell = this.getWindowsPowerShellPath();
    let process = Components.classes["@mozilla.org/process/util;1"]
      .createInstance(Components.interfaces.nsIProcess);
    process.init(powershell);
    process.startHidden = true;

    let pidFile = this.createTempPidFilePath("zero-mcp-start");
    this.setManagedMcpPid("");
    let args = ["-NoProfile", "-Command", this.buildManagedMcpCommand(executablePath, pidFile)];
    process.runw(true, args, args.length);
    this.readManagedPidFromFile(pidFile);
    this.setBoolPref("mcpManagedByPlugin", true);
  },

  buildManagedMcpCommand(executablePath, pidFile) {
    let command = this.escapeForPowerShell(executablePath);
    let bridgeURL = this.escapeForPowerShell(this.getLocalBridgeProxyURL());
    let bridgeToken = this.escapeForPowerShell(this.getStringPref("sharedSecret"));
    let localMcpPort = this.getLocalMcpPort();
    return [
      "$env:ZOTERO_NO_CLAUDE='true'",
      "$env:ZOTERO_LOCAL='true'",
      "$env:ZOTERO_LIBRARY_ID='0'",
      "$env:ZOTERO_DESKTOP_BRIDGE_TIMEOUT='120'",
      "$env:ZOTERO_DESKTOP_BRIDGE_PROXY_TIMEOUT='120'",
      "$env:ZOTERO_DESKTOP_BRIDGE_URL='" + bridgeURL + "'",
      "$env:ZOTERO_DESKTOP_BRIDGE_TOKEN='" + bridgeToken + "'",
      "$proc = Start-Process -FilePath '" +
        command +
        "' -ArgumentList 'serve','--transport','streamable-http','--host','127.0.0.1','--port','" +
        localMcpPort +
        "' -WindowStyle Hidden -PassThru",
      "$proc.Id | Set-Content -Path '" + this.escapeForPowerShell(pidFile) + "' -Encoding UTF8",
    ].join("; ");
  },

  buildStopManagedMcpCommand(executablePath, managedPid) {
    let targetExecutable = String(executablePath || "").trim();
    let normalizedPid = String(managedPid || "").trim();
    return normalizedPid
      ? [
          "$pidToStop=" + parseInt(normalizedPid, 10),
          "Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue",
          "$target='" + this.escapeForPowerShell(targetExecutable) + "'",
          "Get-CimInstance Win32_Process -Filter \"name = 'zotero-mcp.exe'\" | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        ].join("; ")
      : [
          "$target='" + this.escapeForPowerShell(targetExecutable) + "'",
          "Get-CimInstance Win32_Process -Filter \"name = 'zotero-mcp.exe'\" | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        ].join("; ");
  },

  stopManagedMcpProcesses(executablePath) {
    let targetExecutable = String(executablePath || this.getMcpExecutablePath() || "").trim();
    if (!targetExecutable) {
      return;
    }

    let powershell = this.getWindowsPowerShellPath();
    let process = Components.classes["@mozilla.org/process/util;1"]
      .createInstance(Components.interfaces.nsIProcess);
    process.init(powershell);
    process.startHidden = true;

    let command = this.buildStopManagedMcpCommand(targetExecutable, this.getManagedMcpPid());
    let args = ["-NoProfile", "-Command", command];
    process.runw(true, args, args.length);
    this.setBoolPref("mcpManagedByPlugin", false);
    this.setManagedMcpPid("");
  },

  createTempPidFilePath(prefix) {
    let tempFile = Services.dirsvc.get("TmpD", Components.interfaces.nsIFile);
    tempFile.append((prefix || "zero-mcp") + "-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".txt");
    return tempFile.path;
  },

  readManagedPidFromFile(path) {
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
        this.setManagedMcpPid(pid);
      }
      file.remove(false);
    } catch (error) {
      Zotero.logError(error);
    }
  },

  getWindowsPowerShellPath() {
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
  },

  escapeForPowerShell(value) {
    return String(value || "").replace(/'/g, "''");
  },

  getPickerParentWindow() {
    try {
      if (window && window.browsingContext && window.browsingContext.topChromeWindow) {
        return window.browsingContext.topChromeWindow;
      }
    } catch (error) {}
    try {
      if (
        window &&
        window.docShell &&
        window.docShell.chromeEventHandler &&
        window.docShell.chromeEventHandler.ownerGlobal
      ) {
        return window.docShell.chromeEventHandler.ownerGlobal;
      }
    } catch (error) {}
    try {
      if (window && window.top) {
        return window.top;
      }
    } catch (error) {}
    try {
      if (typeof Zotero !== "undefined" && Zotero && Zotero.getMainWindow) {
        let mainWindow = Zotero.getMainWindow();
        if (mainWindow) {
          return mainWindow;
        }
      }
    } catch (error) {}
    return window;
  },

  pickFilePath(title, filters) {
    try {
      let picker = Components.classes["@mozilla.org/filepicker;1"]
        .createInstance(Components.interfaces.nsIFilePicker);
      picker.init(this.getPickerParentWindow(), title, Components.interfaces.nsIFilePicker.modeOpen);
      if (Array.isArray(filters)) {
        for (let filter of filters) {
          picker.appendFilter(filter[0], filter[1]);
        }
      } else {
        picker.appendFilters(Components.interfaces.nsIFilePicker.filterAll);
      }
      return new Promise((resolve) => {
        picker.open((result) => {
          if (result === Components.interfaces.nsIFilePicker.returnOK && picker.file) {
            resolve(picker.file.path);
            return;
          }
          resolve("");
        });
      });
    } catch (error) {
      Zotero.logError(error);
      this.setTestMcpStatus("文件选择器打开失败。");
    }
    return Promise.resolve("");
  },

  pickDirectoryPath(title) {
    try {
      let picker = Components.classes["@mozilla.org/filepicker;1"]
        .createInstance(Components.interfaces.nsIFilePicker);
      picker.init(
        this.getPickerParentWindow(),
        title,
        Components.interfaces.nsIFilePicker.modeGetFolder
      );
      return new Promise((resolve) => {
        picker.open((result) => {
          if (result === Components.interfaces.nsIFilePicker.returnOK && picker.file) {
            resolve(picker.file.path);
            return;
          }
          resolve("");
        });
      });
    } catch (error) {
      Zotero.logError(error);
      this.setTestMcpStatus("目录选择器打开失败。");
    }
    return Promise.resolve("");
  },

  getZoteroDataDirectoryPath() {
    try {
      if (typeof Zotero !== "undefined" && Zotero && Zotero.DataDirectory) {
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
    return this.getFileLocatorPath("ProfD");
  },

  defaultBufferDirectory() {
    try {
      let dataPath = this.getZoteroDataDirectoryPath();
      if (!dataPath) {
        return "";
      }
      let directory = Zotero.File.pathToFile(dataPath);
      directory.append("buffer");
      return directory.path;
    } catch (error) {
      return "";
    }
  },

  getFileLocatorPath(name) {
    try {
      return Services.dirsvc.get(name, Components.interfaces.nsIFile).path;
    } catch (error) {
      return "";
    }
  },

  getConfiguredMcpExecutablePath() {
    return this.getStringPref("mcpExecutablePath").trim();
  },

  getMcpExecutablePath() {
    return this.getConfiguredMcpExecutablePath();
  },

  getBufferDirectory() {
    return this.getStringPref("bufferDirectory") || this.defaultBufferDirectory();
  },

  isAllowedLinkMode(value) {
    return value === "imported_file" || value === "linked_file";
  },

  isAllowedDuplicatePolicy(value) {
    return (
      value === "add_existing_to_collection" ||
      value === "skip" ||
      value === "attach_to_existing" ||
      value === "error"
    );
  },

  getLinkMode() {
    let value = this.getStringPref("defaultLinkMode");
    return this.isAllowedLinkMode(value) ? value : this.DEFAULT_LINK_MODE;
  },

  getDuplicatePolicy() {
    let value = this.getStringPref("defaultDuplicatePolicy");
    return this.isAllowedDuplicatePolicy(value) ? value : this.DEFAULT_DUPLICATE_POLICY;
  },

  generateToken() {
    if (typeof crypto !== "undefined" && crypto && crypto.getRandomValues) {
      let bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    }
    let uuid = Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
    return (uuid + uuid).slice(0, 48);
  },

};

(function bootstrapZeroMcpPluginPreferences() {
  let attempts = 0;
  let maxAttempts = 50;

  function tryInit() {
    attempts += 1;
    let root = document.getElementById("zero-mcp-plugin-preferences-root");
    if (root && typeof ZeroMcpPluginPreferences !== "undefined") {
      try {
        ZeroMcpPluginPreferences.init();
        return;
      } catch (error) {
        if (typeof Zotero !== "undefined" && Zotero && Zotero.logError) {
          Zotero.logError(error);
        }
      }
    }
    if (attempts < maxAttempts) {
      window.setTimeout(tryInit, 100);
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    window.setTimeout(tryInit, 0);
  } else {
    window.addEventListener("DOMContentLoaded", tryInit, { once: true });
    window.addEventListener("load", tryInit, { once: true });
  }
})();
