# @dsh-blue/blue-ui

Blue 公共 UI wire format 的纯 renderer-neutral builder。`ui` namespace 构造与插件
手写对象形状完全一致的深冻结 `BlueUiNode`，覆盖全部内容 leaf、显式 flex/viewport
child、横纵 stack、surface、scroll、controlled pattern、progress、spacer 与 divider。

```ts
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'

export const metric = defineBlueComponent<{ label: string, value: number }>({
  id: '@acme/metric',
  api: '^1.0.0',
  render: props => ui.surface({
    title: props.label,
    child: ui.stack.column([
      ui.child(ui.progress({ value: props.value, max: 100 }), {
        grow: 1,
        when: { minWidth: 40 },
      }),
    ]),
  }),
})
```

`defineBlueComponent` 记录带包 namespace 的 id 与 Blue API range，并深冻结每次
render 的节点。它只是纯 package factory，不是 runtime registry。插件提交展开后的
节点树时，kind、数值、深度、quota 与 renderer 安全仍由 core 验证。

本包重导出 `@dsh-blue/blue-api`，不依赖 Cordis、Harness、frontend state、core、
pi-tui 或任何终端 runtime。
