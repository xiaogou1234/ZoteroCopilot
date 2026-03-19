# Windows Helper Build

This document is for maintainers building the Windows helper. End-user installation lives in the [top-level README](../../README.md).

## Goal

Build:

- internal onedir output: `dist\\zotero_copilot_0.3.0_helper_windows_x64\\`
- public release archive: `dist\\releases\\zotero_copilot_0.3.0_helper_windows_x64.zip`

The build script uses the shared PyInstaller spec at `packaging/helper/zotero-mcp-helper.spec`.

## Recommended Environment

```powershell
cd C:\path\to\ZoteroCopilot
python -m venv .venv-helper-build
.\.venv-helper-build\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[build]"
```

## Build Command

```powershell
cd C:\path\to\ZoteroCopilot
.\packaging\windows\build-helper.ps1 -PythonExe .\.venv-helper-build\Scripts\python.exe -Clean
```

## Output Layout

The onedir output contains:

- `zotero_copilot_0.3.0_helper_windows_x64.exe`
- `_internal\`

The public zip contains the full top-level helper directory plus:

- `README.txt`
- `SHA256SUMS.txt`

## Verification

```powershell
.\dist\zotero_copilot_0.3.0_helper_windows_x64\zotero_copilot_0.3.0_helper_windows_x64.exe version
.\dist\zotero_copilot_0.3.0_helper_windows_x64\zotero_copilot_0.3.0_helper_windows_x64.exe serve --transport streamable-http --host 127.0.0.1 --port 8000
```

## Platform Notes

- Build on 64-bit Windows and publish the zip, not a copied standalone `.exe`.
- Keep the top-level helper directory name stable so release assets match the documented names.
- `_internal\\` must stay next to the executable in both the onedir output and the public zip.

## Related Docs

- [Development](../../docs/development.md)
- [Plugin maintainer notes](../../zero-mcp-plugin/README.md)
