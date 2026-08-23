/** Renderer-neutral frontend data. No renderer objects or async values belong here. */
export type Tone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'
export interface TextView { readonly kind: 'text'; readonly text: string; readonly tone?: Tone }
export interface RichTextView { readonly kind: 'rich-text'; readonly spans: readonly { readonly text: string; readonly tone?: Tone; readonly strong?: boolean }[] }
export interface FieldsView { readonly kind: 'fields'; readonly fields: readonly { readonly label: string; readonly value: string }[] }
export interface SectionsView { readonly kind: 'sections'; readonly sections: readonly { readonly title: string; readonly body: View; readonly collapsed?: boolean }[] }
export interface ListView { readonly kind: 'list'; readonly items: readonly { readonly id: string; readonly label: string; readonly detail?: string; readonly disabled?: boolean; readonly action?: Action }[]; readonly selectedId?: string }
export interface CodeView { readonly kind: 'code'; readonly code: string; readonly language?: string }
export interface DiffView { readonly kind: 'diff'; readonly before: string; readonly after: string; readonly language?: string }
export type View = TextView | RichTextView | FieldsView | SectionsView | ListView | CodeView | DiffView
export type Action = Readonly<{ readonly kind: string; readonly [key: string]: unknown }>
export interface CommandModel { readonly kind: 'command'; readonly id: string; readonly label: string; readonly description?: string; readonly enabled: boolean; readonly action?: Action }
export type PanelModel = Readonly<{ readonly kind: 'panel'; readonly mode: 'select' | 'form' | 'info' | 'loading' | 'error'; readonly title: string; readonly view?: View; readonly submit?: Action; readonly cancel?: Action }>
export interface StatusModel { readonly kind: 'status'; readonly id: string; readonly view: View; readonly priority?: number; readonly band?: 'left' | 'center' | 'right'; readonly row?: 1 | 2; readonly overflow?: 'truncate' | 'hide'; readonly visible: boolean }
export interface DockModel { readonly kind: 'dock'; readonly id: string; readonly view: View; readonly placement: 'left' | 'right' | 'bottom'; readonly priority?: number; readonly preferredRows?: number; readonly collapsed?: boolean }
export interface NotificationModel { readonly kind: 'notification'; readonly id: string; readonly severity: 'info' | 'success' | 'warning' | 'error'; readonly message: string; readonly durationMs?: number; readonly dedupeKey?: string }
export interface ProviderModel { readonly providerId: string; readonly capabilities: readonly string[]; readonly views: readonly View[] }
export interface ToolPresentationModel { readonly kind: 'tool'; readonly id: string; readonly name: string; readonly call?: View; readonly result?: View; readonly expanded?: boolean; readonly action?: Action }
export interface ThemeModel { readonly kind: 'theme'; readonly id: string; readonly name: string; readonly colors: Readonly<Record<string, string>>; readonly dark: boolean }
export interface EditorModel { readonly kind: 'editor'; readonly id: string; readonly value: string; readonly placeholder?: string; readonly enabled: boolean; readonly set?: Action; readonly submit?: Action; readonly abort?: Action }
export interface TranscriptModel { readonly kind: 'transcript'; readonly id: string; readonly entries: readonly View[]; readonly streaming?: boolean }

export function freezeModel<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) if (child && typeof child === 'object') freezeModel(child)
  }
  return value as Readonly<T>
}
