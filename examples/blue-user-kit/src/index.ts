/**
 * Pure component factories shared by multiple Blue ecosystem examples.
 *
 * @module @dsh-blue-example/user-kit
 */
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'

/** Compact label/value row suitable for a pane header or inspector. */
export const summaryMetric = defineBlueComponent<{
  readonly label: string
  readonly value: string
  readonly detail: string
}>({
  id: '@dsh-blue-example/summary-metric',
  api: '^1.0.0-beta.1',
  render: props => ui.surface({
    chrome: 'lane',
    padding: 1,
    child: ui.stack.row([
      ui.richText([
        { text: props.label, tone: 'muted' },
        { text: ` ${props.value}`, tone: 'accent', emphasis: 'strong' },
      ]),
      ui.child(ui.text(props.detail, { tone: 'muted' }), { grow: 1, when: { minWidth: 32 } }),
    ], { gap: 1, align: 'center' }),
  }),
})
