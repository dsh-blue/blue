#!/usr/bin/env node
/**
 * The component-shot scenarios: one per `ui.*` section of
 * website/plugins/ui-reference.md, plus the two code examples of
 * website/plugins/ui-kit.md (`uikit-builder`, `uikit-component`). Each entry
 * compiles one wire node built
 * with the BUILT `@dsh-blue/blue-ui` builder namespace; `drive` optionally
 * pushes an interactive node into a meaningful visual state through the
 * compiler's focus target (same machinery as core's ui-compiler spec).
 *
 * Fidelity contract: every scenario renders the exact code example shown in
 * its ui-reference.md section. Sections with a complete example replicate it
 * 1:1; sections whose doc shows only the signature are completed minimally
 * (no invented demo content); examples that cannot stand alone (`child`,
 * `spacer`) get the minimal wrapper noted on the entry.
 *
 * @module script/shots/manifest
 */

export const SCENARIOS = [
  {
    id: 'text',
    // Doc example, verbatim.
    title: 'text — semantic wrappable text',
    width: 64,
    build: ui => ui.text('Connection lost', { tone: 'danger' }),
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
    id: 'code',
    // The doc shows only the signature; completed with a minimal ts snippet.
    title: 'code — preformatted block with language hint',
    width: 64,
    build: ui => ui.code('const answer = 42', { language: 'ts' }),
  },
  {
    id: 'diff',
    // The doc shows only the signature; completed with a minimal before/after.
    title: 'diff — before/after semantic comparison',
    width: 64,
    build: ui => ui.diff(
      'const answer = 41',
      'const answer = 42',
    ),
  },
  {
    id: 'sections',
    // The doc shows only the signature; completed minimally. The second
    // section exercises the documented `collapsed: true` presentation.
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
    // Doc example: ui.child(ui.text('Wide-only detail'), { grow: 1, when: { minWidth: 48 } }).
    // A `child` node is only valid as a stack entry, so the scenario wraps it
    // in the minimal stack.column and renders at width 64, where the
    // documented `minWidth: 48` condition is true.
    title: 'child — sized, responsive stack member',
    width: 64,
    build: ui => ui.stack.column([
      ui.child(ui.text('Wide-only detail'), {
        grow: 1,
        when: { minWidth: 48 },
      }),
    ]),
  },
  {
    id: 'stack',
    // The doc shows only the signature; completed with a minimal row inside a
    // column so both documented directions appear.
    title: 'stack — row and column composition',
    width: 64,
    build: ui => ui.stack.column([
      ui.stack.row([ui.text('left'), ui.text('right')], { gap: 1 }),
      ui.text('below'),
    ]),
  },
  {
    id: 'surface',
    // The doc shows only the signature; completed minimally with the
    // documented `chrome: 'surface'` border so the container is visible.
    title: 'surface — titled container with border chrome',
    width: 64,
    build: ui => ui.surface({
      title: 'Settings',
      chrome: 'surface',
      padding: 1,
      child: ui.text('Surface body'),
    }),
  },
  {
    id: 'scroll',
    // The doc shows only the signature; completed with minimal content.
    title: 'scroll — scrollable content',
    width: 64,
    build: ui => ui.scroll(
      ui.stack.column([
        ui.text('First line'),
        ui.text('Second line'),
        ui.text('Third line'),
      ]),
    ),
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
          { id: 'advanced', label: 'Advanced' },
        ],
      }),
      ui.text('Summary content'),
    ]),
  },
  {
    id: 'list',
    // The doc shows only the signature; completed with minimal items and the
    // documented single-mode `selectedIds` state.
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
    id: 'form',
    // The doc shows only the signature; completed with one minimal input
    // field plus the documented `submitActionId` control, in its default
    // state (no invented interaction).
    title: 'form — input field with submit control',
    width: 64,
    build: ui => ui.form({
      id: 'profile-form',
      fields: [
        { kind: 'input', id: 'name', label: 'Name', value: '' },
      ],
      submitActionId: 'Create profile',
    }),
  },
  {
    id: 'actions',
    // The doc shows only the signature; completed with two minimal items in
    // the default state (no invented interaction).
    title: 'actions — action items with intent',
    width: 64,
    build: ui => ui.actions({
      id: 'session-actions',
      items: [
        { id: 'save', label: 'Save', intent: 'primary' },
        { id: 'cancel', label: 'Cancel' },
      ],
    }),
  },
  {
    id: 'loader',
    // The doc shows only the signature; completed with a minimal message
    // (variant defaults to the documented 'braille').
    title: 'loader — braille indicator',
    width: 64,
    build: ui => ui.loader({
      message: 'Loading',
    }),
  },
  {
    id: 'empty',
    // The doc shows only the signature; completed with a minimal
    // title/description no-data state.
    title: 'empty — no-data state',
    width: 64,
    build: ui => ui.empty({
      title: 'No results',
      description: 'Try a different query.',
    }),
  },
  {
    id: 'progress',
    // The doc shows only the signature; completed with minimal value/max.
    title: 'progress — determinate bar',
    width: 64,
    build: ui => ui.progress({ value: 7, max: 10 }),
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
    }).render({ label: 'Branch', value: 'main', detail: 'Blue ecosystem example' }),
  },
]
