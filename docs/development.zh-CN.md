# 开发与源码安装

本文档面向维护者和贡献者。如果你只是从发布页安装 ZoteroCopilot，请先看顶层 [README.zh-CN.md](../README.zh-CN.md)。

## 克隆仓库并准备本地环境

```bash
git clone https://github.com/xiaogou1234/ZoteroCopilot.git
cd ZoteroCopilot
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

如果你只是想在本地仓库之外安装已发布的 Python 包：

```bash
pip install zoterocopilot-server
```

或者：

```bash
uv tool install zoterocopilot-server
```

当前发布到 PyPI 的 distribution name 改为 `zoterocopilot-server`。第一次用这个新名字发布前，需要先在 PyPI 上创建一个 pending Trusted Publisher，并让它匹配 `xiaogou1234/ZoteroCopilot`、`.github/workflows/release.yml` 和 `pypi` 环境。

## 构建 Zotero 插件

```bash
python3 packaging/plugin/build_xpi.py
```

会生成：

- `dist/plugins/zotero_copilot_0.3.0_zotero7_plugin.xpi`
- `dist/plugins/zotero_copilot_0.3.0_zotero8_plugin.xpi`

## 构建 Helper

- macOS：见 [../packaging/macos/README.zh-CN.md](../packaging/macos/README.zh-CN.md)
- Windows：见 [../packaging/windows/README.zh-CN.md](../packaging/windows/README.zh-CN.md)

## 使用源码构建产物

构建完成后：

1. 在 `dist/plugins/` 中安装与你 Zotero 主版本匹配的 XPI。
2. 按你的平台构建 helper，并保持整个输出目录完整。
3. 在 Zotero Copilot 偏好设置里，把 helper 路径指向该目录中的可执行文件。
4. 配置一个可写的文件缓冲目录，决定是否允许写入，再执行测试连接。
5. 如果你改过端口或令牌，需要重新复制一次最新的 MCP 客户端配置。

## 建议验证

```bash
python3 -m pytest -q
python3 -m compileall src/zotero_mcp
python3 packaging/plugin/build_xpi.py
```

## 维护者文档

- [架构说明](architecture.zh-CN.md)
- [插件维护说明](../zero-mcp-plugin/README.zh-CN.md)
- [macOS helper 打包说明](../packaging/macos/README.zh-CN.md)
- [Windows helper 打包说明](../packaging/windows/README.zh-CN.md)
- [0.3.0 发行说明](release-notes-0.3.0.zh-CN.md)
