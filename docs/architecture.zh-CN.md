# 架构说明

本文档面向需要理解系统结构和数据流的技术读者。用户安装流程请看顶层 [README.zh-CN.md](../README.zh-CN.md)。

## 组成部分

### MCP helper

- 通过 `http://127.0.0.1:8000/mcp` 向 MCP 客户端提供服务
- 通过 `http://127.0.0.1:8000/zero-mcp` 暴露 helper 对外 bridge 代理
- 承载读取类工具，以及兼容 connector 的 `search` / `fetch`

### Zotero 桌面插件

- 运行在 Zotero 7 和 Zotero 8 内部
- 负责桌面场景下的 helper 生命周期管理
- 在 Zotero 内部暴露仅限 localhost 的写操作 endpoint

### 本地读取层

- 从本地 Zotero 数据库和活动 Zotero profile 读取数据
- 提供 metadata、notes、collections、tags、recent items、feeds 和全文读取能力
- `0.3.0` 不依赖向量数据库和 embedding 模型

## 读取路径

1. MCP 客户端调用 helper
2. helper 从本地 Zotero 数据库或 profile 派生状态读取数据
3. helper 返回统一的 MCP 结果

## 写入路径

1. MCP 客户端调用 helper
2. helper 将写请求转发到本地 bridge 代理
3. Zotero 插件在 Zotero 内部真正执行写操作

这样可以把正式支持的写路径限制在本地桌面环境内，而不依赖 Zotero Web API。

## Helper 分发模型

- 内部构建形态：`onedir`
- 对外发布形态：
  - macOS：`.tar.gz`
  - Windows：`.zip`
- 终端用户必须保留完整的解压目录，因为可执行文件依赖同级 `_internal/`

## 相关文档

- [README.zh-CN.md](../README.zh-CN.md)
- [开发与源码安装](development.zh-CN.md)
