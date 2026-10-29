# 发布方 GitHub 登录配置

普通使用者无需配置本文件中的任何内容。Repo Berth 的发行方需要一次性注册应用，之后所有用户共用应用公开标识，并分别授权自己的 GitHub 账号。

1. 在 [GitHub 的 OAuth App 注册页面](https://github.com/settings/applications/new) 为 Repo Berth 注册自己的应用，填写项目名称和项目网站。Device Flow 不使用浏览器回调，注册页面要求回调地址时可填写 `http://127.0.0.1`。
2. 启用 **Device Flow**，取得公开的 Client ID；本方案不使用 Client Secret。
3. 项目已在 `app.config.json` 保存自己的公开标识（不是 Secret），`node scripts/package-windows.mjs` 会通过 Go 链接参数将其内置进程序。可用 `REPO_BERTH_GITHUB_CLIENT_ID` 在构建时覆盖，用于发布者维护应用身份；不是让每个用户输入。
4. CI 默认使用项目公开配置，也允许通过同名 repository variable 覆盖。只有项目配置和环境变量都缺失时，才阻止登录发行包生成。

不应借用 GitHub CLI 或其他产品的 Client ID。应用名称、授权范围与撤销授权入口必须对应 Repo Berth 自己的应用。

当所有发布者配置缺失时，`node scripts/build.mjs --allow-unconfigured-auth` 才生成带 `-dev` 后缀的本地开发程序；这种程序没有真实登录能力，不能作为可登录成品交付。单元测试使用合成 Provider，不会证明实际 GitHub 授权已经可用。旧版本的每用户配置仅为迁移和开发测试兼容保留，不再提供普通用户编辑入口；构建内置配置优先。

注册和 Device Flow 的要求见 [GitHub 官方文档](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)。
