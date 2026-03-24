# ZoteroCopilot

ZoteroCopilot 将 AI 助手与你的本地 Zotero 文献库无缝衔接，实现解放双手的文献自动化管理。

## 主要能力

- 🔎 按关键词、标签、集合、note 和最近条目检索本地 Zotero 文库
- 📚 读取条目 metadata、notes、child items、tags 和可用全文
- ✍️ 通过 Zotero 桌面 bridge 执行本地写操作
- 🗂️ 实现文献资料的自动组织与智能化归类。

## 用户安装

1. 打开 [GitHub Releases 页面](https://github.com/xiaogou1234/ZoteroCopilot/releases)。
2. 下载与你当前 Zotero7 的插件包：
   - `zotero_copilot_0.3.0_zotero7_plugin.xpi`
3. 下载与你平台匹配的 helper 归档：
   - macOS 11+（Apple Silicon，`arm64`）：`zotero_copilot_0.3.0_helper_macos_arm64.tar.gz`
   - Windows 10+（`x64`）：`zotero_copilot_0.3.0_helper_windows_x64.zip`
4. 在 Zotero 的插件管理界面选择“Install Add-on From File...”，安装对应的 XPI。
5. 完整解压 helper 归档，不要只拿出单个可执行文件。
6. 在 Zotero Copilot 偏好设置中选择解压目录里的 helper 可执行文件。
7. 配置文件缓冲目录，并决定是否允许写入 Zotero。
8. 点击插件里的“测试连接”。
9. 复制生成的 Codex 或 Claude Code MCP 配置。

如果 macOS 在解压后阻止 helper 启动：

```bash
xattr -dr com.apple.quarantine /path/to/extracted/zotero_copilot_0.3.0_helper_macos_arm64
```

安装后的首次配置、常见问题和客户端连接说明见 [docs/getting-started.zh-CN.md](docs/getting-started.zh-CN.md)。

## 文档导航

- 🧭 [安装后配置与排错](docs/getting-started.zh-CN.md)
- 🧰 [MCP 接口总览](docs/mcp-tools.zh-CN.md)
- 🏗️ [架构说明](docs/architecture.zh-CN.md)
- 🛠️ [开发与源码安装](docs/development.zh-CN.md)

如果你要从源码安装、维护插件或构建 helper，请从 [docs/development.zh-CN.md](docs/development.zh-CN.md) 进入。

## 致谢

ZoteroCopilot 基于开源项目 [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) 继续开发，并扩展为当前的本地优先桌面 bridge 方案。
