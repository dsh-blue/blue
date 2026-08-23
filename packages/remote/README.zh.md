# @dsh-blue/blue-remote

Blue 的 F4 headless session runtime，提供多 session projection registry、current-session binding，以及 dsh-remote 风格的 capability negotiation、seq resume、write lease、action 和 question/approval proxy。

本包不依赖 TUI 或终端 API。官方 connection 通过 structural adapter 接入，所有调用携带明确的读写 authorization，snapshot 到 subscribe 的事件会被缓存重放，session attachment 随作用域释放。question/approval 回复使用官方 client-response carrier。

在仓库根目录运行 `pnpm fixture:remote-upstream -- --upstream <checkout>`，可通过真实 Unix socket 验证已认证的 dsh-remote daemon。SSH bootstrap 仍需在专用 profile 中单独验收。
