var ZeroMcpPluginCommon = {
  _filePickerCtor: null,
  _filePickerLoaded: false,

  log(scope, message) {
    try {
      if (typeof Zotero !== "undefined" && Zotero && typeof Zotero.debug === "function") {
        Zotero.debug("[ZeroMcpPlugin][" + String(scope || "core") + "] " + String(message || ""));
      }
    } catch (error) {}
  },

  logError(error) {
    try {
      if (typeof Zotero !== "undefined" && Zotero && typeof Zotero.logError === "function") {
        Zotero.logError(error);
      }
    } catch (_error) {}
  },

  isWindows() {
    return !!(typeof Zotero !== "undefined" && Zotero && Zotero.isWin);
  },

  isMac() {
    return !!(typeof Zotero !== "undefined" && Zotero && Zotero.isMac);
  },

  isLinux() {
    return !!(typeof Zotero !== "undefined" && Zotero && Zotero.isLinux);
  },

  getPickerParentWindow(targetWindow) {
    let activeWindow = targetWindow;
    try {
      if (
        activeWindow &&
        activeWindow.browsingContext &&
        activeWindow.browsingContext.topChromeWindow
      ) {
        return activeWindow.browsingContext.topChromeWindow;
      }
    } catch (error) {}
    try {
      if (
        activeWindow &&
        activeWindow.docShell &&
        activeWindow.docShell.chromeEventHandler &&
        activeWindow.docShell.chromeEventHandler.ownerGlobal
      ) {
        return activeWindow.docShell.chromeEventHandler.ownerGlobal;
      }
    } catch (error) {}
    try {
      if (activeWindow && activeWindow.top) {
        return activeWindow.top;
      }
    } catch (error) {}
    try {
      if (typeof Zotero !== "undefined" && Zotero && typeof Zotero.getMainWindow === "function") {
        let mainWindow = Zotero.getMainWindow();
        if (mainWindow) {
          return mainWindow;
        }
      }
    } catch (error) {}
    return activeWindow || null;
  },

  _loadFilePickerCtor() {
    if (this._filePickerLoaded) {
      return this._filePickerCtor;
    }
    this._filePickerLoaded = true;

    try {
      if (typeof ChromeUtils !== "undefined" && typeof ChromeUtils.importESModule === "function") {
        let filePickerModule = ChromeUtils.importESModule(
          "chrome://zotero/content/modules/filePicker.mjs"
        );
        if (filePickerModule && filePickerModule.FilePicker) {
          this._filePickerCtor = filePickerModule.FilePicker;
        }
      }
    } catch (error) {
      this.log("picker", "Falling back to nsIFilePicker compatibility wrapper");
    }

    return this._filePickerCtor;
  },

  _createPicker(targetWindow, title, mode) {
    let parentWindow = this.getPickerParentWindow(targetWindow);
    let FilePicker = this._loadFilePickerCtor();
    if (FilePicker) {
      let picker = new FilePicker();
      picker.init(parentWindow, title, mode);
      return picker;
    }

    let picker = Components.classes["@mozilla.org/filepicker;1"]
      .createInstance(Components.interfaces.nsIFilePicker);
    let initTarget = parentWindow && parentWindow.browsingContext
      ? parentWindow.browsingContext
      : parentWindow;
    picker.init(initTarget, title, mode);
    return picker;
  },

  _pickerReturnOK(picker) {
    if (picker && typeof picker.returnOK === "number") {
      return picker.returnOK;
    }
    return Components.interfaces.nsIFilePicker.returnOK;
  },

  _pickerSelectedPath(picker) {
    if (!picker) {
      return "";
    }
    try {
      if (typeof picker.file === "string") {
        return picker.file;
      }
      if (picker.file && picker.file.path) {
        return picker.file.path;
      }
    } catch (error) {}
    return "";
  },

  _showPicker(picker) {
    if (!picker) {
      return Promise.resolve("");
    }

    let returnOK = this._pickerReturnOK(picker);
    if (typeof picker.show === "function") {
      let result = picker.show();
      if (result && typeof result.then === "function") {
        return result.then((resolvedResult) => {
          if (resolvedResult === returnOK) {
            return this._pickerSelectedPath(picker);
          }
          return "";
        });
      }
      if (result === returnOK) {
        return Promise.resolve(this._pickerSelectedPath(picker));
      }
      return Promise.resolve("");
    }

    if (typeof picker.open === "function") {
      return new Promise((resolve) => {
        picker.open((result) => {
          if (result === returnOK) {
            resolve(this._pickerSelectedPath(picker));
            return;
          }
          resolve("");
        });
      });
    }

    return Promise.reject(new Error("Unsupported file picker implementation"));
  },

  pickFilePath(targetWindow, title, filters) {
    try {
      let picker = this._createPicker(
        targetWindow,
        title,
        Components.interfaces.nsIFilePicker.modeOpen
      );
      if (Array.isArray(filters) && filters.length) {
        for (let filter of filters) {
          picker.appendFilter(filter[0], filter[1]);
        }
      } else {
        picker.appendFilters(Components.interfaces.nsIFilePicker.filterAll);
      }
      return this._showPicker(picker);
    } catch (error) {
      this.logError(error);
    }
    return Promise.resolve("");
  },

  pickDirectoryPath(targetWindow, title) {
    try {
      let picker = this._createPicker(
        targetWindow,
        title,
        Components.interfaces.nsIFilePicker.modeGetFolder
      );
      return this._showPicker(picker);
    } catch (error) {
      this.logError(error);
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

    try {
      return Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
    } catch (error) {
      return "";
    }
  },

  defaultBufferDirectory() {
    let dataPath = this.getZoteroDataDirectoryPath();
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
  },

  generateSharedSecret() {
    if (typeof crypto !== "undefined" && crypto && crypto.getRandomValues) {
      let bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, function (value) {
        return value.toString(16).padStart(2, "0");
      }).join("");
    }

    let uuid = Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
    return (uuid + uuid).slice(0, 48);
  },

  buildManagedMcpArguments(port) {
    return [
      "serve",
      "--transport",
      "streamable-http",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ];
  },

  normalizePort(value, fallback) {
    let parsed = parseInt(String(value || "").trim() || String(fallback || 8000), 10);
    if (!parsed || parsed < 1 || parsed > 65535) {
      return String(fallback || 8000);
    }
    return String(parsed);
  },

  _looksLikePackagedHelperBasename(pathOrName) {
    let normalizedName = this._normalizeExecutableName(this._pathBasename(pathOrName));
    if (!normalizedName) {
      return false;
    }
    return (
      (normalizedName.indexOf("zotero_copilot_") === 0 &&
        normalizedName.indexOf("_helper_") !== -1) ||
      normalizedName.indexOf("zotero-mcp") === 0
    );
  },

  inspectHelperExecutablePath(executablePath) {
    let normalizedPath = String(executablePath || "").trim();
    if (!normalizedPath) {
      return {
        ok: false,
        code: "HELPER_PATH_REQUIRED",
        message: "Missing MCP helper executable path",
      };
    }

    let executable = null;
    try {
      executable = Zotero.File.pathToFile(normalizedPath);
    } catch (error) {}
    if (!executable) {
      return {
        ok: false,
        code: "HELPER_PATH_NOT_FOUND",
        message: "The selected helper path could not be resolved",
      };
    }

    if (!executable.exists()) {
      return {
        ok: false,
        code: "HELPER_PATH_NOT_FOUND",
        message: "The selected helper file does not exist",
      };
    }

    if (executable.isDirectory()) {
      return {
        ok: false,
        code: "HELPER_PATH_IS_DIRECTORY",
        message: "The selected helper path is a directory, not an executable file",
      };
    }

    let resolvedPath = executable.path || normalizedPath;
    let bundleDirectory = null;
    let hasInternalDirectory = false;
    try {
      bundleDirectory = executable.parent ? executable.parent.path : "";
      if (bundleDirectory) {
        let internalDirectory = executable.parent.clone();
        internalDirectory.append("_internal");
        hasInternalDirectory = internalDirectory.exists() && internalDirectory.isDirectory();
      }
    } catch (error) {}

    if (this.isMac() || this.isLinux()) {
      let isExecutable = true;
      try {
        if (typeof executable.isExecutable === "function") {
          isExecutable = !!executable.isExecutable();
        } else if (typeof executable.isExecutable === "boolean") {
          isExecutable = executable.isExecutable;
        }
      } catch (error) {}

      if (!isExecutable) {
        return {
          ok: false,
          code: "HELPER_PATH_NOT_EXECUTABLE",
          message: "The selected helper file is not executable",
          details: {
            path: resolvedPath,
            bundleDirectory: bundleDirectory,
          },
        };
      }
    }

    if (
      this._looksLikePackagedHelperBasename(resolvedPath) &&
      bundleDirectory &&
      !hasInternalDirectory
    ) {
      return {
        ok: false,
        code: "HELPER_LAYOUT_INCOMPLETE",
        message: "The extracted helper directory is incomplete",
        details: {
          path: resolvedPath,
          bundleDirectory: bundleDirectory,
        },
      };
    }

    return {
      ok: true,
      path: resolvedPath,
      bundleDirectory: bundleDirectory,
      isPackagedHelper: this._looksLikePackagedHelperBasename(resolvedPath),
      hasInternalDirectory: hasInternalDirectory,
    };
  },

  _createProcess(executablePath) {
    let inspection = this.inspectHelperExecutablePath(executablePath);
    if (!inspection.ok) {
      let inspectionError = new Error(inspection.message);
      inspectionError.code = inspection.code;
      inspectionError.details = inspection.details || null;
      throw inspectionError;
    }

    let executable = Zotero.File.pathToFile(inspection.path);

    let process = Components.classes["@mozilla.org/process/util;1"]
      .createInstance(Components.interfaces.nsIProcess);
    process.init(executable);
    process.startHidden = true;
    if ("noShell" in process) {
      process.noShell = true;
    }
    return process;
  },

  spawnHelper(executablePath, args, observer) {
    let process = this._createProcess(executablePath);
    if (typeof process.runwAsync === "function") {
      process.runwAsync(args, args.length, observer || null, false);
    } else {
      process.runw(false, args, args.length);
    }

    let pid = "";
    try {
      if (process.pid) {
        pid = String(process.pid);
      }
    } catch (error) {}

    this.log("process", "Started process " + executablePath + (pid ? " (pid " + pid + ")" : ""));
    return { pid: pid, args: args, process: process };
  },

  startManagedMcpProcess(executablePath, port, observer) {
    let args = this.buildManagedMcpArguments(port);
    let result = this.spawnHelper(executablePath, args, observer);
    this.log(
      "process",
      "Started local helper at " +
        executablePath +
        " on port " +
        port +
        (result.pid ? " (pid " + result.pid + ")" : "")
    );
    return result;
  },

  _resolveWindowsCommand(name) {
    let windir = Services.dirsvc.get("WinD", Components.interfaces.nsIFile);
    let file = windir.clone();
    file.append("System32");
    file.append(name);
    if (!file.exists()) {
      throw new Error("Missing Windows system command: " + name);
    }
    return file.path;
  },

  _resolvePosixCommand(paths) {
    for (let path of paths) {
      try {
        let file = Zotero.File.pathToFile(path);
        if (file && file.exists() && !file.isDirectory()) {
          return file.path;
        }
      } catch (error) {}
    }
    throw new Error("Missing POSIX system command: " + paths.join(", "));
  },

  _normalizeExistingPath(path) {
    let normalized = String(path || "").trim();
    if (!normalized) {
      return "";
    }

    try {
      let file = Zotero.File.pathToFile(normalized);
      if (!file) {
        return normalized;
      }
      if (typeof file.normalize === "function") {
        file.normalize();
      }
      return file.path || normalized;
    } catch (error) {
      return normalized;
    }
  },

  _pathBasename(path) {
    let normalized = String(path || "").trim().replace(/[\\/]+$/, "");
    if (!normalized) {
      return "";
    }
    let parts = normalized.split(/[\\/]/);
    return parts.length ? parts[parts.length - 1] : normalized;
  },

  _normalizeExecutableName(name) {
    return String(name || "")
      .trim()
      .replace(/^"+|"+$/g, "")
      .replace(/\.exe$/i, "")
      .toLowerCase();
  },

  _extractCommandImageName(command) {
    let normalized = String(command || "").trim();
    if (!normalized) {
      return "";
    }

    let imagePath = normalized;
    if (normalized[0] === '"') {
      let closingQuote = normalized.indexOf('"', 1);
      imagePath = closingQuote > 1 ? normalized.slice(1, closingQuote) : normalized.slice(1);
    } else {
      imagePath = normalized.split(/\s+/)[0];
    }

    return this._pathBasename(imagePath);
  },

  _parseTasklistCsvLine(line) {
    let values = [];
    let matcher = /"((?:[^"]|"")*)"(?:,|$)/g;
    let match = null;
    while ((match = matcher.exec(String(line || "")))) {
      values.push(String(match[1] || "").replace(/""/g, '"'));
    }
    return values;
  },

  _processImageMatchesExecutable(imageName, executablePath) {
    let normalizedImageName = String(imageName || "").trim().toLowerCase();
    if (!normalizedImageName) {
      return false;
    }

    let expectedBasename = this._pathBasename(this._normalizeExistingPath(executablePath) || executablePath);
    if (!expectedBasename) {
      return true;
    }
    return this._isHelperFamilyName(normalizedImageName, expectedBasename);
  },

  _isHelperFamilyName(candidateName, executablePath) {
    let normalizedCandidate = this._normalizeExecutableName(candidateName);
    let expectedBasename = this._pathBasename(this._normalizeExistingPath(executablePath) || executablePath);
    let normalizedExpected = this._normalizeExecutableName(expectedBasename);
    if (!normalizedCandidate || !normalizedExpected) {
      return false;
    }

    if (normalizedCandidate === normalizedExpected) {
      return true;
    }

    if (
      normalizedExpected.indexOf("zotero_copilot_") === 0 &&
      normalizedExpected.indexOf("_helper_") !== -1
    ) {
      return (
        normalizedCandidate.indexOf("zotero_copilot_") === 0 &&
        normalizedCandidate.indexOf("_helper_") !== -1
      );
    }

    if (normalizedExpected.indexOf("zotero-mcp") === 0) {
      return normalizedCandidate.indexOf("zotero-mcp") === 0;
    }

    return false;
  },

  _commandMatchesHelperProcess(command, executablePath) {
    if (this._commandMatchesExecutable(command, executablePath)) {
      return true;
    }
    return this._isHelperFamilyName(this._extractCommandImageName(command), executablePath);
  },

  matchesHelperProcess(command, executablePath) {
    return this._commandMatchesHelperProcess(command, executablePath);
  },

  _commandMatchesExecutable(command, executablePath) {
    let normalizedCommand = String(command || "").trim();
    if (!normalizedCommand) {
      return false;
    }

    let expectedPath = this._normalizeExistingPath(executablePath);
    if (!expectedPath) {
      return true;
    }

    let candidates = Array.from(new Set([String(executablePath || "").trim(), expectedPath])).filter(
      Boolean
    );
    for (let candidate of candidates) {
      if (normalizedCommand === candidate || normalizedCommand.indexOf(candidate + " ") === 0) {
        return true;
      }
    }

    let basename = this._pathBasename(expectedPath);
    if (!basename) {
      return false;
    }

    if (
      normalizedCommand === basename ||
      normalizedCommand.endsWith("/" + basename) ||
      normalizedCommand.indexOf("/" + basename + " ") !== -1 ||
      normalizedCommand.indexOf("\\" + basename + " ") !== -1
    ) {
      return true;
    }

    return false;
  },

  async isProcessRunning(pid, executablePath) {
    let normalizedPid = String(pid || "").trim();
    if (!normalizedPid) {
      return false;
    }

    if (this.isWindows()) {
      let tasklistPath = this._resolveWindowsCommand("tasklist.exe");
      let output = "";
      try {
        output = String(
          await Zotero.Utilities.Internal.subprocess(tasklistPath, [
            "/FI",
            "PID eq " + normalizedPid,
            "/FO",
            "CSV",
            "/NH",
          ])
        ).trim();
      } catch (error) {
        return false;
      }

      if (!output || /^INFO:/i.test(output)) {
        return false;
      }

      let firstLine = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
      if (!firstLine) {
        return false;
      }

      let fields = this._parseTasklistCsvLine(firstLine);
      if (fields.length < 2 || String(fields[1]).trim() !== normalizedPid) {
        return false;
      }

      if (!executablePath) {
        return true;
      }
      return this._processImageMatchesExecutable(fields[0], executablePath);
    }

    if (!(this.isMac() || this.isLinux())) {
      return false;
    }

    let psPath = this._resolvePosixCommand(["/bin/ps", "/usr/bin/ps"]);
    let command = "";
    try {
      command = String(
        await Zotero.Utilities.Internal.subprocess(psPath, ["-p", normalizedPid, "-o", "command="])
      ).trim();
    } catch (error) {
      return false;
    }

    if (!command) {
      return false;
    }

    if (!executablePath) {
      return true;
    }
    return this._commandMatchesHelperProcess(command, executablePath);
  },

  async listMatchingProcessInfo(executablePath) {
    let normalizedExecutablePath = this._normalizeExistingPath(executablePath);
    if (this.isWindows()) {
      let tasklistPath = this._resolveWindowsCommand("tasklist.exe");
      let output = "";
      try {
        output = String(
          await Zotero.Utilities.Internal.subprocess(tasklistPath, ["/FO", "CSV", "/NH"])
        ).trim();
      } catch (error) {
        return [];
      }

      return String(output || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => this._parseTasklistCsvLine(line))
        .filter((fields) => fields.length >= 2)
        .filter((fields) => this._processImageMatchesExecutable(fields[0], normalizedExecutablePath))
        .map((fields) => ({
          pid: String(fields[1]).trim(),
          command: String(fields[0] || "").trim(),
        }))
        .filter((info) => !!info.pid);
    }

    if (!(this.isMac() || this.isLinux())) {
      return [];
    }

    let psPath = this._resolvePosixCommand(["/bin/ps", "/usr/bin/ps"]);
    let output = "";
    try {
      output = String(
        await Zotero.Utilities.Internal.subprocess(psPath, ["-axo", "pid=,command="])
      );
    } catch (error) {
      return [];
    }

    return String(output || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        let match = line.match(/^(\d+)\s+(.*)$/);
        if (!match) {
          return null;
        }
        return {
          pid: String(match[1]).trim(),
          command: String(match[2] || "").trim(),
        };
      })
      .filter(Boolean)
      .filter((info) => this._commandMatchesHelperProcess(info.command, normalizedExecutablePath));
  },

  async listMatchingPids(executablePath) {
    let infos = await this.listMatchingProcessInfo(executablePath);
    return infos.map((info) => info.pid).filter(Boolean);
  },

  async findListeningProcessInfo(port) {
    let normalizedPort = parseInt(String(port || "").trim(), 10);
    if (!normalizedPort || normalizedPort < 1 || normalizedPort > 65535) {
      return null;
    }

    if (this.isWindows()) {
      let netstatPath = this._resolveWindowsCommand("netstat.exe");
      let output = "";
      try {
        output = await Zotero.Utilities.Internal.subprocess(netstatPath, ["-ano", "-p", "tcp"]);
      } catch (error) {
        return null;
      }

      let targetPid = "";
      let lines = String(output || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (let line of lines) {
        let fields = line.split(/\s+/);
        if (fields.length < 5) {
          continue;
        }
        let localAddress = String(fields[1] || "");
        let state = String(fields[3] || "").toUpperCase();
        if (state !== "LISTENING") {
          continue;
        }
        if (!localAddress.endsWith(":" + normalizedPort)) {
          continue;
        }
        targetPid = String(fields[4] || "").trim();
        if (targetPid) {
          break;
        }
      }

      if (!targetPid) {
        return null;
      }

      let command = "";
      try {
        let tasklistPath = this._resolveWindowsCommand("tasklist.exe");
        let taskOutput = String(
          await Zotero.Utilities.Internal.subprocess(tasklistPath, [
            "/FI",
            "PID eq " + targetPid,
            "/FO",
            "CSV",
            "/NH",
          ])
        ).trim();
        let firstLine = taskOutput
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)[0];
        if (firstLine) {
          let fields = this._parseTasklistCsvLine(firstLine);
          command = String(fields[0] || "").trim();
        }
      } catch (error) {}

      return {
        pid: targetPid,
        command: command,
      };
    }

    let lsofPath = this._resolvePosixCommand(["/usr/sbin/lsof", "/usr/bin/lsof", "/bin/lsof"]);
    let output = "";
    try {
      output = await Zotero.Utilities.Internal.subprocess(lsofPath, [
        "-nP",
        "-iTCP:" + normalizedPort,
        "-sTCP:LISTEN",
      ]);
    } catch (error) {
      this.log("process", "No listening helper process found on port " + normalizedPort);
      return null;
    }

    let lines = String(output || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      return null;
    }

    let fields = lines[1].split(/\s+/);
    if (fields.length < 2) {
      return null;
    }

    let pid = fields[1];
    if (!pid) {
      return null;
    }

    let psPath = this._resolvePosixCommand(["/bin/ps", "/usr/bin/ps"]);
    let command = "";
    try {
      command = String(
        await Zotero.Utilities.Internal.subprocess(psPath, ["-p", String(pid), "-o", "command="])
      ).trim();
    } catch (error) {}

    return {
      pid: String(pid).trim(),
      command: command,
    };
  },

  async findMatchingListeningProcessInfo(port, executablePath) {
    let info = await this.findListeningProcessInfo(port);
    if (!info || !info.pid) {
      return null;
    }

    if (!this._commandMatchesHelperProcess(info.command, executablePath)) {
      return null;
    }

    return info;
  },

  async findMatchingListeningPid(port, executablePath) {
    let info = await this.findMatchingListeningProcessInfo(port, executablePath);
    return info && info.pid ? info.pid : "";
  },

  async findListeningProcess(port) {
    return this.findListeningProcessInfo(port);
  },

  _resolveTerminationCommand(pid, force) {
    let normalizedPid = String(pid || "").trim();
    if (!normalizedPid) {
      return null;
    }

    if (this.isWindows()) {
      return {
        executablePath: this._resolveWindowsCommand("taskkill.exe"),
        args: ["/PID", normalizedPid, "/T", "/F"],
      };
    }

    if (this.isMac() || this.isLinux()) {
      return {
        executablePath: this._resolvePosixCommand(["/bin/kill", "/usr/bin/kill"]),
        args: [force ? "-KILL" : "-TERM", normalizedPid],
      };
    }

    throw new Error("Unsupported platform for helper termination");
  },

  terminateProcessTree(pid, force) {
    let command = this._resolveTerminationCommand(pid, force);
    if (!command) {
      return false;
    }

    let process = this._createProcess(command.executablePath);
    process.runw(true, command.args, command.args.length);
    this.log(
      "process",
      "Sent " + (force ? "forced" : "graceful") + " stop signal to managed helper pid " + pid
    );
    return true;
  },

  stopManagedMcpProcess(pid, force) {
    return this.terminateProcessTree(pid, force);
  },

  async isProcessAlive(pid, executablePath) {
    return this.isProcessRunning(pid, executablePath);
  },

  async waitForProcessExit(pid, timeoutMs, executablePath) {
    let normalizedPid = String(pid || "").trim();
    if (!normalizedPid) {
      return true;
    }

    let deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    do {
      if (!(await this.isProcessAlive(normalizedPid, executablePath))) {
        return true;
      }
      if (typeof Zotero !== "undefined" && Zotero && Zotero.Promise) {
        await Zotero.Promise.delay(200);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } while (Date.now() < deadline);

    return !(await this.isProcessAlive(normalizedPid, executablePath));
  },
};
