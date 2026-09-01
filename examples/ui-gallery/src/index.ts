/**
 * Opt-in renderer-neutral UI gallery showcasing the public ui builders.
 *
 * @module @dsh-blue-example/ui-gallery
 */
import type { Context } from '@deepseek-ai/cordis'
// Pull in the direct Blue pane service Context merge.
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const name = '@dsh-blue-example/ui-gallery'
export const inject = ['bluePanes']

/** Content demos: text, rich text, fields, code, diff, and sections. */
function contentGroup() {
  return [
    ui.divider({ label: 'Content' }),
    ui.text('Plain text wraps in the theme body tone.'),
    ui.text('中文示例：文本宽度按真实列宽计算。', { tone: 'muted' }),
    ui.richText([
      { text: 'Rich text ', tone: 'muted' },
      { text: 'mixes', emphasis: 'strong' },
      { text: ' tones', tone: 'accent' },
    ]),
    ui.fields([
      { label: 'Status', value: [{ text: 'Ready', tone: 'success' }] },
      { label: 'Model', value: [{ text: 'deepseek-chat', tone: 'accent' }] },
      { label: 'Mode', value: [{ text: 'plan', tone: 'warning' }] },
    ]),
    ui.code('const answer = 42\nconsole.log(answer)', { language: 'ts' }),
    ui.diff('export const mode = "plan"', 'export const mode = "normal"'),
    ui.sections([
      { title: 'Expanded section', body: ui.text('Section bodies stay lightweight BlueView content.') },
      { title: 'Collapsed section', body: ui.text('Hidden while collapsed.'), collapsed: true },
    ]),
  ]
}

/** Layout demos: stacks, responsive child hints, surfaces, and rhythm nodes. */
function layoutGroup() {
  return [
    ui.divider({ label: 'Layout' }),
    ui.stack.row([
      ui.text('start'),
      ui.child(ui.text('grow', { tone: 'accent' }), { grow: 1 }),
      ui.child(ui.text('wide only', { tone: 'muted' }), { when: { minWidth: 48 } }),
    ], { gap: 1 }),
    ui.surface({
      chrome: 'surface',
      padding: 1,
      title: 'Nested surface',
      subtitle: 'chrome, badges, footer',
      badges: [{ text: 'demo', tone: 'accent' }],
      child: ui.text('A surface groups title, badges, body, and footer.'),
      footer: ui.text('Footer node', { tone: 'muted' }),
    }),
    ui.spacer({ size: 1 }),
    ui.text('A spacer above and a divider below mark semantic rhythm.', { tone: 'muted' }),
    ui.divider(),
  ]
}

/** Pattern demos: list, form, progress, loader, empty, and actions. */
function patternsGroup() {
  return [
    ui.divider({ label: 'Patterns' }),
    ui.list({
      id: 'gallery-list',
      selectedIds: ['build'],
      items: [
        { id: 'build', label: 'Build project', detail: 'pnpm run build', badge: 'done', group: 'Tasks' },
        { id: 'test', label: '运行测试', detail: 'vitest run', group: 'Tasks' },
        { id: 'deploy', label: 'Deploy', detail: 'disabled sample', group: 'Tasks', disabled: true },
      ],
    }),
    ui.form({
      id: 'gallery-form',
      fields: [
        { kind: 'input', id: 'gallery-form-name', label: 'Name', value: 'blue-gallery', placeholder: 'project name' },
        {
          kind: 'select', id: 'gallery-form-theme', label: 'Theme', value: 'dark',
          options: [
            { id: 'dark', label: 'Dark' },
            { id: 'light', label: 'Light' },
          ],
        },
        { kind: 'toggle', id: 'gallery-form-vim', label: 'Vim bindings', value: false },
      ],
      submitActionId: 'gallery-form-submit',
      cancelActionId: 'gallery-form-cancel',
    }),
    ui.progress({ label: 'Progress', value: 3, max: 5 }),
    ui.loader({ message: 'Loading gallery', variant: 'tide', elapsedMs: 1200 }),
    ui.empty({
      title: 'No results',
      description: 'An empty state can offer follow-up actions.',
      actions: ui.actions({
        id: 'gallery-empty-actions',
        items: [{ id: 'gallery-empty-retry', label: 'Retry', intent: 'primary' }],
      }),
    }),
    ui.actions({
      id: 'gallery-actions',
      items: [
        { id: 'gallery-apply', label: 'Apply', intent: 'primary' },
        { id: 'gallery-refresh', label: 'Refresh', intent: 'secondary', busy: true },
        { id: 'gallery-reset', label: 'Reset', intent: 'danger', confirm: 'Reset the gallery demo?' },
      ],
    }),
  ]
}

/** Build a fresh static gallery tree; the pane owns no mutable state. */
function renderGallery() {
  return ui.surface({
    chrome: 'lane',
    padding: 1,
    title: 'UI Gallery',
    subtitle: 'Public blue-ui builders',
    badges: [{ text: 'static', tone: 'muted' }],
    child: ui.stack.column([
      ui.tabs({
        id: 'gallery-tabs',
        activeId: 'content',
        items: [
          { id: 'content', label: 'Content' },
          { id: 'layout', label: 'Layout' },
          { id: 'patterns', label: 'Patterns' },
        ],
      }),
      ui.scroll(ui.stack.column([
        ...contentGroup(),
        ...layoutGroup(),
        ...patternsGroup(),
      ], { gap: 1 }), { scrollbar: true }),
    ], { gap: 1 }),
  })
}

/** Register the gallery pane; a right lane that degrades to bottom when narrow. */
export function apply(ctx: Context): void {
  ctx.bluePanes.register({
    id: 'example.ui-gallery.showcase',
    title: 'UI Gallery',
    placement: 'right',
    size: { min: 24, preferred: 36, max: 48 },
    narrow: 'bottom',
    render: () => renderGallery(),
  })
}
