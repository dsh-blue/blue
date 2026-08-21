# 调研：pi-tui 能力与限制

> **归档说明（2026-08-21，R6b 文档清账）**：本文档为选型调研存档（pi-tui 0.84.2 时点），移入 docs/history/，正文保持归档时点原貌、不做改写。更正：文中"OSC 52 复制随 TuiAltScreen"的关联已被 S26 解连坐（OSC 52 为纯转义输出，与 scrollback/差分渲染无关，已随 /copy 落地）。现状以 [blue-roadmap.md](../blue-roadmap.md)、[blue-seams.md](../blue-seams.md) 为准；索引见 [docs/README.md](../README.md)。

> 调研对象：`@earendil-works/pi-tui@0.84.2`（pi 单仓 `packages/tui`）。本文是 Blue 选型和 L0/L1 设计的依据存档。
> 官方文档：<https://pi.dev/docs/latest/tui>

## 定位

终端 UI 库，"differential rendering for efficient text-based applications"。TypeScript ESM，Node ≥ 22.19。运行时依赖仅 `marked` + `get-east-asian-width`，**不依赖 pi 的其他包**，可完全独立使用。主题以 `(text: string) => string` 函数注入，不绑 chalk。可选 N-API 预编译 addon 仅用于 Apple Terminal/Windows 的 Shift 修饰键检测，加载失败优雅降级。

## 核心抽象

```typescript
interface Component {
  render(width: number): string[]      // 行数组，每行不超宽（超出报错）
  handleInput?(data: string): void     // 有焦点时接收原始终端输入
  invalidate(): void
}
interface TUI extends Component {
  children; addChild/removeChild/clear(); setFocus(component | null)
  showOverlay(component, options?): OverlayHandle; hideOverlay(); hasOverlay()
  start(); stop(); renderNow(force?); requestRender(force?)
  addInputListener(listener): () => void   // 可 consume/改写输入
}
```

- **行流式渲染模型**：组件树从上到下渲染成行数组，无矩形/坐标系。子组件通信靠命令式回调 + `requestRender()`，**不是响应式/虚拟 DOM**。
- **diff 渲染**：主屏三策略（首绘/宽度变化全清/移动首个变化行清到屏底），CSI 2026 synchronized output 包裹无闪烁；重绘节流 16ms，键盘输入走 immediate render 绕过。
- **每行渲染约束**：行末自动追加 SGR/OSC 8 reset，样式不跨行。
- **输入**：原始转义序列逐级传递；`matchesKey(data, "ctrl+shift+p")`；Kitty keyboard protocol（含 release/repeat）协商，失败回退 modifyOtherKeys；SSH 下 ESC 超时自动放宽。单焦点模型。
- **KeybindingsManager**：全局可配置注册表（约 45 个动作），冲突检测，TS declaration merging 扩展。

## 内置组件

Text / TruncatedText / Box / Container / Spacer / Input（单行）/ **Editor**（多行：word wrap、slash 补全、Tab 文件补全、大段粘贴折叠、kill-ring、undo、历史）/ **Markdown**（可注入语法高亮、LaTeX→Unicode、渲染缓存、transform 钩子）/ Loader / CancellableLoader（AbortSignal + Esc）/ **SelectList**（可过滤）/ SettingsList（值循环+子菜单）/ Image（Kitty/iTerm2 图形协议）/ VStack/HStack/ScrollView（**仅 alt-screen**：flex 约束布局、滚轮路由、可拖滚动条、OSC 133 prompt 跳转、内容搜索）。

辅助：`CombinedAutocompleteProvider`、`fuzzyFilter/fuzzyMatch`、OSC 8 hyperlink、宽度工具（visibleWidth/truncateToWidth/wrapTextWithAnsi）。

## 进程模型

- `TuiMainScreen`：主缓冲区、终端自有 scrollback、退出内容留 scrollback。
- `TuiAltScreen`：alternate buffer 全屏；退出恢复主屏并打印最终文档；鼠标（滚轮路由/拖选+OSC 52 复制/链接点击）。
- 两渲染器运行时可互换（同一组件树换 renderer 重挂载），pi 用 Proxy 提供稳定 TUI 引用。
- VirtualTerminal（@xterm/headless）只在 pi 源码 test/ 内，**npm dist 不导出**（→ 决策 D13）。

## pi coding-agent 的使用模式（Blue 的参照系）

- 组合根按设置选渲染器 + Proxy 稳定引用；一棵组件树服务两种渲染器。
- 事件流对接：`session.subscribe(event)` → message_start 新建组件挂容器 / message_update 增量更新 / toolCall 按 callId 维护 pending map / 每个分支末尾 requestRender。
- 消息组件 = Container 子类按 content block 拼子组件（"数据模型 → 组件子树"范式）。
- 弹窗统一 showOverlay + SelectList/SettingsList。
- **反面对照**：全部收在一个 6.5k 行 `InteractiveMode` 上帝类——Blue 选择 Cordis 插件树正是对此的回应（决策 D2）。

## 成熟度与限制

- 成熟度高、活跃开发：bug fix 具体到终端型号/协议边界（tmux/SSH/Windows/CJK/组合 emoji），测试覆盖良好（含 xterm headless 集成）。
- 限制：无响应式状态管理；约束布局仅 alt-screen；无虚拟化 transcript；无通用鼠标点击组件 API；键盘增强依赖 Kitty 协议（老终端梯度降级）；`render()` 行宽超限直接报错；iTerm2 图片在 alt-screen 降级为占位符。
- 最强项：健壮的终端输入解析（Kitty/paste/SSH/CJK/IME）、无闪烁 diff 渲染、Markdown/LaTeX/图片、可复用的 Editor 与 overlay 系统——聊天/agent 类 TUI 几乎开箱即用。
