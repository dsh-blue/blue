# 公共 UI Kit

`@dsh-blue/blue-ui` 是纯 renderer-neutral 构造层。它导出 `ui` builder、
`defineBlueComponent()`，并重导 `@dsh-blue/blue-api` 的 wire types。它没有 Cordis
plugin、capability、host service 或终端依赖。

## Builder

```ts
import { ui } from '@dsh-blue/blue-ui'

const node = ui.surface({
  title: 'Context',
  chrome: 'lane',
  child: ui.stack.column([
    ui.progress({ label: 'Tokens', value: 12_000, max: 28_000 }),
    ui.child(ui.text('deepseek-chat', { tone: 'muted' }), {
      when: { minWidth: 32 },
    }),
  ], { gap: 1 }),
})
```

Builder 的结果与手写 `BlueUiNode` 完全同形，并会递归克隆、深冻结调用方数据。
普通 node 可直接传入 stack；只有 `grow`、`basis`、`minSize`、`when` 等 child
layout metadata 才需要 `ui.child()`。

可用构造器包括内容 leaf（text、rich-text、fields、code、diff、sections）、
stack/surface/scroll、tabs/list/form/actions，以及 loader/empty/progress/spacer/divider。
节点只表达语义，不表达 ANSI、终端列数、focus handle 或 renderer key binding。
每个构造器的字段、默认值、约束、事件 payload 与 surface 兼容性见
[UI 节点参考](/plugins/ui-reference)。

## 可复用组件

用户 kit 是一个普通 npm library，不是插件：

```ts
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'

export const summaryMetric = defineBlueComponent<{
  label: string
  value: string
  detail: string
}>({
  id: '@acme/summary-metric',
  api: '^1.0.0-beta.1',
  render: props => ui.surface({
    chrome: 'lane',
    child: ui.stack.row([
      ui.richText([
        { text: props.label, tone: 'muted' },
        { text: ` ${props.value}`, tone: 'accent', emphasis: 'strong' },
      ]),
      ui.child(ui.text(props.detail, { tone: 'muted' }), {
        grow: 1,
        when: { minWidth: 32 },
      }),
    ], { gap: 1 }),
  }),
})
```

`defineBlueComponent` 只校验组件 id、API range 与 render 函数，然后冻结每次
render 的结果。它不注册自定义 node kind，也不绕过 core 的 schema、quota 与
宽度验证。

kit 的 `package.json` 只需要 peer `@dsh-blue/blue-ui`；不要添加
`blue.plugin.json`、`cordis.patch.yml`、`inject` 或 `apply()`。安装 kit 不会改变
任何 Blue 界面。真正把组件放入 pane/overlay/provider 的消费插件，仍须在自己的
manifest 申请相应 capability，并接受 host 的拒绝、Fiber unload 与配额约束。

仓库中的 `@dsh-blue-example/user-kit` 被 header 与 right-inspector 两个插件共同
消费，见[示例目录](/plugins/examples)。
