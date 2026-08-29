# `@dsh-blue/blue-harness-adapter`

F2 Harness 兼容适配层，将文档化 Harness 能力转换为 Blue 的 renderer-neutral runtime。session、projection、action、model、question/approval、locale bridge 可独立卸载；缺失能力、abort 和 stale result 均返回结构化结果，不暴露原始 Agent 或 Session 对象。

`SessionBridge.reader` 只为 Beta `session.read` 暴露 `current()` 与 `subscribe()`。generic public `session.act` 已移除。remote mutation 使用所属包自有的 action vocabulary，与 plugin host 分离；session bridge 不再合并读写权限。

`./locale` adapter 把 Harness 官方的 `locale.preference` setting 绑定到单棵 frontend tree 的 `blueLocale` 服务。没有显式偏好时依次跟随 `LC_ALL`、`LC_MESSAGES`、`LANG` 与 `Intl`；中文变体统一使用简体中文，不支持的语言回退英文。
