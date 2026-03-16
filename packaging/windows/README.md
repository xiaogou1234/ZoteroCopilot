# Windows Helper Build

This directory contains the Windows packaging assets for the ZoteroCopilot helper executable.

## Goal

Build a local `zotero-mcp.exe` that can be selected from the Zotero plugin preferences page.

## Recommended environment

```powershell
cd F:\codex\zotero-mcp
python -m venv .venv-helper-build
.\.venv-helper-build\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[build,semantic]"
```

## Build command

```powershell
cd F:\codex\zotero-mcp
.\packaging\windows\build-helper.ps1 -PythonExe .\.venv-helper-build\Scripts\python.exe -Clean
```

## Output

The expected output directory is:

```text
dist\zotero-mcp\
```

The expected executable path is:

```text
dist\zotero-mcp\zotero-mcp.exe
```

## Verification

```powershell
.\dist\zotero-mcp\zotero-mcp.exe version
.\dist\zotero-mcp\zotero-mcp.exe serve --transport streamable-http --host 127.0.0.1 --port 8000
```

This repository does not commit built helper artifacts.
