# 安装后配置与排错

本文档默认你已经通过发布页安装好 ZoteroCopilot。如果你还需要从源码构建，请看 [development.zh-CN.md](development.zh-CN.md)。

## 首次配置

打开 Zotero Copilot 偏好设置，重点确认这几项：

- **helper 可执行文件路径**
  请选择解压后目录里的可执行文件，而不是最外层目录。
- **文件缓冲目录**
  导入 PDF 时会先把文件暂存到这里。
- **是否允许写入 Zotero**
  只有当 MCP 客户端需要创建、移动、导入或删除条目时才需要开启。
- **端口和令牌**
  没有特殊需求时保持默认即可。

插件会自动管理 helper 生命周期：

- 启动 Zotero：自动启动或恢复 helper
- 修改端口或令牌：自动重启 helper
- 关闭 Zotero：自动停止插件管理的 helper

## 连接 MCP 客户端

默认 MCP 地址：

```text
http://127.0.0.1:8000/mcp
```

helper 对外的 bridge 代理地址：

```text
http://127.0.0.1:8000/zero-mcp
```

优先使用插件界面生成的配置片段。如果之后改了端口或令牌，需要重新复制一次最新配置。

## 常见问题

### helper 无法启动

先检查：

- 选中的路径是不是可执行文件本身
- helper 解压目录是否仍然完整
- `_internal/` 是否还和可执行文件在同级目录

### 测试连接失败

先检查：

- Zotero 是否仍在运行
- helper 路径是否正确
- 当前端口是否被其他程序占用
- MCP 客户端是否使用了最新复制的配置

### PDF 导入一开始就失败

先检查：

- 文件缓冲目录是否存在且可写
- 导入的文件是否是真实 PDF
- 如果客户端在执行导入写操作，写入开关是否已开启

### macOS 阻止 helper 启动

执行：

```bash
xattr -dr com.apple.quarantine /path/to/extracted/zotero_copilot_0.3.0_helper_macos_arm64
```

然后回到 Zotero 偏好设置里重新选择 helper，并再次测试连接。

## 相关文档

- [README.zh-CN.md](../README.zh-CN.md)
- [MCP 接口总览](mcp-tools.zh-CN.md)
- [架构说明](architecture.zh-CN.md)
- [开发与源码安装](development.zh-CN.md)
