# Zotero Copilot 插件

本文档面向维护 Zotero 侧插件的开发者。终端用户安装说明请看顶层 [README.zh-CN.md](../README.zh-CN.md)。

## 在系统中的角色

插件运行在 Zotero 内部，负责：

- 仅限 localhost 的写操作 bridge endpoint
- 跟随 Zotero 生命周期的 helper 启动、重启、恢复和关闭
- helper 路径、缓冲目录、端口、令牌和客户端配置片段等偏好设置界面

## 支持目标

- Zotero 7
- Zotero 8

Windows 与 macOS 共用同一套插件源码。

## 构建产物

构建命令：

```bash
python3 packaging/plugin/build_xpi.py
```

会生成：

- `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
- `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`

## 关键源码文件

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | 打包时使用的共享 manifest 基础配置 |
| `manifest.z7.json` | Zotero 7 的 manifest 覆盖项 |
| `manifest.z8.json` | Zotero 8 的 manifest 覆盖项 |
| `bootstrap.js` | 插件在 Zotero 内部的加载入口 |
| `plugin-compat.js` | 处理 Zotero 版本与平台差异的兼容层 |
| `plugin-main.js` | bridge endpoint、helper 生命周期和主要插件逻辑 |
| `preferences.xhtml` | 偏好设置窗口结构 |
| `preferences.js` | 偏好设置交互、校验和配置片段生成 |
| `prefs.js` | 默认偏好设置值 |

## 偏好设置界面负责的内容

插件侧 UI 负责：

- helper 可执行文件路径
- 文件缓冲目录
- 是否允许写入
- 端口与令牌
- Codex / Claude Code MCP 配置片段生成

## 相关文档

- [README.zh-CN.md](../README.zh-CN.md)
- [开发与源码安装](../docs/development.zh-CN.md)
