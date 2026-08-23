# @dsh-blue/blue-remote

Blue 的 F4 headless session runtime，提供多 session projection registry、current-session binding，以及 dsh-remote 风格的 capability negotiation、seq resume、write lease、action 和 question/approval proxy。

本包不依赖 TUI 或终端 API。官方 connection 通过 structural adapter 接入，所有调用携带明确的读写 authorization；snapshot 到 subscribe 的事件会被缓存重放，session attachment 以 generation fencing 去重并随作用域释放，官方请求可配置超时。question/approval 回复使用官方 client-response carrier，重复或格式错误的 acceptance body 会被拒绝。write lease 的 acquire/release 在同一 connection generation 内去重；过期或迟到的 grant 会先释放，后台清理失败可通过 adapter diagnostic callback 上报。

在仓库根目录运行 `pnpm fixture:remote-upstream -- --upstream <checkout>`，可通过真实 Unix socket 验证已认证的 dsh-remote daemon。增加以下参数可通过固定 fingerprint 的 SSH forwarding 运行同一组场景：

```sh
--ssh --ssh-host <host> --ssh-user <user> \
  --ssh-private-key <path> --ssh-fingerprint <SHA256:...>
```

SSH fingerprint 必须显式提供；fixture 不扫描也不自动信任 host key。真实 profile 的人工验收仍是独立门禁。
