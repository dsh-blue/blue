# External Fixture Audit

本文记录外部插件如何验证 Blue 目标架构；不把“可迁移”误写成“已迁移”。

## [dsh-remote](https://github.com/GeekCmore/dsh-remote)

`dsh-remote` 已按 shared core、backend、client、proxy、frontend、bundle 拆分，提供 live/daemon 两种模式、capability negotiation、seq-cursor resume、write lease、approval/question bridge 和 daemon-TUI bundle。

验证重点：session runtime、attach/detach、remote proxy、action 转发、多 session scope、headless 与 TUI 共用 domain 能力。它应作为第二条垂直 fixture，而不是第一个 UI 迁移样例。

## [dsh-context](https://github.com/bowenliang123/dsh-context)

验证链路：Harness context/token-meter domain -> projection -> `/context` command/action -> panel/status interaction model -> Blue TUI renderer。重点检查 replay/resume、projection watermark、缺能力降级、Fiber unload、窄终端和 fixture snapshot。

## [dsh-openpencil](https://github.com/ZSeven-W/dsh-openpencil)

Domain 包含工具、签名 capability、事务性 batch action 和文件生命周期；交互/renderer 包含多帧预览、Web canvas 和 managed editor。Blue 迁移目标是提供文本/摘要 fallback，不复制 Web canvas；headless domain 能力必须独立可用。

## [dsh-lark](https://github.com/sugarforever/dsh-lark)

验证外部系统 action、notification、credentials/config 和无 TUI domain 使用。Blue adapter 只负责将结果映射到 command/notification model。

## 统一审计字段

后续每个 fixture 都记录 Domain、Projection、Action、Command、Interaction model、Renderer-specific UI、Bundle rows、scope、依赖、迁移风险和验证场景。

## F6 shallow-clone audit (2026-08-23)

The upstream heads were checked with `git ls-remote` and shallow-cloned into a
throwaway `/tmp/blue-ecosystem-audit.*` directory:

- `dsh-openpencil` head `e3eb3bfdb5262db0659c3c6e567fe209199c3eb2`: the host
  registers five model-facing tools through `ctx.effect`, emits presentation
  metadata separately from canonical tool results, and owns signed,
  hash-bound editor capabilities. The browser React/canvas workbench is a
  renderer-only surface. Blue integration must therefore consume the tool
  summaries and expose text/diff fallback when presentation routes or browser
  capabilities are absent; it must not copy the canvas or bearer capability
  into a frontend model.
- `dsh-lark` head `ee639df50fc7c004ac4e3ea90fa523a4d366729c`: the domain plugin
  owns settings/runtime/channel services and registers its web settings route
  and settings action through Fiber-bound disposers. Its React client is an
  optional renderer. Blue integration must project runtime failures and
  external actions as notification/command models, dedupe by operation id, and
  remain usable without the web route or client bundle.

The audit established the migration boundary; neither external domain project
was rewritten. Blue now implements that boundary in
`@dsh-blue/blue-openpencil` and `@dsh-blue/blue-lark`, with both composition
rows disabled by default until profile acceptance.

## F6 packed fixture evidence (2026-08-23)

The runner packed the complete local workspace closure, installed it in an
independent temporary npm project, and resolved imports only through installed
package exports. Frontend, harness-adapter, context, and remote each executed
all seven shared scenarios with zero skipped scenarios. OpenPencil and Lark
each executed those seven plus two package-specific scenarios (9/9):

- OpenPencil verified official presentation fallback, signed-meta elision,
  call-id dedupe, bounded retention, failure notification cleanup, unload, and
  rejection of late tool results.
- Lark verified status/retry notification states, operation-id dedupe,
  route-absent fallback, abort, bounded retention, unload, and late-result
  rejection.

Current-line runs resolved the observed Harness peers to `0.1.1-rc.2`.
Compatibility runs used `--harness-line 0.1.1-rc.1`, resolved every observed
Harness peer in the temporary install to that exact line, and again executed
9/9 scenarios with no skips or failures. The override never edits repository
manifests or `pnpm-lock.yaml`.

The final automated gate passed with 2,080 tests in 133 files and per-file
100% coverage (9,301 statements, 5,819 branches, 1,885 functions, 7,661
lines). Typecheck/build, lint, 62 lib/export claims, diagram synchronization,
the VitePress production build, `smoke:happy`, `smoke:pty`, and
`smoke:pty:mouse` also passed; all three smoke processes exited 0. Dedicated
`blue-frontend-runtime` profile dogfood and human acceptance remain separate.
