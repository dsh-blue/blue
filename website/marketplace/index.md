# 插件市场

::: warning rc.3 市场迁移中
市场注册表与首个示例插件仍使用 P1–P4 之前的过渡契约，当前条目尚未完成
`0.1.1-rc.3` canonical manifest 迁移。裸 `/plugin` 的 TUI 目录会索引
`dsh-blue/blue-doudizhu`，但明确显示“需要迁移”并禁用安装。本页仍不展示安装卡片，
现有 `verified` 标记也不是 rc.3 兼容性证据。
:::

`0.1.1-rc.3` 提供七项 Public Beta capability 的机器契约与 Host admission：
`commands`、`status`、`panes`、`overlays`、`notifications.publish`、
`session.read` 和 `session.projections.read`。市场恢复前会完成两项工作：

1. 注册表 validator 迁移到 P1 canonical schema、required/optional 与 exact resource；
2. 至少一个插件通过 rc.3 manifest、packed fixture、真实 profile 和人工验收。

现阶段开发插件请从[快速开始](/plugins/quickstart)创建 canonical
`blue.plugin.json`，并用已发布的 `blue-plugin validate/conformance` 按
[调试与验证](/plugins/testing)完成免 checkout 验证。TUI 目录是随 Blue 发布的有界
元数据索引，不是市场 Service，也不开放收录。

## 收录状态

新收录暂时暂停。注册表完成迁移后，本页会恢复卡片和
[收录指南](/marketplace/submit)中的提交流程。已经安装旧市场插件的用户，应先保留在
原 Blue 版本；迁移完成前不要把它们作为 rc.3 profile 的依赖。
