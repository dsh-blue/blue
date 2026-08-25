# Blue PR #36 对抗性测试报告

日期：2026-08-23  
对象：当前工作区（PR #36 的目标架构对应实现）

## 结论

自动化门禁全部通过，但人工验收发现两个真实交互缺陷和一个性能体验问题。因此当前实现可以作为兼容基线，不能作为可合并的最终 TUI 实现。PR #36 本身是文档-only 变更；本次发现说明目标架构中 renderer viewport、流式投影和交互性能仍未完成。

## 对照目标与证据

| 目标 | 方法 | 证据 | 判定 |
|---|---|---|---|
| Domain / Interaction / Renderer / Composition 分层 | 依赖图、源码 import 扫描、包 manifest 审计 | frontend/harness-adapter/context/remote 为独立 headless 包；core 是唯一 pi-tui 边界 | F0-F4 基本满足 |
| projection replay、watermark、late event 丢弃 | 新增 `packages/remote/tests/adversarial.spec.ts`，并运行既有 remote/context/adapter suites | 取消 baseline 后返回 `BLUE_ABORTED`，无 slot 残留；全量测试覆盖 seq 过滤 | 通过 |
| provider `capture -> abort -> dispose -> activate -> restore` 与失败回退 | 新增 `packages/frontend/tests/adversarial.spec.ts` + 既有 lifecycle suite | 并发 swap 最后 provider 生效；失败回退 plain；late publish 被丢弃 | 通过 |
| renderer-neutral API 稳定性 | TypeScript、lint、源码依赖扫描 | 新包未引入 pi-tui/ANSI/DOM/React；模型为冻结 readonly 数据 | 通过当前范围 |
| 性能与可扩展性 | `packages/transcript/tests/perf.spec.ts` 的 200-turn 合成流；窗口挂载上界 | window=15 保持有限挂载，unbounded 显著更多；测试只记录耗时，不设 SLA | 有数据但无性能预算，需后续补基准门槛 |
| 真实进程/宽度/PTY | `pnpm run smoke:happy`（COLUMNS=40，mock LLM）和 `smoke:pty` | `HAPPY_SMOKE_PASS exit=0`、`PTY_SMOKE_PASS exit=0`，用户确认窄终端缩放正常 | 通过 |
| 外部 fixture 与真实 TUI 迁移 | 设计文档和实施计划审计 | `blue-implementation-plan.md` 明确 F5/F6 的真实外部 adapter、TUI renderer、人工验收仍为后续；默认 bundle 仍是旧 renderer | 未完成/未证明 |

## 门禁结果

- `pnpm run test`: 126 files, 1983 tests passed。
- `pnpm run typecheck`: passed。
- `pnpm run lint`: passed。
- `pnpm run diagrams:check`: passed。
- `pnpm run check:lib`: 56 lib exports intact。
- `pnpm run smoke:happy`: passed at `COLUMNS=40`。
- `pnpm run smoke:pty`: `PTY_SMOKE_PASS exit=0` at `40x24`。

## 新增对抗性测试

- `packages/remote/tests/adversarial.spec.ts`：baseline snapshot 忽略 abort 时，registry 仍不得安装 slot。
- `packages/frontend/tests/adversarial.spec.ts`：并发 provider swap 的生成代际与最终 provider 一致性。
- `packages/frontend/tests/architecture-boundary.spec.ts`：扫描 frontend、harness-adapter、context、remote 的全部 TypeScript 源文件，拒绝 pi-tui/React/DOM/ANSI/terminal 依赖，并检查公共导出表面。

三项均通过；它们补足了“取消/替换后无晚到状态”和“headless 不越界”的架构门禁，而不是重复已有 happy-path 测试。

## 人工验收结果

用户在 `blue-adversarial` profile 完成真实终端验收：生命周期、窄终端、主题/面板、session 操作和恢复均正常；但发现以下问题：

1. **底部 dock 未真正固定**：编辑框和会话流在 main-screen buffer 中共同滚动。预期是编辑框始终位于终端底部，用户滚动只改变 transcript viewport；当前实现不满足这一契约。
2. **流式输出重绘抖动**：长文本输出期间焦点/视口停在会话流开头附近；手动滚动会触发持续闪烁和上下跳动。根因与上项相同：旧 transcript 行变化会触发 main-screen full redraw，重置可视 viewport。
3. **interrupted 标记不可见**：代码中已有 `TranscriptFolder.interrupt()` 和 `InterruptedMarkerComponent`，但人工取消长请求后没有看到标记。它可能被上述视口重绘推出可视区域，也需要独立的 end-to-end 事件证据确认。
4. **`/sessions` 列表首屏偏慢**：功能正确，但原实现串行等待全部标题读取后才挂载 picker。现已改为分页懒加载和预取：header 列表返回后先读取第一页标题，第一页完成后才展示，避免 session id 被替换为标题；光标接近当前页末尾时预取下一页，已加载页缓存复用。机器测试已覆盖首屏等待、可见页请求、临近翻页预取、缓存与卸载竞态；真实 profile 的延迟预算仍需人工验收。

这些是用户可感知的 P1/P2 交互与性能问题，不应在修复前合并主分支。

## 发现与风险

自动化没有发现异常，但人工验收已发现上述运行时交互缺陷。主要架构风险是 renderer 没有独立 transcript viewport 与 bottom dock；性能风险是 session load 缺少阶段预算和可观测数据。真实 dsh-context TUI vertical slice、dsh-remote 外部 daemon、openpencil/lark 独立安装 fixture、上一 Harness line contract fixture 仍未被本次验证覆盖。

## 最后的人工验收

机器测试完成后，必须由人类在独立 profile 运行真实终端：

```sh
PROFILE=blue-adversarial script/install-dev.sh
dsh --profile blue-adversarial
```

该 profile 已由 `PROFILE=blue-adversarial script/install-dev.sh` 准备完成，并链接当前工作区的六个可安装 Blue 包。`blue-frontend`、`blue-context`、`blue-remote` 和 `blue-harness-adapter` 当前没有默认 bundle row，因此不会自动成为生产 TUI surface；这正是本报告“目标架构未全部落地”的一项直接运行时证据。人工验收结果已记录在本节，不应删除该 profile，直到修复后的版本重新验收。

建议至少验证：启动/退出 bracketed paste 开关、`/context`（若 profile 注入 context）、session 切换与 `/new`、窄终端 resize、provider/theme 切换、输入草稿跨 reload、异常 action 后 Agent loop 是否继续。请在此报告之后回复实际观察结果；在收到明确“验收通过”前，不应宣称目标架构已完成或允许删除该 profile。
