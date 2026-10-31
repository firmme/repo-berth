# Repo Berth

基于 **Wails 3.0.0 + Go + React / TypeScript** 的多账号 Git 仓库桌面工具，目前支持 GitHub。每个本地副本可以独立绑定访问账号与提交身份，仓库 owner 不会用于推断当前登录账号。

当前版本 **0.2.13**：第三方许可压缩内嵌到应用，`关于 → 第三方许可` 可查看；每个平台改为只发布一个更新包。

## 功能

- 多账号 GitHub 授权、重新授权、会话级凭据、提交姓名与邮箱配置。
- 云端仓库同步、访问关系合并、搜索、收藏、分组和最近访问。
- 本地仓库导入、目录扫描、多个本地副本、worktree 与普通目录管理。
- 变更/全部文件树、暂存、提交、分支切换、Fetch / Pull / Push、提交历史。
- 文件编码与换行符状态栏、文本/图片/音频/视频/二进制预览。
- 文件树复制、剪切、删除、重命名、新建文件或目录、终端与 VS Code 打开。
- 统一 Diff、双栏 Diff、语法高亮、自动换行和带行号编辑器。
- 第三方许可文本压缩内嵌，可在应用“关于 → 第三方许可”查看。
- 应用内自更新。更新器只使用 GitHub Release 中的 `*-update.zip` 资产。

## 下载

- Windows：`RepoBerth-<version>-windows-amd64-update.zip`，解压后运行 `RepoBerth.exe`。需要 Git 与 WebView2。
- macOS Apple Silicon：`RepoBerth-<version>-macos-arm64-update.zip`。
- 同一个包既用于手动下载，也用于应用内更新；每个平台只发布一个压缩包和 `.sha256`。

版本历史、下载地址和校验值请查看 [GitHub Releases](https://github.com/firmme/repo-berth/releases)。

## 构建

需要 Go **1.27.2+**、Node.js **24** 和 Git。依赖版本由 `go.sum` 与 `frontend/package-lock.json` 固定。

```powershell
npm ci --prefix frontend
node scripts/build.mjs
.\bin\<version>\RepoBerth.exe
```

构建脚本会自动生成压缩的第三方许可清单并嵌入二进制。Windows 构建需要 MinGW `windres` 生成 EXE 图标资源，可通过 `WINDRES` 指定路径。macOS 需要 Xcode Command Line Tools；Linux 需要 GTK4、WebKitGTK 6.0、X11 和 Secret Service。开发配置见 [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md)。

## 发布资产

每个平台只发布一个 `*-update.zip` 和一个 `.sha256`：

```powershell
node scripts/package-update.mjs
```

压缩包只包含一个顶层可执行文件或 `.app`，既满足更新器要求，也可直接解压运行。第三方许可、README 和依赖清单已压缩嵌入应用，发布时不再附带额外文件。`node scripts/package-windows.mjs` 仅保留用于生成完整开发验收包。

macOS 同理生成 `*-macos-*-update.zip`。所有压缩包同时上传对应的 `.sha256`。

## 验证

```powershell
node scripts/build.mjs
go test ./...
go vet ./...
npm test --prefix frontend
```

第三方许可由 `node scripts/generate-notices.mjs` 生成并压缩嵌入；`node scripts/build.mjs` 会自动执行。CI 在 Windows、macOS 和 Ubuntu 上运行构建与测试。

## 数据与安全

- Token 只存在于 Go 内存和系统凭据库，不进入 React、SQLite、remote URL、命令行参数或日志。
- 每个网络命令使用独立 loopback 凭据通道和随机 nonce。
- Git 子进程隔离继承的 `GIT_*`、系统/全局配置和凭据助手链；应用不写全局 Git 配置。
- 应用内提交不启用 GPG / SSH 签名，不递归克隆 submodule，不自动下载 Git LFS 对象。
- 数据库位置：Windows `%APPDATA%/RepoBerth/berth.db`，macOS `~/Library/Application Support/RepoBerth/berth.db`，Linux `$XDG_CONFIG_HOME/RepoBerth/berth.db`。

更完整的产品边界与验收记录见 [PRODUCT_AUDIT.md](PRODUCT_AUDIT.md)。

## 代码结构

```text
main.go              Wails 入口、原生目录选择和外部工具
internal/model       共享数据类型
internal/store       SQLite 存储
internal/vault       系统凭据库和会话凭据
internal/provider    GitHub API / Device Flow
internal/gitexec     Git 执行、凭据隔离、状态与历史
internal/service     账号、仓库、Git 和任务业务逻辑
frontend/src         React 桌面界面
scripts              构建、打包和验证脚本
```
