import { Context } from '@deepseek-ai/cordis'
import type {
  BlueCapability,
  BlueEditorCompletionRequest,
  BlueEditorCompletionRequestV2,
  BlueEditorExtensionContribution,
  BlueEditorExtensionNode,
  BlueEditorProvider,
  BlueEditorShellNode,
  BlueEditorSubmitValue,
  BlueOverlayRequest,
  BluePaneContribution,
  BluePluginApi,
  BluePluginHost,
  BluePluginManifest,
  BlueStatusNode,
  BlueStatusProvider,
  BlueUiEvent,
  BlueUiNode,
} from '@dsh-blue/blue-api'

declare const pluginHost: BluePluginHost
export const contextConsumer = pluginHost.open(new Context(), {
  id: '@acme/context-consumer', api: '^1.0.0', capabilities: [],
})

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

export const semanticList: BlueUiNode = {
  kind: 'list', id: 'models', selectedIds: ['model'], items: [{
    id: 'model', label: 'Model', detail: 'plain fallback',
    detailSpans: [{ text: '[High]', tone: 'accent', emphasis: 'strong' }],
  }],
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

export const editorExtensionContent = {
  kind: 'surface', title: 'Context', child: {
    kind: 'stack', direction: 'column', children: [
      { node: { kind: 'text', content: 'Repository context' } },
      { node: {
        kind: 'surface', chrome: 'lane', child: {
          kind: 'stack', direction: 'row', children: [
            { node: { kind: 'fields', rows: [{ label: 'Branch', value: [{ text: 'main' }] }] } },
            { node: { kind: 'progress', label: 'Context', value: 42, max: 100 } },
          ],
        }, footer: { kind: 'divider', label: 'Ready' },
      }, when: { minWidth: 40 } },
    ],
  }, footer: { kind: 'rich-text', spans: [{ text: 'Passive', tone: 'muted' }] },
} satisfies BlueEditorExtensionNode

export const editorExtension = {
  id: '@acme/editor-extension',
  before: editorExtensionContent,
  after: { kind: 'code', code: 'pnpm test', language: 'sh' },
  complete: (request, context) => context.signal.aborted
    ? { ok: false, code: 'BLUE_ABORTED', message: 'aborted' }
    : { ok: true, value: [{ id: 'legacy', label: request.query, insertText: request.query }] },
  completeV2: (request, context) => context.signal.aborted
    ? { ok: false, code: 'BLUE_ABORTED', message: 'aborted' }
    : { ok: true, value: [{ id: 'skill', label: request.trigger === '#' ? 'Skill' : request.query, insertText: '#skill' }] },
  onEvent: (_event, context) => context.signal.aborted
    ? { ok: false, code: 'BLUE_ABORTED', message: 'aborted' }
    : { ok: true, value: undefined },
  transformSubmit: request => ({ ok: true, value: { text: request.text } }),
} satisfies BlueEditorExtensionContribution

export function visitLegacyCompletionTrigger(request: BlueEditorCompletionRequest): string {
  switch (request.trigger) {
    case '/': return 'slash'
    case '@': return 'at'
    case 'manual': return 'manual'
    default: return assertNever(request.trigger)
  }
}

export function visitCompletionTriggerV2(request: BlueEditorCompletionRequestV2): string {
  switch (request.trigger) {
    case '/': return 'slash'
    case '@': return 'at'
    case '#': return 'hash'
    case 'manual': return 'manual'
    default: return assertNever(request.trigger)
  }
}

/** G1 compatibility: old contributions remain source-valid; host admission rejects this node. */
export const legacyInteractiveEditorExtension = {
  id: '@acme/legacy-editor-extension',
  before: { kind: 'actions', id: 'legacy-action', items: [] },
} satisfies BlueEditorExtensionContribution

export const invalidEditorSubmitValue: BlueEditorSubmitValue = {
  text: 'preserve attachments outside plugin output',
  // @ts-expect-error attachments are readonly input metadata, not transformer output
  attachments: [],
}

// @ts-expect-error actions use the separate extension actions/onEvent path
export const invalidEditorExtensionActions: BlueEditorExtensionNode = { kind: 'actions', id: 'bad', items: [] }
// @ts-expect-error list is an interactive control
export const invalidEditorExtensionList: BlueEditorExtensionNode = { kind: 'list', id: 'bad', selectedIds: [], items: [] }
// @ts-expect-error form is an interactive control
export const invalidEditorExtensionForm: BlueEditorExtensionNode = { kind: 'form', id: 'bad', fields: [] }
// @ts-expect-error tabs are an interactive control
export const invalidEditorExtensionTabs: BlueEditorExtensionNode = { kind: 'tabs', id: 'bad', activeId: 'one', items: [] }
// @ts-expect-error scroll is outside the passive editor-extension subset
export const invalidEditorExtensionScroll: BlueEditorExtensionNode = { kind: 'scroll', child: { kind: 'text', content: 'bad' } }
// @ts-expect-error loader is outside the passive editor-extension subset
export const invalidEditorExtensionLoader: BlueEditorExtensionNode = { kind: 'loader', message: 'bad' }
// @ts-expect-error empty is outside the passive editor-extension subset
export const invalidEditorExtensionEmpty: BlueEditorExtensionNode = { kind: 'empty', title: 'bad' }
// @ts-expect-error editor-control is reserved for the provider shell
export const invalidEditorExtensionControl: BlueEditorExtensionNode = { kind: 'editor-control' }
export const invalidNestedEditorExtension: BlueEditorExtensionNode = {
  kind: 'stack', direction: 'column', children: [
    // @ts-expect-error interactive nodes remain excluded recursively
    { node: { kind: 'actions', id: 'nested-bad', items: [] } },
  ],
}

export const capabilities = [
  'commands', 'notifications', 'status', 'panes', 'overlays',
  'editor.extensions', 'session.read', 'session.act', 'status.provider', 'editor.provider',
] as const satisfies readonly BlueCapability[]

export const manifest = {
  id: '@acme/inspector', api: '^1.0.0', capabilities: ['panes', 'status'],
} satisfies BluePluginManifest

declare const status: NonNullable<BluePluginApi['status']>
status.register({ id: '@acme/status/branch', render: () => ({ kind: 'text', content: 'main' }) })
// @ts-expect-error code is outside the recursive status subset
status.register({ id: '@acme/status/code', render: () => ({ kind: 'code', code: 'unsafe status' }) })
// @ts-expect-error actions are interactive and cannot enter status
status.register({ id: '@acme/status/action', render: () => ({ kind: 'actions', id: 'bad', items: [] }) })

// @ts-expect-error editor-control is provider-only
export const invalidPaneNode: BlueUiNode = { kind: 'editor-control' }
// @ts-expect-error status is non-interactive
export const invalidStatusNode: BlueStatusNode = { kind: 'actions', id: 'bad', items: [] }
// @ts-expect-error removed capabilities are not part of the public union
export const invalidDockCapability: BlueCapability = 'dock'
// @ts-expect-error tools has no public registry or owner
export const invalidToolsCapability: BlueCapability = 'tools'
// @ts-expect-error removed values do not leak through BluePluginManifest
export const invalidDockManifest: BluePluginManifest = { id: '@acme/old', api: '^1.0.0', capabilities: ['dock'] }
