# ZoteroCopilot 插件

ZoteroCopilot 插件是项目在 Zotero 侧的本地写操作桥接层。

## 作用

插件运行在 Zotero 内部，对外提供仅限本机访问的 bridge endpoint，用于执行：

- collection 管理
- note 创建
- PDF、identifier、BibTeX 导入
- collection 之间的条目移动
- 安全删除条目
- tag 更新

## 在整体架构中的位置

- helper 负责 MCP 对外适配
- 插件负责本地写路径，是唯一可信写层
- 客户端应始终通过 `8000` 端口访问 helper 对外的 bridge

## 关键源码文件

- `manifest.json`
- `bootstrap.js`
- `zero-mcp-plugin.js`
- `preferences.xhtml`
- `preferences.js`
- `prefs.js`

## 说明

- 当前插件版本为 `0.1.1`
- 如果 Zotero 已装过更高的内部测试版，请手动覆盖安装，或先卸载旧版再装
- 仓库只保留插件源码，不提交编译后的 `.xpi` 产物
