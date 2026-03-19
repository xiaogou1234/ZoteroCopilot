# ZoteroCopilot

ZoteroCopilot is a local-first MCP adapter plus Zotero desktop bridge for working with a local Zotero library from MCP clients.

## Status

- Repository version: `0.3.0`
- Python package / helper version: `0.3.0`
- Zotero plugin version: `0.3.0`
- Zotero plugin artifacts:
  - `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
  - `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`
- Public helper artifacts:
  - `dist/releases/zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`
  - `dist/releases/zotero_copilot_0.3.0_helper_windows_x64.zip`

## What It Does

- Search the local Zotero library by keyword, tag, collection, notes, and recent items
- Read item metadata, child items, notes, tags, and available full text
- Expose ChatGPT connectors compatible `search` and `fetch` tools
- Execute local write operations through the Zotero desktop plugin bridge:
  - collection creation and deletion
  - note creation
  - PDF / identifier / BibTeX import
  - batch PDF import
  - collection moves
  - safe item deletion
  - batch tag updates

Semantic search and vector-database tooling were removed in `0.3.0`. The `search` wrapper now performs keyword search over the local library.

## Downloads

Prebuilt plugin and helper packages should be published on the [GitHub Releases page](https://github.com/xiaogou1234/ZoteroCopilot/releases).

- [Open the download page](https://github.com/xiaogou1234/ZoteroCopilot/releases)
- [End-user install guide](docs/getting-started.md)

If the current version has not been published as a release yet, follow the source-install path below.

## Installation

### End-User Install

1. Open the [GitHub Releases page](https://github.com/xiaogou1234/ZoteroCopilot/releases).
2. Download the XPI that matches your Zotero major version:
   - `zotero_copilot_0.3.0_zotero7_plugin.xpi`
   - `zotero_copilot_0.3.0_zotero8_plugin.xpi`
3. Download the helper archive for your platform:
   - macOS: `zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`
   - Windows: `zotero_copilot_0.3.0_helper_windows_x64.zip`
4. Install the XPI in Zotero.
5. Extract the helper archive and keep the full extracted directory intact.
6. In Zotero Copilot preferences, choose the helper executable inside the extracted directory.
7. Configure the buffer directory and whether Zotero writes are allowed.
8. Test the connection in the plugin preferences.
9. Copy the generated MCP configuration for Codex or Claude Code.

Detailed end-user steps are in [docs/getting-started.md](docs/getting-started.md).

### Install From Source

1. Install the Python package:

```bash
pip install zotero-mcp-server
```

or:

```bash
uv tool install zotero-mcp-server
```

2. Build the Zotero plugin:

```bash
python3 packaging/plugin/build_xpi.py
```

3. Build the helper package for your platform:

- macOS: [packaging/macos/README.md](packaging/macos/README.md)
- Windows: [packaging/windows/README.md](packaging/windows/README.md)

4. Install the XPI that matches your Zotero major version.
5. Extract the helper archive and keep the whole extracted directory intact.
6. In Zotero Copilot preferences, choose the helper executable inside the extracted directory.
7. Copy the generated MCP configuration for Codex or Claude Code.

## MCP Interfaces

The MCP server currently exposes 34 tools, grouped below by purpose.

### Read and Search Tools

| Tool | Brief |
| --- | --- |
| `zotero_search_items` | Keyword search across local Zotero items, with query-mode, tag, and item-type filtering. |
| `zotero_search_by_tag` | Tag-first search with AND, OR, and exclusion support. |
| `zotero_get_item_metadata` | Return detailed item metadata by Zotero item key. |
| `zotero_get_item_fulltext` | Return extracted attachment full text, with metadata fallback when needed. |
| `zotero_get_collections` | List the collection tree in the active library. |
| `zotero_get_collection_items` | List items inside a specific collection. |
| `zotero_get_item_children` | List child attachments and notes for a parent item. |
| `zotero_get_tags` | List tags used in the active library. |
| `zotero_get_recent` | Show recently added items. |
| `zotero_advanced_search` | Run multi-condition client-side advanced search with optional sorting. |
| `zotero_get_notes` | Read notes, optionally scoped to a parent item. |
| `zotero_search_notes` | Search note content across the active library. |

### Library, Feed, and Bridge Context Tools

| Tool | Brief |
| --- | --- |
| `zotero_get_desktop_plugin_capabilities` | Report whether the local desktop bridge is available and what mutation features it supports. |
| `zotero_resolve_collection_path` | Convert a human-readable collection path into a stable collection key. |
| `zotero_list_libraries` | List accessible user, group, and feed libraries. |
| `zotero_switch_library` | Switch the active library context for subsequent tool calls. |
| `zotero_list_feeds` | List RSS feed subscriptions from the local Zotero installation. |
| `zotero_get_feed_items` | Read items from a specific RSS feed library. |

### Write and Import Tools

| Tool | Brief |
| --- | --- |
| `zotero_create_collection` | Create a collection by name or full path through the desktop bridge. |
| `zotero_delete_collection` | Delete a collection container without deleting the underlying library items. |
| `zotero_batch_create_collections` | Create multiple collections in one request. |
| `zotero_batch_delete_collections` | Delete multiple collections in one request. |
| `zotero_import_pdf_to_collection` | Import one local PDF into a target collection. |
| `zotero_import_identifier_to_collection` | Import metadata from DOI, ISBN, PMID, or arXiv identifiers. |
| `zotero_import_bibtex_to_collection` | Import metadata from BibTeX or BibLaTeX text. |
| `zotero_create_collection_note` | Create a standalone note inside a collection. |
| `zotero_create_child_note` | Create a child note under an existing item. |
| `zotero_batch_import_pdfs_to_collection` | Bulk import PDFs from a file list or directory. |
| `zotero_move_items_between_collections` | Move one or more items from one collection to another. |
| `zotero_remove_item_from_collection` | Remove an item from one collection without deleting the item itself. |
| `zotero_delete_item` | Move an item to the Zotero trash through the bridge. |
| `zotero_batch_update_tags` | Add or remove tags across multiple matched items in one operation. |

### Connector Compatibility Tools

| Tool | Brief |
| --- | --- |
| `search` | ChatGPT connector-compatible keyword search wrapper returning JSON results. |
| `fetch` | ChatGPT connector-compatible fetch wrapper returning metadata and text for one item. |

## Architecture

ZoteroCopilot uses a three-part local architecture:

1. The helper serves MCP clients on `http://127.0.0.1:8000/mcp`
2. The Zotero plugin exposes localhost-only bridge endpoints and the helper proxies them at `http://127.0.0.1:8000/zero-mcp`
3. Read operations come from the local Zotero database and active Zotero desktop profile

See [docs/architecture.md](docs/architecture.md) for the concise architecture overview.

## Public Distribution Notes

- The helper is still built as `onedir` internally.
- Public releases are archives, not bare folders.
- End users must extract the full helper directory before selecting the executable in Zotero.
- On macOS, if the helper is blocked after extraction, remove quarantine on the extracted directory:

```bash
xattr -dr com.apple.quarantine /path/to/extracted/zotero_copilot_0.3.0_helper_macos_arm64
```

## Development

Repository layout:

- `src/zotero_mcp/`: Python MCP server, helper, and desktop bridge client
- `zero-mcp-plugin/`: Zotero desktop plugin source
- `docs/`: setup and architecture docs
- `packaging/`: helper and plugin build scripts
- `tests/`: Python test suite

Recommended validation:

```bash
python3 -m pytest
python3 -m compileall src/zotero_mcp
python3 packaging/plugin/build_xpi.py
```

## Documentation

- [README.zh-CN.md](README.zh-CN.md)
- [docs/getting-started.md](docs/getting-started.md)
- [docs/getting-started.zh-CN.md](docs/getting-started.zh-CN.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)
- [zero-mcp-plugin/README.md](zero-mcp-plugin/README.md)
- [zero-mcp-plugin/README.zh-CN.md](zero-mcp-plugin/README.zh-CN.md)
