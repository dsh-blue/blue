# Blue Frontend Runtime 合并审计

日期：2026-08-23

## 结论摘要

- AltScreen 改造已完成自动化和人工验收；滚轮、键盘滚动、拖选复制、底部 dock、退出恢复和窄终端 smoke 均通过。
- F0、F1 和 F2 的核心 headless runtime/adapters 已有实现和测试。审计期间发现的 `FrontendHost` 并发 capture 竞态已修复，provider swap 现在串行化完整生命周期。
- F3、F4、F5、F6 不是全部完成。`dsh-context` 仍是 generic headless source，没有官方 domain 到新 TUI renderer 的完整 vertical slice；`dsh-remote` 没有真实 SSH bootstrap/profile dogfood；官方 surface 仍以旧 renderer 为 baseline；openpencil/lark 只有迁移审计；独立安装 fixture 不能安装 context 的 workspace peer 依赖。
- PR #36 本身是 docs-only，远端 commit 的唯一 check 已成功，PR API 返回 `mergeable=true`，但当前 `mergeable_state=unstable` 且传统 status 仍为 pending/0。当前证据不足以立即合并；应等待 GitHub 状态稳定并完成所需人工 review。即使 PR #36 合并，也不能宣称 frontend-runtime 路线全部完成。

## 自动化证据

修复后的本地快照通过：

| 门禁 | 结果 |
|---|---|
| `pnpm run test:coverage` | 127 files / 2003 tests；Statements、Branches、Functions、Lines 均 100% |
| `pnpm run typecheck` | 通过 |
| `pnpm run lint` | 通过 |
| `pnpm run build` | 通过 |
| `pnpm run check:lib` | 56 个 lib export claims 完整 |
| `pnpm run diagrams:check` | 通过 |
| `pnpm run smoke:happy` | `HAPPY_SMOKE_PASS exit=0` |
| `pnpm run smoke:pty` | `PTY_SMOKE_PASS exit=0` |
| `pnpm run smoke:pty:mouse` | `PTY_MOUSE_SMOKE_PASS exit=0`，真实 SGR wheel 改变 VT 屏幕 |
| `blue-plugin-validate` | frontend、harness-adapter、context、remote 均无边界违规 |

`packages/transcript/tests/perf.spec.ts` 的 200-turn 结果为 window=15、120 个挂载、约 26.4ms；无界窗口为 1600 个挂载、约 19.9ms。测试只断言窗口挂载上界，不断言 persistence/list、resume、fold、mount 阶段的 latency budget，因此“有性能数据”不等于“有性能目标”。

## 生命周期竞态修复

`packages/frontend/src/host.ts` 原先允许并发 `swap()` 同时进入旧 provider 的异步 `capture()`。后发请求可能先完成，随后又被先发请求覆盖，违反“last requested provider remains active”。现在通过 pending swap queue 串行化完整的 `capture -> abort -> dispose -> activate -> restore` 生命周期，并在 unload/capture/dispose 边界拒绝继续挂载。新增 adversarial/provider-lifecycle 测试覆盖了 capture 阶段竞态、失败 capture、unload 期间 capture 和 disposal 竞态。

## 阶段判定

| 阶段 | 判定 | 证据与缺口 |
|---|---|---|
| F0 | 基本完成 | frontend、adapter 包骨架、capability absent、Fiber cleanup、plain fallback 和边界扫描存在；新 runtime 不在默认 Blue bundle。独立 worktree/commit 证据因当前 checkout 无 `.git` 无法提供。 |
| F1 | 完成（修复后） | readonly models、host lifecycle、fallback、unload/late publish、并发 swap 测试均通过。 |
| F2 | 基本完成 | session/projection/action/model/question bridge、watermark、abort/stale、capability absent 有实现和测试；当前/上一 Harness line contract fixture 尚未建立。 |
| F3 | 未完成 | `packages/context` 是 generic `ContextSource` headless slice；没有官方 dsh-context consumer、新 TUI renderer、默认 bundle row 或真实 Blue profile dogfood。`ContextFeature.execute()` 目前只是结构化 action 的占位执行。 |
| F4 | 部分完成 | `packages/remote` 有多 session registry、binding 和 dsh-remote v1 wire-client 形状；v1 的 interrupt/write lease 明确 absent，真实 SSH bootstrap daemon 和独立 profile 验收仍缺失。 |
| F5 | 未完成 | status/dock/command/tool/theme/editor/transcript 主要是 additive model/registry；旧 transcript/editor renderer 仍为 golden baseline，新 runtime 没有逐项完成 official consumer、replacement fixture、bundle row 和人工验收。 |
| F6 | 部分完成 | 四份 skill、validator、fixture manifest 入口、openpencil/lark shallow audit 已有；真实外部 Blue adapter 和生态迁移未完成。`blue-plugin-fixture.mjs packages/frontend --install` 可通过，但 `packages/context --install` 因 peer 包未同时打包而被 npm 404 拒绝。 |

## PR #36 合并判断

远端 API（head `587efda58f370ecaf512699d0236369400f331c2`）显示：PR #36 open、非 draft、10 个 docs 文件、261 additions/0 deletions，唯一 check `typecheck / lint / test (coverage)` 已成功；PR 返回 `mergeable=true`，但 `mergeable_state=unstable`，commit status 为 `pending` 且没有传统 status。PR body 要求的 diagrams、fence、relative-link 检查中，远端 PR 文件的图表/fence/relative-link 内容检查通过。当前快照中发现并删除了 `docs/README.md` 对不存在 `blue-parallel-execution.md` 的旧索引项；删除后本地 fence/relative-link 检查通过。

因此：

1. **PR #36 docs-only 变更**：内容方向和远端 CI 证据支持“待状态稳定后可合并”，但现在不应依据 `mergeable=true` 直接合并；先等待 `unstable/pending` 消失并确认仓库所需 review/branch protection 条件。
2. **整个 frontend-runtime 重构**：不能判定完成，也不应以“重构完成”为理由合并。F3/F4/F5/F6 的明确后续项必须单独完成并验收。
3. **当前 checkout**：没有 `.git` 元数据，无法执行 commit、push、merge、worktree 或 `git diff --check`，本报告只提供验证和合并建议，不声称已经合并。
