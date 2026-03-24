# ZoteroCopilot

ZoteroCopilot seamlessly connects AI assistants to your local Zotero library for hands-free literature management.

## What It Does

- 🔎 Search a local Zotero library by keyword, tag, collection, note, and recent item state
- 📚 Read item metadata, notes, child items, tags, and available full text
- ✍️ Support local write operations through the Zotero desktop bridge
- 🗂️ Automatically organize and categorize literature

## Install for End Users

1. Open the [GitHub Releases page](https://github.com/xiaogou1234/ZoteroCopilot/releases).
2. Download the XPI of Zotero 7:
   - `zotero_copilot_0.3.0_zotero7_plugin.xpi`
3. Download the helper archive for your platform:
   - macOS 11+ (Apple Silicon, `arm64`): `zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`
   - Windows 10+ (`x64`): `zotero_copilot_0.3.0_helper_windows_x64.zip`
4. In Zotero, open the add-ons view, choose `Install Add-on From File...`, and install the matching XPI.
5. Extract the helper archive and keep the whole extracted directory intact.
6. In Zotero Copilot preferences, select the helper executable inside the extracted directory.
7. Configure the buffer directory and whether Zotero writes are allowed.
8. Click the plugin's connection test button.
9. Copy the generated MCP configuration for Codex or Claude Code.

If macOS blocks the helper after extraction:

```bash
xattr -dr com.apple.quarantine /path/to/extracted/zotero_copilot_0.3.0_helper_macos_arm64
```

For setup after installation, common failures, and client configuration details, see [docs/getting-started.md](docs/getting-started.md).

## Documentation

- 🧭 [Post-install setup and troubleshooting](docs/getting-started.md)
- 🧰 [MCP tools reference](docs/mcp-tools.md)
- 🏗️ [Architecture](docs/architecture.md)
- 🛠️ [Development and source install](docs/development.md)

Maintainer notes for the Zotero plugin and helper packaging live under [docs/development.md](docs/development.md).

## Acknowledgements

ZoteroCopilot builds on the open-source work in [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) and extends it with the current local-first desktop bridge architecture and packaging flow.
