# ZoteroCopilot

ZoteroCopilot is a local-first MCP adapter and Zotero desktop plugin bridge for working with a Zotero library from AI clients.

It exposes one MCP helper endpoint for clients, reads from the local Zotero data store, and performs write operations through a localhost-only Zotero desktop bridge.

## Status

- Repository version: `0.1.1`
- Python package / helper version: `0.1.1`
- Zotero plugin version: `0.1.1`
- Supported product path: local-first only

## What It Does

- Search the local Zotero library by keyword, tag, collection, and recent items
- Retrieve metadata, notes, child items, and full text when available
- Run semantic search against a local vector index
- Create and delete collections
- Create collection notes and child notes
- Import PDFs, identifiers, and BibTeX metadata into Zotero
- Move items between Zotero collections without changing metadata or attachment storage
- Remove items from collections or send items to the Zotero trash with safety checks

## Architecture

ZoteroCopilot uses a three-part local architecture:

1. The MCP helper serves clients on `http://127.0.0.1:8000/mcp`
2. The Zotero desktop plugin exposes a localhost-only write bridge on `http://127.0.0.1:8000/zero-mcp`
3. Local reads come from the Zotero database and local desktop environment

For a concise architecture overview, see [docs/architecture.md](/F:/codex/zotero-mcp/docs/architecture.md).

## Installation

### Python package

```bash
pip install zotero-mcp-server
```

or with `uv`:

```bash
uv tool install zotero-mcp-server
```

### Optional semantic search dependencies

```bash
pip install "zotero-mcp-server[semantic]"
```

### Zotero desktop plugin

Build the plugin locally from the `zero-mcp-plugin/` source tree and install the generated `.xpi` in Zotero.

The plugin version is currently `0.1.1`. If you already installed a newer internal build such as `2.x`, manually reinstall or uninstall the old plugin first so Zotero does not treat `0.1.1` as a downgrade.

## Quick Start

1. Install the Python package.
2. Build the helper executable if you want the standalone desktop-helper workflow on Windows.
3. Build and install the Zotero plugin.
4. Open the plugin preferences in Zotero and choose the local MCP driver path.
5. Copy the MCP client configuration for Codex or Claude Code from the plugin UI.
6. Start or test the local MCP service from the plugin UI.

Detailed setup steps are available in [docs/getting-started.md](/F:/codex/zotero-mcp/docs/getting-started.md).

## Semantic Search

Semantic search uses a local Chroma database. The helper now checks index state before each semantic search and automatically refreshes or rebuilds the index when needed.

Common helper commands:

```bash
zotero-mcp update-db
zotero-mcp update-db --fulltext
zotero-mcp db-status
```

## Development

### Repository layout

- `src/zotero_mcp/`: Python MCP server, helper, semantic search, and bridge client
- `zero-mcp-plugin/`: Zotero desktop plugin source
- `docs/`: user and architecture documentation
- `packaging/`: helper build assets and scripts
- `tests/`: Python test suite

### Validation

Recommended checks before release:

```bash
python -m pytest
python -m compileall src/zotero_mcp
```

For Windows helper packaging details, see [packaging/windows/README.md](/F:/codex/zotero-mcp/packaging/windows/README.md).

## Documentation

- [README.zh-CN.md](/F:/codex/zotero-mcp/README.zh-CN.md)
- [docs/getting-started.md](/F:/codex/zotero-mcp/docs/getting-started.md)
- [docs/getting-started.zh-CN.md](/F:/codex/zotero-mcp/docs/getting-started.zh-CN.md)
- [docs/architecture.md](/F:/codex/zotero-mcp/docs/architecture.md)
- [docs/architecture.zh-CN.md](/F:/codex/zotero-mcp/docs/architecture.zh-CN.md)
- [zero-mcp-plugin/README.md](/F:/codex/zotero-mcp/zero-mcp-plugin/README.md)
- [zero-mcp-plugin/README.zh-CN.md](/F:/codex/zotero-mcp/zero-mcp-plugin/README.zh-CN.md)

## Acknowledgements

ZoteroCopilot gratefully acknowledges the open-source work in [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp), which helped inform this project.
