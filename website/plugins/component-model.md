# 组件模型

本页解释 Blue 受控 UI 组件的完整回路：插件如何持有状态、`render()` 产出
什么、事件如何回流、renderer 在编辑与焦点上提供什么。逐字段 API 与截图见
[UI 节点参考](/plugins/ui-reference)；构造器与可复用组件见
[公共 UI Kit](/plugins/ui-kit)。

## 心智模型

Blue 的组件是**受控组件**：真相永远在插件手里。

- 每次 `render()` 返回一棵**全新的、不可变的 wire node 树**，由插件自己
  的 view state 构造。`ui.*` builder 会递归复制并深冻结输入；节点里不
  存在任何可写的 widget handle。
- 没有“拿到组件实例再调 setValue”这种操作。要改变界面，插件改自己的
  状态，然后让 Blue 重新调用 `render()`——事件成功后自动触发，外部数据
  变化则走 pane/overlay handle 的 `refresh()`。
- renderer 负责校验、布局、主题、宽度、焦点、输入路由和事件派发；节点
  不接受 renderer callback、raw key、终端坐标、ANSI 或 focus handle，
  `render()` 里也不要做 I/O。

`examples/ui-gallery` 的 pane 是这种形态的极端：它不持有任何可变状态，
每次 `render()` 都从纯 builder 调用重建同一棵静态树。

## 状态与事件回路

交互节点（tabs/list/form/actions，以及 loader/cancel control）由插件提供
canonical state，renderer 发出“建议的新状态”。回路固定为四步：

1. 插件以当前状态渲染：tabs 的 `activeId`、list 的 `selectedIds`、form
   field 的 `value` 全部来自插件自己的 view state。
2. 用户操作让 renderer 把 `BlueUiEvent` 派发到 contribution/request 上的
   `onEvent()`；事件只描述建议，不修改任何插件状态。
3. 插件校验事件，把接受的值写入自己的状态（并按需调用所属 domain
   service/action），返回 `BlueResult`。
4. handler 成功后 Blue 自动重渲染；失败、abort、timeout、旧 generation
   或卸载后的结果不会提交。

事件载荷（`@dsh-blue/blue-api` 的契约类型）：

```ts
type BlueUiEvent =
  | { kind: 'activate', controlId: string }
  | { kind: 'selection-change' | 'value-change', controlId: string, value: BlueJson }
  | { kind: 'submit', controlId: string, values: BlueJson }
  | { kind: 'tab-change', controlId: string, tabId: string }
  | { kind: 'dismiss' }
```

`value-change` 的 `value` 类型由 field kind 决定：input/textarea/secret 是
`string`，select 是 `string | null`，toggle 是 `boolean`。multiple list 的
`selection-change` 携带切换该 item 后建议的完整 `string[]`；`submit` 的
`values` 按 field id 携带当前 draft 值。

派发顺序：`value-change`、`selection-change`、`tab-change` 按 control id
latest-wins——连续击键只保留最新建议；`activate`、`submit`、`dismiss`
按 surface FIFO。

一个最小闭环（tabs）：

```ts
let activeTab = 'summary'

const render = () => ui.tabs({
  id: 'settings-tabs',
  activeId: activeTab,
  items: [
    { id: 'summary', label: 'Summary' },
    { id: 'advanced', label: 'Advanced' },
  ],
})

const onEvent = (event: BlueUiEvent) => {
  if (event.kind === 'tab-change' && event.controlId === 'settings-tabs') {
    activeTab = event.tabId
  }
  return { ok: true, value: undefined } as const
}
```

外部 projection、service subscription 或 timer 改变状态时，调用
pane/overlay handle 的 `refresh()`。不要在 `onEvent()` 成功路径里手动
refresh——那会把当前事件误判为一次外部替换，并可能 abort 它自己的
generation。

## 编辑态语义

文本输入期间，renderer 在当前 surface generation 内保留编辑 draft，并
持续发出 `value-change`；插件仍应把接受的值写回自己的 view state。重新
创建 surface 或外部 canonical value 改变时，以插件提供的值为准——draft
不会盖过 canonical state。

当前 TUI 的编辑按键语义：

- 文本字段（input/textarea/secret）：第一次 `Enter` 进入编辑态，再次
  `Enter` 确认并回到同一字段的导航态；textarea 用 `Alt+Enter` 插入换行。
- select：第一次 `Enter` 进入以 `‹ value ›` 标识的调整态，`←`/`→` 只
  修改 renderer-local 候选，再次 `Enter` 才发出一次 `value-change`；
  `Esc` 或 `Tab` 取消并恢复进入调整态时的值——未确认的候选不会到达
  插件。
- `↑`/`↓` 仅在调整态之外切换 form field。

## 焦点与上下文提示

TUI 从 canonical control 角色直接推导按键提示，插件不应在 surface
footer 里重复写通用按键教学：

- `Tab`/`Shift-Tab` 按树序切换语义组，并记住每组上次聚焦项。
- `←`/`→` 在 tabs/actions 内移动；`↑`/`↓` 在 list/form 内移动。
- tabs 与 single list 用 `Enter` 激活，multiple list 用 `Space`，action
  用 `Enter` 或 `Space`。
- 待确认的 action 把提示切换为 `Enter confirm · Esc cancel`；text/select
  的编辑态与调整态也会就地切换提示。

提示行只在当前 plugin pane 获得焦点或 capturing overlay 打开时显示；最多
三个语义片段，窄屏先缩成完整按键 token、再整段隐藏，不会截断半条指令。
局部计数、进度、风险和业务状态仍然属于 footer——通用按键教学不属于。

## 约束与生命周期

- **Schema 与配额**：一棵树最多 256 个节点、最大深度 8（根节点深度为
  0）、任一数组最多 200 项、全树字符串合计最多 20,000 个 UTF-16 code
  unit；host admission 只接受普通 object 和 dense array，并移除 ANSI、
  C1 与不安全控制字符。完整规则见
  [公共规则与限额](/plugins/ui-reference#公共规则与限额)。
- **Surface 兼容**：并非所有 surface 都接受交互控件——pane 与 capturing
  overlay 接受完整 `BlueUiNode`，non-capturing overlay 与 status 只允许
  passive 子集；完整对照见
  [Surface 兼容矩阵](/plugins/ui-reference#surface-兼容矩阵)。
- **Capability admission**：渲染 pane/overlay 需要在 manifest 中声明
  `panes`/`overlays` capability；host 可以整体拒绝 `open()`，required
  能力不满足时原子失败，不存在半注册状态。
- **Fiber unload**：每次注册都绑定调用方 Fiber；插件卸载（patch 行删除、
  profile 切换）时所有贡献自动回滚，迟到的事件结果按 generation 拒绝。

## 下一步

- 每个节点的字段、默认值、事件 payload 与截图：
  [UI 节点参考](/plugins/ui-reference)
- `ui` builder 与 `defineBlueComponent()`：[公共 UI Kit](/plugins/ui-kit)
- 可运行的完整插件：[示例目录](/plugins/examples)
