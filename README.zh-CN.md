# ZoteroCopilot

ZoteroCopilot 是一个面向本地 Zotero 文库的 MCP 适配层与 Zotero 桌面 bridge 方案，供 MCP 客户端通过本地 helper 访问你的 Zotero 数据。

## 当前状态

- 仓库版本：`0.3.0`
- Python 包 / helper 版本：`0.3.0`
- Zotero 插件版本：`0.3.0`
- Zotero 插件产物：
  - `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
  - `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`
- 公开 helper 产物：
  - `dist/releases/zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`
  - `dist/releases/zotero_copilot_0.3.0_helper_windows_x64.zip`

## 主要能力

- 按关键词、标签、集合、notes、最近条目检索本地 Zotero 库
- 读取条目 metadata、child items、notes、tags 和可用全文
- 保留兼容 ChatGPT connectors 的 `search` 与 `fetch`
- 通过 Zotero 桌面插件 bridge 执行本地写操作：
  - collection 创建与删除
  - note 创建
  - PDF / identifier / BibTeX 导入
  - 批量 PDF 导入
  - collection 间移动
  - 安全删除条目
  - 批量 tag 更新

`0.3.0` 已彻底移除语义搜索和向量数据库能力。`search` 现在固定是本地关键词检索兼容入口。

## 下载入口

预编译插件包和 helper 归档建议通过 GitHub Releases 发布页统一分发：

- [打开下载页](https://github.com/xiaogou1234/ZoteroCopilot/releases)
- [终端用户安装说明](docs/getting-started.zh-CN.md)

如果当前版本还没有发布成 Release，请走下面的源码安装流程。

## 安装方式

### 用户态安装

1. 打开 [GitHub Releases 页面](https://github.com/xiaogou1234/ZoteroCopilot/releases)。
2. 下载与你当前 Zotero 主版本匹配的插件包：
   - `zotero_copilot_0.3.0_zotero7_plugin.xpi`
   - `zotero_copilot_0.3.0_zotero8_plugin.xpi`
3. 下载与你平台匹配的 helper 归档：
   - macOS：`zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`
   - Windows：`zotero_copilot_0.3.0_helper_windows_x64.zip`
4. 在 Zotero 中安装对应的 XPI。
5. 完整解压 helper 归档，不要只拿出单个可执行文件。
6. 在 Zotero Copilot 偏好设置中选择解压目录里的 helper 可执行文件。
7. 配置文件缓冲目录，并决定是否允许写入 Zotero。
8. 在偏好设置中点击“测试连接”。
9. 复制生成的 Codex 或 Claude Code MCP 配置。

更详细的终端用户步骤见 [docs/getting-started.zh-CN.md](docs/getting-started.zh-CN.md)。

### 从源码安装

1. 安装 Python 包：

```bash
pip install zotero-mcp-server
```

或者：

```bash
uv tool install zotero-mcp-server
```

2. 构建 Zotero 插件：

```bash
python3 packaging/plugin/build_xpi.py
```

3. 按你的平台构建 helper：

- macOS：见 [packaging/macos/README.zh-CN.md](packaging/macos/README.zh-CN.md)
- Windows：见 [packaging/windows/README.zh-CN.md](packaging/windows/README.zh-CN.md)

4. 安装与你当前 Zotero 主版本匹配的 XPI。
5. 解压 helper 归档，并保持整个解压目录完整。
6. 在 Zotero Copilot 偏好设置中选择解压目录里的 helper 可执行文件。
7. 复制生成的 Codex 或 Claude Code MCP 配置。

## MCP 接口总览

当前 MCP server 暴露了 34 个工具，下面按用途分组说明。

### 读取与检索接口

| 接口 | 简述 |
| --- | --- |
| `zotero_search_items` | 按关键词检索本地 Zotero 条目，支持查询模式、tag 过滤和 item type 过滤。 |
| `zotero_search_by_tag` | 以标签为主的检索，支持 AND、OR 和排除条件。 |
| `zotero_get_item_metadata` | 按 item key 读取条目元数据详情。 |
| `zotero_get_item_fulltext` | 读取条目附件全文，必要时回退到 metadata 摘要。 |
| `zotero_get_collections` | 列出当前文库中的 collection 层级结构。 |
| `zotero_get_collection_items` | 列出指定 collection 下的条目。 |
| `zotero_get_item_children` | 列出父条目的附件和子 note。 |
| `zotero_get_tags` | 列出当前文库使用到的 tags。 |
| `zotero_get_recent` | 列出最近新增的条目。 |
| `zotero_advanced_search` | 执行多条件高级检索，并支持排序。 |
| `zotero_get_notes` | 读取 note，可按父条目过滤。 |
| `zotero_search_notes` | 在当前文库里检索 note 内容。 |

### 文库上下文与桥接接口

| 接口 | 简述 |
| --- | --- |
| `zotero_get_desktop_plugin_capabilities` | 检查本地桌面 bridge 是否可用，以及支持哪些写操作能力。 |
| `zotero_resolve_collection_path` | 把可读的 collection 路径解析成稳定的 collection key。 |
| `zotero_list_libraries` | 列出可访问的 user library、group library 和 feed library。 |
| `zotero_switch_library` | 切换后续工具调用所使用的活动文库上下文。 |
| `zotero_list_feeds` | 列出本地 Zotero 里的 RSS 订阅。 |
| `zotero_get_feed_items` | 读取指定 RSS feed library 下的条目。 |

### 写入与导入接口

| 接口 | 简述 |
| --- | --- |
| `zotero_create_collection` | 通过桌面 bridge 按名称或完整路径创建 collection。 |
| `zotero_delete_collection` | 删除 collection 容器，但不删除底层 library item。 |
| `zotero_batch_create_collections` | 一次请求批量创建多个 collection。 |
| `zotero_batch_delete_collections` | 一次请求批量删除多个 collection。 |
| `zotero_import_pdf_to_collection` | 把单个本地 PDF 导入到目标 collection。 |
| `zotero_import_identifier_to_collection` | 通过 DOI、ISBN、PMID、arXiv 等标识符导入 metadata。 |
| `zotero_import_bibtex_to_collection` | 通过 BibTeX 或 BibLaTeX 文本导入 metadata。 |
| `zotero_create_collection_note` | 在 collection 下创建独立 note。 |
| `zotero_create_child_note` | 在现有条目下创建 child note。 |
| `zotero_batch_import_pdfs_to_collection` | 从文件列表或目录批量导入 PDF。 |
| `zotero_move_items_between_collections` | 在两个 collection 之间移动一个或多个条目。 |
| `zotero_remove_item_from_collection` | 仅把条目从一个 collection 中移除，不删除条目本身。 |
| `zotero_delete_item` | 通过 bridge 把条目安全移入 Zotero 回收站。 |
| `zotero_batch_update_tags` | 按查询结果批量添加或移除 tags。 |

### Connector 兼容接口

| 接口 | 简述 |
| --- | --- |
| `search` | 兼容 ChatGPT connector 的关键词检索包装器，返回 JSON 结果。 |
| `fetch` | 兼容 ChatGPT connector 的抓取包装器，返回单条目的 metadata 和文本。 |

## 架构

ZoteroCopilot 采用三段式本地架构：

1. helper 对外提供 `http://127.0.0.1:8000/mcp`
2. Zotero 插件暴露仅限 localhost 的 bridge endpoint，再由 helper 代理到 `http://127.0.0.1:8000/zero-mcp`
3. 读取链路来自本地 Zotero 数据库和当前活动的 Zotero 桌面 profile

简要架构说明见 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)。

## 公开分发说明

- helper 内部仍然使用 `onedir` 构建。
- 对外发布物改为归档包，而不是裸 `dist/` 目录。
- 用户必须先完整解压整个 helper 目录，再在 Zotero 中选择其中的可执行文件。
- macOS 若在解压后被系统阻止启动，可对解压目录执行：

```bash
xattr -dr com.apple.quarantine /path/to/extracted/zotero_copilot_0.3.0_helper_macos_arm64
```

## 开发

仓库结构：

- `src/zotero_mcp/`：Python MCP server、helper、desktop bridge client
- `zero-mcp-plugin/`：Zotero 桌面插件源码
- `docs/`：安装与架构文档
- `packaging/`：helper 和插件打包脚本
- `tests/`：Python 测试套件

建议发布前执行：

```bash
python3 -m pytest
python3 -m compileall src/zotero_mcp
python3 packaging/plugin/build_xpi.py
```

## 文档

- [README.md](README.md)
- [docs/getting-started.md](docs/getting-started.md)
- [docs/getting-started.zh-CN.md](docs/getting-started.zh-CN.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)
- [zero-mcp-plugin/README.md](zero-mcp-plugin/README.md)
- [zero-mcp-plugin/README.zh-CN.md](zero-mcp-plugin/README.zh-CN.md)
