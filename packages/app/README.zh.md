# `@dsh-blue/blue-app`

[English](README.md) | 中文

Blue 交互式 `dsh --profile blue` 界面的命令行启动提供方与 Agent 驱动。

`./startup` 入口（`blue-startup`）声明可选的 `[task]` 位置参数与 `--resume <id>`，并通过 `blueStartup` 发布解析结果。显示帮助或解析失败时不会启动应用 action。

主入口（`blue-app`）创建或恢复 Harness Agent，但 Agent 与 Session 始终留在本包内部。Frontend 插件只接收三个 renderer-neutral 服务：

- `blueSessionReader` 发布不可变的当前会话快照，并接收 `@dsh-blue/blue-api` 定义的基础 follow-up、steer 与 interrupt action。
- `blueSessionProjections` 读取并订阅官方当前会话 projection 值，也可读取直接子会话 projection，但不暴露 Session handle。
- `blueSessionActions` 承担更丰富的交互操作，包括模型与模式切换、命令执行、队列投影、rewind 候选、preset、skill、tool、会话详情以及可释放的旁路会话。Interrupt 请求也会停止当前 Agent 仍在运行的 continuable 后代。

创建、恢复、fork、rewind 与新建会话请求共用一条串行切换队列。切换时先创建或恢复替代 Agent，再释放旧 Agent、安装新的内部绑定，最后发布 reader 快照。失败会保留当前会话并写入 stderr。启动任务作为第一条普通用户消息提交。

模型选择按三层解析：会话内选择、最近一次持久化 request header、进程默认值。对外只暴露不可变 action 结果，不暴露 Harness 的可变选择引用。可选 preset composition 会在创建与恢复时从会话记录重建。

本包还拥有安全的进行中 turn 撤回与 BTW 旁路会话。旁路 handle 只暴露 opaque projection identity、纯文本 follow-up、限定为 `running`/`idle` 的状态以及 disposal。

## 模型体验

本包不添加 prompt 前缀。用户输入以普通 user message 提交；prompt 与 tool 由组合后的 Harness profile 提供。

## 已知限制

Blue 当前仍运行于通用 `dsh` launcher，而非独立 binary。bundle 的全树 e2e 与真实进程 smoke 覆盖完整 profile。
