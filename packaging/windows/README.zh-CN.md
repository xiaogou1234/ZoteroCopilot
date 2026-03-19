# Windows Helper 打包说明

这个目录包含 Zotero Copilot 的 Windows helper 打包入口。

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

终端用户必须先完整解压 zip，再选择其中的 `.exe`。不要只分发或移动单个 `.exe` 文件。
