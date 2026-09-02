/** Renderer-independent contracts shared by official and third-party Cordis plugins.
 * @module @dsh-blue/blue-api/contracts
 */

export type BlueJson = null | boolean | number | string | readonly BlueJson[] | { readonly [key: string]: BlueJson }

export interface BlueRegistration {
  readonly disposed: boolean
  dispose(): void
}

export interface BlueRefreshRegistration extends BlueRegistration {
  refresh(): void
}

export type BlueTone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'
export interface BlueInlineSpan { readonly text: string, readonly tone?: BlueTone, readonly emphasis?: 'normal' | 'strong' }
export interface BlueField { readonly label: string, readonly value: readonly BlueInlineSpan[] }
export interface BlueSection { readonly title?: string, readonly body: BlueView, readonly collapsed?: boolean }

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

/** Renderer-neutral rich document rendered by the active terminal adapter. */
export interface BlueDocumentNode {
  readonly kind: 'document'
  readonly format: 'markdown' | 'mermaid'
  readonly source: string
}

/** One numeric coordinate in a line or point chart. */
export interface BlueChartPoint { readonly x: number, readonly y: number | null }
/** One numeric series in a line or point chart. */
export interface BlueChartSeries {
  readonly id: string
  readonly label?: string
  readonly tone?: BlueTone
  readonly points: readonly BlueChartPoint[]
}
/** One category-aligned series in a bar chart. */
export interface BlueBarChartSeries {
  readonly id: string
  readonly label?: string
  readonly tone?: BlueTone
  readonly values: readonly (number | null)[]
}
/** One exact value-to-presentation mapping in a categorical heatmap. */
export interface BlueChartLevel {
  readonly value: number | string
  readonly label: string
  readonly tone?: BlueTone
}
export interface BlueLineChartNode {
  readonly kind: 'chart'
  readonly chart: 'line' | 'point'
  readonly series: readonly BlueChartSeries[]
  readonly title?: string
  readonly xLabel?: string
  readonly yLabel?: string
  readonly height?: number
}
export interface BlueBarChartNode {
  readonly kind: 'chart'
  readonly chart: 'bar'
  readonly layout?: 'grouped' | 'stacked' | 'normalized'
  readonly categories: readonly string[]
  readonly series: readonly BlueBarChartSeries[]
  readonly title?: string
  readonly yLabel?: string
  readonly height?: number
}
export interface BlueSparklineChartNode {
  readonly kind: 'chart'
  readonly chart: 'sparkline'
  readonly values: readonly (number | null)[]
  readonly label?: string
  readonly tone?: BlueTone
}
export interface BlueHeatmapChartNode {
  readonly kind: 'chart'
  readonly chart: 'heatmap'
  readonly columns: readonly string[]
  readonly rows: readonly string[]
  readonly values: readonly (readonly (number | string | null)[])[]
  readonly levels: readonly BlueChartLevel[]
  readonly title?: string
}
export type BlueChartNode = BlueLineChartNode | BlueBarChartNode | BlueSparklineChartNode | BlueHeatmapChartNode

export type BlueUiNode =
  | BlueView | BlueRichTextNode | BlueStackNode | BlueSurfaceNode | BlueScrollNode
  | BlueTabsNode | BlueListNode | BlueFormNode | BlueActionsNode | BlueLoaderNode
  | BlueEmptyNode | BlueProgressNode | BlueSpacerNode | BlueDividerNode
  | BlueDocumentNode | BlueChartNode

export type BlueUiEvent =
  | { readonly kind: 'activate', readonly controlId: string }
  | { readonly kind: 'selection-change' | 'value-change', readonly controlId: string, readonly value: BlueJson }
  | { readonly kind: 'submit', readonly controlId: string, readonly values: BlueJson }
  | { readonly kind: 'tab-change', readonly controlId: string, readonly tabId: string }
  | { readonly kind: 'dismiss' }
export interface BlueUiEventContext { readonly surfaceId: string, readonly signal: AbortSignal, readonly revision: number }
export type BlueUiEventHandler = (event: BlueUiEvent, context: BlueUiEventContext) => void | Promise<void>

export type BluePanePlacement = 'header' | 'left' | 'right' | 'bottom'
export interface BluePaneContribution {
  readonly id: string
  readonly title?: string
  readonly priority?: number
  readonly placement: BluePanePlacement
  readonly size?: { readonly min?: number, readonly preferred?: number | 'auto', readonly max?: number }
  readonly narrow?: 'bottom' | 'overlay' | 'hidden'
  readonly render: () => BlueUiNode | null
  readonly onEvent?: BlueUiEventHandler
}
export interface BluePaneRegistration extends BlueRefreshRegistration { setHidden(hidden: boolean): void }
export interface BluePaneEntry { readonly id: string, readonly contribution: BluePaneContribution, readonly hidden: boolean, readonly revision: number }
export interface BluePaneRegistry {
  register(contribution: BluePaneContribution): BluePaneRegistration
  list(): readonly BluePaneEntry[]
  subscribe(listener: (entries: readonly BluePaneEntry[]) => void): () => void
}

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
export interface BlueOverlayHandle extends BlueRefreshRegistration { readonly closed: boolean, close(): void }
export interface BlueOverlayEntry { readonly id: string, readonly request: BlueOverlayRequest, readonly revision: number, readonly order: number }
export interface BlueOverlayRegistry {
  open(request: BlueOverlayRequest): BlueOverlayHandle
  close(id: string): boolean
  list(): readonly BlueOverlayEntry[]
  subscribe(listener: (entries: readonly BlueOverlayEntry[]) => void): () => void
}

export type BlueStatusNode = BlueStatusTextNode | BlueRichTextNode | BlueStatusFieldsNode | BlueProgressNode | BlueStatusStackNode
export type BlueStatusTextNode = Extract<BlueView, { readonly kind: 'text' }>
export type BlueStatusFieldsNode = Extract<BlueView, { readonly kind: 'fields' }>
export interface BlueStatusChild extends Omit<BlueUiChild, 'node'> { readonly node: BlueStatusNode }
export interface BlueStatusStackNode extends Omit<BlueStackNode, 'children'> { readonly children: readonly BlueStatusChild[] }
export interface BlueStatusEntry {
  readonly id: string
  readonly node: BlueStatusNode
  readonly priority?: number
  readonly band?: 'left' | 'center' | 'right'
  readonly row?: 1 | 2
  readonly overflow?: 'truncate' | 'hide'
  readonly visible: boolean
}
export type BlueStatusSource = BlueStatusEntry | (() => BlueStatusEntry | null)
export interface BlueStatusRegistry {
  register(source: BlueStatusSource): BlueRefreshRegistration
  refresh(id: string): void
  list(): readonly BlueStatusEntry[]
  subscribe(listener: () => void): () => void
}

export interface BlueEditorCompletionItem { readonly id: string, readonly label: string, readonly insertText: string, readonly detail?: string }
export interface BlueEditorCompletionRequest { readonly query: string, readonly trigger: '/' | '@' | '#' | 'manual' }
export interface BlueEditorDiagnostic { readonly id: string, readonly message: string, readonly tone?: BlueTone }
export interface BlueEditorAttachment { readonly id: string, readonly label: string, readonly mediaType?: string, readonly size?: number }
export interface BlueEditorSubmitRequest { readonly text: string, readonly attachments: readonly BlueEditorAttachment[] }
export interface BlueEditorSubmitValue { readonly text: string }
export type BlueEditorExtensionNode =
  | BlueView | BlueRichTextNode | BlueProgressNode | BlueSpacerNode | BlueDividerNode
  | BlueEditorExtensionStackNode | BlueEditorExtensionSurfaceNode
export interface BlueEditorExtensionChild extends Omit<BlueUiChild, 'node'> { readonly node: BlueEditorExtensionNode }
export interface BlueEditorExtensionStackNode extends Omit<BlueStackNode, 'children'> { readonly children: readonly BlueEditorExtensionChild[] }
export interface BlueEditorExtensionSurfaceNode extends Omit<BlueSurfaceNode, 'child' | 'footer'> { readonly child: BlueEditorExtensionNode, readonly footer?: BlueEditorExtensionNode }
export interface BlueEditorExtensionContribution {
  readonly id: string
  readonly priority?: number
  readonly before?: BlueEditorExtensionNode
  readonly after?: BlueEditorExtensionNode
  readonly hint?: string
  readonly diagnostics?: readonly BlueEditorDiagnostic[]
  readonly actions?: readonly BlueActionItem[]
  readonly onEvent?: BlueUiEventHandler
  readonly complete?: (request: BlueEditorCompletionRequest, context: BlueUiEventContext) => readonly BlueEditorCompletionItem[] | Promise<readonly BlueEditorCompletionItem[]>
  readonly transformSubmit?: (request: BlueEditorSubmitRequest, context: BlueUiEventContext) => BlueEditorSubmitValue | Promise<BlueEditorSubmitValue>
}
export interface BlueEditorExtensionRegistry {
  register(contribution: BlueEditorExtensionContribution): BlueRefreshRegistration
  list(): readonly BlueEditorExtensionContribution[]
  subscribe(listener: (entries: readonly BlueEditorExtensionContribution[], revision: number) => void): () => void
}

export interface BlueNotice { readonly id: string, readonly view: BlueView, readonly tone?: BlueTone }
export interface BlueNoticeService { publish(notice: BlueNotice): void }

export type BlueRequestState = 'started' | 'streaming' | 'completed' | 'failed' | 'aborted' | 'interrupted'
export interface BlueRequestRef { readonly sessionEpoch: number, readonly requestEpoch: number, readonly scope: 'main' | 'btw' | 'subagent' }
export interface BlueRequestLifecycle { readonly ref: BlueRequestRef, readonly state: BlueRequestState, readonly reason?: string }
