# 快速开始

本文档说明 ZoteroCopilot 当前支持的纯本地部署方式。

## 1. 安装 Python 包

```bash
pip install zotero-mcp-server
```

如需语义搜索依赖：

```bash
pip install "zotero-mcp-server[semantic]"
```

## 2. 如需本地可执行 helper，则本地构建

Windows 下可参考 [../packaging/windows/README.zh-CN.md](/F:/codex/zotero-mcp/packaging/windows/README.zh-CN.md)。

## 3. 构建并安装 Zotero 插件

插件源码位于 `zero-mcp-plugin/`。请本地打包 `.xpi` 后，通过 Zotero 的扩展管理器手动安装。

注意：当前插件版本为 `0.1.1`。如果 Zotero 中已经安装过更高的内部测试版，请先手动覆盖安装，或先卸载旧版再装。

## 4. 配置插件

打开 Zotero 中的插件设置页，至少配置：

- MCP 驱动器路径
- 文件缓冲目录
- 是否允许 MCP 写入 Zotero
- Codex / Claude Code 的配置复制按钮

你也可以直接在设置页里启动、关闭和测试本地 MCP 服务。

## 5. 连接 MCP 客户端

helper 对外的 MCP 地址：

```text
http://127.0.0.1:8000/mcp
```

helper 对外的桌面 bridge 地址：

```text
http://127.0.0.1:8000/zero-mcp
```

优先使用插件设置页中生成的 Codex 或 Claude Code 配置。

## 6. 初始化语义搜索

```bash
zotero-mcp update-db
```

如需更完整索引：

```bash
zotero-mcp update-db --fulltext
```

查看状态：

```bash
zotero-mcp db-status
```

现在语义搜索会在每次执行前自动检查本地索引状态，并在必要时自动刷新或重建。

## 7. 典型使用流程

1. 启动 Zotero
2. 确认插件已安装
3. 在插件设置页启动或测试 MCP 服务
4. 连接 MCP 客户端
5. 开始查询本地文库或执行本地写操作
