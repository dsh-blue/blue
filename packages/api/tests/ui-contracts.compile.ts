import type {
  BlueCapability,
  BlueEditorProvider,
  BlueEditorShellNode,
  BlueOverlayRequest,
  BluePaneContribution,
  BlueStatusNode,
  BlueStatusProvider,
  BlueUiEvent,
  BlueUiNode,
} from '@dsh-blue/blue-api'

function assertNever(value: never): never { throw new Error(String(value)) }

export function visitNode(node: BlueUiNode): string {
  switch (node.kind) {
    case 'text': return node.content
    case 'fields': return String(node.rows.length)
    case 'code': return node.code
    case 'diff': return node.before + node.after
    case 'sections': return String(node.sections.length)
    case 'rich-text': return String(node.spans.length)
    case 'stack': return String(node.children.length)
    case 'surface': return node.title ?? ''
    case 'scroll': return visitNode(node.child)
    case 'tabs': return node.activeId
    case 'list': return node.id
    case 'form': return node.id
    case 'actions': return node.id
    case 'loader': return node.message
    case 'empty': return node.title
    case 'progress': return String(node.value)
    case 'spacer': return String(node.size ?? 1)
    case 'divider': return node.label ?? ''
    default: return assertNever(node)
  }
}

export function visitEvent(event: BlueUiEvent): string {
  switch (event.kind) {
    case 'activate': return event.controlId
    case 'selection-change': return event.controlId
    case 'value-change': return event.controlId
    case 'submit': return event.controlId
    case 'tab-change': return event.tabId
    case 'dismiss': return event.kind
    default: return assertNever(event)
  }
}

export function visitStatus(node: BlueStatusNode): string {
  switch (node.kind) {
    case 'text': return node.content
    case 'rich-text': return String(node.spans.length)
    case 'fields': return String(node.rows.length)
    case 'progress': return String(node.value)
    case 'stack': return String(node.children.length)
    default: return assertNever(node)
  }
}

export function visitEditor(node: BlueEditorShellNode): string {
  switch (node.kind) {
    case 'editor-control': return node.kind
    case 'text': return node.content
    case 'fields': return String(node.rows.length)
    case 'code': return node.code
    case 'diff': return node.before + node.after
    case 'sections': return String(node.sections.length)
    case 'rich-text': return String(node.spans.length)
    case 'stack': return String(node.children.length)
    case 'surface': return node.title ?? ''
    case 'scroll': return visitEditor(node.child)
    case 'tabs': return node.activeId
    case 'list': return node.id
    case 'form': return node.id
    case 'actions': return node.id
    case 'loader': return node.message
    case 'empty': return node.title
    case 'progress': return String(node.value)
    case 'spacer': return String(node.size ?? 1)
    case 'divider': return node.label ?? ''
    default: return assertNever(node)
  }
}

export const pane = {
  id: '@acme/inspector/main',
  title: 'Inspector',
  placement: 'right',
  priority: 50,
  size: { min: 20, preferred: 32, max: 48 },
  narrow: 'bottom',
  render: () => ({
    kind: 'surface', title: 'Task inspector', child: {
      kind: 'stack', direction: 'column', gap: 1, children: [
        { node: { kind: 'tabs', id: 'view', activeId: 'overview', items: [{ id: 'overview', label: 'Overview' }] } },
        { node: { kind: 'divider', label: 'Metrics' } },
        { node: { kind: 'progress', label: 'Context', value: 42, max: 100 } },
        { node: { kind: 'spacer' }, when: { minHeight: 10 } },
        { node: { kind: 'actions', id: 'actions', items: [{ id: 'refresh', label: 'Refresh' }] } },
      ],
    },
  }),
  onEvent: async (_event, context) => context.signal.aborted
    ? { ok: false, code: 'BLUE_ABORTED', message: 'aborted' }
    : { ok: true, value: undefined },
} satisfies BluePaneContribution

export const overlay = {
  id: '@acme/inspector/details', capturing: true, dismissible: true,
  anchor: 'center', width: '70%', maxHeight: '80%',
  render: () => ({ kind: 'text', content: 'Details' }),
} satisfies BlueOverlayRequest

export const statusProvider = {
  id: '@acme/status',
  render: snapshot => ({ kind: 'stack', direction: 'row', children: [
    { node: { kind: 'text', content: snapshot.session?.cwd ?? 'No session' } },
    { node: { kind: 'text', content: '' }, grow: 1, when: { minWidth: 60 } },
    { node: { kind: 'progress', value: snapshot.busy ? 1 : 0, max: 1 } },
  ] }),
} satisfies BlueStatusProvider

export const editorProvider = {
  id: '@acme/editor',
  render: snapshot => ({ kind: 'stack', direction: 'column', children: [
    { node: { kind: 'text', content: `${snapshot.attachments.length} attachments` } },
    { node: { kind: 'editor-control' } },
  ] }),
} satisfies BlueEditorProvider

export const capabilities = [
  'commands', 'notifications', 'status', 'panes', 'overlays',
  'editor.extensions', 'session.read', 'session.act', 'status.provider', 'editor.provider',
] as const satisfies readonly BlueCapability[]

// @ts-expect-error editor-control is provider-only
export const invalidPaneNode: BlueUiNode = { kind: 'editor-control' }
// @ts-expect-error status is non-interactive
export const invalidStatusNode: BlueStatusNode = { kind: 'actions', id: 'bad', items: [] }
// @ts-expect-error removed capabilities are not part of the public union
export const invalidDockCapability: BlueCapability = 'dock'
// @ts-expect-error tools has no public registry or owner
export const invalidToolsCapability: BlueCapability = 'tools'
