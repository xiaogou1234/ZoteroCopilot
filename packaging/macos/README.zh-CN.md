# macOS Helper 打包说明

这个目录包含 Zotero Copilot 的 macOS helper 打包入口。

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

支持的目标架构为 `arm64`、`x86_64`、`universal2`。默认使用当前主机架构。

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

## 公开分发说明

终端用户必须先完整解压 tarball，并保持整个 helper 目录完整。若 macOS 在解压后阻止执行：

```bash
xattr -dr com.apple.quarantine /path/to/extracted/zotero_copilot_0.3.0_helper_macos_arm64
```
