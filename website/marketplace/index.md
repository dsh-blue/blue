# 插件市场

Blue 生态插件的发现与安装入口：基于稳定 [Seam](/plugins/seams) 与公开 API 开发的第三方插件在这里集中展示，一行命令装进你的 Blue。

::: info 安装插件前
市场中的插件都运行在 Blue 之上，请先[安装 Blue](/guide/)。安装命令统一为 `blue plugin add <spec>`（等价于 `dsh plugin --profile blue add <spec>`），`<spec>` 为卡片或详情页给出的安装源；机制细节参见 [dsh 插件文档](/dsh/plugins)。
:::

::: warning 国内网络访问 GitHub
`/plugin` 面板需要从 GitHub 读取市场注册表。如果出现 `plugin operation failed: fetch failed`，请先为当前终端设置一个可访问的注册表地址，再启动 Blue。以下按推荐顺序排列：

1. [gh-proxy.com](https://gh-proxy.com/)

   ```sh
   export BLUE_MARKETPLACE_REGISTRY='https://gh-proxy.com/https://raw.githubusercontent.com/dsh-blue/marketplace/master/registry.json'
   ```

2. [gh.jasonzeng.dev](https://gh.jasonzeng.dev/)

   ```sh
   export BLUE_MARKETPLACE_REGISTRY='https://gh.jasonzeng.dev/https://raw.githubusercontent.com/dsh-blue/marketplace/master/registry.json'
   ```

3. [GitProxy](https://gitproxy.dev/)

   GitProxy 的网页入口用于转换链接；在 `BLUE_MARKETPLACE_REGISTRY` 中请使用它的 API 端点：

   ```sh
   export BLUE_MARKETPLACE_REGISTRY='https://api.gitproxy.dev/https://raw.githubusercontent.com/dsh-blue/marketplace/master/registry.json'
   ```

设置只对当前终端会话生效。可先运行 `curl -fL "$BLUE_MARKETPLACE_REGISTRY"`，确认返回 JSON 后再执行 `blue` 或 `dsh --profile blue`。该配置只加速市场注册表的读取；插件实际安装仍使用卡片上的 npm/GitHub 安装源。

如果卡片的安装源是 GitHub 仓库，建议同时配置仓库代理。`/plugin` 面板和 `/plugin install` 会自动把 `github:`、`git+https://github.com/...` 源改写为该代理；使用网页卡片上的 `blue plugin add <spec>` 或直接运行 dsh 时，请按同一代理设置 Git 的 URL 重写：

```sh
# 与上面选择同一顺序的仓库代理（每次只设置一个）
export BLUE_MARKETPLACE_GITHUB_PROXY='https://gh-proxy.com/'
# export BLUE_MARKETPLACE_GITHUB_PROXY='https://gh.jasonzeng.dev/'
# GitProxy 使用 API 端点；网页入口仍是 https://gitproxy.dev/
# export BLUE_MARKETPLACE_GITHUB_PROXY='https://api.gitproxy.dev/'
```

手动执行 `blue plugin add` 时，可让 Git 全局改写 GitHub 地址（下面以第一个代理为例）：

```sh
git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"
git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "git@github.com:"
```

切换到第二或第三个代理时，将命令中的目标地址替换为对应的 `https://gh.jasonzeng.dev/https://github.com/` 或 `https://api.gitproxy.dev/https://github.com/`。这些代理是第三方服务，若某个地址超时或返回错误，请按上面的顺序更换。
:::

<MarketplaceGrid />

## 收录你的插件

写好了插件想让更多人用上？往 [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace) 仓库提交收录即可——**GitHub 可安装的插件就能收录，npm 不是门槛**（发布 npm 后补一条安装源即可）。完整流程、字段说明与写作规范见[收录指南](/marketplace/submit)。
