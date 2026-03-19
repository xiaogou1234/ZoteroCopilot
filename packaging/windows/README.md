# Windows Helper Build

This directory contains the Windows packaging entry point for the Zotero Copilot helper.

## Goal

Build:

- internal onedir output: `dist\\zotero_copilot_0.3.0_helper_windows_x64\\`
- public release archive: `dist\\releases\\zotero_copilot_0.3.0_helper_windows_x64.zip`

The build script uses the shared PyInstaller spec at `packaging/helper/zotero-mcp-helper.spec`.

## Recommended environment

```powershell
cd C:\path\to\ZoteroCopilot
python -m venv .venv-helper-build
.\.venv-helper-build\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[build]"
```

## Build command

```powershell
cd C:\path\to\ZoteroCopilot
.\packaging\windows\build-helper.ps1 -PythonExe .\.venv-helper-build\Scripts\python.exe -Clean
```

## Output layout

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

End users must extract the zip and keep the whole helper directory intact. Do not distribute or move only the `.exe`.
