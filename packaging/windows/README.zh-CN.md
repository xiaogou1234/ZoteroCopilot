# Windows Helper 打包说明

这个目录包含 ZoteroCopilot 的 Windows helper 可执行文件打包资产。

## 目标

构建一个本地 `zotero-mcp.exe`，供 Zotero 插件设置页直接选择并启动。

## 建议环境

```powershell
cd F:\codex\zotero-mcp
python -m venv .venv-helper-build
.\.venv-helper-build\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[build,semantic]"
```

## 打包命令

```powershell
cd F:\codex\zotero-mcp
.\packaging\windows\build-helper.ps1 -PythonExe .\.venv-helper-build\Scripts\python.exe -Clean
```

## 输出位置

预期输出目录：

```text
dist\zotero-mcp\
```

预期可执行文件路径：

```text
dist\zotero-mcp\zotero-mcp.exe
```

## 验证

```powershell
.\dist\zotero-mcp\zotero-mcp.exe version
.\dist\zotero-mcp\zotero-mcp.exe serve --transport streamable-http --host 127.0.0.1 --port 8000
```

本仓库不提交编译后的 helper 产物。
