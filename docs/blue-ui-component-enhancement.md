# Blue UI API 与组件系统重构方案

> 状态：目标架构与实施蓝图，W0 可行性探针已验收，产品实现尚未开始。本文以
> `master@1d0f01e` 和
> `@earendil-works/pi-tui@0.84.2` 为事实基线。现状描述以代码为准，目标契约以本文为准；
> 实施完成后，公开 API 文档与各包 `AGENTS.md` 接替本文成为运行时真相。
>
> 发布目标：完成本文定义的 UI API、公开 UI Kit、内置组件迁移、插件边界和真实终端验收，
> 是 Blue `0.1.1-rc.1` 的版本标志。该版本不是一次主题换肤，而是 UI 架构切换。

## 1. 目标与边界

本次重构同时解决五类问题：

1. **建立可识别的 Blue 视觉语言。** 默认界面保持单列、安静和工作导向，以“深海工作台”形成差异，而不是复制 Claude Code、Kimi 或 dsh-TUI。
2. **建立公开、可复用、可贡献的 UI Kit。** Blue 官方组件与第三方组件使用同一套 renderer-neutral API；用户可以把组合组件发布为独立 kit 给其他插件复用。
3. **建立真正的布局框架。** Blue 管理外部 surface 位置和资源分配，插件在获配 viewport 内自由组合声明式布局。
4. **建立清晰的插件权限层级。** 普通插件做增量贡献；需要替换 Editor 或 statusline 的插件走用户显式选择的独占 provider。
5. **以迁移完成作为发布门槛。** Blue 自有组件必须使用同一套公开 UI Kit，第三方 fixture、宽度扫描和真实终端 dogfood 必须证明契约可用。

### 1.1 成功标准

- 没有插件时，Blue 仍是当前熟悉的单列会话界面，不因为框架能力而默认变成三栏仪表盘。
- 有插件时，可按需出现 `header`、`left`、`right`、`bottom` 和 `overlay`，卸载后无残留空栏或焦点。
- pane 内可声明横纵布局、滚动、tabs、列表、表单和操作组；插件不接触 pi-tui、ANSI、终端坐标或原始焦点对象。
- Blue 内置命令面板、设置、审批、问卷和计划评审共用 UI Kit，交互状态和窄宽降级一致。
- 用户可以通过 `@dsh-blue/blue-ui` 构建和发布自己的组合组件，消费方式与 Blue 官方组件一致。
- 普通插件不能覆盖 conversation、editor 或 statusline；独占 provider 必须由用户选择、可原子热换、失败可回滚。
- 所有新增渲染路径遵守 D48 宽度契约，并在 CJK、emoji、ANSI 等敌对输入下验证。

### 1.2 非目标

- 不引入 React、Yoga、Ink 或 Web 布局模型。
- 不把 pi-tui 类型暴露给 core 以外的包或第三方插件。
- 不开放任意终端坐标、裸 ANSI/OSC、自定义 RGB 或全局键盘截获。
- 不让插件替换 Harness 的 Agent、Session 或 action 真相。
- 不为展示能力而把 Blue 官方 Todo、Agents、Activity、Queue 强行迁入左右栏。
- 不允许用户 kit 注册新的原始 renderer node kind；用户组件必须展开为 Blue 已知的安全节点。
- 不在本次重构中加入鼠标依赖；滚轮仍由现有 ScrollView 路径消费。

## 2. 当前事实

### 2.1 当前根布局

生产运行时已经使用 pi-tui `TuiAltScreen`。`packages/core/src/terminal.ts` 当前根布局为：

```text
VStack
├─ ScrollView(contentContainer, grow=1)
└─ DockLayoutContainer
   ├─ passive bottom panes
   ├─ editor / replacement panel
   └─ pinned status footer
```

这证明 pi-tui 的 height-aware layout 可以作为重构基础，但当前只有“可滚动内容 + 底部 dock”两条真实 lane。

### 2.2 `left/right` 只是未完成的 seam

W4a-C 已删除内部 placement model 和伪 left/right 分组。当前 `BlueBottomPaneService` 是 package-private、bottom-only composition；每个官方 pane 经 core 的共享 dock allocator 独立挂载。

旧公共 dock contribution 类型和 transcript dock bridge 已在 W6 删除。第三方插件通过 `BluePaneContribution` 明确声明 placement/size/narrow，并由 core canonical surface bridge 托管。

结论：当前 Blue 没有需要兼容的真实侧栏行为。`left/right` 可以在新 surface manager 中重新定义，且 Blue 官方不需要默认使用它们。

### 2.3 当前 `BlueView` 是内容模型，不是布局模型

`BlueView` 目前支持 `text`、`fields`、`code`、`diff`、`sections`。core 的 `plugin-view.ts` 已提供正确的安全边界：

- 剥离 ANSI、OSC 和危险控制字符；
- 只接受语义 tone；
- 限制字符数、递归深度和行数；
- 通过 pi-tui 宽度工具换行、截断；
- 将动态 render 失败收容为一行错误。

这些能力应保留，但 `BlueView` 只能作为新布局树的内容叶子，不能承担 row/column、滚动、焦点和控件事件。

### 2.4 当前 capability 名称与真实能力不一致

当前 manifest 只列有真实契约的 commands、notifications、status、panes、overlays、editor extensions、session 与 provider 能力；旧 `dock/editor/panels/tools` 仅保留为带迁移建议的拒绝诊断。普通动态插件拿不到 `blueScreen`、`blueComponents`、`blueEditorHost` 等 owner 服务。

隔离本身是正确的，问题在于公共形状尚未清理：

- `dock` 只有 bottom 行贡献，且 `minRows/collapsible` 没有完整消费；
- `editor/panels` 名义存在但不可用；
- status 只支持 additive entry，没有全量 provider；
- overlay 是内部 `BlueScreen.showOverlay(BlueComponent)`，不是公共插件 API。

`0.1.1-rc.1` 应利用 rc 阶段清理这些半成品名称，而不是长期固化错误抽象。

## 3. pi-tui 0.84.2 能力与边界

### 3.1 可采用能力

| pi-tui 能力 | 关键行为 | Blue 的采用方式 |
|---|---|---|
| `VStack/HStack` | `basis/grow/shrink/minSize/maxSize`、gap、align、viewport visibility | 只在 core 编译层构建根布局和插件节点树 |
| `ScrollView` | height-aware、follow、overscroll、scrollbar | transcript 保持 primary scroll；pane 内允许受控子 scroll |
| `Box` | padding 与整行背景 | 编译 surface、选中带和紧凑区域背景 |
| `Loader` | 自持 interval、调用 `requestRender()` | 经 Blue adapter 包装并绑定 Fiber/组件生命周期 |
| `SelectList/SettingsList` | 列表、搜索、submenu、截断 hook | 作为 list/settings pattern 的底层适配，不作为公共类型 |
| `showOverlay` | anchor、尺寸、定位、margin、焦点栈 | core 内部使用；公共 API 只暴露收窄后的 overlay spec |
| `Focusable` | 单一全局焦点与 cursor marker | 每个编译后 surface 对 pi-tui 表现为一个复合 Focusable |
| layout frame | 递归布局、裁剪和 ScrollView 几何 | 由 AltScreen 根布局消费 |

### 3.2 Blue 必须自行提供的能力

pi-tui 是布局和渲染引擎，不是插件窗口管理器。它不提供：

- `header/left/right/bottom` 的产品语义；
- 多插件注册、能力授权、重复 ID 和 Fiber 回收；
- 同 lane 竞争、用户 pin、优先级、tabs/overflow；
- 侧栏向 bottom/overlay/hidden 的窄屏降级；
- renderer-neutral 节点协议与公共 UI Kit；
- 表单焦点、事件序列和异步 action 的统一规则；
- Blue 主题、宽度安全、ANSI 清洗和资源配额。

职责分层必须保持：

```text
Plugin / user UI kit
        ↓
Blue capability host
        ↓
Blue surface manager + UI compiler
        ↓
pi-tui Stack / ScrollView / Overlay / controls
        ↓
Terminal
```

### 3.3 已知限制

- 普通 `Component.render(width)` 不知道高度；需要高度的布局必须进入 AltScreen layout tree 或由 Blue 注入明确 viewport。
- pi-tui 只有一个全局焦点；嵌套表单不能依赖 Container 自动路由。Blue 的复合 surface 必须维护 roving focus。
- HStack 在非 layout-frame 路径没有真实高度裁剪。`TuiMainScreen` 兼容模式应线性化 side/header contribution，不承诺完整多栏体验。
- Loader 必须显式 stop；overlay handle 必须随贡献卸载；两者不能留给插件管理。
- `BlueOverlayOptions` 当前没有透传上游的 `row/col/margin`。内部包装应补齐，但公共 API 不照抄全部上游字段。

### 3.4 W0 renderer 探针裁决

- AltScreen 使用一个 layout root 和唯一 primary transcript `ScrollView`；HStack/VStack 的 viewport predicate 足以支持 120/80/40 列重排。
- 一个 surface 对 pi-tui 只表现为一个复合 `Focusable`。复合控件先合成完整行，再用 pi-tui 的可见列工具插入唯一 `CURSOR_MARKER`；marker 不能由 HStack child 直接输出，否则其后的文本会丢失。
- 响应式节点消失前由 Blue 迁移焦点；pi-tui 的 `visible` predicate 不负责 focus reconciliation。
- pi-tui 接受嵌套 `ScrollView`，但内层获得 natural/unbounded height，不能形成有效 viewport；Blue validator 必须拒绝 scroll descendant。
- `TuiMainScreen` 不消费 layout root。兼容模式按文档序编译为线性 VStack，不承诺与 AltScreen 等价的多栏、子滚动或 overlay 几何。

## 4. 视觉系统：“深海工作台”

差异化不能只靠鲸鱼、蓝色或换一个箭头。Blue 的视觉签名由层级、状态和动效共同构成。

### 4.1 默认保持单列

没有插件 surface 时，不出现空 header 或空侧栏：

```text
conversation
optional Blue bottom panes
editor
status
```

启动鲸 banner 仍是 transcript 内容而非固定 header。Todo、Agents、Activity、Queue 保持 bottom，除非真实 dogfood 证明迁移有收益。

### 4.2 颜色与状态

- `primary` 青蓝：当前焦点、可执行目标、链接和 active tab。
- `selectedBg` 深潮背景：只用于**当前聚焦的选择行**，不铺满所有持久选中项。
- `accent` 青绿：信息强调，不与焦点竞争。
- `warning/borderFocus` 琥珀：等待确认、风险操作和计划模式。
- `success/error` 绿/红：终态语义。
- `muted/textMuted` 两级灰：次要内容与 chrome 提示。
- `logoGradient`：只用于 banner、空态或重大状态，不进入日常表单和列表。

保持多色语义能避免界面退化为单一蓝色主题。

### 4.3 空间层级

| 层级 | 表现 | 用途 |
|---|---|---|
| Flow | 无外框，靠 gutter 和段落节奏 | transcript 主流 |
| Lane | 一条标题规则线或共享边界 | header/side/bottom workspace |
| Surface | 轻边框、标题、可选 footer | pane、表单、详情 |
| Overlay | 完整 frame、清晰焦点色 | dialog、picker、临时工作区 |
| Content box | 圆角或 inset | diff、计划正文、代码等被查看对象 |

对话框保持扁平规则线；圆角只用于 Editor 和被查看的内容盒。不能把每个 section 都做成独立 card，也不能嵌套装饰卡片。

### 4.4 统一交互语言

- 聚焦选择行：`→ ` + primary label + selectedBg。
- 持久选中但未聚焦：`✓` 或 control 自身状态，不使用整行背景。
- active tab：`‹ label ›` + primary + bold；非 active 使用 muted。
- 下钻：行尾 `›`；当前值：`← current`；更多内容：`↑/↓` 或计数。
- disabled：textMuted，无指针、无 background、不可获得焦点。
- error：字段下方一行 error，不只改变边框颜色。
- loading：spinner + 动词 + 可选耗时，布局尺寸稳定。

## 5. 公开 Blue UI Kit

### 5.1 包边界

新增 renderer-neutral 发布包 `@dsh-blue/blue-ui`：

```text
@dsh-blue/blue-api
  stable host/capability/result contracts · BlueUiNode wire types
             ↑
@dsh-blue/blue-ui
  re-exported types · pure builders · official patterns · component definition
             ↑
Blue official packages and third-party plugins
             ↓
@dsh-blue/blue-core
  validates and compiles nodes to pi-tui
```

`BlueUiNode`、events 和 contribution wire types 归 `blue-api` 所有，pane/overlay 契约因此可以直接引用节点而不产生包环。`blue-ui` 依赖并重导这些类型，不能依赖 core、pi-tui、Cordis runtime 或 Harness。它的运行时代码仅包含纯构造、冻结和开发期校验 helper，因此官方组件和用户组件不存在两套能力等级。

该包加入 Blue 的统一版本线、package contract、workspace references 和发布 tarball 集；第三方 kit 将它声明为 peer dependency，避免同一插件树装入两份不兼容 node schema。

### 5.2 四层组件系统

```text
L3 Product and ecosystem compositions
   command palette · settings · approval · user-contributed inspectors

L2 Public patterns
   surface · tabs · list · form · actions · empty · loader · progress

L1 Public layout/content primitives
   stack · scroll · text · fields · code · diff · responsive visibility

L0 Core-only pi-tui adapter
   HStack · VStack · ScrollView · Box · Editor · SelectList · Overlay
```

只有 L0 不公开。L1/L2 都由 `@dsh-blue/blue-ui` 导出，L3 可由 Blue 或任何用户包提供。

### 5.3 官方 builders

API 同时提供类型和无副作用 builders：

```ts
import { ui } from '@dsh-blue/blue-ui'

const view = ui.surface({
  title: 'Task inspector',
  child: ui.stack.column([
    ui.tabs({ id: 'view', activeId: 'overview', items: [...] }),
    ui.fields([...]),
    ui.scroll(ui.list({ id: 'files', items: [...] }), { grow: 1 }),
    ui.actions({ items: [...] }),
  ], { gap: 1 }),
})
```

builders 只消除样板并冻结结构，不隐藏 wire shape。用户可以直接写对象；两种方式必须产生相同 node。

### 5.4 用户贡献 UI Kit

用户通过普通 npm 包发布组合组件，而不是向 renderer 注册任意新 `kind`：

```ts
// @acme/blue-observability-kit
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'

export const metricBoard = defineBlueComponent<MetricBoardProps>({
  id: '@acme/metric-board',
  api: '^1.0.0',
  render: props => ui.stack.column([
    ui.progress({ label: props.label, value: props.value, max: props.max }),
    ui.fields(props.metrics),
  ]),
})
```

消费插件显式依赖并调用它：

```ts
import { metricBoard } from '@acme/blue-observability-kit'

const node = metricBoard.render({ label: 'Context', value: 42, max: 100, metrics })
```

`defineBlueComponent` 返回纯 component factory，记录 id/API 范围用于错误定位和 devtools。factory 执行在消费插件的 Fiber 中，输出完整展开为标准 `BlueUiNode`，随后仍经过 host 校验、配额和 core 编译。

发布和消费 UI Kit 不需要额外 capability。真正向屏幕注册 pane/overlay/status 的消费插件仍必须申请对应 capability；kit 本身没有 host、session 或 terminal 权限。

rc.1 不提供全局 runtime component registry，理由是它会引入跨插件加载顺序、版本冲突、卸载悬挂和自定义 renderer 风险。共享通过包依赖完成，行为可重复、可锁版本、可独立测试。

`api` 是独立的公共协议版本，不是 Blue 产品版本；rc.1 保持 `BLUE_API_VERSION = 1.0.0` 和 manifest `schemaVersion = 1`。官方包使用精确 lockstep 产品版本。第三方 kit 将 `@dsh-blue/blue-ui` 声明为 peer；如需限定本次 preview 窗口，使用 `>=0.1.1-rc.1 <0.1.2`，不能把 `^0.1.1-rc.1` 描述成 rc line。

### 5.5 primitives 与 patterns

- `stack(row|column)`：嵌套布局，支持 gap、align 和 child flex size。
- `surface`：title、subtitle、badges、chrome variant、padding 和 footer。
- `scroll`：单轴纵向滚动；嵌套 scroll 默认拒绝。
- `tabs`：active、disabled、count、窄宽折叠和 change event。
- `list`：单/多选、detail、badge、group、filter、empty、window。
- `form`：input、textarea、select、toggle、secret、validation、submit/cancel。
- `actions`：primary/secondary/danger、disabled、busy、确认路径。
- `loader`：braille/tide indicator、message、elapsed、cancel capability。
- `empty`：title、description、最多两个 action；重大空态才使用品牌资产。
- `progress`：value/max、label、紧凑 1/8 block bar。
- `spacer/divider`：受 token 控制，不允许插件手写宽度填充。
- `responsive`：按当前获配 viewport 的宽高声明显示条件，不暴露全局尺寸回调。

`listRow`、`chipRow`、frame 数学等纯字符串 helper 可以存在于 core，但只是 pattern renderer 的私有实现，不能成为主要公共复用 API。

### 5.6 状态矩阵

每个交互 pattern 至少验证：

```text
idle · focused · selected · disabled · loading · error · empty
```

focus、selection 和 active 不能混成一个布尔值。tabs 的 active 是导航状态，list 的 focused 是输入目标，form 的 value 是业务状态，三者必须使用不同视觉信号。

## 6. Surface Manager

### 6.1 根布局

完整能力开启时的目标根树：

```text
VStack
├─ optional HeaderLane
├─ HStack(grow=1, minSize=1)
│  ├─ optional LeftLane
│  ├─ TranscriptScrollView(grow=1, minSize=40, primary=true)
│  └─ optional RightLane
├─ optional BottomLane
├─ EditorSlot
└─ StatusSlot
```

`HeaderLane/LeftLane/RightLane` 默认不创建。只有贡献存在、viewport 足够且用户未隐藏时才进入 layout tree；卸载最后一个贡献后立即移除。

### 6.2 插件可申请位置

| placement | 典型用途 | 默认预算 | 窄屏策略 |
|---|---|---|---|
| `header` | 导航、全局进度、紧凑过滤 | 1 行，硬上限 4 行 | overflow/hidden |
| `left` | 文件、上下文、会话结构 | min 20 / preferred 32 / max 48 列 | bottom |
| `right` | Todo、Agent、检查器、指标 | min 20 / preferred 32 / max 48 列 | bottom |
| `bottom` | 活动、队列、日志、诊断 | auto，lane 不超过剩余高度 1/3 | tabs/hidden |
| `overlay` | form、picker、详情、临时工作区 | center 70%，max 100 列/80% 高 | 自适应收窄 |

数值是 Blue 默认值，不进入主题或插件强制契约。插件提供 min/preferred/max 建议，surface manager 在硬边界内 clamp。

### 6.3 多插件冲突

布局决策优先级：

```text
用户 pin/顺序/可见性
> Blue editor/status 等系统保留区
> 当前 active/focused surface
> 插件 priority（公共范围 0..100）
> contribution id 字典序
```

相同输入必须产生相同布局，不依赖插件加载顺序。

- **header**：紧凑 segment 同行排列，放不下的进入 `+N` overflow；多行 header surface 同时只激活一个。
- **left/right**：每侧默认只有一个 active pane；多个贡献由 Blue 生成 lane tabs，插件不能把 lane 再切成多列。
- **bottom**：在高度预算内分配；无法获得最小高度的贡献进入 bottom tabs/overflow。
- **overlay**：有界栈，最上层 capturing overlay 独占焦点；关闭后恢复上一层或 editor。
- **status**：不是普通 pane lane，走独立 status 规则。

lane tabs 属于 Blue chrome，不属于任何插件。插件内部仍可拥有自己的 tabs。

### 6.4 窄屏降级

每个 side contribution 可声明：

```ts
narrow: 'bottom' | 'overlay' | 'hidden'
```

`overlay` 表示进入可打开的 overlay 入口，不允许 resize 自动弹出并抢焦点。分配算法必须：

1. 先保留 transcript 最小宽度和至少一行高度；
2. 按低优先级开始折叠 side；
3. 重新计算 bottom 高度预算；
4. 无法容纳时停放到 tabs/overflow，而不是递归迁移；
5. 对临界宽高使用 hysteresis，避免 resize 时反复跳动。

### 6.5 用户覆盖

Blue 按 profile 持久化：显示/隐藏、lane、顺序、active pane、pin、用户调整后的 size。插件更新和 priority 不能覆盖这些选择。插件卸载时只删除自己的 surface；若它是 active，则选择同 lane 下一个，不扰动其他 lane。

## 7. 公共声明式节点与事件

### 7.1 原则

- node、event payload 和 snapshot renderer-neutral、readonly、JSON-shaped；`render`、`onEvent`、`AbortSignal` 和 registration handle 是进程内执行边界，不声称可序列化。
- 业务状态由插件持有；focus、edit buffer、scroll 和 pending event 由 Blue surface 持有。
- node 中只引用 control/action id；统一 `onEvent` 是贡献执行边界。
- 普通插件永远拿不到 `BlueComponent`、`BlueScreen`、pi-tui 或 raw key。
- 所有 union 带稳定 `kind`；未知 kind 返回结构化错误，不在渲染帧抛出。

### 7.2 节点草案

```ts
export type BlueUiNode =
  | BlueView
  | BlueRichTextNode
  | BlueStackNode
  | BlueSurfaceNode
  | BlueScrollNode
  | BlueTabsNode
  | BlueListNode
  | BlueFormNode
  | BlueActionsNode
  | BlueLoaderNode
  | BlueEmptyNode
  | BlueProgressNode
  | BlueSpacerNode
  | BlueDividerNode

export interface BlueStackNode {
  readonly kind: 'stack'
  readonly direction: 'row' | 'column'
  readonly gap?: 0 | 1 | 2
  readonly align?: 'stretch' | 'start' | 'center' | 'end'
  readonly children: readonly BlueUiChild[]
}

export interface BlueUiChild {
  readonly node: BlueUiNode
  readonly basis?: number | 'auto'
  readonly grow?: number
  readonly shrink?: number
  readonly minSize?: number
  readonly maxSize?: number
  readonly when?: BlueViewportCondition
}

export interface BlueViewportCondition {
  readonly minWidth?: number
  readonly maxWidth?: number
  readonly minHeight?: number
  readonly maxHeight?: number
}
```

`when` 相对 pane viewport 计算，不允许函数；responsive 只存在于 `BlueUiChild.when`，没有独立 node kind。`editor-control` 不属于 `BlueUiNode`，只存在于递归收窄的 `BlueEditorShellNode` union。数值先校验再 clamp；深度、children 数和总节点数有统一上限。

### 7.3 控件事件

控件是 controlled model。Blue 发事件，插件更新状态并刷新贡献：

```ts
export type BlueUiEvent =
  | { readonly kind: 'activate', readonly controlId: string }
  | { readonly kind: 'selection-change', readonly controlId: string, readonly value: BlueJson }
  | { readonly kind: 'value-change', readonly controlId: string, readonly value: BlueJson }
  | { readonly kind: 'submit', readonly controlId: string, readonly values: BlueJson }
  | { readonly kind: 'tab-change', readonly controlId: string, readonly tabId: string }
  | { readonly kind: 'dismiss' }

export interface BlueUiEventContext {
  readonly surfaceId: string
  readonly signal: AbortSignal
  readonly revision: number
  readonly userGesture?: BlueUserGesture
}
```

事件分两条确定性通道：

- `value-change`、`selection-change` 和 `tab-change` 按 `surfaceId + controlId` latest-wins；新 revision abort 同控件旧 handler。
- `activate`、`submit` 和 `dismiss` 按 surface FIFO 串行；一个 handler 完成或在 30 秒超时后才执行下一项。

handler 不持有 refresh registration。host 只在成功结果仍是当前 revision 时合并一次 refresh；unload abort 当前和排队事件，late completion 不得刷新已销毁 contribution。`BlueUserGesture` 是 host 在明确键盘 action/command dispatch 时签发的一次性 opaque token，只在当前 dispatch 中有效并在首次消费后失效。

## 8. 插件 Surface API

### 8.1 Pane API

rc.1 清理 `dock` 和不可用的 `panels` capability，替换为 `panes`：

```ts
export type BluePanePlacement = 'header' | 'left' | 'right' | 'bottom'

export interface BluePaneContribution {
  readonly id: string
  readonly title?: string
  readonly placement: BluePanePlacement
  readonly priority?: number
  readonly size?: {
    readonly min?: number
    readonly preferred?: number | 'auto'
    readonly max?: number
  }
  readonly narrow?: 'bottom' | 'overlay' | 'hidden'
  readonly render: () => BlueUiNode | null
  readonly onEvent?: (
    event: BlueUiEvent,
    context: BlueUiEventContext,
  ) => Promise<BlueResult> | BlueResult
}

export interface BluePaneRegistration extends BlueRegistration {
  refresh(): BlueResult
  setHidden(hidden: boolean): BlueResult
}
```

注册句柄不暴露 `focus()`，避免后台插件抢焦点。用户通过 Blue lane navigation 聚焦 pane；由明确用户 command 打开的 overlay 可在打开时获得焦点。

### 8.2 Overlay API

`overlays` 是独立 capability，避免普通 pane 自动获得模态权限：

```ts
export interface BlueOverlayRequest {
  readonly id: string
  readonly title?: string
  readonly capturing?: boolean
  readonly dismissible?: boolean
  readonly anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right'
  readonly width?: number | `${number}%`
  readonly minWidth?: number
  readonly maxHeight?: number | `${number}%`
  readonly render: () => BlueUiNode
  readonly onEvent?: BlueUiEventHandler
}

export interface BluePublicOverlayHandle {
  readonly closed: boolean
  refresh(): BlueResult
  close(): void
}
```

- `capturing` 默认 `false`，`dismissible` 默认 `true`。只有 capturing overlay 可获得焦点和包含交互控件；打开时必须消费当前 event/command 的 `BlueUserGesture`。后台通知使用 notifications。
- 每插件最多一个 capturing overlay，整个栈有深度上限。
- 插件不能指定绝对 row/col、负 offset 或越过安全 margin。
- overlay unload/throw/timeout 后恢复前一焦点。

### 8.3 Status 与完整替换

普通 `status` capability 保持 additive，只接受紧凑语义贡献。它不能改变 footer 高度或覆盖其他条目。

需要重写整个 statusline 的插件申请独占 `status.provider`：

```ts
export interface BlueStatusProvider {
  readonly id: string
  render(snapshot: BlueStatusSnapshot): BlueStatusNode
}
```

`BlueStatusNode` 是 `BlueUiNode` 的非交互子集，只允许 text/rich-text/fields/progress、横向或纵向 stack 和响应式隐藏；禁止 form、actions、scroll、overlay 和 editor-control。statusline 不能变成第二个交互面。

- 同时只能激活一个 provider；由用户配置选择，不看 priority。
- provider 可决定 status viewport 内部布局，但高度仍由 Blue 限制为 1–3 行。
- provider 只读 Blue 提供的 snapshot，不能读取 Agent/Session。
- candidate 先按实际 footer child 宽度 dry-render 并通过 1–3 行限制，再原子替换；首次激活或 session 切换失败使用 Blue default，同一 session 的 A → 坏 B 切换保留 A。
- 普通 additive entries 通过 snapshot 的标准字段进入 provider，不能绕过清洗。

W5-A 当前实现以 `blue.statusProvider` 保存期望 id，`blue.default` 为内建
sentinel。缺失或失败 id 不回写；host 的 additive status/provider candidate
各有独立 revision，其他 capability 变化不会重建 status。选中 provider 只收到
冻结的公共 session snapshot、清洗后的可见 additive entries 与 busy 标志；零行、
超三行、校验或运行时失败都不能提交。失败预算归 selected/desired candidate
generation：A -> bad B 时保留的 A 只是 B 选择流程的 LKG surface，其运行失败仍计入
B，而不是 `active.id`。同一 desired generation 在滚动 60 秒内第三次失败后打开无定时器
breaker 并回落 default，成功 dry-render 会清空该 generation 的失败历史。

### 8.4 Editor 扩展与替换

Editor 分为 shell 和 editing engine：

```text
Editor shell
├─ chrome / mode / hint / auxiliary controls
└─ Blue-owned editing engine
   draft · cursor · history · IME · paste · attachments · submit
```

普通 `editor.extensions` 只开放 completion、hint/diagnostic、editor 上下辅助行、结构化 action 和 submit transformer。

独占 `editor.provider` 可重写 shell、布局、模式条和结构化键位映射，但通过特殊 `editor-control` node 嵌入 Blue-owned editing engine，不能接触 raw terminal input。

每个 editor shell 必须恰好包含一个 `editor-control`；Blue 在注册期验证这一不变量。Provider 可在它上下组合公开 UI Kit 节点，但不能复制、隐藏或在多个位置挂载编辑内核。

`BlueEditorSnapshot` 只包含 mode、busy、只读 attachment metadata 和已接纳 extension；不公开 draft 内容、history、cursor 或 IME 状态。它们由 Blue 在热换事务内部 capture/restore。`BlueStatusSnapshot` 只包含公共 `BlueSessionSnapshot | null`、经过清洗的 additive entries 和 busy 状态。

真正替换编辑引擎需要受信 renderer/composition 插件，不属于普通动态插件，也不进入 rc.1 公共 capability。未来只有在存在第二个真实 renderer、包信任和独立 dogfood 方案时才另立契约。

Editor provider 热换必须事务化：

```text
capture draft/history/mode/attachments
→ build and validate candidate
→ suspend input dispatch
→ atomic swap
→ restore state/focus
→ force repaint
→ rollback default on failure
```

多个 editor/status provider 是候选列表，不是竞争贡献。新安装的 provider 永远不能自动接管。

### 8.5 Capability 清理结果

目标 manifest capability：

```text
commands
notifications
status
panes
overlays
editor.extensions
session.read
session.act

exclusive, user-selected:
status.provider
editor.provider
```

`dock`、`panels`、含义不清的 `editor` 和没有公共 registry/owner 的 `tools` 从 rc.1 公共 manifest 删除。`renderer.provider` 不预留空 capability，避免重复“manifest 有、运行时无”的历史。

## 9. Focus、生命周期与安全

### 9.1 复合焦点

一个 pane 编译成一个 `BlueSurfaceComponent implements BlueFocusable`。pi-tui 只看见一个焦点对象；surface 内部维护 control graph：

- Tab/Shift-Tab 移动控件焦点；
- 方向键由 active control 解释；
- Esc 先退出局部编辑，再释放 pane focus；capturing overlay 按 dismissible 关闭；
- lane 切换走 Blue keymap action，不硬编码原始键；
- 失去 focus 后保留 controlled selection，但不绘制 selectedBg 焦点带。

插件只收到语义事件，不收到按键字节。

### 9.2 生命周期

- 所有 registry、timer、subscription、overlay 和 pending event 均绑定 consumer Fiber。
- `refresh()` 合并到节流 render；高频刷新有配额，超限返回 `BLUE_LIMIT_EXCEEDED`。
- theme swap 使 compiler adapter invalidate/rebuild，不要求插件重发业务状态。
- contribution render 抛错只影响自己的 viewport，并显示有界错误 surface。
- provider 构建失败不拆旧 provider；运行时连续失败触发 circuit breaker 并回退默认。

### 9.3 资源限制

rc.1 固定：单 view 20,000 字符、递归深度 8、总节点数 256、单 collection 200 项、每插件 8 个 pane、每插件 1 个 capturing overlay、全局 overlay 栈深度 4、每 contribution 每秒 20 次 refresh（同一 render tick 合并）。provider 在 60 秒内连续 3 次 render/runtime failure 后触发 circuit breaker，回退默认；status provider 的成功 dry-render 重置计数，editor provider 则只有最新 generation 真正提交成功 live frame 后重置，旧 LKG frame 不得清除新 candidate 的失败。side lane 在 transcript 可保留至少 40 列时进入，在可保留至少 44 列时才从窄屏状态恢复，形成 4 列 hysteresis。

插件不能：

- 改变根布局顺序或移动 conversation/editor/status；
- 在其他插件 viewport 中绘制；
- 指定绝对终端坐标或输出 ANSI/OSC；
- 持有 pi-tui Component、TUI、timer 或 focus handle；
- 通过极大 priority 抢占系统区域；
- 未经用户动作主动打开 capturing overlay；
- 用用户 UI Kit 包引入自定义 renderer 或跳过 host validation。

## 10. 内置组件迁移

UI Kit 只有在 Blue 自己使用后才算稳定。迁移顺序按基础依赖进行。

### 10.1 列表与 tabs

统一 slash dropdown、SelectListPanel、BlueSelect、FrontendPanel list、approval、questionnaire、plan review 和 settings list：

- 同一 pointer/selection/focus 状态；
- 同一 detail、badge、scroll window 和 empty state；
- active tab 使用 chip 语法；
- 下拉匹配区间用 accent+bold，描述最多两行；
- 40 列先隐藏 detail，再折叠 tabs，最后 ANSI-safe truncate。

### 10.2 FormPanel

FormPanel 不再自绘独立圆角对话框，而由 `form` pattern + `surface/framePanel` 编译：

- 问题式 label；
- 字段下方 validation；
- footer hint 统一；
- secret/select/toggle 不再各自发明行格式；
- editor cursor、IME 和 submit 继续复用 Blue editor adapter。

### 10.3 对话框家族

Approval、Questionnaire、PlanReview、Help、Info、Settings 使用同一 overlay/surface shell。业务差异只体现在 node tree 和事件：

- Approval 保留数字直选和 feedback editor；
- Questionnaire 保留进度和 Other 输入；
- PlanReview 保留 content box、scroll 和 revise；
- loading 使用统一 loader；
- title/footer/focus/error chrome 不再复制。

### 10.4 Frontend model 收敛

内部 `@dsh-blue/blue-frontend` 的 `View/PanelModel` 与公共 `BlueUiNode/PaneContribution` 不能长期保留两套同义模型；status/dock 的同义 generic model 已在 W4a-C 删除：

- 公共安全类型放 `blue-api/blue-ui`；
- 官方 runtime model 可增加领域事实，但 UI 组合引用公共 node；
- core 只有一个 compiler；
- transcript/interaction 不再各自拥有同义 renderer 分支。

## 11. 布局效果

### 11.1 默认 Blue

```text
Conversation
  user / assistant / tool flow

optional Blue bottom activity
editor
status
```

不出现 header、left 或 right 空壳。

### 11.2 插件扩展后的宽屏

```text
┌─ optional plugin header ────────────────────────────────────────────────┐
├──────────────┬────────────────────────────────────────┬────────────────┤
│ left plugins │ conversation                           │ right plugins  │
│ lane tabs    │ several user/assistant/tool turns      │ lane tabs      │
│ active pane  │ primary ScrollView                     │ active pane    │
├──────────────┴────────────────────────────────────────┴────────────────┤
│ optional bottom plugin/Blue panes with managed height                  │
├────────────────────────────────────────────────────────────────────────┤
│ editor                                                                 │
│ status or selected status.provider                                     │
└────────────────────────────────────────────────────────────────────────┘
```

插件只控制 active pane 内部；lane tabs、外部尺寸和降级由 Blue 控制。

### 11.3 80 列降级

```text
conversation

bottom lane: ‹ Activity › Left: Files  Right: Tasks  +2 ›
editor
status
```

侧栏不会把主会话压成不可读窄列，overlay fallback 也不会自动抢焦点。

## 12. `0.1.1-rc.1` Agent 实施编排

本项目按依赖波次交给 Codex 等代码 Agent 执行，不按传统工程师工期组织。目标是 16–20 个边界明确的 agent task、7 个顺序集成门。当前执行环境一次只运行一个 subagent，由主 Agent 分派、验收和集成；依赖图保留任务边界，但所有任务严格串行。

### 12.1 执行纪律

1. 每个 task 使用独立 worktree 和分支，基于上一集成门已经验收并合入的集成分支；不得让多个 Agent 在同一 checkout 工作。
2. 一个文件在一个波次只归一个 task owner。`package-contract`、版本 spec、bundle patch、共享 fake 和 release docs 明确归集成 owner，其他 Agent 不顺手修改。
3. 公共类型先合入，消费方才开始；后续分支不得复制临时 type，避免集成后出现同名双契约。
4. 每个 task 同时交付实现、测试、所属包 `AGENTS.md`、需要的双语 README 和变更说明，不把文档债留给末期 Agent。
5. 每个用户可见波次在自己的 profile dogfood，并等待真人验收；未验收分支不能成为下一波的共同基线。
6. Agent 不直接发布、修改 dist-tag 或合并 master。集成 owner 负责按顺序合并已验收分支、重跑全量门禁和生成候选 tarball。

每个 task prompt 必须给出：唯一目标、允许修改的路径、禁止修改的路径、依赖 commit、公共接口、必测场景、完成命令和产出报告模板。实现 Agent 不再决定架构。

### 12.2 依赖图

```text
W0 可行性探针（P0 → P1 → P2，只产证据）
 ├─ P0 API wire/type specimen
 ├─ P1 pi-tui layout/focus/resize spike
 └─ P2 新包 pack/install/user-kit spike
                 ↓ G0 决策冻结
W1 blue-api 契约（顺序，单 owner）
                 ↓ G1 类型冻结
W2 基础设施（A → B → C）
 ├─ A blue-ui builders/package
 ├─ B core validator/compiler/focus engine
 └─ C api host registries/capability admission
                 ↓ G2 compiler 集成
W3 运行时（B → A → C）
 ├─ B reusable pattern adapters
 ├─ A surface manager/root layout
 └─ C pane/overlay owner bridges
                 ↓ G3 首个端到端插件
W4a 内置迁移（A → B → C，按包所有权）
 ├─ A core dropdown/frontend renderers
 ├─ B interaction lists/forms/settings
 └─ C transcript dock/status
                 ↓
W4b interaction dialogs（顺序接 W4a-B）
                 ↓ G4 旧组件退出
W5 生态与 provider（顺序）
 ├─ A status.provider
 ├─ B editor.extensions → editor.provider（支线内顺序）
 └─ C 示例插件/用户 kit/开发文档
                 ↓ G5 公共 API 验收
W6 清理、版本、打包、真人验收（顺序）
                 ↓ G6 发布 0.1.1-rc.1
```

### 12.3 W0：可行性探针

三个探针按 P0 → P1 → P2 顺序运行，产物不直接进入产品：

| Task | 研究目标 | 必须回答的问题 | 产出 |
|---|---|---|---|
| P0 | 用 TS specimen 表达 node/events/panes/providers | controlled state、event revision、status 子集是否无环 | 决策记录 + 编译 fixture |
| P1 | 最小 HStack/VStack/ScrollView + 复合焦点 | 120→40 列降级、嵌套 scroll、IME cursor 是否可控 | VT 录制 + spike test |
| P2 | 最小 `blue-ui` tarball + 外部 kit + 消费插件 | peer 版本、exports、ATTW、独立 npm 安装是否成立 | api/ui/kit/consumer 四个临时 tarball 的报告 |

**G0 验收：**P0 `b64d42a` 的 TypeScript/revision specimen、P1 `6540d47` 的 9 项 pi-tui probe 和 P2 `19231a6` 的四级 tarball/install probe 已由集成 owner 独立复跑。上述 probe 分支只作为证据归档，不合入产品；本文已经吸收最终接口和 renderer/package 裁决。

### 12.4 W1：契约冻结

单一 Agent 只修改 `packages/api` 及其测试，建立 `BlueUiNode`、事件、pane/overlay/status/editor provider wire types、capability 和错误分类。此波不实现 renderer，不新增 `blue-ui` 包。

**G1 验收：**

- `blue-api` 不依赖 `blue-ui/core/pi-tui/Harness`；依赖图无环。
- 全部 union 有 compile-time exhaustive test 和非法 manifest runtime test。
- 一个只依赖 `blue-api` 的外部 TS fixture 能声明完整 pane。
- 旧 capability 的迁移结果有明确错误，而不是静默忽略。
- API review 冻结字段名称；G1 后的 breaking change 必须退回本门重新验收。

### 12.5 W2：基础设施顺序波

G1 合入后按 A → B → C 启动三个独立 worktree；前一个完成并由主 Agent 验收后才启动下一个：

| Owner | 允许范围 | 产出目标 | 不得触碰 |
|---|---|---|---|
| W2-A | 新 `packages/ui` | builders、`defineBlueComponent`、freeze、官方 composition helpers | core renderer、host registries、package contract |
| W2-B | `packages/core/src/ui-*` 新模块及 core tests | validator、sanitizer、compiler、复合 focus、错误 surface | terminal 根布局、api types |
| W2-C | `packages/api/src/host.ts`、manifest admission 及 API tests | panes/overlays/provider registry、readiness、配额、Fiber disposal | core、transcript、interaction |

集成顺序固定为 A → B → C；每次集成后后续 worktree 基于最新集成 commit 创建并重跑自己的门禁。package contract、根 references 和 lockfile 由集成 owner 在 A 交付后统一接入，避免 package 数量和发布顺序出现第二 owner。

**G2 验收：**builders 与手写 wire node 深相等；所有 node kind 可编译或返回结构化拒绝；恶意深树/ANSI/超限输入被收容；每个新增源文件 100% coverage；`build/check:lib/check:pack` 包含新 UI 包；外部 kit tarball 能独立安装。

### 12.6 W3：运行时顺序波

- **W3-A Surface Manager：**独占 `terminal.ts/screen.ts` 和新的 lane 模块，实现可选 header、真实 left/right HStack、bottom budget、用户布局 state、tabs/overflow、fallback 和 hysteresis。
- **W3-B Patterns：**独占新的 core pattern adapter 与 `packages/ui` pattern builders，实现 surface/tabs/list/form/actions/loader/empty/progress 的状态矩阵。
- **W3-C Bridges：**独占 API owner bridge 与模型适配，打通 pane/overlay contribution、refresh/event/abort/unload。

三支都不得迁移现有业务组件。G2 compiler 是唯一渲染入口，禁止为赶进度直接传 `BlueComponent`。

合并顺序固定为 W3-B → W3-A → W3-C：先让 pattern adapter 可用，再切根布局，最后接公共 contribution，避免 bridge 在半成品 surface 上形成临时旁路。

**G3 验收：**

- 无贡献时的默认 frame 与现有单列行为等价，无空 header/side lane。
- 两个插件竞争同一 right lane 时出现 Blue-owned tabs，卸载 active 插件能稳定切换。
- 120 列真实三栏；80/40 列按策略进入 bottom/overflow；至少保留 40 列或实际全宽 transcript。
- overlay 的 focus、dismiss、stack restore、late event 和 unload 全绿。
- VT 断言 editor/status 固定，primary transcript scroll 不被 pane scroll 劫持。
- `smoke:happy` 无 overflow，`smoke:pty` 的 raw key 路径正常。

G3 是第一个必须真人 live-test 的门；通过后 surface API 才允许迁移官方组件。

### 12.7 W4：内置组件迁移

W4a 三个 worktree 按 A → B → C 严格串行，并保持包所有权：

- **W4a-A Core：**WrappingSelectList、frontend renderer、公共 chrome 私有化；不修改 interaction。
- **W4a-B Interaction：**SelectListPanel、BlueSelect、FormPanel、settings；它独占 interaction 的 `fakes.ts` 和 `width-scan.spec.ts`。
- **W4a-C Transcript：**canonical status nodes、package-private bottom panes 和官方 renderer adapters；保持默认底部位置，不把官方 pane 迁入 side。

W4b 在 W4a-B 合入后由一个 Agent 迁移 Approval、Questionnaire、PlanReview、Help、Info 和 loading。这样避免两个 Agent 同时改 interaction 共享 editor/fake/width fixture。

**G4 验收：**

- 官方组件通过 `@dsh-blue/blue-ui` builders 或同一 wire type 构建，不再维护同义 renderer model。
- `rg` drift guard 禁止业务包新增指针、边框填充和本地宽度数学。
- 列表/form/dialog 的完整状态矩阵和 120→2 列 width-scan 全绿。
- 现有键位、数字直选、Other、revise、settings 两级导航和 Editor slot 行为无回归。
- 删除已替代组件和兼容 facade；coverage 不靠 ignore 掩盖新路径。
- 默认单列 profile 真人对比验收，视觉变化有截图/PTY 记录。

### 12.8 W5：生态与 provider

G4 后按 Status → Editor extensions → Editor provider → Ecosystem 顺序执行：

- **W5-A Status（实现已落地，待工作树门禁与真人验收）：**已实现 additive status snapshot、inert provider candidate、持久化用户选择、实际宽度 dry-render、原子替换、同会话 last-known-good、跨会话 default fallback 与 3/60s 无定时器 breaker。
- **W5-B Editor：**先交付并验收 extensions，再在下一 task 实现 shell provider；保存 draft/history/mode/attachments，恰好一个 editor-control，失败回退默认。两个 task 不并行。
- **W5-C Ecosystem：**在示例目录提供 header、right inspector、bottom log、overlay、custom status、custom editor shell；另建一个用户 kit，由至少两个示例插件共同依赖。同步中英插件开发文档和迁移指南。

**G5 验收：**

- 多个 provider 只是候选，安装和 priority 不会自动接管；只有用户选择改变 active provider。
- Editor shell 切换前后 draft、history、mode、attachments、focus 和 IME marker 保持。
- candidate 构建失败不拆旧 provider；运行时失败触发回退；unload 无悬挂 input/timer。
- 六类示例从打包 tarball 在独立 npm 项目安装，不借 workspace link。
- 用户 kit 不需要 capability，消费插件仍按 pane/overlay 权限被 host 拒绝或接纳。
- API quickstart 不导入 repo internal、core 或 pi-tui。

### 12.9 W6：顺序发布波

W6 不并行，按以下顺序执行：

1. 删除旧 `dock/panels/editor/tools` capability transition、兼容类型、死 bridge 和当前态旧文档；保留四个旧名的可操作迁移诊断。
2. 将 frontend/transcript/tool/context/openpencil 消费者全部迁到 canonical `BlueUiNode`，删除 core 的临时 `frontend-renderer` 和 source-plane 兼容入口。
3. 将 session seam 拆为只读 `session.read` 与写入 `session.act`：app 是唯一真实 owner，read-only/act-only facade 隔离，并覆盖 snapshot revision/freeze、FIFO、abort、owner unload、session stale/late fencing。
4. 收口 bundle rows、packed fixtures、双语文档；将 11 包 release set、`BLUE_VERSION`、网站中英文、CLI pin 与 version specs 统一到 `0.1.1-rc.1`。
5. 运行完整 release gates，并在统一 worktree profile dogfood 默认单列、120 列多插件、80/40 列降级、provider swap、theme swap、session switch。
6. 邀请用户 live-test；等待明确“验收通过”，此前不合并、不删除 profile、不发布。验收后再合并 master、重建主 checkout，并由 release workflow 生成和复用同一候选 artifact。

**G6 验收：**所有自动门禁、dogfood 日志、真人验收和 registry install smoke 完整；七类示例场景有结果；发布 tarball 不含 workspace protocol、缺失 subpath 或未声明依赖。

### 12.10 Agent task 交付模板

每个实现 Agent 必须返回：

```text
branch/worktree
dependency commit
files changed and ownership exceptions
public API added/changed
tests added and exact commands/results
coverage result for every changed source file
dogfood profile/scenarios/results（用户可见 task）
AGENTS/README updates
known risks or deliberately deferred work
commit id
```

集成 owner 在合并前检查 diff 范围、独立复跑结果和用户验收，不以子 Agent 的“完成”声明代替门禁。

### 12.11 最终产出目标

- 新发布包 `@dsh-blue/blue-ui@0.1.1-rc.1`，官方与用户 kit 共用 builders/patterns。
- `blue-api` 中稳定、无环、实际有 owner 的 nodes/events/panes/overlays/status/editor 契约。
- core 中唯一 node compiler、surface manager 和复合 focus engine。
- 默认单列保持简洁，插件可用 header/left/right/bottom/overlay，冲突与窄屏行为确定。
- Blue 内置列表、表单、tabs、对话框和 provider 全部迁移，无双轨 UI model。
- 可独立安装的示例插件、共享用户 kit、中英开发文档和旧 API 迁移指南。
- 一组经过完整 gate、真实终端验收和 registry smoke 的 rc.1 发布 tarball。

## 13. 测试与验收矩阵

| 维度 | 必测场景 |
|---|---|
| UI Kit | 官方 builder、手写 node、用户 component factory、跨插件消费、版本不兼容 |
| Layout | 无贡献、单 lane、四 lane、多插件同 lane、resize、fallback hysteresis |
| Focus | editor→lane→control→overlay→恢复；卸载 active pane；不可 dismiss overlay |
| Events | 串行、abort、late result、refresh throttle、handler throw、revision stale |
| Provider | 多候选不抢占、用户切换、candidate failure、runtime failure rollback |
| Security | ANSI/OSC、控制字符、深树、大数组、重复 ID、未授权 capability、自定义 kind |
| Width | 120/80/60/40/20/10/5/3/2，CJK、emoji ZWJ、OSC8、tab、长路径 |
| Height | 10/20/40 行、header cap、bottom 1/3 cap、至少一行 transcript |
| Lifecycle | consumer unload、owner bridge reload、theme swap、session switch、screen stop |
| Packaging | declarations、exports/files/tsdown 三角、独立 kit/plugin tarball、旧 capability 报错 |

## 14. 决策摘要

1. Blue 默认保持单列；header/left/right 是插件能力，不是默认产品布局。
2. pi-tui 提供布局原语，Blue 提供 surface manager、UI compiler 和冲突政策。
3. 插件在 viewport 内高度自由，在 viewport 外严格托管。
4. 多插件同 lane 由 Blue tabs/overflow 协调，用户选择高于插件 priority。
5. `@dsh-blue/blue-ui` 同时服务官方与第三方；用户通过纯 component factory 发布自己的 kit。
6. 用户 kit 只能组合标准节点，不能注册 renderer、ANSI 或新原始 kind。
7. 普通插件只做 additive contribution；完整 statusline 和 Editor shell 由独占 provider 提供。
8. editing engine 和 renderer 替换属于更高信任层级，不能伪装成普通 UI 插件。
9. `BlueView` 保留为安全内容叶子；`BlueUiNode` 承担布局和交互。
10. `dock/panels/editor/tools` 半成品或无 owner capability 在 rc.1 清理，不固化错误兼容层。
11. Blue 内置组件全部迁移并通过真实终端验收，才允许宣称 API 稳定。
12. 上述全部完成是 `0.1.1-rc.1` 的发布标志。

## 15. 参考来源

- pi-tui 官方文档：<https://pi.dev/docs/latest/tui>
- pi-tui 0.84.2 `dist/tui.d.ts`、`components/stack.d.ts`、`h-stack.d.ts`、`v-stack.d.ts`、`scroll-view.d.ts`、`loader.d.ts`
- Blue 当前根布局：`packages/core/src/terminal.ts`
- Blue 当前公共视图编译器：`packages/core/src/plugin-view.ts`
- Blue 当前公共契约与 host：`packages/api/src/contracts.ts`、`host.ts`、`manifest.ts`
- Blue 当前 internal bottom-pane/status owner：`packages/transcript/src/dock-model.ts`、`plugin-host-bridge.ts`、`status-model.ts`；公共 pane/overlay bridge 位于 core
- Blue 架构与 seam：`docs/blue-frontend-architecture.md`、`docs/blue-seams.md`
- 视觉历史与竞品调研：`docs/history/blue-p2-visual-design.md`、`docs/history/blue-survey-pi-tui.md`
