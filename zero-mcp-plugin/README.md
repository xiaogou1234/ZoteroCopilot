# ZoteroCopilot Plugin

The ZoteroCopilot plugin is the Zotero-side bridge for local write operations.

## Purpose

The plugin runs inside Zotero and exposes localhost-only bridge endpoints for:

- collection management
- note creation
- PDF, identifier, and BibTeX import
- item moves between collections
- safe item deletion
- tag updates

## Role in the stack

- The helper is the MCP-facing adapter
- The plugin is the authoritative local write layer
- Clients should use the helper-facing bridge URL on port `8000`

## Key source files

- `manifest.json`
- `bootstrap.js`
- `zero-mcp-plugin.js`
- `preferences.xhtml`
- `preferences.js`
- `prefs.js`

## Notes

- The plugin version is `0.1.1`
- If Zotero already has a newer internal build installed, manually reinstall this plugin or remove the old build first
- The plugin source is kept in the repository; built `.xpi` artifacts are not committed
