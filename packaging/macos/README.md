# macOS Helper Build

This directory contains the macOS packaging entry point for the Zotero Copilot helper.

## Goal

Build:

- internal onedir output: `dist/zotero_copilot_0.3.0_helper_macos_arm64/`
- public release archive: `dist/releases/zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`

## Recommended environment

```bash
cd /path/to/ZoteroCopilot
python3 -m venv .venv-helper-build
source .venv-helper-build/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[build]"
```

## Build command

```bash
cd /path/to/ZoteroCopilot
bash packaging/macos/build-helper.sh --clean --target-arch arm64
```

Supported target architectures are `arm64`, `x86_64`, and `universal2`. The script defaults to the current host architecture.

## Output layout

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

## Public distribution note

End users must extract the tarball and keep the whole helper directory intact. If macOS blocks execution after extraction:

```bash
xattr -dr com.apple.quarantine /path/to/extracted/zotero_copilot_0.3.0_helper_macos_arm64
```
