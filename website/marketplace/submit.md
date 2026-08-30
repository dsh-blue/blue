# 收录指南

::: warning 暂停新收录
`dsh-blue/marketplace` 的注册表校验器与现有示例条目尚未迁移到
`0.1.1-rc.2` 的 canonical P1–P4 契约。迁移完成前请不要提交新的收录 PR；旧版
`verified` 只表示旧 Host 上的历史验证，不表示 rc.2 兼容。
:::

市场重新开放时，最低门禁将与 rc.2 的机器契约一致：

- package root 通过 `package.json.blue.manifest` 指向 canonical `blue.plugin.json`；
- manifest `id` 等于 package name，entry 是公开 exports subpath；
- required/optional、capability version 与 exact resource 通过共享 parser/validator；
- 只使用七项 Public Beta capability，不把 Experimental/reference facet 写进 canonical manifest；
- packed install、当前/上一 Harness line、Fiber unload、宽度扫描与真实 profile 有可复现证据；
- 中英文元信息、版本、license、仓库和安装源与实际 artifact 一致。

当前可先按[快速开始](/plugins/quickstart)开发，并从 Blue checkout 运行
[验证脚本](/plugins/testing)。免克隆 author command、正式 skill 与 registry 自动
conformance 属于 P5；它们完成后，本页会恢复具体字段、PR 流程和 review 清单。

[返回插件市场](/marketplace/)
