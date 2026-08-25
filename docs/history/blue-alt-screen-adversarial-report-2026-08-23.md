# Blue AltScreen 对抗性测试报告

日期：2026-08-23
对象：当前工作区的 `TuiAltScreen` 改造
设计对照：PR #36 的 Renderer / Interaction / Composition 分层目标，以及 `docs/blue-frontend-architecture.md`、`docs/blue-architecture.md`。

## 结论

本轮修复解决了鼠标滚轮不能滚动的回归。实现保持 AltScreen 的应用内选择能力，同时把滚轮事件按上下文分流：主编辑器先消费原始 SGR/X10 滚轮并滚动 transcript，替换面板接收上下键语义，无编辑器 handler 时由 pi-tui 的主 `ScrollView` 原生处理。自动化门禁全部通过；真机验收尚未完成，因此当前结论是“可进入人工验收”，不是“已合并”。

## 发现与修复

### 鼠标滚轮失效（已修复）

原实现的全局 wheel normalizer 无条件把鼠标报告改成 `Up/Down`，导致 AltScreen 的 `routeWheel()` 收不到原始事件；编辑器 handler 在边界返回 `false` 时还可能把事件落入焦点组件。

修复位于 `packages/core/src/terminal.ts` 与 `packages/interaction/src/input-plugin.ts`：

- AltScreen 保留原始 wheel 报告给 pi-tui viewport；
- 聚焦编辑器的 scroll handler 在移动成功和边界都消费 wheel，避免变成历史导航；
- 聚焦替换面板才执行 wheel -> `Up/Down` 转换；
- MainScreen 兼容模式继续保留原有 normalized-input 行为；
- `TuiAltScreen` 的 ScrollView、底部 dock、拖选复制和退出恢复不改变。

## 测试方法与数据

### 单元/集成

- `pnpm run test`：127 个文件，1999 个测试通过。
- 新增 AltScreen 对抗性场景：无 editor handler 时 raw SGR wheel 使 viewport 移动 3 行；编辑器聚焦且滚到边界时不收到 wheel 转换键；底部 dock 仍固定；拖选仍通过 OSC 52 复制；替换面板仍收到 wheel-as-arrow 和 PageDown。
- `pnpm run test:coverage`：Statements、Branches、Functions、Lines 均为 100%。

### 真实进程与 PTY

- `pnpm run smoke:happy`：`HAPPY_SMOKE_PASS exit=0`，窄终端宽度守卫通过。
- `pnpm run smoke:pty`：`PTY_SMOKE_PASS exit=0`，键盘输入、流式输出和退出通过。
- `pnpm run smoke:pty:mouse`：`PTY_MOUSE_SMOKE_PASS exit=0`。真实 node-pty 启动生产 profile，确认启用 `?1002h` 和 `?1006h`，发送 SGR wheel 后 headless VT 屏幕内容发生变化，并干净退出。

### 架构与发布门禁

- `pnpm run typecheck`：通过。
- `pnpm run lint`：通过。
- `pnpm run build`：通过。
- `pnpm run check:lib`：56 个 lib export claims 完整。
- headless package 依赖扫描仍确认只有 `packages/core` 触碰 pi-tui/raw terminal；frontend/harness-adapter/context/remote 保持 renderer-neutral 边界。

## 当前完成度与风险

| 项目 | 结论 |
|---|---|
| AltScreen 主 viewport 与底部 dock | 自动化通过，待真机观察长流重绘与 resize |
| 鼠标滚轮 | 自动化和真实 PTY 通过，待不同终端/复用器真机验收 |
| 拖选复制 | AltScreen 单测通过，待真机确认 tmux/终端 OSC 52 策略 |
| 键盘 Up/Down/PageUp/PageDown/End | 单测、既有 PTY smoke 通过 |
| 用户滚动后 tail-follow 暂停及新消息通知 | 代码路径和既有测试通过，待真机确认通知可见性 |
| PR #36 目标架构整体迁移 | 未完成；PR #36 本身是文档-only，外部 fixture vertical slice 仍是后续工作 |

## 人工验收

机器测试全部完成后，在真实终端运行独立 profile：

```sh
dsh --profile blue-alt-screen
```

请重点验证：

1. 生成足够长的流式输出后，鼠标滚轮向上/向下每次移动约 3 行，编辑框和 footer 始终在底部。
2. 滚动后继续让模型输出：视口不被抢回底部；出现新消息提示，并可按 `End` 直接回到底部。
3. 在 transcript 上拖选并复制，确认系统剪贴板得到选中文本；在 tmux 中也验证一次。
4. 打开 `/sessions`、`/help`、`/model` 等面板后，滚轮只作用于当前面板；`PageUp/PageDown` 不会滚动错误的 surface。
5. 外部编辑器/暂停恢复后，备用屏、鼠标报告和剪贴板行为仍正常；退出后 transcript 可在主屏 scrollback 中查看。
6. 调整终端宽度和高度，确认没有闪烁、跳回开头、底部 dock 漂移或 `exceeds terminal width`。

在收到明确的真机验收结果前，不删除 `blue-alt-screen` profile，也不宣称可以合并主分支。
