# 架构说明

ZoteroCopilot 是一套本地优先架构，读路径和写路径明确分离。

## 组成部分

### MCP helper

- 通过 `http://127.0.0.1:8000/mcp` 向 MCP 客户端提供服务
- 在 `http://127.0.0.1:8000/zero-mcp` 暴露 helper 对外 bridge 代理
- 承载只读 MCP 工具，以及兼容 ChatGPT connectors 的 `search` / `fetch`

### Zotero 桌面插件

- 运行在 Zotero 7 和 Zotero 8 内部
- Windows 与 macOS 共用同一套插件源码
- 负责桌面场景下的 helper 生命周期管理
- 在 Zotero 内部暴露仅限 localhost 的 mutation endpoint

### 本地读取层

- 从本地 Zotero 数据库和活动 Zotero profile 读取数据
- 提供 metadata、notes、collections、tags、recent items 与全文读取能力
- `0.3.0` 不再依赖向量数据库和 embedding 模型

## 读取路径

1. MCP 客户端调用 helper
2. helper 从本地 Zotero 数据库或 profile 派生状态读取数据
3. helper 返回统一的 MCP 结果

现在 ChatGPT connectors 的 `search` 已改为本地关键词检索包装器，`fetch` 仍按 item key 或 Zotero URL 返回 metadata 和文本。

## 写操作路径

1. MCP 客户端调用 helper
2. helper 将 mutation 请求转发到本地 bridge 代理
3. Zotero 插件在 Zotero 内部真正执行写操作

这样可以保证正式支持的写路径完全基于本地环境，不依赖 Zotero Web API。

## helper 分发模型

- 内部构建形态：`onedir`
- 对外发布形态：
  - macOS：`.tar.gz`
  - Windows：`.zip`
- 终端用户必须保留完整的解压目录，因为可执行文件依赖同级 `_internal/`
