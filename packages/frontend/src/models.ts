/** Renderer-neutral frontend data. No renderer objects or async values belong here. */
export type Tone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'
export interface TextView { readonly kind: 'text'; readonly text: string; readonly tone?: Tone }
export interface RichTextView { readonly kind: 'rich-text'; readonly spans: readonly { readonly text: string; readonly tone?: Tone; readonly strong?: boolean }[] }
export interface FieldsView { readonly kind: 'fields'; readonly fields: readonly { readonly label: string; readonly value: string }[] }
export interface SectionsView { readonly kind: 'sections'; readonly sections: readonly { readonly title: string; readonly body: View; readonly collapsed?: boolean }[] }
export interface ListItemVariant { readonly id: string; readonly label: string; readonly action?: Action; readonly secondaryAction?: Action }
export interface ListViewItem { readonly id: string; readonly label: string; readonly detail?: string; readonly disabled?: boolean; readonly action?: Action; readonly secondaryAction?: Action; readonly group?: string; readonly variants?: readonly ListItemVariant[]; readonly selectedVariantId?: string }
export interface ListView { readonly kind: 'list'; readonly items: readonly ListViewItem[]; readonly selectedId?: string; readonly filterable?: boolean; readonly grouped?: boolean; readonly includeAllGroup?: boolean; readonly groups?: readonly string[] }
export interface CodeView { readonly kind: 'code'; readonly code: string; readonly language?: string }
export interface DiffView { readonly kind: 'diff'; readonly before: string; readonly after: string; readonly language?: string }
export type View = TextView | RichTextView | FieldsView | SectionsView | ListView | CodeView | DiffView
export type Action = Readonly<{ readonly kind: string; readonly [key: string]: unknown }>
export interface CommandModel { readonly kind: 'command'; readonly id: string; readonly label: string; readonly description?: string; readonly enabled: boolean; readonly action?: Action }
export type PanelModel = Readonly<{ readonly kind: 'panel'; readonly mode: 'select' | 'form' | 'info' | 'loading' | 'error'; readonly title: string; readonly header?: View; readonly view?: View; readonly submit?: Action; readonly cancel?: Action; readonly dismissible?: boolean }>
export interface StatusModel { readonly kind: 'status'; readonly id: string; readonly view: View; readonly priority?: number; readonly band?: 'left' | 'center' | 'right'; readonly row?: 1 | 2; readonly overflow?: 'truncate' | 'hide'; readonly visible: boolean }
export interface DockModel { readonly kind: 'dock'; readonly id: string; readonly view: View; readonly placement: 'left' | 'right' | 'bottom'; readonly priority?: number; readonly preferredRows?: number; readonly collapsed?: boolean }
export interface NotificationModel { readonly kind: 'notification'; readonly id: string; readonly severity: 'info' | 'success' | 'warning' | 'error'; readonly message: string; readonly durationMs?: number; readonly dedupeKey?: string }
export interface ProviderModel { readonly providerId: string; readonly capabilities: readonly string[]; readonly views: readonly View[] }
export interface ToolPresentationModel { readonly kind: 'tool'; readonly id: string; readonly name: string; readonly call?: View; readonly result?: View; readonly expanded?: boolean; readonly action?: Action }
export interface ThemeModel { readonly kind: 'theme'; readonly id: string; readonly name: string; readonly colors: Readonly<Record<string, string>>; readonly dark: boolean }
export interface EditorModel { readonly kind: 'editor'; readonly id: string; readonly value: string; readonly placeholder?: string; readonly enabled: boolean; readonly set?: Action; readonly submit?: Action; readonly abort?: Action }
export interface TranscriptImageModel { readonly attachmentId: string; readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; readonly bytes: number; readonly width: number; readonly height: number; readonly name?: string | undefined; readonly originalDimensions?: Readonly<{ readonly width: number; readonly height: number }> | undefined }
export interface TranscriptUserModel { readonly kind: 'transcript-user'; readonly id: string; readonly seq: number; readonly turn: number; readonly text: string; readonly images: readonly TranscriptImageModel[] }
export interface TranscriptAssistantModel { readonly kind: 'transcript-assistant'; readonly id: string; readonly seq: number; readonly turn: number; readonly step: number; readonly text: string; readonly streaming: boolean }
export interface TranscriptThinkingModel { readonly kind: 'transcript-thinking'; readonly id: string; readonly seq: number; readonly turn: number; readonly step: number; readonly text: string; readonly streaming: boolean }
export interface TranscriptToolResultModel { readonly text: string; readonly fullText?: string; readonly isError: boolean; readonly endedAt: number }
export interface TranscriptToolModel { readonly kind: 'transcript-tool'; readonly id: string; readonly seq: number; readonly turn: number; readonly step: number; readonly callId: string; readonly name: string; readonly arguments: string; readonly startedAt: number; readonly result?: TranscriptToolResultModel; readonly presentation?: ToolPresentationModel }
export interface TranscriptErrorModel { readonly kind: 'transcript-error'; readonly id: string; readonly seq: number; readonly turn: number; readonly message: string; readonly code?: string }
export interface TranscriptInterruptedModel { readonly kind: 'transcript-interrupted'; readonly id: string; readonly seq: number; readonly turn: number }
export type TranscriptEntryModel = TranscriptUserModel | TranscriptAssistantModel | TranscriptThinkingModel | TranscriptToolModel | TranscriptErrorModel | TranscriptInterruptedModel
export interface TranscriptModel { readonly kind: 'transcript'; readonly id: string; readonly entries: readonly (View | TranscriptEntryModel)[]; readonly streaming?: boolean }

export function freezeModel<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) if (child && typeof child === 'object') freezeModel(child)
  }
  return value as Readonly<T>
}
