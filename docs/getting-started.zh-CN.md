# 快速开始

本文档说明 ZoteroCopilot `0.3.0` 的本地优先部署方式。

## 1. 安装 Python 包

```bash
pip install zotero-mcp-server
```

或者：

```bash
uv tool install zotero-mcp-server
```

## 2. 构建 Zotero 插件

```bash
python3 packaging/plugin/build_xpi.py
```

会生成：

- `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
- `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`

安装与你当前 Zotero 主版本匹配的 XPI。

## 3. 构建 helper 发布包

- macOS：见 [../packaging/macos/README.zh-CN.md](../packaging/macos/README.zh-CN.md)
- Windows：见 [../packaging/windows/README.zh-CN.md](../packaging/windows/README.zh-CN.md)

公开分发产物为：

- `dist/releases/zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`
- `dist/releases/zotero_copilot_0.3.0_helper_windows_x64.zip`

## 4. 解压 helper 归档

先完整解压归档，并保持整个 helper 目录完整。

- macOS 可执行文件：
  - `zotero_copilot_0.3.0_helper_macos_arm64/zotero_copilot_0.3.0_helper_macos_arm64`
- Windows 可执行文件：
  - `zotero_copilot_0.3.0_helper_windows_x64/zotero_copilot_0.3.0_helper_windows_x64.exe`

不要只移动单个可执行文件。`_internal/` 必须保留在同级目录。

## 5. 配置插件

打开 Zotero，然后进入 Zotero Copilot 偏好设置，至少配置：

- helper 可执行文件路径
- 文件缓冲目录
- 是否允许写入操作
- 如有需要，再修改本地 MCP 端口和令牌

现在 helper 生命周期已经简化为自动模式：

- 启动 Zotero：自动确保 helper 可用
- 修改端口或令牌：自动重启 helper
- 关闭 Zotero：自动停止插件管理的 helper

## 6. 连接 MCP 客户端

helper 对外的 MCP 地址：

```text
http://127.0.0.1:8000/mcp
```

helper 对外的桌面 bridge 地址：

```text
http://127.0.0.1:8000/zero-mcp
```

优先使用插件界面生成的配置片段。

## 7. macOS quarantine 说明

如果 macOS 在解压后阻止 helper 启动：

```bash
xattr -dr com.apple.quarantine /path/to/extracted/zotero_copilot_0.3.0_helper_macos_arm64
```

然后回到 Zotero 偏好设置里重新选择 helper，并再次测试连接。
