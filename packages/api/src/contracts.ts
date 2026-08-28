/** Renderer-independent contracts shared by official and third-party effects. */
import type { BluePluginManifest } from './manifest.ts'

export type BlueErrorCode =
  | 'BLUE_API_INCOMPATIBLE' | 'BLUE_CAPABILITY_DENIED' | 'BLUE_CAPABILITY_ABSENT'
  | 'BLUE_DUPLICATE_ID' | 'BLUE_INVALID_CONTRIBUTION' | 'BLUE_LIMIT_EXCEEDED'
  | 'BLUE_ABORTED' | 'BLUE_SESSION_UNAVAILABLE' | 'BLUE_ACTION_REJECTED'

export type BlueResult<Value = void> =
  | { readonly ok: true, readonly value: Value }
  | { readonly ok: false, readonly code: BlueErrorCode, readonly message: string }

export type BlueJson = null | boolean | number | string | readonly BlueJson[] | { readonly [key: string]: BlueJson }

export interface BlueRegistration { readonly disposed: boolean, dispose(): void }
export interface BlueRefreshRegistration extends BlueRegistration { refresh(): BlueResult }
export interface BlueContributionMeta { readonly id: string, readonly priority?: number }

declare const blueUserGestureBrand: unique symbol
/** Opaque, one-shot proof minted by Blue during an explicit user dispatch. */
export interface BlueUserGesture { readonly [blueUserGestureBrand]: true }

export interface BlueCommandContribution extends BlueContributionMeta {
  readonly label: string
  readonly execute: (args: readonly string[], options?: {
    readonly signal?: AbortSignal
    readonly rawInput?: string
    readonly userGesture?: BlueUserGesture
  }) => Promise<BlueResult>
}

export type BlueTone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'
export interface BlueInlineSpan { readonly text: string, readonly tone?: BlueTone, readonly emphasis?: 'normal' | 'strong' }
export interface BlueField { readonly label: string, readonly value: readonly BlueInlineSpan[] }
export interface BlueSection { readonly title?: string, readonly body: BlueView, readonly collapsed?: boolean }

/** Existing sanitized content leaf, retained without a parallel renderer path. */
export type BlueView =
  | { readonly kind: 'text', readonly content: string, readonly tone?: BlueTone }
  | { readonly kind: 'fields', readonly rows: readonly BlueField[] }
  | { readonly kind: 'code', readonly code: string, readonly language?: string }
  | { readonly kind: 'diff', readonly before: string, readonly after: string }
  | { readonly kind: 'sections', readonly sections: readonly BlueSection[] }

export interface BlueRichTextNode { readonly kind: 'rich-text', readonly spans: readonly BlueInlineSpan[] }
export interface BlueViewportCondition { readonly minWidth?: number, readonly maxWidth?: number, readonly minHeight?: number, readonly maxHeight?: number }
export interface BlueUiChild {
  readonly node: BlueUiNode
  readonly basis?: number | 'auto'
  readonly grow?: number
  readonly shrink?: number
  readonly minSize?: number
  readonly maxSize?: number
  readonly when?: BlueViewportCondition
}
export interface BlueStackNode { readonly kind: 'stack', readonly direction: 'row' | 'column', readonly gap?: 0 | 1 | 2, readonly align?: 'stretch' | 'start' | 'center' | 'end', readonly children: readonly BlueUiChild[] }
export interface BlueSurfaceNode { readonly kind: 'surface', readonly title?: string, readonly subtitle?: string, readonly badges?: readonly BlueInlineSpan[], readonly chrome?: 'none' | 'lane' | 'surface' | 'overlay', readonly padding?: 0 | 1 | 2, readonly child: BlueUiNode, readonly footer?: BlueUiNode }
export interface BlueScrollNode { readonly kind: 'scroll', readonly child: BlueUiNode, readonly follow?: 'none' | 'start' | 'end', readonly scrollbar?: boolean }
export interface BlueTabItem { readonly id: string, readonly label: string, readonly disabled?: boolean, readonly count?: number }
export interface BlueTabsNode { readonly kind: 'tabs', readonly id: string, readonly activeId: string, readonly items: readonly BlueTabItem[] }
export interface BlueListItem { readonly id: string, readonly label: string, readonly detail?: string, readonly detailSpans?: readonly BlueInlineSpan[], readonly badge?: string, readonly group?: string, readonly disabled?: boolean }
export interface BlueListNode { readonly kind: 'list', readonly id: string, readonly mode?: 'single' | 'multiple', readonly selectedIds: readonly string[], readonly items: readonly BlueListItem[], readonly filter?: string, readonly empty?: BlueUiNode }
export type BlueFormField =
  | { readonly kind: 'input' | 'textarea' | 'secret', readonly id: string, readonly label: string, readonly value: string, readonly placeholder?: string, readonly error?: string, readonly disabled?: boolean }
  | { readonly kind: 'select', readonly id: string, readonly label: string, readonly value: string | null, readonly options: readonly BlueListItem[], readonly error?: string, readonly disabled?: boolean }
  | { readonly kind: 'toggle', readonly id: string, readonly label: string, readonly value: boolean, readonly error?: string, readonly disabled?: boolean }
export interface BlueFormNode { readonly kind: 'form', readonly id: string, readonly fields: readonly BlueFormField[], readonly submitActionId?: string, readonly cancelActionId?: string }
export interface BlueActionItem { readonly id: string, readonly label: string, readonly intent?: 'primary' | 'secondary' | 'danger', readonly disabled?: boolean, readonly busy?: boolean, readonly confirm?: string }
export interface BlueActionsNode { readonly kind: 'actions', readonly id: string, readonly items: readonly BlueActionItem[] }
export interface BlueLoaderNode { readonly kind: 'loader', readonly message: string, readonly variant?: 'braille' | 'tide', readonly elapsedMs?: number, readonly cancelActionId?: string }
export interface BlueEmptyNode { readonly kind: 'empty', readonly title: string, readonly description?: string, readonly actions?: BlueActionsNode }
export interface BlueProgressNode { readonly kind: 'progress', readonly label?: string, readonly value: number, readonly max: number }
export interface BlueSpacerNode { readonly kind: 'spacer', readonly size?: 1 | 2 }
export interface BlueDividerNode { readonly kind: 'divider', readonly label?: string }

export type BlueUiNode =
  | BlueView | BlueRichTextNode | BlueStackNode | BlueSurfaceNode | BlueScrollNode
  | BlueTabsNode | BlueListNode | BlueFormNode | BlueActionsNode | BlueLoaderNode
  | BlueEmptyNode | BlueProgressNode | BlueSpacerNode | BlueDividerNode

export type BlueUiEvent =
  | { readonly kind: 'activate', readonly controlId: string }
  | { readonly kind: 'selection-change' | 'value-change', readonly controlId: string, readonly value: BlueJson }
  | { readonly kind: 'submit', readonly controlId: string, readonly values: BlueJson }
  | { readonly kind: 'tab-change', readonly controlId: string, readonly tabId: string }
  | { readonly kind: 'dismiss' }
export interface BlueUiEventContext { readonly surfaceId: string, readonly signal: AbortSignal, readonly revision: number, readonly userGesture?: BlueUserGesture }
export type BlueUiEventHandler = (event: BlueUiEvent, context: BlueUiEventContext) => BlueResult | Promise<BlueResult>

export type BluePanePlacement = 'header' | 'left' | 'right' | 'bottom'
export interface BluePaneContribution extends BlueContributionMeta {
  readonly title?: string
  readonly placement: BluePanePlacement
  readonly size?: { readonly min?: number, readonly preferred?: number | 'auto', readonly max?: number }
  readonly narrow?: 'bottom' | 'overlay' | 'hidden'
  readonly render: () => BlueUiNode | null
  readonly onEvent?: BlueUiEventHandler
}
export interface BluePaneRegistration extends BlueRefreshRegistration { setHidden(hidden: boolean): BlueResult }
export interface BluePaneRegistry { register(contribution: BluePaneContribution): BlueResult<BluePaneRegistration>, list(): readonly BluePaneContribution[] }

export type BlueOverlayAnchor = 'center' | 'top' | 'bottom' | 'left' | 'right'
export interface BlueOverlayRequest {
  readonly id: string
  readonly title?: string
  readonly capturing?: boolean
  readonly dismissible?: boolean
  readonly anchor?: BlueOverlayAnchor
  readonly width?: number | `${number}%`
  readonly minWidth?: number
  readonly maxHeight?: number | `${number}%`
  readonly render: () => BlueUiNode
  readonly onEvent?: BlueUiEventHandler
}
export interface BlueOverlayOpenOptions { readonly userGesture?: BlueUserGesture }
export interface BluePublicOverlayHandle extends BlueRegistration { readonly closed: boolean, refresh(): BlueResult, close(): void }
export interface BlueOverlayRegistry { open(request: BlueOverlayRequest, options?: BlueOverlayOpenOptions): BlueResult<BluePublicOverlayHandle> }

/** Recursive non-interactive subset; responsive visibility remains on each child. */
export type BlueStatusNode = BlueStatusTextNode | BlueRichTextNode | BlueStatusFieldsNode | BlueProgressNode | BlueStatusStackNode
export type BlueStatusTextNode = Extract<BlueView, { readonly kind: 'text' }>
export type BlueStatusFieldsNode = Extract<BlueView, { readonly kind: 'fields' }>
export interface BlueStatusChild extends Omit<BlueUiChild, 'node'> { readonly node: BlueStatusNode }
export interface BlueStatusStackNode extends Omit<BlueStackNode, 'children'> { readonly children: readonly BlueStatusChild[] }
export interface BlueStatusEntryContribution extends BlueContributionMeta { readonly render: () => BlueStatusNode | null }
export interface BlueStatusEntryRegistry { register(contribution: BlueStatusEntryContribution): BlueResult<BlueRefreshRegistration>, list(): readonly BlueStatusEntryContribution[] }
export interface BlueStatusEntrySnapshot { readonly id: string, readonly node: BlueStatusNode }
export interface BlueStatusSnapshot { readonly session: BlueSessionSnapshot | null, readonly entries: readonly BlueStatusEntrySnapshot[], readonly busy: boolean }
export interface BlueStatusProvider { readonly id: string, readonly render: (snapshot: BlueStatusSnapshot) => BlueStatusNode }

export interface BlueEditorCompletionItem { readonly id: string, readonly label: string, readonly insertText: string, readonly detail?: string }
/** Compatibility completion request. This callback never receives a hash trigger. */
export interface BlueEditorCompletionRequest { readonly query: string, readonly trigger: '/' | '@' | 'manual' }
/** Opt-in completion request for extensions that handle hash-prefixed tokens. */
export interface BlueEditorCompletionRequestV2 { readonly query: string, readonly trigger: '/' | '@' | '#' | 'manual' }
export interface BlueEditorDiagnostic { readonly id: string, readonly message: string, readonly tone?: BlueTone }
export interface BlueEditorAttachment { readonly id: string, readonly label: string, readonly mediaType?: string, readonly size?: number }
export interface BlueEditorSubmitRequest { readonly text: string, readonly attachments: readonly BlueEditorAttachment[] }
export interface BlueEditorSubmitValue { readonly text: string }
/** Recursive passive subset accepted around the host-owned editor control. */
export type BlueEditorExtensionNode =
  | BlueView | BlueRichTextNode | BlueProgressNode | BlueSpacerNode | BlueDividerNode
  | BlueEditorExtensionStackNode | BlueEditorExtensionSurfaceNode
export interface BlueEditorExtensionChild extends Omit<BlueUiChild, 'node'> { readonly node: BlueEditorExtensionNode }
export interface BlueEditorExtensionStackNode extends Omit<BlueStackNode, 'children'> { readonly children: readonly BlueEditorExtensionChild[] }
export interface BlueEditorExtensionSurfaceNode extends Omit<BlueSurfaceNode, 'child' | 'footer'> { readonly child: BlueEditorExtensionNode, readonly footer?: BlueEditorExtensionNode }
export interface BlueEditorExtensionContribution extends BlueContributionMeta {
  /** Static compatibility type; registration admits only the passive BlueEditorExtensionNode subset. */
  readonly before?: BlueUiNode
  /** Static compatibility type; registration admits only the passive BlueEditorExtensionNode subset. */
  readonly after?: BlueUiNode
  readonly hint?: string
  readonly diagnostics?: readonly BlueEditorDiagnostic[]
  readonly actions?: readonly BlueActionItem[]
  /** Event context uses the extension id as surfaceId and expires with its owner generation. */
  readonly onEvent?: BlueUiEventHandler
  /** Legacy completion callback for slash, at-sign, and manual requests. */
  readonly complete?: (request: BlueEditorCompletionRequest, context: BlueUiEventContext) => BlueResult<readonly BlueEditorCompletionItem[]> | Promise<BlueResult<readonly BlueEditorCompletionItem[]>>
  /** Opt-in completion callback including hash requests; owners prefer it when both callbacks exist. */
  readonly completeV2?: (request: BlueEditorCompletionRequestV2, context: BlueUiEventContext) => BlueResult<readonly BlueEditorCompletionItem[]> | Promise<BlueResult<readonly BlueEditorCompletionItem[]>>
  /** Submit context is revision-fenced and expires with its owner generation. */
  readonly transformSubmit?: (request: BlueEditorSubmitRequest, context: BlueUiEventContext) => BlueResult<BlueEditorSubmitValue> | Promise<BlueResult<BlueEditorSubmitValue>>
}
export interface BlueEditorExtensionSnapshot { readonly id: string, readonly before?: BlueUiNode, readonly after?: BlueUiNode, readonly hint?: string, readonly diagnostics?: readonly BlueEditorDiagnostic[], readonly actions?: readonly BlueActionItem[] }
export interface BlueEditorSnapshot { readonly mode: 'normal' | 'plan' | 'yolo', readonly busy: boolean, readonly attachments: readonly BlueEditorAttachment[], readonly extensions: readonly BlueEditorExtensionSnapshot[] }

/** Host-owned engine slot; absent from BlueUiNode and ordinary pane trees. */
export interface BlueEditorControlNode { readonly kind: 'editor-control' }
type BlueEditorShellLeaf = Exclude<BlueUiNode, BlueStackNode | BlueSurfaceNode>
export type BlueEditorShellNode = BlueEditorShellLeaf | BlueEditorControlNode | BlueEditorStackNode | BlueEditorSurfaceNode
export interface BlueEditorChild extends Omit<BlueUiChild, 'node'> { readonly node: BlueEditorShellNode }
export interface BlueEditorStackNode extends Omit<BlueStackNode, 'children'> { readonly children: readonly BlueEditorChild[] }
export interface BlueEditorSurfaceNode extends Omit<BlueSurfaceNode, 'child' | 'footer'> { readonly child: BlueEditorShellNode, readonly footer?: BlueEditorShellNode }
export interface BlueEditorProvider { readonly id: string, readonly render: (snapshot: BlueEditorSnapshot) => BlueEditorShellNode, readonly onEvent?: BlueUiEventHandler }
export interface BlueEditorExtensionRegistry { register(contribution: BlueEditorExtensionContribution): BlueResult<BlueRefreshRegistration>, list(): readonly BlueEditorExtensionContribution[] }
export interface BlueStatusProviderRegistry { register(provider: BlueStatusProvider): BlueResult<BlueRefreshRegistration>, list(): readonly BlueStatusProvider[] }
export interface BlueEditorProviderRegistry { register(provider: BlueEditorProvider): BlueResult<BlueRefreshRegistration>, list(): readonly BlueEditorProvider[] }

export interface BlueSessionSnapshot { readonly id: string, readonly cwd: string, readonly status: 'idle' | 'running' | 'waiting' | 'failed', readonly mode: 'normal' | 'plan' | 'yolo', readonly model?: { readonly id: string, readonly provider?: string, readonly effort?: string } }
export type BlueSessionAction = { readonly kind: 'followup' | 'steer', readonly text: string } | { readonly kind: 'interrupt' }
export interface BlueSessionReader { current(): BlueSessionSnapshot | null, subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void): BlueRegistration, request(action: BlueSessionAction, options?: { readonly signal?: AbortSignal }): Promise<BlueResult> }
export type BlueRequestState = 'started' | 'streaming' | 'completed' | 'failed' | 'aborted' | 'interrupted'
export interface BlueRequestRef { readonly sessionEpoch: number, readonly requestEpoch: number, readonly scope: 'main' | 'btw' | 'subagent' }
export interface BlueRequestLifecycle { readonly ref: BlueRequestRef, readonly state: BlueRequestState, readonly reason?: string }

export interface BlueNotification { readonly id: string, readonly view: BlueView, readonly tone?: BlueTone }
export interface BlueRegistry<T> { register(contribution: T): BlueResult<BlueRegistration>, list(): readonly T[] }

/** W1 declares new registries; W2-C owns their host implementation. */
export interface BluePluginApi {
  readonly manifest: BluePluginManifest
  readonly commands?: BlueRegistry<BlueCommandContribution>
  readonly status?: BlueStatusEntryRegistry
  /** @deprecated Internal bridge until W2-C migrates dock consumers to panes. */
  readonly dock?: BlueRegistry<BlueDockContribution>
  readonly notifications?: { publish(notification: BlueNotification): BlueResult, subscribe(listener: (notification: BlueNotification) => void): BlueRegistration }
  readonly panes?: BluePaneRegistry
  readonly overlays?: BlueOverlayRegistry
  readonly editorExtensions?: BlueEditorExtensionRegistry
  readonly statusProviders?: BlueStatusProviderRegistry
  readonly editorProviders?: BlueEditorProviderRegistry
  readonly session?: BlueSessionReader
}
export interface BluePluginHost { readonly version: string, open(consumer: { effect(callback: () => () => void): unknown }, manifest: BluePluginManifest): BlueResult<BluePluginApi> }

/** @deprecated Internal transition type; remove with the W2-C pane bridge. */
export interface BlueDockContribution extends BlueContributionMeta { readonly view: BlueView | (() => BlueView | null), readonly preferredRows?: number, readonly minRows?: number, readonly collapsible?: boolean }
/** @deprecated Internal transition type; remove with the W2-C status bridge. */
export interface BlueStatusContribution extends BlueContributionMeta { readonly render: () => BlueView | null }
