# macOS Helper Build

This document is for maintainers building the macOS helper. End-user installation lives in the [top-level README](../../README.md).

## Goal

Build:

- internal onedir output: `dist/zotero_copilot_0.3.0_helper_macos_arm64/`
- public release archive: `dist/releases/zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`

## Recommended Environment

```bash
cd /path/to/ZoteroCopilot
python3 -m venv .venv-helper-build
source .venv-helper-build/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[build]"
```

## Build Command

```bash
cd /path/to/ZoteroCopilot
bash packaging/macos/build-helper.sh --clean --target-arch arm64
```

Supported target architectures are `arm64`, `x86_64`, and `universal2`. The script defaults to the current host architecture.

## Output Layout

The onedir output contains:

- `zotero_copilot_0.3.0_helper_macos_arm64`
- `_internal/`

The public tarball contains the full top-level helper directory plus:

- `README.txt`
- `SHA256SUMS.txt`

## Verification

```bash
./dist/zotero_copilot_0.3.0_helper_macos_arm64/zotero_copilot_0.3.0_helper_macos_arm64 version
./dist/zotero_copilot_0.3.0_helper_macos_arm64/zotero_copilot_0.3.0_helper_macos_arm64 serve --transport streamable-http --host 127.0.0.1 --port 8000
```

## Platform Notes

- Ship the archive, not a copied standalone executable.
- Keep the top-level helper directory name stable so release assets match the documented names.
- `_internal/` must stay next to the executable in both the onedir output and the public archive.

## Related Docs

- [Development](../../docs/development.md)
- [Plugin maintainer notes](../../zero-mcp-plugin/README.md)
