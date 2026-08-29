import { defineBlueComponent, ui, type BlueUiChild, type BlueUiNode } from '@dsh-blue/blue-ui'

interface MetricProps { readonly label: string, readonly value: number }

export const metric = defineBlueComponent<MetricProps>({
  id: '@acme/metric',
  api: '^1.0.0-beta.1',
  render: props => ui.stack.column([
    ui.progress({ label: 'Direct node', value: props.value, max: 100 }),
    ui.child(ui.progress({ label: props.label, value: props.value, max: 100 }), {
      grow: 1,
      basis: 'auto',
      when: { minWidth: 40 },
    }),
  ], { gap: 1 }),
})

export const node: BlueUiNode = metric.render({ label: 'Context', value: 42 })
export const child: BlueUiChild = ui.child(node, { shrink: 1 })

// @ts-expect-error flex properties belong to ui.child, not scroll options
ui.scroll(node, { grow: 1 })
// @ts-expect-error flex properties cannot be attached directly to a node
ui.stack.row([{ kind: 'text', content: 'bad', grow: 1 }])
// @ts-expect-error component props are preserved by the factory
metric.render({ label: 'Context' })
// @ts-expect-error user kits cannot introduce a new node kind through the type contract
defineBlueComponent({ id: '@acme/invalid', api: '^1.0.0-beta.1', render: () => ({ kind: 'custom' }) })
