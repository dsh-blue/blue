/** Pure builders for Blue's renderer-independent public UI wire format. */
import { BLUE_API_VERSION, validateBlueManifest } from '@dsh-blue/blue-api'
import type {
  BlueActionsNode,
  BlueDividerNode,
  BlueEmptyNode,
  BlueFormNode,
  BlueInlineSpan,
  BlueListNode,
  BlueLoaderNode,
  BlueProgressNode,
  BlueRichTextNode,
  BlueScrollNode,
  BlueSection,
  BlueSpacerNode,
  BlueStackNode,
  BlueSurfaceNode,
  BlueTabsNode,
  BlueUiChild,
  BlueUiNode,
  BlueView,
} from '@dsh-blue/blue-api'

export * from '@dsh-blue/blue-api'

type BlueTextNode = Extract<BlueView, { readonly kind: 'text' }>
type BlueFieldsNode = Extract<BlueView, { readonly kind: 'fields' }>
type BlueCodeNode = Extract<BlueView, { readonly kind: 'code' }>
type BlueDiffNode = Extract<BlueView, { readonly kind: 'diff' }>
type BlueSectionsNode = Extract<BlueView, { readonly kind: 'sections' }>

type TextOptions = Omit<BlueTextNode, 'kind' | 'content'>
type CodeOptions = Omit<BlueCodeNode, 'kind' | 'code'>
type ChildOptions = Omit<BlueUiChild, 'node'>
type StackOptions = Omit<BlueStackNode, 'kind' | 'direction' | 'children'>
type ScrollOptions = Omit<BlueScrollNode, 'kind' | 'child'>
const API_MAJOR = BLUE_API_VERSION.slice(0, BLUE_API_VERSION.indexOf('.'))
const SUPPORTED_API_RANGE = new RegExp(`^\\^?${API_MAJOR}(?:\\.|$)`)

/** Deeply freeze JSON-shaped data while tolerating cycles in hostile input. */
export function deepFreeze<Value>(value: Value): Value {
  const seen = new WeakSet<object>()
  const visit = (current: unknown): void => {
    if (current === null || typeof current !== 'object' || seen.has(current)) return
    seen.add(current)
    for (const child of Object.values(current)) visit(child)
    Object.freeze(current)
  }
  visit(value)
  return value
}

function frozen<Value>(value: Value): Value {
  return deepFreeze(value)
}

function text(content: string, options: TextOptions = {}): BlueTextNode {
  return frozen({ ...options, kind: 'text', content })
}

function fields(rows: BlueFieldsNode['rows']): BlueFieldsNode {
  return frozen({ kind: 'fields', rows })
}

function code(value: string, options: CodeOptions = {}): BlueCodeNode {
  return frozen({ ...options, kind: 'code', code: value })
}

function diff(before: string, after: string): BlueDiffNode {
  return frozen({ kind: 'diff', before, after })
}

function sections(value: readonly BlueSection[]): BlueSectionsNode {
  return frozen({ kind: 'sections', sections: value })
}

function richText(spans: readonly BlueInlineSpan[]): BlueRichTextNode {
  return frozen({ kind: 'rich-text', spans })
}

function child(node: BlueUiNode, options: ChildOptions = {}): BlueUiChild {
  return frozen({ ...options, node })
}

function stack(direction: BlueStackNode['direction'], children: readonly BlueUiChild[], options: StackOptions = {}): BlueStackNode {
  return frozen({ ...options, kind: 'stack', direction, children })
}

function surface(options: Omit<BlueSurfaceNode, 'kind'>): BlueSurfaceNode {
  return frozen({ ...options, kind: 'surface' })
}

function scroll(node: BlueUiNode, options: ScrollOptions = {}): BlueScrollNode {
  return frozen({ ...options, kind: 'scroll', child: node })
}

function tabs(options: Omit<BlueTabsNode, 'kind'>): BlueTabsNode {
  return frozen({ ...options, kind: 'tabs' })
}

function list(options: Omit<BlueListNode, 'kind'>): BlueListNode {
  return frozen({ ...options, kind: 'list' })
}

function form(options: Omit<BlueFormNode, 'kind'>): BlueFormNode {
  return frozen({ ...options, kind: 'form' })
}

function actions(options: Omit<BlueActionsNode, 'kind'>): BlueActionsNode {
  return frozen({ ...options, kind: 'actions' })
}

function loader(options: Omit<BlueLoaderNode, 'kind'>): BlueLoaderNode {
  return frozen({ ...options, kind: 'loader' })
}

function empty(options: Omit<BlueEmptyNode, 'kind'>): BlueEmptyNode {
  return frozen({ ...options, kind: 'empty' })
}

function progress(options: Omit<BlueProgressNode, 'kind'>): BlueProgressNode {
  return frozen({ ...options, kind: 'progress' })
}

function spacer(options: Omit<BlueSpacerNode, 'kind'> = {}): BlueSpacerNode {
  return frozen({ ...options, kind: 'spacer' })
}

function divider(options: Omit<BlueDividerNode, 'kind'> = {}): BlueDividerNode {
  return frozen({ ...options, kind: 'divider' })
}

/** Pure builder namespace. Every result is recursively frozen. */
export const ui = Object.freeze({
  text,
  fields,
  code,
  diff,
  sections,
  richText,
  child,
  stack: Object.freeze({
    row: (children: readonly BlueUiChild[], options?: StackOptions) => stack('row', children, options),
    column: (children: readonly BlueUiChild[], options?: StackOptions) => stack('column', children, options),
  }),
  surface,
  scroll,
  tabs,
  list,
  form,
  actions,
  loader,
  empty,
  progress,
  spacer,
  divider,
})

/** User-kit component metadata and renderer before runtime hardening. */
export interface BlueComponentDefinition<Props> {
  readonly id: string
  readonly api: string
  readonly render: (props: Props) => BlueUiNode
}

/** Pure component factory returned to official packages and third-party kits. */
export interface BlueComponentFactory<Props> {
  readonly id: string
  readonly api: string
  readonly render: (props: Props) => BlueUiNode
}

/** Define a pure component factory; core remains responsible for node validation. */
export function defineBlueComponent<Props>(definition: BlueComponentDefinition<Props>): BlueComponentFactory<Props> {
  if (definition === null || typeof definition !== 'object') throw new TypeError('Blue component definition must be an object')
  const validation = validateBlueManifest({ id: definition.id, api: definition.api, capabilities: [] })
  if (!validation.ok) throw new TypeError(`Invalid Blue component: ${validation.message}`)
  if (!SUPPORTED_API_RANGE.test(definition.api)) throw new TypeError(`Unsupported Blue component API range "${definition.api}"`)
  if (typeof definition.render !== 'function') throw new TypeError('Blue component render must be a function')
  return Object.freeze({
    id: definition.id,
    api: definition.api,
    render: (props: Props): BlueUiNode => deepFreeze(definition.render(props)),
  })
}
