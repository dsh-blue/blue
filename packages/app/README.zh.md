# `@deepseek-ai/dsh-blue-app`

[English](README.md) | 中文

Blue 终端 UI 应用：交互式 `dsh --profile blue` 表面的命令行启动提供方与 Agent 驱动。

`./startup` 入口（`blue-startup`，inject `['cmdlineArgs']`）声明本应用的命令——可选的 `[task]` 位置参数与 `--resume <id>`——并把解析结果作为普通的 `blueStartup` 服务（`{ task?, resume? }`）发布。`--help` 或解析被拒绝时 action 不会执行、不发布任何内容，所有消费行保持 pending，直到启动器的有界退出触发。

主入口（`blue-app`，inject `['blueStartup', 'agentDefaultModel', 'agents', 'sessions', 'blueScreen']`）要求启动器提供 `ctx.appExit`，缺失即抛错。它在做任何其他事之前先提供 `blueSession`——可变的 `{ current: Agent | null }` 引用——然后等待 Loader 结算，随后恢复 `--resume` 指定的 session，或在默认模型上创建新 Agent（用 `installModelSelection` 把所选模型装入 agent 作用域，与 headless runner 同一构造）。启动任务作为第一条用户消息发送。每次 create/resume 完成后先更新 `blueSession.current`，再广播 `blue/session-changed(agent)`；交互层的 `/resume` 以 `blue/request-resume(sessionId)` 到达，驱动把它与在途操作串行化，先 resume、再 dispose 旧 Agent，并在该提交点发布——切换失败则保留当前 session 并向 stderr 报告。两个事件与 `BlueSessionRef` 类型均在 `src/types.ts` 中声明。

致命加载失败时的终端恢复由启动器的 `installFailLoud` release 负责，它会 dispose 整棵树；`@deepseek-ai/dsh-blue-core` 的 effect 会停止终端。core 包还导出 `createTerminalRelease()`，供未来自行持有 `installFailLoud` 的独立 Blue bin 使用。

## 模型体验

无影响，因为应用把用户输入作为普通用户消息提交；提示词与工具由组合中的 bundle 提供。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **无独立 bin**：profile 经由通用 `dsh` 启动器运行，因此 `installFailLoud` 的 release 是 dispose 整棵树，而不是直接调用终端 release；独立的 Blue bin 会自己把 `createTerminalRelease()` 交给 `installFailLoud`。
- **尚无整树 E2E**：transcript 与 interaction 并行开发中；组装后的 `dsh --profile blue` 冒烟暂缓至联调步骤。
