# Codex 验收归档：机器门禁与暂缓项

> 2026-08-23 · 按 `CODEX-ACCEPTANCE-TDD-GUIDE.md` 对当前代码快照执行的验收记录。

## 范围与限制

当前目录是无 `.git` 元数据的代码快照，无法提供 branch、HEAD、upstream 或独立 worktree 证据。本记录只声明实际执行过的本地验证，不把文档描述或历史提交当作当前快照证据。

## 机器门禁

以下命令均成功：

- `pnpm install --frozen-lockfile`
- `pnpm run test`：124 test files，1981 tests
- `pnpm run test:coverage`：statements、branches、functions、lines 均 100%
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run diagrams:check`
- `pnpm run build`
- `pnpm run check:lib`：56 个 lib/export 声明完整
- `pnpm run website:build`
- `pnpm run smoke:happy`：连续 3 次通过
- `pnpm run smoke:pty`：连续 3 次通过，40x24、真实 CLI/raw-mode、streaming、slash dropdown、Escape、双 Ctrl-C、退出码检查通过

## 架构与插件证据

- `blue-plugin-validate` 对 `api`、`frontend`、`harness-adapter`、`context`、`remote`、`core`、`interaction`、`transcript`、`app` 逐包通过。
- `blue-plugin-fixture.mjs packages/frontend --install` 完成临时打包、独立安装，并通过 provider swap、plain fallback、卸载后晚到事件场景。
- 依赖核对确认只有 `packages/core` 声明 `@earendil-works/pi-tui`。
- frontend、harness-adapter、context、remote 的单元/契约测试覆盖 lifecycle、watermark/replay、stale rejection、capability absent、action abort、question/approval、write lease 和 unload 清理。

直接运行无参数的 `pnpm run blue:plugin-validate` 会审计根 bundle。根 bundle 的 `apply()` 按设计为空，挂载由 `cordis.patch.yml` 完成，因此该默认调用报告 lifecycle marker 缺失；实际插件包逐包验证均通过。

## 暂缓归档

以下项目按用户要求暂不作为本轮机器验收失败，但在指南的最终完成条件中仍保持未完成状态：

1. `dsh-remote v1` runtime 的真实 SSH bootstrap。远端依赖从 npmjs 与 npmmirror 安装均超时。
2. 人类 live acceptance：provider/session 切换、窄终端、CJK、fallback、卸载后的晚到事件和旧功能回归。
3. 当前/上一 Harness line 的独立 fixture 尚未建立。
4. 完整 PTY resize/provider/session/remote 场景尚未纳入现有 smoke 脚本。
5. `dsh-openpencil`、`dsh-lark` 目前只有迁移审计与计划，未形成真实外部插件 fixture。

## 结论

当前状态为：

`AUTOMATED_MACHINE_GATE_PASS / DEFERRED_REMOTE_AND_HUMAN_ACCEPTANCE`

本记录不等同于人类视觉、键盘手感、真实远端连接或产品最终验收通过。
