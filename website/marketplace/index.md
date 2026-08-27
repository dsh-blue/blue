# 插件市场

Blue 生态插件的发现与安装入口：基于稳定 [Seam](/plugins/seams) 与公开 API 开发的第三方插件在这里集中展示，一行命令装进你的 Blue。

::: info 安装插件前
市场中的插件都运行在 Blue 之上，请先[安装 Blue](/guide/)。安装命令统一为 `blue plugin add <spec>`（等价于 `dsh plugin --profile blue add <spec>`），`<spec>` 为卡片或详情页给出的安装源；机制细节参见 [dsh 插件文档](/dsh/plugins)。
:::

<MarketplaceGrid />

## 收录你的插件

写好了插件想让更多人用上？往 [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace) 仓库提交收录即可——**GitHub 可安装的插件就能收录，npm 不是门槛**（发布 npm 后补一条安装源即可）。完整流程、字段说明与写作规范见[收录指南](/marketplace/submit)。
