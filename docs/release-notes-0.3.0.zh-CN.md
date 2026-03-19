# ZoteroCopilot 0.3.0 发行说明

发布日期：2026-03-19

## 概览

`0.3.0` 是一次面向公开分发和桌面本地工作流的整理版本。这个版本把产品路径明确收敛到“本地 helper + Zotero 桌面 bridge”的架构，并补齐了插件打包、helper 打包、安装文档、接口说明和测试覆盖。

如果你是首次接入，建议直接按用户态安装流程使用发布页产物；如果你已经在使用旧版本，本次升级最重要的变化是语义搜索和向量数据库相关能力已从公开产品路径中移除，`search` 现在固定走本地关键词检索。

## 亮点

- 明确采用本地优先架构：
  helper 对外提供 MCP 服务，Zotero 插件负责本地写操作 bridge 和 helper 生命周期管理。
- 完整的公开交付链路：
  增加了 Zotero 7 / Zotero 8 双 XPI 构建脚本，以及 macOS / Windows helper 打包说明。
- 更清晰的用户安装路径：
  README 和 getting-started 文档现在区分“用户态安装”和“从源码安装”。
- MCP 工具发现成本更低：
  README 中新增全部 MCP 接口的分组表格说明，方便直接查看每个接口的用途。
- 桌面本地能力更完整：
  支持文库列表、文库切换、RSS feed 列表与条目读取、collection 路径解析，以及桌面 bridge 能力探测。

## 主要变更

### 新增

- Zotero 7 / Zotero 8 插件构建脚本
- helper 公开打包清单与发布脚本
- macOS helper 打包脚本和文档
- ChatGPT connector 兼容的 `search` / `fetch` 包装器
- library / feed / active profile 发现相关能力
- plugin packaging、helper packaging、search wrapper 等测试

### 调整

- 统一仓库版本、Python/helper 版本和插件版本到 `0.3.0`
- 桌面插件结构拆分为更清晰的 `plugin-main.js`、兼容层和双 manifest
- 重写中英文 README、安装文档和架构文档
- 本地关键词检索逻辑增加全文回退路径
- helper 公开分发说明改为“先完整解压，再在 Zotero 中选择可执行文件”

### 移除

- 语义搜索相关公开能力
- Chroma / 向量数据库相关代码路径
- 相关可选功能装配和旧测试

## 兼容性与破坏性变化

- `search` 不再是语义检索入口，而是本地关键词检索兼容接口。
- 语义搜索、向量数据库和相关依赖不再属于 `0.3.0` 的公开支持范围。
- helper 的终端用户安装方式默认变为“解压完整归档目录后再选择其中的可执行文件”，不再建议直接搬运单个可执行文件。

## 适合谁升级

- 需要稳定本地读写 Zotero 的 MCP 客户端用户
- 需要通过桌面 bridge 做 collection、note、PDF 导入和批量整理的用户
- 需要更清晰安装文档和更明确产品边界的公开分发场景

如果你高度依赖语义搜索、相似文献发现或本地向量索引，请注意这部分不再是当前公开版本主路径。

## 验证情况

本次整理后，仓库测试已通过：

```bash
python3 -m pytest -q
```

结果：`51 passed`

## 下载与安装

- 发布页：<https://github.com/xiaogou1234/ZoteroCopilot/releases>
- 用户态安装说明：[getting-started.zh-CN.md](getting-started.zh-CN.md)

## 升级建议

1. 安装与当前 Zotero 主版本匹配的新版 XPI。
2. 下载并完整解压对应平台的 helper 归档。
3. 在 Zotero Copilot 偏好设置中重新确认 helper 路径、缓冲目录、端口和令牌。
4. 如果你修改过客户端 MCP 配置，请重新复制最新配置片段。
5. 如果你之前依赖语义搜索能力，请在升级前确认工作流是否需要调整到关键词检索路径。
