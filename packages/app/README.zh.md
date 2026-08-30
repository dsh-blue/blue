# `@dsh-blue/blue-app`

[English](README.md) | 中文

Blue 交互式 `dsh --profile blue` 界面的命令行启动提供方与 Agent 驱动。

`./startup` 入口（`blue-startup`）声明可选的 `[task]` 位置参数与 `--resume <id>`，并通过 `blueStartup` 发布解析结果。显示帮助或解析失败时不会启动应用 action。

主入口（`blue-app`）创建或恢复 Harness Agent，但 Agent 与 Session 始终留在本包内部。bundle 私有 runtime realm 中的 Blue 官方 consumer 只接收四个 renderer-neutral 服务：

- `blueSessionReader` 发布带单调递增 revision、必需 switch epoch、缓存且深冻结的当前会话快照。
- `blueSessionProjections` 以同一 epoch 与一致 sequence cut 读取并订阅官方当前会话 projection 值，也可读取直接子会话 projection，但不暴露 Session handle。
- `blueSessionActions` 承担更丰富的交互操作，包括模型与模式切换、命令执行、队列投影、rewind 候选、preset、skill、tool、会话详情以及可释放的旁路会话。Interrupt 请求也会停止当前 Agent 仍在运行的 continuable 后代。
- `blueToolPresentations` 解析 Agent-scoped 的官方 tool presenter view，但不暴露 active Agent。

创建、恢复、fork、rewind 与新建会话请求共用一条串行切换队列。切换时先创建或恢复替代 Agent，再释放旧 Agent、安装新的内部绑定，最后发布 reader 快照。失败会保留当前会话并写入 stderr。启动任务作为第一条普通用户消息提交。

模型选择按三层解析：会话内选择、最近一次持久化 request header、进程默认值。对外只暴露不可变 action 结果，不暴露 Harness 的可变选择引用。可选 preset composition 会在创建与恢复时从会话记录重建。

本包还拥有安全的进行中 turn 撤回与 BTW 旁路会话。旁路 handle 只暴露 opaque projection identity、纯文本 follow-up、限定为 `running`/`idle` 的状态以及 disposal。

`./plugin-host-session-bridge` 入口在自身 Fiber 生命周期内通过 composition-private control 把两个 app-owned read source 挂接到 `bluePluginHost`。公共插件获得 field-scoped `session.read` facade 与 exact-key `session.projections.read` facade；JSON 分离、大小上限、epoch/sequence fence、owner reload 和 consumer unload 均由 API host 托管。generic `session.act` 已移除，未收窄的 projection source 与内部宽口径 `blueSessionActions` 都不会越过该边界。领域写入继续使用所属 Harness service 或专用 feature action。

## 模型体验

本包不添加 prompt 前缀。用户输入以普通 user message 提交；prompt 与 tool 由组合后的 Harness profile 提供。

## 启动器与覆盖

Blue 已有独立启动器：`@dsh-blue/blue-cli` 提供的独立 `blue` binary，内嵌固定且经过测试的 dsh 宿主，并在首次使用时校准 `blue` profile。通过通用 `dsh --profile blue` 启动会解析同一份不可变 bundle。bundle 的全树 e2e 与真实进程 smoke 覆盖完整 profile。
