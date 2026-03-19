# Development

This document is for maintainers and contributors. If you are installing ZoteroCopilot from release packages, start from the [top-level README](../README.md).

## Clone and Set Up a Local Environment

```bash
git clone https://github.com/xiaogou1234/ZoteroCopilot.git
cd ZoteroCopilot
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

If you only need the published Python package outside a local checkout:

```bash
pip install zotero-mcp-server
```

or:

```bash
uv tool install zotero-mcp-server
```

## Build the Zotero Plugin

```bash
python3 packaging/plugin/build_xpi.py
```

This produces:

- `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
- `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`

## Build the Helper

- macOS: [packaging/macos/README.md](../packaging/macos/README.md)
- Windows: [packaging/windows/README.md](../packaging/windows/README.md)

## Use Locally Built Artifacts

After building:

1. Install the matching XPI from `dist/plugins/` into Zotero.
2. Build the helper for your platform and keep the full output directory intact.
3. In Zotero Copilot preferences, point the helper path at the executable inside that directory.
4. Set a writable buffer directory, choose whether writes are allowed, then run the connection test.
5. Copy the generated MCP client configuration again if you changed the port or token.

## Recommended Validation

```bash
python3 -m pytest -q
python3 -m compileall src/zotero_mcp
python3 packaging/plugin/build_xpi.py
```

## Maintainer Docs

- [Architecture](architecture.md)
- [Plugin maintainer notes](../zero-mcp-plugin/README.md)
- [macOS helper packaging](../packaging/macos/README.md)
- [Windows helper packaging](../packaging/windows/README.md)
- [0.3.0 release notes (Chinese)](release-notes-0.3.0.zh-CN.md)
