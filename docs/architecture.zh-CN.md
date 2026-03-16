# 架构说明

ZoteroCopilot 采用纯本地优先架构。

## 组成部分

### MCP helper

- 通过 `http://127.0.0.1:8000/mcp` 向 MCP 客户端提供服务
- 将本地 Zotero 能力适配成 MCP 工具
- 在 `http://127.0.0.1:8000/zero-mcp` 提供 helper 对外可见的 bridge 代理

### Zotero 桌面插件

- 运行在 Zotero 7 内部
- 对外暴露仅限本机访问的 mutation endpoints
- 负责所有必须通过 Zotero 本地 JavaScript API 执行的写操作

### 本地读取层

- 从本地 Zotero 数据库和本地桌面环境读取数据
- 支持 metadata、notes、collections、tags 和语义搜索索引

## 写操作路径

写操作通过桌面 bridge 执行：

1. MCP 客户端调用 helper
2. helper 将请求转发到 helper 对外 bridge
3. 插件在 Zotero 内部真正执行 mutation

这样可以保证正式支持的写路径完全基于本地环境，不依赖 Zotero Web API。

## 语义搜索

- 使用本地 Chroma 数据库
- 支持 metadata-first 索引，也支持可选 full-text 索引
- 搜索前会先检查索引状态，并在必要时自动刷新或重建

## 集合间移动

集合移动 API 只修改 collection membership，不会改变 metadata 记录本体，也不会移动附件文件在磁盘上的物理位置。
