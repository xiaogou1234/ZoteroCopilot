# Windows Helper 打包说明

本文档面向构建 Windows helper 的维护者。终端用户安装说明请看顶层 [README.zh-CN.md](../../README.zh-CN.md)。

## 目标

生成：

- 内部 `onedir` 输出：`dist\\zotero_copilot_0.3.0_helper_windows_x64\\`
- 对外发布归档：`dist\\releases\\zotero_copilot_0.3.0_helper_windows_x64.zip`

当前打包脚本使用共享 PyInstaller spec：`packaging/helper/zotero-mcp-helper.spec`。

## 建议环境

```powershell
cd C:\path\to\ZoteroCopilot
python -m venv .venv-helper-build
.\.venv-helper-build\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[build]"
```

## 构建命令

```powershell
cd C:\path\to\ZoteroCopilot
.\packaging\windows\build-helper.ps1 -PythonExe .\.venv-helper-build\Scripts\python.exe -Clean
```

## 输出结构

`onedir` 目录中包含：

- `zotero_copilot_0.3.0_helper_windows_x64.exe`
- `_internal\`

公开 zip 还会额外包含：

- `README.txt`
- `SHA256SUMS.txt`

## 验证

```powershell
.\dist\zotero_copilot_0.3.0_helper_windows_x64\zotero_copilot_0.3.0_helper_windows_x64.exe version
.\dist\zotero_copilot_0.3.0_helper_windows_x64\zotero_copilot_0.3.0_helper_windows_x64.exe serve --transport streamable-http --host 127.0.0.1 --port 8000
```

## 平台注意事项

- 请在 64 位 Windows 上构建，并以 zip 归档形式发布，不要单独分发 `.exe`。
- 顶层 helper 目录名需要保持稳定，这样发布物名称才能和文档一致。
- 无论是 `onedir` 目录还是公开 zip，`_internal\\` 都必须和可执行文件保持同级。

## 相关文档

- [开发与源码安装](../../docs/development.zh-CN.md)
- [插件维护说明](../../zero-mcp-plugin/README.zh-CN.md)
