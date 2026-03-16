# Getting Started

This guide covers the supported local-first setup for ZoteroCopilot.

## 1. Install the Python package

```bash
pip install zotero-mcp-server
```

Optional semantic search dependencies:

```bash
pip install "zotero-mcp-server[semantic]"
```

## 2. Build the helper if you need a local executable

On Windows, use the helper packaging instructions in [../packaging/windows/README.md](/F:/codex/zotero-mcp/packaging/windows/README.md).

## 3. Build and install the Zotero plugin

The plugin source lives in `zero-mcp-plugin/`. Build the `.xpi` locally and install it from Zotero's add-on manager.

Important: the plugin version is `0.1.1`. If Zotero already has a newer internal build installed, manually reinstall or uninstall the old plugin first.

## 4. Configure the plugin

Open Zotero, then open the plugin preferences page and configure:

- MCP driver path
- buffer directory
- whether MCP writes are allowed
- optional client configuration copy buttons for Codex or Claude Code

You can also start, stop, and test the local MCP service from the plugin preferences page.

## 5. Connect an MCP client

The helper-facing MCP URL is:

```text
http://127.0.0.1:8000/mcp
```

The helper-facing desktop bridge URL is:

```text
http://127.0.0.1:8000/zero-mcp
```

Use the plugin-provided configuration snippet for Codex or Claude Code whenever possible.

## 6. Initialize semantic search

```bash
zotero-mcp update-db
```

For a more complete index:

```bash
zotero-mcp update-db --fulltext
```

Check status with:

```bash
zotero-mcp db-status
```

Semantic search now checks the local index automatically before each search and refreshes or rebuilds the index when needed.

## 7. Typical workflow

1. Start Zotero
2. Make sure the plugin is installed
3. Start or test the MCP service from the plugin preferences page
4. Connect your MCP client
5. Query the local library or run local mutations
