# 插件市场

::: info 建设中
Blue 生态插件市场将以独立仓库实现（收录、索引与卡片展示），目前处于规划阶段。本页为占位，开放后同步上线。
:::

## 这里是什么

面向 **Blue 下游开发者**的生态插件市场：你通过 [Seam](/plugins/seams) 和稳定 public API 编写的 status、dock、command、notification 插件，发布到 npm 后收录于此，其他用户一行安装。

每张卡片大致长这样：

```
┌─────────────────────────────────────┐
│ my-plugin-clock              v0.1.0 │
│ 状态栏时钟 + /now 命令                 │
│ ★ 12 · 状态栏 / 命令                  │
│ dsh plugin add my-scope/my-pkg      │
└─────────────────────────────────────┘
```

## 上线之前

- 想开发插件：从[快速开始](/plugins/quickstart)入手，缝的目录见 [Seam 参考](/plugins/seams)；
- 想看当前组合：Blue bundle 的 28 条自有行见[内置插件](/plugins/builtins)；
- 关注 [GitHub 仓库](https://github.com/dsh-blue/blue)获取市场开放公告。
