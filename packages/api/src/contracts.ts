/** Renderer-independent contracts shared by official and third-party effects. */
import type { BluePluginManifest } from './manifest.ts'
import type {
  BluePluginCapabilityNameV1,
  BluePluginCapabilityRequestV1,
  BluePluginManifestV1,
} from './manifest-v1.generated.ts'

/** The two manifest lanes accepted during the Beta-to-v1 transition. */
export type BluePluginManifestInput = BluePluginManifest | BluePluginManifestV1

export type BlueErrorCode =
  | 'BLUE_API_INCOMPATIBLE' | 'BLUE_CAPABILITY_DENIED' | 'BLUE_CAPABILITY_ABSENT'
  | 'BLUE_DUPLICATE_ID' | 'BLUE_INVALID_CONTRIBUTION' | 'BLUE_LIMIT_EXCEEDED'
  | 'BLUE_ABORTED' | 'BLUE_SESSION_UNAVAILABLE' | 'BLUE_ACTION_REJECTED'
  | 'BLUE_CAPABILITY_UNSUPPORTED' | 'BLUE_CAPABILITY_VERSION_UNSUPPORTED'
  | 'BLUE_RESOURCE_DENIED' | 'BLUE_POLICY_DENIED' | 'BLUE_OWNER_UNAVAILABLE'
  | 'BLUE_STALE' | 'BLUE_TIMEOUT' | 'BLUE_INTERNAL_FAILURE'

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

/** Full app-owned snapshot accepted only by the composition-private owner seam. */
export interface BlueSessionSnapshot { readonly revision: number, readonly sessionEpoch: number, readonly id: string, readonly cwd: string, readonly status: 'idle' | 'running' | 'waiting' | 'failed', readonly mode: 'normal' | 'plan' | 'yolo', readonly model?: { readonly id: string, readonly provider?: string, readonly effort?: string } }
export interface BlueSessionReader { current(): BlueSessionSnapshot | null, subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void): BlueRegistration }

/** Resource names accepted by the canonical `session.read` capability. */
export type BlueSessionReadField = 'identity' | 'cwd' | 'status' | 'mode' | 'model'

/**
 * Field-scoped public session snapshot. Revision and epoch are mandatory
 * fencing metadata; every user field is present only when its resource was
 * granted (and, for model, when the owner has a selected model).
 */
export interface BluePluginSessionSnapshot {
  readonly revision: number
  readonly sessionEpoch: number
  readonly id?: string
  readonly cwd?: string
  readonly status?: BlueSessionSnapshot['status']
  readonly mode?: BlueSessionSnapshot['mode']
  readonly model?: BlueSessionSnapshot['model']
}

/** Canonical field-scoped session reader. */
export interface BluePluginSessionReader {
  current(): BlueResult<BluePluginSessionSnapshot | null>
  subscribe(listener: (result: BlueResult<BluePluginSessionSnapshot | null>) => void): BlueResult<BlueRegistration>
}

/** One projection value from a consistent current-session cut. */
export interface BlueSessionProjectionSnapshot {
  readonly sessionEpoch: number
  readonly asOfSeq: number
  readonly key: string
  readonly value: BlueJson
}

/** Several granted projection values read from one consistent cut. */
export interface BlueSessionProjectionCut {
  readonly sessionEpoch: number
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, BlueJson>>
}

/** Canonical key-scoped projection reader. */
export interface BlueSessionProjectionReader {
  current(key: string): BlueResult<BlueSessionProjectionSnapshot | null>
  currentMany(keys: readonly string[]): BlueResult<BlueSessionProjectionCut | null>
  subscribe(
    keys: readonly string[],
    listener: (result: BlueResult<BlueSessionProjectionCut | null>) => void,
  ): BlueResult<BlueRegistration>
}
export type BlueRequestState = 'started' | 'streaming' | 'completed' | 'failed' | 'aborted' | 'interrupted'
export interface BlueRequestRef { readonly sessionEpoch: number, readonly requestEpoch: number, readonly scope: 'main' | 'btw' | 'subagent' }
export interface BlueRequestLifecycle { readonly ref: BlueRequestRef, readonly state: BlueRequestState, readonly reason?: string }

export interface BlueNotification { readonly id: string, readonly view: BlueView, readonly tone?: BlueTone }
export interface BlueRegistry<T> { register(contribution: T): BlueResult<BlueRegistration>, list(): readonly T[] }

/** Capability-scoped API returned by the Beta plugin host. */
export interface BluePluginApi {
  readonly manifest: BluePluginManifestInput
  readonly commands?: BlueRegistry<BlueCommandContribution>
  readonly status?: BlueStatusEntryRegistry
  readonly notifications?: { publish(notification: BlueNotification): BlueResult }
  readonly panes?: BluePaneRegistry
  readonly overlays?: BlueOverlayRegistry
  readonly editorExtensions?: BlueEditorExtensionRegistry
  readonly statusProviders?: BlueStatusProviderRegistry
  readonly editorProviders?: BlueEditorProviderRegistry
  readonly session?: BlueSessionReader
}

/** Canonical v1 facet view after exact resource negotiation. */
export interface BluePluginApiV1 extends Omit<BluePluginApi, 'session'> {
  readonly session?: BluePluginSessionReader
  readonly projections?: BlueSessionProjectionReader
}

/** Resources granted to one canonical v1 capability. */
export type BlueCapabilityGrantResources =
  | { readonly names: readonly string[] }
  | { readonly placements: readonly BluePanePlacement[] }
  | { readonly fields: readonly ('identity' | 'cwd' | 'status' | 'mode' | 'model')[] }
  | { readonly keys: readonly string[] }

/** Host-owned limits and quotas attached to a capability grant. */
export type BlueCapabilityLimits = Readonly<Record<string, number>>
export type BlueCapabilityQuotas = Readonly<Record<string, number>>

/** Exact capability authorization returned by canonical v1 admission. */
export interface BlueCapabilityGrant {
  readonly name: BluePluginCapabilityNameV1
  readonly version: string
  /** Monotonic owner generation captured when this grant was admitted. */
  readonly generation: number
  readonly resources?: BlueCapabilityGrantResources
  readonly limits: BlueCapabilityLimits
  readonly quotas: BlueCapabilityQuotas
  readonly availability: 'ready' | 'unavailable'
}

/** Stable reason classes for an optional capability that was not granted. */
export type BlueCapabilityUnavailableReason =
  | 'unsupported'
  | 'version'
  | 'resource'
  | 'policy'
  | 'owner-gap'

/** Structured optional-capability denial returned by canonical admission. */
export interface BlueCapabilityUnavailable {
  readonly name: BluePluginCapabilityNameV1
  readonly reason: BlueCapabilityUnavailableReason
  readonly message: string
}

/** Canonical v1 open result. Facets are mirrored at the top level for Beta callers. */
export interface BluePluginOpen extends BluePluginApiV1 {
  /** Facet-only API view; no grant-management or owner authority is exposed. */
  readonly api: BluePluginApiV1
  readonly grants: readonly BlueCapabilityGrant[]
  readonly unavailableOptional: readonly BlueCapabilityUnavailable[]
}

/** Capability request accepted by the v1 catalog. */
export type BlueCapabilityRequest = BluePluginCapabilityRequestV1

export interface BluePluginHost {
  readonly version: string
  /** Legacy inline manifests retain the Beta facade shape. */
  open(consumer: { effect(callback: () => () => void): unknown }, manifest: BluePluginManifest): BlueResult<BluePluginApi>
  /** Canonical v1 manifests expose exact grants and optional denials. */
  open(consumer: { effect(callback: () => () => void): unknown }, manifest: BluePluginManifestV1): BlueResult<BluePluginOpen>
}
