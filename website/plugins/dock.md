# Pane 与 Overlay

## Pane

`bluePanes` 支持 `header`、`left`、`right`、`bottom` 四个 placement。

```ts
export const inject = ['bluePanes']

export function apply(ctx: Context): void {
  const pane = ctx.bluePanes.register({
    id: 'acme.inspector',
    title: 'Inspector',
    placement: 'right',
    size: { min: 20, preferred: 30, max: 40 },
    narrow: 'bottom',
    render: () => ({ kind: 'text', content: 'healthy' }),
  })

  // 领域状态变化后调用：
  pane.refresh()
}
```

`narrow` 可设为 `bottom`、`overlay` 或 `hidden`。Handle 另有
`setHidden(boolean)`。

## Overlay

```ts
export const inject = ['commands', 'blueOverlays']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'health',
    description: 'Open health details',
    handler: () => {
      ctx.blueOverlays.close('acme.health')
      ctx.blueOverlays.open({
        id: 'acme.health',
        title: 'Health',
        capturing: true,
        anchor: 'center',
        width: '70%',
        render: () => ({ kind: 'text', content: 'healthy' }),
      })
      return { kind: 'success', text: 'opened health details' }
    },
  })
}
```

Capturing overlay 取得 focus，默认可由 Escape 关闭；只有显式
`dismissible: false` 才禁用。非 capturing overlay 不得包含交互控件。

Pane/overlay id 在 registry 内唯一。Render 与 event callback 产生的数据仍会
经过 core admission。Fiber unload 会移除 pane，并关闭该 Fiber 打开的 overlay。
