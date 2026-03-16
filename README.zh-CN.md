# ZoteroCopilot

ZoteroCopilot 是一个面向本地 Zotero 库的 MCP 适配层与 Zotero 桌面插件桥接方案，方便 AI 客户端直接使用你的 Zotero 数据。

它对外提供统一的 MCP helper 入口，从本地 Zotero 数据库读取内容，并通过仅限 localhost 的 Zotero 桌面 bridge 执行写操作。

## 当前状态

- 仓库版本：`0.1.1`
- Python 包 / helper 版本：`0.1.1`
- Zotero 插件版本：`0.1.1`
- 当前支持路径：纯本地模式

## 主要能力

- 按关键词、标签、集合、最近条目搜索本地 Zotero 库
- 读取 metadata、notes、child items 和可用的全文内容
- 基于本地向量索引执行语义搜索
- 创建和删除 collection
- 创建 collection note 和 child note
- 将 PDF、identifier、BibTeX 元数据导入 Zotero
- 在 Zotero collections 之间移动条目，而不改变 metadata 或附件存储位置
- 将条目从 collection 移除，或在带安全检查的前提下移入 Zotero Trash

## 架构

ZoteroCopilot 采用三段式本地架构：

1. MCP helper 对外服务于 `http://127.0.0.1:8000/mcp`
2. Zotero 桌面插件在 `http://127.0.0.1:8000/zero-mcp` 暴露仅本机可访问的写操作 bridge
3. 读取路径来自本地 Zotero 数据库与桌面运行环境

简要架构说明见 [docs/architecture.zh-CN.md](/F:/codex/zotero-mcp/docs/architecture.zh-CN.md)。

## 安装

### Python 包

```bash
pip install zotero-mcp-server
```

或者使用 `uv`：

```bash
uv tool install zotero-mcp-server
```

### 可选的语义搜索依赖

```bash
pip install "zotero-mcp-server[semantic]"
```

### Zotero 桌面插件

请从 `zero-mcp-plugin/` 源码目录打包生成 `.xpi`，再在 Zotero 中安装该插件。

当前插件版本是 `0.1.1`。如果你之前安装过更高的内部测试版本，例如 `2.x`，请先手动覆盖安装，或先卸载旧版再安装，以免 Zotero 将 `0.1.1` 识别为降级版本。

## 快速开始

1. 安装 Python 包。
2. 如果你需要 Windows 下的独立 helper 工作流，先构建 helper 可执行文件。
3. 构建并安装 Zotero 插件。
4. 在 Zotero 插件设置页中选择本地 MCP 驱动器路径。
5. 从插件界面复制 Codex 或 Claude Code 所需的 MCP 配置。
6. 在插件界面中启动或测试本地 MCP 服务。

详细安装步骤见 [docs/getting-started.zh-CN.md](/F:/codex/zotero-mcp/docs/getting-started.zh-CN.md)。

## 语义搜索

语义搜索使用本地 Chroma 数据库。helper 在每次执行语义搜索前会先检查索引状态，并在必要时自动刷新或重建索引。

常用 helper 命令：

```bash
zotero-mcp update-db
zotero-mcp update-db --fulltext
zotero-mcp db-status
```

## 开发

### 仓库结构

- `src/zotero_mcp/`：Python MCP server、helper、semantic search 和 bridge client
- `zero-mcp-plugin/`：Zotero 桌面插件源码
- `docs/`：用户文档与架构文档
- `packaging/`：helper 打包脚本和构建资源
- `tests/`：Python 测试套件

### 验证

发布前建议执行：

```bash
python -m pytest
python -m compileall src/zotero_mcp
```

Windows helper 打包说明见 [packaging/windows/README.zh-CN.md](/F:/codex/zotero-mcp/packaging/windows/README.zh-CN.md)。

## 文档

- [README.md](/F:/codex/zotero-mcp/README.md)
- [docs/getting-started.md](/F:/codex/zotero-mcp/docs/getting-started.md)
- [docs/getting-started.zh-CN.md](/F:/codex/zotero-mcp/docs/getting-started.zh-CN.md)
- [docs/architecture.md](/F:/codex/zotero-mcp/docs/architecture.md)
- [docs/architecture.zh-CN.md](/F:/codex/zotero-mcp/docs/architecture.zh-CN.md)
- [zero-mcp-plugin/README.md](/F:/codex/zotero-mcp/zero-mcp-plugin/README.md)
- [zero-mcp-plugin/README.zh-CN.md](/F:/codex/zotero-mcp/zero-mcp-plugin/README.zh-CN.md)

## 致谢

ZoteroCopilot 感谢开源项目 [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) 提供的工作与启发，本项目在此基础上继续整理和演进。
