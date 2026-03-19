# MCP 接口总览

ZoteroCopilot 当前暴露了 34 个 MCP 工具。这个文档只做“该用哪个工具”的快速参考，不展开参数细节。

## 读取与检索

| 接口 | 用途 | 常见场景 |
| --- | --- | --- |
| `zotero_search_items` | 按关键词检索本地 Zotero 条目 | 按标题、作者、摘要等信息找论文、书籍或报告 |
| `zotero_search_by_tag` | 按标签检索，支持 AND、OR 和排除条件 | 适合已经有标签体系的整理流程 |
| `zotero_get_item_metadata` | 按 item key 读取完整元数据 | 已知条目 key，需要看详细信息 |
| `zotero_get_item_fulltext` | 读取附件全文，必要时回退到 metadata | 需要读取条目的正文内容 |
| `zotero_get_collections` | 列出 collection 树 | 先了解文库结构，再做移动或导入 |
| `zotero_get_collection_items` | 列出指定 collection 下的条目 | 浏览一个已知 collection |
| `zotero_get_item_children` | 查看附件和子 note | 检查某个父条目下面有哪些内容 |
| `zotero_get_tags` | 列出当前文库中的 tags | 先了解已有标签体系 |
| `zotero_get_recent` | 列出最近新增条目 | 检查最近导入或最近整理的内容 |
| `zotero_advanced_search` | 多条件本地检索 | 需要结构化检索，而不只是简单关键词 |
| `zotero_get_notes` | 读取 note，可按父条目过滤 | 查看阅读笔记或项目笔记 |
| `zotero_search_notes` | 按 note 内容检索 | 在笔记正文里找信息 |

## 文库、Feed 与上下文

| 接口 | 用途 | 常见场景 |
| --- | --- | --- |
| `zotero_get_desktop_plugin_capabilities` | 检查本地 bridge 是否可用，以及当前是否支持写操作 | 先确认桌面写路径是否正常 |
| `zotero_resolve_collection_path` | 把可读 collection 路径转成稳定 key | 例如把 `Research/Agents` 转成自动化可用的 key |
| `zotero_list_libraries` | 列出 user、group 和 feed 文库 | 在切换文库前先看可用范围 |
| `zotero_switch_library` | 切换当前活动文库上下文 | 后续所有工具改为作用于另一个文库 |
| `zotero_list_feeds` | 列出 RSS 订阅 | 查看本地 Zotero 中的 feed 文库 |
| `zotero_get_feed_items` | 读取某个 feed 文库里的条目 | 浏览一个已知 RSS feed 的内容 |

## 写入与导入

| 接口 | 用途 | 常见场景 |
| --- | --- | --- |
| `zotero_create_collection` | 按名称或路径创建 collection | 为新项目建立目录结构 |
| `zotero_delete_collection` | 只删除 collection 容器 | 清理无用 collection，但保留条目本身 |
| `zotero_batch_create_collections` | 批量创建多个 collection | 一次性准备项目层级 |
| `zotero_batch_delete_collections` | 批量删除多个 collection | 集中清理废弃 collection |
| `zotero_import_pdf_to_collection` | 导入单个本地 PDF | 已经有 PDF 文件，需要加到 Zotero |
| `zotero_import_identifier_to_collection` | 通过 DOI、ISBN、PMID、arXiv 等标识符导入 | 没有 PDF，但有可解析的标识符 |
| `zotero_import_bibtex_to_collection` | 通过 BibTeX / BibLaTeX 文本导入 | 从其他引用流程导入 metadata |
| `zotero_create_collection_note` | 在 collection 下创建独立 note | 写项目 note，而不是挂在某个条目下 |
| `zotero_create_child_note` | 在父条目下创建 child note | 给某篇文献补阅读笔记 |
| `zotero_batch_import_pdfs_to_collection` | 批量导入文件列表或目录中的 PDF | 一次性导入一个文件夹的论文 |
| `zotero_move_items_between_collections` | 在 collection 之间移动条目 | 重组项目目录 |
| `zotero_remove_item_from_collection` | 只从一个 collection 中移除条目 | 保留条目，但移除一处归档关系 |
| `zotero_delete_item` | 把条目移入 Zotero 回收站 | 通过 bridge 安全删除条目 |
| `zotero_batch_update_tags` | 批量添加或移除 tags | 对一批检索结果统一改标签 |

## Connector 兼容接口

| 接口 | 用途 | 常见场景 |
| --- | --- | --- |
| `search` | 兼容 ChatGPT connector 的关键词检索包装器 | 让 connector 客户端通过最小接口发现 Zotero 条目 |
| `fetch` | 兼容 ChatGPT connector 的单条目抓取包装器 | 在 connector 模式下返回一个条目的 metadata 和文本 |

## 相关文档

- [README.zh-CN.md](../README.zh-CN.md)
- [安装后配置与排错](getting-started.zh-CN.md)
- [架构说明](architecture.zh-CN.md)
