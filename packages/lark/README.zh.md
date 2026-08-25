# `@dsh-blue/blue-lark`

面向 `@sugarforever/dsh-lark` 的可选 renderer-neutral compatibility adapter。它通过 Harness 官方 command service 注册 `/lark [status|retry]`，并发布以 operation 为 scope 的 Blue notification。

adapter 只调用公开的 loopback `/dsh-lark/settings` route，不保存 settings 或 credentials，也不提供 credential 删除操作。route 或 web server 缺失时，Lark domain plugin 仍可继续运行，command 会返回普通的可用性提示。
