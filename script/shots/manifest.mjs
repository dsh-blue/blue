#!/usr/bin/env node
/**
 * The 19 component-shot scenarios, one per `ui.*` section of
 * website/plugins/ui-reference.md. Each entry compiles one wire node built
 * with the BUILT `@dsh-blue/blue-ui` builder namespace; `drive` optionally
 * pushes an interactive node into a meaningful visual state through the
 * compiler's focus target (same machinery as core's ui-compiler spec).
 *
 * @module script/shots/manifest
 */

export const SCENARIOS = [
  {
    id: 'text',
    title: 'text — semantic wrappable text',
    width: 64,
    build: ui => ui.stack.column([
      ui.text('The session resumed cleanly and every queued tool call replayed in order.'),
      ui.text('界面文本示例：终端里的中文照常换行。', { tone: 'muted' }),
      ui.text('Connection lost', { tone: 'danger' }),
    ]),
  },
  {
    id: 'richText',
    title: 'richText — inline tone and emphasis spans',
    width: 64,
    build: ui => ui.richText([
      { text: 'Model ', tone: 'muted' },
      { text: 'deepseek-chat', tone: 'accent', emphasis: 'strong' },
      { text: ' · context ', tone: 'muted' },
      { text: '82%', tone: 'warning', emphasis: 'strong' },
      { text: ' — consider /compact', tone: 'muted' },
    ]),
  },
  {
    id: 'fields',
    title: 'fields — compact label/value pairs',
    width: 64,
    build: ui => ui.fields([
      { label: 'Status', value: [{ text: 'Ready', tone: 'success' }] },
      { label: 'Model', value: [{ text: 'deepseek-chat' }] },
      { label: 'Profile', value: [{ text: 'blue-dev' }, { text: ' (linked checkout)', tone: 'muted' }] },
      { label: 'Harness', value: [{ text: '0.1.2-alpha.2', tone: 'accent' }] },
    ]),
  },
  {
    id: 'code',
    title: 'code — preformatted block with language hint',
    width: 72,
    build: ui => ui.code([
      'export async function loadProfile(name) {',
      '  const profile = await registry.resolve(name)',
      '  if (!profile.ok) {',
      "    throw new Error(`unknown profile: ${name}`)",
      '  }',
      '  return profile.value',
      '}',
    ].join('\n'), { language: 'ts' }),
  },
  {
    id: 'diff',
    title: 'diff — before/after semantic comparison',
    width: 72,
    build: ui => ui.diff(
      [
        'export function greet(name) {',
        "  return 'hello ' + name",
        '}',
      ].join('\n'),
      [
        'export function greet(name, punctuation = "!") {',
        '  return `hello ${name}${punctuation}`',
        '}',
      ].join('\n'),
    ),
  },
  {
    id: 'sections',
    title: 'sections — titled lightweight bodies, one collapsed',
    width: 64,
    build: ui => ui.sections([
      {
        title: 'Environment',
        body: ui.fields([
          { label: 'Node', value: [{ text: 'v24.15.0' }] },
          { label: 'Package manager', value: [{ text: 'pnpm 11.7.0', tone: 'muted' }] },
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
    title: 'child — sized, responsive stack member',
    width: 64,
    build: ui => ui.stack.column([
      ui.text('Always visible summary', { tone: 'muted' }),
      ui.child(ui.text('Wide-only detail: 8 tool calls, 2 denied, 12.4k tokens'), {
        grow: 1,
        when: { minWidth: 48 },
      }),
    ]),
  },
  {
    id: 'stack',
    title: 'stack — row and column composition',
    width: 64,
    build: ui => ui.stack.column([
      ui.stack.row([ui.text('left'), ui.divider({ label: 'middle' }), ui.text('right')], { gap: 1 }),
      ui.stack.row([ui.text('status', { tone: 'muted' }), ui.text('ready', { tone: 'success' })], { gap: 1 }),
    ], { gap: 1 }),
  },
  {
    id: 'surface',
    title: 'surface — titled container with badges and footer',
    width: 64,
    build: ui => ui.surface({
      title: 'Session settings',
      subtitle: 'Profile blue-dev',
      badges: [{ text: 'alpha', tone: 'warning' }, { text: 'linked', tone: 'accent' }],
      chrome: 'surface',
      padding: 1,
      child: ui.fields([
        { label: 'Model', value: [{ text: 'deepseek-chat' }] },
        { label: 'Mode', value: [{ text: 'default', tone: 'muted' }] },
      ]),
      footer: ui.text('Esc to close', { tone: 'muted' }),
    }),
  },
  {
    id: 'scroll',
    title: 'scroll — follow intent and scrollbar request',
    width: 64,
    build: ui => ui.scroll(
      ui.stack.column(
        Array.from({ length: 12 }, (_, index) =>
          ui.text(`log line ${String(index + 1).padStart(2, '0')} — tool call finished`, { tone: index % 3 === 0 ? 'muted' : 'default' })),
      ),
      { follow: 'start', scrollbar: true },
    ),
  },
  {
    id: 'tabs',
    title: 'tabs — controlled active item, second tab active',
    width: 64,
    build: ui => ui.tabs({
      id: 'settings-tabs',
      activeId: 'advanced',
      items: [
        { id: 'summary', label: 'Summary' },
        { id: 'advanced', label: 'Advanced' },
        { id: 'logs', label: 'Logs', count: 12 },
        { id: 'raw', label: 'Raw', disabled: true },
      ],
    }),
  },
  {
    id: 'list',
    title: 'list — grouped items with details and badges',
    width: 64,
    build: ui => ui.list({
      id: 'task-list',
      mode: 'single',
      selectedIds: ['build'],
      items: [
        { id: 'lint', label: 'Lint workspace', detail: 'oxlint · 0 problems', group: 'Checks' },
        { id: 'build', label: 'Build packages', detail: 'tsc -b + tsdown', badge: 'running', group: 'Checks' },
        { id: 'test', label: 'Run tests', detail: 'vitest · 195 files', group: 'Checks' },
        { id: 'publish', label: 'Publish release', detail: 'disabled in dev', disabled: true, group: 'Release' },
      ],
    }),
  },
  {
    id: 'form',
    title: 'form — first field filled, focus on the second',
    width: 64,
    build: ui => ui.form({
      id: 'profile-form',
      fields: [
        { kind: 'input', id: 'name', label: 'Name', value: 'A' },
        { kind: 'input', id: 'email', label: 'Email', value: '', placeholder: 'you@example.com' },
        { kind: 'toggle', id: 'digest', label: 'Weekly digest', value: true },
      ],
      submitActionId: 'Create profile',
    }),
    drive: focus => {
      focus.handleInput?.('da') // Name: A → Ada
      focus.handleInput?.('\t') // move focus to the Email field
    },
  },
  {
    id: 'actions',
    title: 'actions — intents with focus on the second item',
    width: 64,
    build: ui => ui.actions({
      id: 'session-actions',
      items: [
        { id: 'save', label: 'Save', intent: 'primary' },
        { id: 'export', label: 'Export transcript' },
        { id: 'sync', label: 'Syncing', busy: true },
        { id: 'delete', label: 'Delete', intent: 'danger', confirm: 'confirm delete' },
      ],
    }),
    drive: focus => {
      focus.handleInput?.('\t') // focus Export transcript
    },
  },
  {
    id: 'loader',
    title: 'loader — braille indicator with elapsed hint',
    width: 64,
    build: ui => ui.loader({
      message: 'Waiting for the model response',
      variant: 'braille',
      elapsedMs: 1200,
      cancelActionId: 'cancel-request',
    }),
  },
  {
    id: 'empty',
    title: 'empty — no-data state with recovery actions',
    width: 64,
    build: ui => ui.empty({
      title: 'No sessions yet',
      description: 'Start a conversation and it will show up here.',
      actions: ui.actions({
        id: 'empty-actions',
        items: [
          { id: 'new', label: 'New session', intent: 'primary' },
          { id: 'import', label: 'Import transcript' },
        ],
      }),
    }),
  },
  {
    id: 'progress',
    title: 'progress — labeled determinate bar',
    width: 64,
    build: ui => ui.progress({ label: 'Indexing', value: 7, max: 10 }),
  },
  {
    id: 'spacer',
    title: 'spacer — semantic vertical whitespace (size 2)',
    width: 48,
    build: ui => ui.stack.column([
      ui.text('Section above', { tone: 'muted' }),
      ui.spacer({ size: 2 }),
      ui.text('Section below', { tone: 'muted' }),
    ]),
  },
  {
    id: 'divider',
    title: 'divider — semantic separator with a label',
    width: 48,
    build: ui => ui.stack.column([
      ui.text('Sign in with an existing account'),
      ui.divider({ label: 'or' }),
      ui.text('Create a new account', { tone: 'accent' }),
    ]),
  },
]
