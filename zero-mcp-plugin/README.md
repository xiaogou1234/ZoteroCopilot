# Zotero Copilot Plugin

This document is for maintainers of the Zotero-side plugin. End-user installation lives in the [top-level README](../README.md).

## Role in the System

The plugin runs inside Zotero and is responsible for:

- localhost-only bridge endpoints for write operations
- helper startup, restart, recovery, and shutdown tied to the Zotero lifecycle
- preferences UI for helper path, buffer directory, port, token, and client configuration snippets

## Supported Targets

- Zotero 7
- Zotero 8

One source tree is used across Windows and macOS.

## Build Output

Build plugin artifacts with:

```bash
python3 packaging/plugin/build_xpi.py
```

This produces:

- `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
- `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`

## Key Source Files

| File | Responsibility |
| --- | --- |
| `manifest.json` | Shared manifest base used for packaging |
| `manifest.z7.json` | Zotero 7-specific manifest overrides |
| `manifest.z8.json` | Zotero 8-specific manifest overrides |
| `bootstrap.js` | Entry point for loading the plugin inside Zotero |
| `plugin-compat.js` | Compatibility helpers for Zotero version and platform differences |
| `plugin-main.js` | Bridge endpoints, helper lifecycle control, and core plugin behavior |
| `preferences.xhtml` | Preferences window structure |
| `preferences.js` | Preferences UI behavior, validation, and generated config snippets |
| `prefs.js` | Default preference values |

## Preferences Surface

The plugin owns the Zotero-side UI for:

- helper executable path
- import buffer directory
- write enablement
- port and token
- generated Codex / Claude Code MCP configuration snippets

## Related Docs

- [Top-level README](../README.md)
- [Development](../docs/development.md)
