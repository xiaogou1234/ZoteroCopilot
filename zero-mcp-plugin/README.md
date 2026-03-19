# Zotero Copilot Plugin

The Zotero Copilot plugin is the Zotero-side bridge and helper lifecycle manager for local desktop usage.

## Purpose

The plugin runs inside Zotero and provides:

- localhost-only bridge endpoints for write operations
- helper startup, restart, recovery, and shutdown tied to the Zotero lifecycle
- preferences UI for helper path, buffer directory, port, token, and client config snippets

## Supported outputs

Build plugin artifacts with:

```bash
python3 packaging/plugin/build_xpi.py
```

This produces:

- `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
- `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`

## Key source files

- `manifest.json`
- `manifest.z7.json`
- `manifest.z8.json`
- `bootstrap.js`
- `plugin-compat.js`
- `plugin-main.js`
- `preferences.xhtml`
- `preferences.js`
- `prefs.js`

## Notes

- Display name: `Zotero Copilot`
- The plugin shares one source tree across Windows and macOS
- End users should select the helper executable inside the extracted helper directory, not the directory itself
- The plugin source stays in the repository; built `.xpi` files are not committed
