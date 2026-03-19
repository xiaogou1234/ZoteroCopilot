# ZoteroCopilot 0.3.0 发行说明

发布日期：2026-03-19

## 概览

`0.3.0` 是一次面向公开分发和本地桌面工作流的整理版本。这个版本明确收敛到“本地 helper + Zotero 桌面 bridge”的产品路径，并补齐了插件打包、helper 打包、安装文档、接口说明和测试覆盖。

## 亮点

- 明确采用本地优先架构
- 增加 Zotero 7 / Zotero 8 双 XPI 构建支持
- 增加 macOS / Windows helper 打包与发布说明
- 补齐 ChatGPT connector 兼容的 `search` / `fetch`
- 完整覆盖本地读写、文库切换、feed 读取等 MCP 能力

## 主要变更

### 新增

- Zotero 7 / Zotero 8 插件构建脚本
- helper 打包清单与发布脚本
- macOS helper 打包脚本和文档
- connector 兼容的 `search` / `fetch`
- library / feed / active profile 发现相关能力
- plugin packaging、helper packaging、search wrapper 等测试

### 调整

- 统一仓库版本、Python/helper 版本和插件版本到 `0.3.0`
- 桌面插件结构拆分为 `plugin-main.js`、兼容层和双 manifest
- 本地关键词检索增加全文回退路径
- 文档结构调整为首页、安装后配置、接口参考、架构说明和开发文档分层

### 移除

- 语义搜索相关公开能力
- Chroma / 向量数据库相关代码路径
- 相关可选功能装配和旧测试

## 破坏性变更

- `search` 不再是语义检索入口，而是本地关键词检索兼容接口
- 语义搜索、向量数据库和相关依赖不再属于 `0.3.0` 的公开支持范围

## 升级建议

1. 安装与当前 Zotero 主版本匹配的新 XPI。
2. 下载并完整解压对应平台的 helper 归档。
3. 在 Zotero Copilot 偏好设置中重新确认 helper 路径、缓冲目录、端口和令牌。
4. 如果你改过 MCP 客户端配置，请重新复制一次最新配置。

## 验证情况

```bash
python3 -m pytest -q
```

结果：`51 passed`

## 相关文档

- [README.zh-CN.md](../README.zh-CN.md)
- [安装后配置与排错](getting-started.zh-CN.md)
- [开发与源码安装](development.zh-CN.md)
