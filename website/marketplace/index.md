# 插件市场

::: warning alpha.1 市场迁移中
市场注册表仍使用 P1–P4 之前的过渡契约，但首个显式索引插件
`dsh-blue/blue-doudizhu@0.3.0` 已完成旧 RC canonical manifest，但其固定提交尚未声明 Harness `0.1.2-alpha.2`，因此当前 catalog 正确显示 incompatible，等待插件自身迁移。
裸 `/plugin` 的 TUI 目录会保留该固定 commit 供查看，但不会提供安装动作。本页仍不
展示安装卡片；现有 `verified` 标记也不是 alpha 兼容性证据。
:::

`0.1.2-alpha.1` 提供七项 Public Beta capability 的机器契约与 Host admission，并只支持 Harness `0.1.2-alpha.2`：
`commands`、`status`、`panes`、`overlays`、`notifications.publish`、
`session.read` 和 `session.projections.read`。市场恢复前会完成两项工作：

1. 注册表 validator 迁移到 P1 canonical schema、required/optional 与 exact resource；
2. 完成迁移插件的人工验收，并把 manifest、packed fixture 与真实 profile 证据接入收录治理。

现阶段开发插件请从[快速开始](/plugins/quickstart)创建 canonical
`blue.plugin.json`，并用已发布的 `blue-plugin validate/conformance` 按
[调试与验证](/plugins/testing)完成免 checkout 验证。TUI 目录是随 Blue 发布的有界
元数据索引，不是市场 Service，也不开放收录。

## 收录状态

新收录暂时暂停。注册表完成迁移后，本页会恢复卡片和
[收录指南](/marketplace/submit)中的提交流程。已经安装旧市场插件的用户，应先保留在
原 Blue 版本；已迁移的 `@dsh-blue/blue-doudizhu@0.3.0` 可从 TUI 目录或 npm 精确安装，
但这不代表 Website 市场已恢复收录。
