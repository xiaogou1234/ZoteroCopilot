# Zotero Copilot 插件

Zotero Copilot 插件是项目在 Zotero 侧的本地 bridge 和 helper 生命周期管理层。

## 作用

插件运行在 Zotero 内部，提供：

- 仅限 localhost 的写操作 bridge endpoint
- 跟随 Zotero 生命周期的 helper 启动、重启、恢复和关闭
- helper 路径、缓冲目录、端口、令牌、客户端配置片段等偏好设置界面

## 产物

使用下面的命令构建插件：

```bash
python3 packaging/plugin/build_xpi.py
```

会生成：

- `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
- `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`

## 关键源码文件

- `manifest.json`
- `manifest.z7.json`
- `manifest.z8.json`
- `bootstrap.js`
- `plugin-compat.js`
- `plugin-main.js`
- `preferences.xhtml`
- `preferences.js`
- `prefs.js`

## 说明

- 用户可见名称：`Zotero Copilot`
- Windows 与 macOS 共用同一套插件源码
- 终端用户应选择解压后 helper 目录里的可执行文件，而不是最外层目录
- 仓库保留插件源码，不提交编译后的 `.xpi`
