#!/usr/bin/env node
/**
 * The component-shot scenarios: one primary shot per `ui.*` section of
 * website/plugins/ui-reference.md, plus `<id>-<state>` variants that capture
 * the documented states of the same node (tones, wrap, hidden responsive
 * children, pending confirms, edit drafts, validation), plus the two code
 * examples of website/plugins/ui-kit.md (`uikit-builder`, `uikit-component`).
 * Each entry compiles one wire node built with the BUILT
 * `@dsh-blue/blue-ui` builder namespace; `drive` optionally pushes an
 * interactive node into a meaningful visual state through the compiler's
 * focus target (same machinery as core's ui-compiler spec), and `height`
 * constrains the frame through pi-tui's layout engine for scroll viewports.
 *
 * Fidelity contract: every scenario renders the exact code example shown in
 * its ui-reference.md section; doc code and manifest entry move together.
 * Driven states render the same node as the section's example — `drive` only
 * replays the key input a user could produce.
 *
 * @module script/shots/manifest
 */

export const SCENARIOS = [
  {
    id: 'text',
    // Doc example, verbatim.
    title: 'text — semantic wrappable text',
    width: 48,
    build: ui => ui.text('Connection lost', { tone: 'danger' }),
  },
  {
    id: 'text-tones',
    // Same section: one text node per documented tone.
    title: 'text — every documented tone',
    width: 56,
    build: ui => ui.stack.column([
      ui.text('Default body text'),
      ui.text('Muted secondary text', { tone: 'muted' }),
      ui.text('Accent highlight text', { tone: 'accent' }),
      ui.text('Success confirmation text', { tone: 'success' }),
      ui.text('Warning caution text', { tone: 'warning' }),
      ui.text('Danger failure text', { tone: 'danger' }),
    ]),
  },
  {
    id: 'text-wrap',
    // Same section: a long message wraps at the allocated width.
    title: 'text — wrapping at the allocated width',
    width: 48,
    build: ui => ui.text('A long status message wraps at the allocated width instead of clipping, so narrow panes stay readable.', { tone: 'warning' }),
  },
  {
    id: 'richText',
    // Doc example, verbatim.
    title: 'richText — inline tone and emphasis spans',
    width: 64,
    build: ui => ui.richText([
      { text: 'Model ', tone: 'muted' },
      { text: 'deepseek-chat', tone: 'accent', emphasis: 'strong' },
    ]),
  },
  {
    id: 'richText-mix',
    // Same section: tone and emphasis combinations in one wrapped block.
    title: 'richText — tone and emphasis combinations',
    width: 56,
    build: ui => ui.richText([
      { text: 'Rebuild of ', tone: 'muted' },
      { text: 'packages/core', tone: 'accent', emphasis: 'strong' },
      { text: ' failed after ', tone: 'muted' },
      { text: '42s', emphasis: 'strong' },
      { text: ' with 2 errors', tone: 'danger' },
    ]),
  },
  {
    id: 'fields',
    // Doc example, verbatim.
    title: 'fields — compact label/value pairs',
    width: 64,
    build: ui => ui.fields([
      { label: 'Status', value: [{ text: 'Ready', tone: 'success' }] },
      { label: 'Model', value: [{ text: 'deepseek-chat' }] },
    ]),
  },
  {
    id: 'fields-spans',
    // Same section: multi-row fields whose values combine several spans.
    title: 'fields — multi-row with span composition',
    width: 64,
    build: ui => ui.fields([
      { label: 'Session', value: [{ text: 'fix-width-scan', tone: 'accent', emphasis: 'strong' }] },
      { label: 'Branch', value: [{ text: 'p2/' }, { text: 'ui-gallery', tone: 'accent' }] },
      { label: 'Status', value: [{ text: 'Running', tone: 'success' }, { text: ' · 2 panes', tone: 'muted' }] },
      { label: 'Elapsed', value: [{ text: '4m 12s', tone: 'muted' }] },
    ]),
  },
  {
    id: 'code',
    // Doc example, verbatim: a realistic multi-line snippet.
    title: 'code — preformatted block with language hint',
    width: 64,
    build: ui => ui.code([
      'export function estimateTokens(text: string): number {',
      '  // Rough heuristic: four characters per token.',
      '  return Math.ceil(text.length / 4)',
      '}',
    ].join('\n'), { language: 'ts' }),
  },
  {
    id: 'diff',
    // Doc example, verbatim: multi-line before/after with shared context lines.
    title: 'diff — before/after semantic comparison',
    width: 64,
    build: ui => ui.diff(
      ['export function connect() {', '  const retries = 3', '  return open(retries)', '}'].join('\n'),
      ['export function connect() {', '  const retries = 5', '  return open(retries)', '}'].join('\n'),
    ),
  },
  {
    id: 'sections',
    // Doc example, verbatim: one expanded section and one collapsed.
    title: 'sections — titled lightweight bodies, one collapsed',
    width: 64,
    build: ui => ui.sections([
      {
        title: 'Environment',
        body: ui.fields([
          { label: 'Node', value: [{ text: 'v24.15.0' }] },
        ]),
      },
      {
        title: 'Raw transcript',
        body: ui.text('Hidden until expanded.'),
        collapsed: true,
      },
    ]),
  },
  {
    id: 'child',
    // Doc example, verbatim: the `child` is only valid as a stack entry, so the
    // example wraps it in a stack.column with an always-visible sibling. Width
    // 64 satisfies the documented `minWidth: 48` condition.
    title: 'child — sized, responsive stack member',
    width: 64,
    build: ui => ui.stack.column([
      ui.text('Session overview'),
      ui.child(ui.text('Wide-only detail'), { grow: 1, when: { minWidth: 48 } }),
    ]),
  },
  {
    id: 'child-hidden',
    // The same node as `child` at width 40: `minWidth: 48` no longer holds and
    // the detail leaves the tree, as the section documents.
    title: 'child — condition false at narrow width',
    width: 40,
    build: ui => ui.stack.column([
      ui.text('Session overview'),
      ui.child(ui.text('Wide-only detail'), { grow: 1, when: { minWidth: 48 } }),
    ]),
  },
  {
    id: 'stack',
    // Doc example, verbatim: a row inside a column so both directions appear.
    title: 'stack — row and column composition',
    width: 64,
    build: ui => ui.stack.column([
      ui.stack.row([ui.text('left'), ui.text('right')], { gap: 1 }),
      ui.text('below'),
    ]),
  },
  {
    id: 'stack-grow',
    // Same section: `grow` splits the row width in 1:2 proportion.
    title: 'stack — grow proportion split',
    width: 64,
    build: ui => ui.stack.row([
      ui.child(ui.surface({ chrome: 'lane', child: ui.text('grow 1') }), { grow: 1 }),
      ui.child(ui.surface({ chrome: 'lane', child: ui.text('grow 2') }), { grow: 2 }),
    ], { gap: 1 }),
  },
  {
    id: 'surface',
    // Doc example, verbatim: title, subtitle, badges, border chrome, padding,
    // and a footer in one container.
    title: 'surface — titled container with border chrome',
    width: 64,
    build: ui => ui.surface({
      title: 'Settings',
      subtitle: 'Profile blue-dev',
      badges: [{ text: 'alpha', tone: 'accent' }],
      chrome: 'surface',
      padding: 1,
      child: ui.fields([
        { label: 'Model', value: [{ text: 'deepseek-chat' }] },
      ]),
      footer: ui.text('Footer note', { tone: 'muted' }),
    }),
  },
  {
    id: 'surface-lane',
    // Same section: the documented `chrome: 'lane'` variant.
    title: 'surface — lane chrome variant',
    width: 64,
    build: ui => ui.surface({
      title: 'Context',
      chrome: 'lane',
      child: ui.text('Lane chrome body'),
    }),
  },
  {
    id: 'scroll',
    // Doc example, verbatim: sixteen lines inside an eight-row viewport with
    // the documented scrollbar, driven three lines down so the thumb shows
    // (same ScrollView machinery as core's ui-compiler spec).
    title: 'scroll — content exceeding the viewport',
    width: 56,
    height: 8,
    build: ui => ui.scroll(
      ui.stack.column(Array.from({ length: 16 }, (_, index) => ui.text(`log line ${index + 1}`))),
      { scrollbar: true },
    ),
    drive: (focus, frame) => {
      const collect = box => [
        ...(box.scrollView ? [box.scrollView] : []),
        ...box.children.flatMap(collect),
      ]
      const [view] = collect(frame.root)
      view?.scrollBy(3)
    },
  },
  {
    id: 'tabs',
    // Doc example, verbatim: the render() output with the doc's initial
    // activeTab = 'summary'.
    title: 'tabs — controlled active item',
    width: 64,
    build: ui => ui.stack.column([
      ui.tabs({
        id: 'settings-tabs',
        activeId: 'summary',
        items: [
          { id: 'summary', label: 'Summary' },
          { id: 'advanced', label: 'Advanced', count: 4 },
          { id: 'legacy', label: 'Legacy', disabled: true },
        ],
      }),
      ui.text('Summary content'),
    ]),
  },
  {
    id: 'tabs-active',
    // Same node after the plugin accepts tab-change: activeTab = 'advanced',
    // so the strip shows the count badge on the active item and the body
    // switches — exactly what the doc's onEvent example produces.
    title: 'tabs — after accepting tab-change',
    width: 64,
    build: ui => ui.stack.column([
      ui.tabs({
        id: 'settings-tabs',
        activeId: 'advanced',
        items: [
          { id: 'summary', label: 'Summary' },
          { id: 'advanced', label: 'Advanced', count: 4 },
          { id: 'legacy', label: 'Legacy', disabled: true },
        ],
      }),
      ui.text('Advanced content'),
    ]),
  },
  {
    id: 'list',
    // Doc example, verbatim: single mode with the documented `selectedIds`.
    title: 'list — single-mode selection',
    width: 64,
    build: ui => ui.list({
      id: 'item-list',
      selectedIds: ['one'],
      items: [
        { id: 'one', label: 'First item' },
        { id: 'two', label: 'Second item' },
      ],
    }),
  },
  {
    id: 'list-multiple',
    // Doc example, verbatim: multiple mode with the documented group, badge,
    // detail, and disabled item shapes.
    title: 'list — multiple mode with groups and badges',
    width: 64,
    build: ui => ui.list({
      id: 'plugin-list',
      mode: 'multiple',
      selectedIds: ['context'],
      items: [
        { id: 'context', label: 'Context', group: 'Official', badge: 'core' },
        { id: 'remote', label: 'Remote', group: 'Official', detail: 'Session transport' },
        { id: 'lark', label: 'Lark', group: 'Optional', badge: 'notify', disabled: true },
      ],
    }),
  },
  {
    id: 'form',
    // Doc example, verbatim: all five documented field kinds plus submit and
    // cancel controls, in the default state. The secret value renders masked.
    title: 'form — five field kinds with submit control',
    width: 64,
    build: ui => ui.form({
      id: 'profile-form',
      fields: [
        { kind: 'input', id: 'name', label: 'Name', value: 'Ada' },
        { kind: 'textarea', id: 'bio', label: 'Bio', value: 'Compiler tinkerer' },
        { kind: 'secret', id: 'token', label: 'Token', value: 'sk-live-9f27' },
        { kind: 'select', id: 'theme', label: 'Theme', value: 'dark', options: [
          { id: 'dark', label: 'Dark' },
          { id: 'light', label: 'Light' },
        ] },
        { kind: 'toggle', id: 'updates', label: 'Auto-update', value: true },
      ],
      submitActionId: 'Create profile',
      cancelActionId: 'Cancel',
    }),
  },
  {
    id: 'form-editing',
    // Doc example, verbatim; drive replays Enter (enter edit mode) then types
    // 'Ada Lovelace', so the shot shows the draft with the visible cursor.
    title: 'form — text editing with visible cursor',
    width: 64,
    build: ui => ui.form({
      id: 'profile-form',
      fields: [
        { kind: 'input', id: 'name', label: 'Name', value: '' },
        { kind: 'toggle', id: 'updates', label: 'Auto-update', value: true },
      ],
      submitActionId: 'Create profile',
    }),
    drive: focus => {
      focus.handleInput?.('\r')
      focus.handleInput?.('Ada Lovelace')
    },
  },
  {
    id: 'form-select',
    // Doc example, verbatim; drive moves to the select field, enters the
    // documented `‹ value ›` adjustment state with Enter, and steps Right.
    title: 'form — select adjustment state',
    width: 64,
    build: ui => ui.form({
      id: 'profile-form',
      fields: [
        { kind: 'input', id: 'name', label: 'Name', value: 'Ada' },
        { kind: 'select', id: 'theme', label: 'Theme', value: 'dark', options: [
          { id: 'dark', label: 'Dark' },
          { id: 'light', label: 'Light' },
        ] },
      ],
      submitActionId: 'Create profile',
    }),
    drive: focus => {
      focus.handleInput?.('\x1b[B')
      focus.handleInput?.('\r')
      focus.handleInput?.('\x1b[C')
    },
  },
  {
    id: 'form-validation',
    // Doc example, verbatim: the documented `error` and `disabled` field
    // states; the disabled field stays out of focus navigation.
    title: 'form — error and disabled states',
    width: 64,
    build: ui => ui.form({
      id: 'profile-form',
      fields: [
        { kind: 'input', id: 'name', label: 'Name', value: '', error: 'Name is required' },
        { kind: 'input', id: 'email', label: 'Email', value: 'ada@example.com', disabled: true },
      ],
      submitActionId: 'Create profile',
    }),
  },
  {
    id: 'actions',
    // Doc example, verbatim: the three documented intents; the danger item
    // carries a `confirm` prompt.
    title: 'actions — action items with intent',
    width: 64,
    build: ui => ui.actions({
      id: 'session-actions',
      items: [
        { id: 'save', label: 'Save', intent: 'primary' },
        { id: 'archive', label: 'Archive', intent: 'secondary' },
        { id: 'discard', label: 'Discard', intent: 'danger', confirm: 'Discard all changes?' },
      ],
    }),
  },
  {
    id: 'actions-confirm',
    // The same node as `actions`; drive moves to the danger item and presses
    // Enter once, capturing the documented pending-confirmation state.
    title: 'actions — pending confirmation',
    width: 64,
    build: ui => ui.actions({
      id: 'session-actions',
      items: [
        { id: 'save', label: 'Save', intent: 'primary' },
        { id: 'archive', label: 'Archive', intent: 'secondary' },
        { id: 'discard', label: 'Discard', intent: 'danger', confirm: 'Discard all changes?' },
      ],
    }),
    drive: focus => {
      focus.handleInput?.('\x1b[C')
      focus.handleInput?.('\x1b[C')
      focus.handleInput?.('\r')
    },
  },
  {
    id: 'actions-busy',
    // Doc example, verbatim: the documented `busy` in-progress presentation
    // and a `disabled` item; neither can activate.
    title: 'actions — busy and disabled items',
    width: 64,
    build: ui => ui.actions({
      id: 'session-actions',
      items: [
        { id: 'deploy', label: 'Deploy', intent: 'primary', busy: true },
        { id: 'retry', label: 'Retry', disabled: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    }),
  },
  {
    id: 'loader',
    // Doc example, verbatim: the default braille variant with the documented
    // elapsed hint and cancel control.
    title: 'loader — braille indicator with cancel control',
    width: 64,
    build: ui => ui.loader({
      message: 'Waiting for model',
      elapsedMs: 1200,
      cancelActionId: 'Stop',
    }),
  },
  {
    id: 'loader-tide',
    // Same section: the documented `tide` variant.
    title: 'loader — tide variant',
    width: 64,
    build: ui => ui.loader({
      message: 'Syncing marketplace',
      variant: 'tide',
      elapsedMs: 4200,
    }),
  },
  {
    id: 'empty',
    // Doc example, verbatim: no-data state with the documented actions slot.
    title: 'empty — no-data state with actions',
    width: 64,
    build: ui => ui.empty({
      title: 'No sessions yet',
      description: 'Start one to see it here.',
      actions: ui.actions({
        id: 'empty-actions',
        items: [{ id: 'new', label: 'New session', intent: 'primary' }],
      }),
    }),
  },
  {
    id: 'progress',
    // Doc example, verbatim: determinate bar with label and count.
    title: 'progress — determinate bar with label',
    width: 64,
    build: ui => ui.progress({ label: 'Tokens', value: 12_000, max: 28_000 }),
  },
  {
    id: 'spacer',
    // ui.spacer() alone renders only blank rows, so the documented semantic
    // whitespace (default size 1) is shown between two minimal text anchors.
    title: 'spacer — semantic vertical whitespace',
    width: 48,
    build: ui => ui.stack.column([
      ui.text('Above'),
      ui.spacer(),
      ui.text('Below'),
    ]),
  },
  {
    id: 'divider',
    // Doc example, verbatim: a bare divider at the assigned width.
    title: 'divider — semantic separator',
    width: 48,
    build: ui => ui.divider(),
  },
  {
    id: 'uikit-builder',
    // ui-kit.md "Builder" section example, verbatim.
    title: 'ui-kit — builder surface example',
    width: 64,
    build: ui => ui.surface({
      title: 'Context',
      chrome: 'lane',
      child: ui.stack.column([
        ui.progress({ label: 'Tokens', value: 12_000, max: 28_000 }),
        ui.child(ui.text('deepseek-chat', { tone: 'muted' }), {
          when: { minWidth: 32 },
        }),
      ], { gap: 1 }),
    }),
  },
  {
    id: 'uikit-component',
    // ui-kit.md "可复用组件 / Reusable components" defines summaryMetric with
    // props; the shot renders that exact definition through
    // defineBlueComponent with the canonical props its documented consumer
    // (examples/header) passes.
    title: 'ui-kit — defineBlueComponent render result',
    width: 64,
    build: (ui, defineBlueComponent) => defineBlueComponent({
      id: '@acme/summary-metric',
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
    }).render({ label: 'Branch', value: 'main', detail: 'Blue ecosystem example' }),
  },
]
