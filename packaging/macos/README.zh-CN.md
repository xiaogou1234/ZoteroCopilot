# macOS Helper 打包说明

本文档面向构建 macOS helper 的维护者。终端用户安装说明请看顶层 [README.zh-CN.md](../../README.zh-CN.md)。

## 目标

生成：

- 内部 `onedir` 输出：`dist/zotero_copilot_0.3.0_helper_macos_arm64/`
- 对外发布归档：`dist/releases/zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`

## 建议环境

```bash
cd /path/to/ZoteroCopilot
python3 -m venv .venv-helper-build
source .venv-helper-build/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[build]"
```

## 构建命令

```bash
cd /path/to/ZoteroCopilot
bash packaging/macos/build-helper.sh --clean --target-arch arm64
```

支持的目标架构为 `arm64`、`x86_64` 和 `universal2`。默认使用当前主机架构。

## 输出结构

`onedir` 目录中包含：

- `zotero_copilot_0.3.0_helper_macos_arm64`
- `_internal/`

公开 tarball 还会额外包含：

- `README.txt`
- `SHA256SUMS.txt`

## 验证

```bash
./dist/zotero_copilot_0.3.0_helper_macos_arm64/zotero_copilot_0.3.0_helper_macos_arm64 version
./dist/zotero_copilot_0.3.0_helper_macos_arm64/zotero_copilot_0.3.0_helper_macos_arm64 serve --transport streamable-http --host 127.0.0.1 --port 8000
```

## 平台注意事项

- 对外发布请使用归档包，不要单独分发可执行文件。
- 顶层 helper 目录名需要保持稳定，这样发布物名称才能和文档一致。
- 无论是 `onedir` 目录还是公开归档，`_internal/` 都必须和可执行文件保持同级。

## 相关文档

- [开发与源码安装](../../docs/development.zh-CN.md)
- [插件维护说明](../../zero-mcp-plugin/README.zh-CN.md)
