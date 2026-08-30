# 插件市场

::: warning rc.2 市场迁移中
市场注册表与首个示例插件仍使用 P1–P4 之前的过渡契约，当前条目尚未完成
`0.1.1-rc.2` canonical manifest 迁移。为避免把旧插件误装进 rc.2 profile，本页暂不
展示安装卡片，也不把现有 `verified` 标记作为 rc.2 兼容性证据。
:::

`0.1.1-rc.2` 已发布七项 Public Beta capability 的机器契约与 Host admission：
`commands`、`status`、`panes`、`overlays`、`notifications.publish`、
`session.read` 和 `session.projections.read`。市场恢复前会完成两项工作：

1. 注册表 validator 迁移到 P1 canonical schema、required/optional 与 exact resource；
2. 至少一个插件通过 rc.2 manifest、packed fixture、真实 profile 和人工验收。

现阶段开发插件请从[快速开始](/plugins/quickstart)创建 canonical
`blue.plugin.json`，并按[调试与验证](/plugins/testing)从 Blue checkout 运行验证。
免克隆作者工具与正式市场闭环属于 P5，尚未包含在本次 RC。

## 收录状态

新收录暂时暂停。注册表完成迁移后，本页会恢复卡片和
[收录指南](/marketplace/submit)中的提交流程。已经安装旧市场插件的用户，应先保留在
原 Blue 版本；迁移完成前不要把它们作为 rc.2 profile 的依赖。
