/**
 * Canonical admission for renderer-neutral Blue UI wire trees. The validator
 * copies only known fields, strips terminal controls, enforces quotas, and
 * recursively freezes its output before the renderer sees it.
 *
 * @module @dsh-blue/blue-core/ui-validator
 */

import type {
  BlueActionItem,
  BlueEditorChild,
  BlueEditorShellNode,
  BlueField,
  BlueFormField,
  BlueInlineSpan,
  BlueListItem,
  BlueResult,
  BlueSection,
  BlueStatusChild,
  BlueStatusNode,
  BlueTabItem,
  BlueUiChild,
  BlueUiNode,
  BlueViewportCondition,
  BlueView,
} from '@dsh-blue/blue-api'

/** Maximum aggregate UTF-16 source units accepted in one tree. */
export const BLUE_UI_MAX_TEXT = 20_000
/** Maximum recursive node depth, with the root at depth zero. */
export const BLUE_UI_MAX_DEPTH = 8
/** Maximum number of UI nodes in one tree. */
export const BLUE_UI_MAX_NODES = 256
/** Maximum entries in any wire collection. */
export const BLUE_UI_MAX_COLLECTION = 200

const TERMINAL_SEQUENCE = /(?:(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c)|(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x07|\x1b\\|\x9c)|(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b.)/gu
const UNSAFE_CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f\uf8ff\ufdd0-\ufdef]/gu

type ValidationMode = 'ui' | 'status' | 'editor'

class ValidationFault extends Error {
  constructor(
    readonly code: 'BLUE_INVALID_CONTRIBUTION' | 'BLUE_LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message)
  }
}

interface ValidationState {
  readonly active: WeakSet<object>
  nodes: number
  text: number
  scrollDepth: number
  editorControls: number
  readonly controlIds: Set<string>
}

function invalid(message: string): never {
  throw new ValidationFault('BLUE_INVALID_CONTRIBUTION', message)
}

function limit(message: string): never {
  throw new ValidationFault('BLUE_LIMIT_EXCEEDED', message)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(`${path} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid(`${path} must be a plain object`)
  return value as Record<string, unknown>
}

function own(object: Record<string, unknown>, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (descriptor === undefined) return undefined
  if (!('value' in descriptor)) invalid(`${path}.${key} must be data`)
  return descriptor.value
}

function required(object: Record<string, unknown>, key: string, path: string): unknown {
  const value = own(object, key, path)
  if (value === undefined) invalid(`${path}.${key} is required`)
  return value
}

function text(value: unknown, path: string, state: ValidationState): string {
  if (typeof value !== 'string') invalid(`${path} must be a string`)
  state.text += value.length
  if (state.text > BLUE_UI_MAX_TEXT) limit(`Blue UI text exceeds ${String(BLUE_UI_MAX_TEXT)} characters`)
  return value.replace(TERMINAL_SEQUENCE, '').replace(UNSAFE_CONTROLS, '')
}

function optionalText(object: Record<string, unknown>, key: string, path: string, state: ValidationState): string | undefined {
  const value = own(object, key, path)
  return value === undefined ? undefined : text(value, `${path}.${key}`, state)
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(`${path} must be a boolean`)
  return value
}

function finiteInteger(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalid(`${path} must be a finite integer within the safe range and >= ${String(minimum)}`)
  }
  return value
}

function identifier(value: unknown, path: string, state: ValidationState, reserve = false): string {
  const result = text(value, path, state)
  if (result.trim().length === 0) invalid(`${path} must not be empty`)
  if (reserve) {
    if (state.controlIds.has(result)) invalid(`control id "${result}" is duplicated`)
    state.controlIds.add(result)
  }
  return result
}

function enumeration<Value extends string | number>(value: unknown, values: readonly Value[], path: string): Value {
  if (!values.includes(value as Value)) invalid(`${path} is invalid`)
  return value as Value
}

function collection(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${path} must be an array`)
  if (Object.getPrototypeOf(value) !== Array.prototype) invalid(`${path} must be a plain array`)
  const length = Object.getOwnPropertyDescriptor(value, 'length')!.value as number
  if (length > BLUE_UI_MAX_COLLECTION) limit(`${path} exceeds ${String(BLUE_UI_MAX_COLLECTION)} entries`)
  const copy: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined) invalid(`${path} must be a dense array`)
    if (!('value' in descriptor)) invalid(`${path}[${String(index)}] must be data`)
    copy.push(descriptor.value)
  }
  return copy
}

function optional<Value>(value: Value | undefined, key: string): { readonly [name: string]: Value } | {} {
  return value === undefined ? {} : { [key]: value }
}

function enter<Value>(value: unknown, path: string, state: ValidationState, visit: (object: Record<string, unknown>) => Value): Value {
  const object = record(value, path)
  if (state.active.has(object)) invalid(`${path} contains a cycle`)
  state.active.add(object)
  try {
    return visit(object)
  } finally {
    state.active.delete(object)
  }
}

function span(value: unknown, path: string, state: ValidationState): BlueInlineSpan {
  return enter(value, path, state, object => {
    const toneValue = own(object, 'tone', path)
    const emphasisValue = own(object, 'emphasis', path)
    const tone = toneValue === undefined ? undefined : enumeration(toneValue, ['default', 'muted', 'accent', 'success', 'warning', 'danger'], `${path}.tone`)
    const emphasis = emphasisValue === undefined ? undefined : enumeration(emphasisValue, ['normal', 'strong'], `${path}.emphasis`)
    return { text: text(required(object, 'text', path), `${path}.text`, state), ...optional(tone, 'tone'), ...optional(emphasis, 'emphasis') }
  })
}

function spans(value: unknown, path: string, state: ValidationState): readonly BlueInlineSpan[] {
  return collection(value, path).map((entry, index) => span(entry, `${path}[${String(index)}]`, state))
}

function field(value: unknown, path: string, state: ValidationState): BlueField {
  return enter(value, path, state, object => ({
    label: text(required(object, 'label', path), `${path}.label`, state),
    value: spans(required(object, 'value', path), `${path}.value`, state),
  }))
}

function listItem(value: unknown, path: string, state: ValidationState): BlueListItem {
  return enter(value, path, state, object => {
    const disabledValue = own(object, 'disabled', path)
    const detailSpansValue = own(object, 'detailSpans', path)
    return {
      id: text(required(object, 'id', path), `${path}.id`, state),
      label: text(required(object, 'label', path), `${path}.label`, state),
      ...optional(optionalText(object, 'detail', path, state), 'detail'),
      ...optional(detailSpansValue === undefined ? undefined : spans(detailSpansValue, `${path}.detailSpans`, state), 'detailSpans'),
      ...optional(optionalText(object, 'badge', path, state), 'badge'),
      ...optional(optionalText(object, 'group', path, state), 'group'),
      ...optional(disabledValue === undefined ? undefined : boolean(disabledValue, `${path}.disabled`), 'disabled'),
    }
  })
}

function actionItem(value: unknown, path: string, state: ValidationState): BlueActionItem {
  return enter(value, path, state, object => {
    const intentValue = own(object, 'intent', path)
    const disabledValue = own(object, 'disabled', path)
    const busyValue = own(object, 'busy', path)
    return {
      id: text(required(object, 'id', path), `${path}.id`, state),
      label: text(required(object, 'label', path), `${path}.label`, state),
      ...optional(intentValue === undefined ? undefined : enumeration(intentValue, ['primary', 'secondary', 'danger'], `${path}.intent`), 'intent'),
      ...optional(disabledValue === undefined ? undefined : boolean(disabledValue, `${path}.disabled`), 'disabled'),
      ...optional(busyValue === undefined ? undefined : boolean(busyValue, `${path}.busy`), 'busy'),
      ...optional(optionalText(object, 'confirm', path, state), 'confirm'),
    }
  })
}

function uniqueIds(items: readonly { readonly id: string }[], path: string): void {
  if (new Set(items.map(item => item.id)).size !== items.length) invalid(`${path} contains duplicate ids`)
}

function viewportCondition(value: unknown, path: string): BlueViewportCondition {
  return enter(value, path, { active: new WeakSet(), nodes: 0, text: 0, scrollDepth: 0, editorControls: 0, controlIds: new Set() }, object => {
    const result: { minWidth?: number, maxWidth?: number, minHeight?: number, maxHeight?: number } = {}
    for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
      const item = own(object, key, path)
      if (item !== undefined) result[key] = finiteInteger(item, `${path}.${key}`)
    }
    if (result.minWidth !== undefined && result.maxWidth !== undefined && result.minWidth > result.maxWidth) invalid(`${path} width range is inverted`)
    if (result.minHeight !== undefined && result.maxHeight !== undefined && result.minHeight > result.maxHeight) invalid(`${path} height range is inverted`)
    return result
  })
}

function uiChild<Node>(value: unknown, path: string, state: ValidationState, depth: number, parseNode: (value: unknown, path: string, state: ValidationState, depth: number) => Node): Omit<BlueUiChild, 'node'> & { readonly node: Node } {
  return enter(value, path, state, object => {
    const basisValue = own(object, 'basis', path)
    const basis = basisValue === undefined ? undefined : basisValue === 'auto' ? 'auto' : finiteInteger(basisValue, `${path}.basis`)
    const growValue = own(object, 'grow', path)
    const shrinkValue = own(object, 'shrink', path)
    const minValue = own(object, 'minSize', path)
    const maxValue = own(object, 'maxSize', path)
    const whenValue = own(object, 'when', path)
    const minSize = minValue === undefined ? undefined : finiteInteger(minValue, `${path}.minSize`)
    const maxSize = maxValue === undefined ? undefined : finiteInteger(maxValue, `${path}.maxSize`)
    if (minSize !== undefined && maxSize !== undefined && minSize > maxSize) invalid(`${path} size range is inverted`)
    return {
      node: parseNode(required(object, 'node', path), `${path}.node`, state, depth),
      ...optional(basis, 'basis'),
      ...optional(growValue === undefined ? undefined : finiteInteger(growValue, `${path}.grow`), 'grow'),
      ...optional(shrinkValue === undefined ? undefined : finiteInteger(shrinkValue, `${path}.shrink`), 'shrink'),
      ...optional(minSize, 'minSize'),
      ...optional(maxSize, 'maxSize'),
      ...optional(whenValue === undefined ? undefined : viewportCondition(whenValue, `${path}.when`), 'when'),
    }
  })
}

function view(value: unknown, path: string, state: ValidationState, depth: number): BlueView {
  return node(value, path, state, depth, 'ui', true)
}

function section(value: unknown, path: string, state: ValidationState, depth: number): BlueSection {
  return enter(value, path, state, object => {
    const collapsedValue = own(object, 'collapsed', path)
    return {
      ...optional(optionalText(object, 'title', path, state), 'title'),
      body: view(required(object, 'body', path), `${path}.body`, state, depth),
      ...optional(collapsedValue === undefined ? undefined : boolean(collapsedValue, `${path}.collapsed`), 'collapsed'),
    }
  })
}

function formField(value: unknown, path: string, state: ValidationState): BlueFormField {
  return enter(value, path, state, object => {
    const kind = enumeration(required(object, 'kind', path), ['input', 'textarea', 'secret', 'select', 'toggle'], `${path}.kind`)
    const id = text(required(object, 'id', path), `${path}.id`, state)
    const label = text(required(object, 'label', path), `${path}.label`, state)
    const error = optionalText(object, 'error', path, state)
    const disabledValue = own(object, 'disabled', path)
    const disabled = disabledValue === undefined ? undefined : boolean(disabledValue, `${path}.disabled`)
    if (kind === 'toggle') return { kind, id, label, value: boolean(required(object, 'value', path), `${path}.value`), ...optional(error, 'error'), ...optional(disabled, 'disabled') }
    if (kind === 'select') {
      const raw = required(object, 'value', path)
      if (raw !== null && typeof raw !== 'string') invalid(`${path}.value must be a string or null`)
      const options = collection(required(object, 'options', path), `${path}.options`).map((item, index) => listItem(item, `${path}.options[${String(index)}]`, state))
      uniqueIds(options, `${path}.options`)
      return { kind, id, label, value: raw, options, ...optional(error, 'error'), ...optional(disabled, 'disabled') }
    }
    return {
      kind,
      id,
      label,
      value: text(required(object, 'value', path), `${path}.value`, state),
      ...optional(optionalText(object, 'placeholder', path, state), 'placeholder'),
      ...optional(error, 'error'),
      ...optional(disabled, 'disabled'),
    }
  })
}

function node(value: unknown, path: string, state: ValidationState, depth: number, mode: 'ui', viewOnly?: false): BlueUiNode
function node(value: unknown, path: string, state: ValidationState, depth: number, mode: 'ui', viewOnly: true): BlueView
function node(value: unknown, path: string, state: ValidationState, depth: number, mode: 'status', viewOnly?: false): BlueStatusNode
function node(value: unknown, path: string, state: ValidationState, depth: number, mode: 'editor', viewOnly?: false, editorSlotAllowed?: boolean): BlueEditorShellNode
function node(value: unknown, path: string, state: ValidationState, depth: number, mode: ValidationMode, viewOnly = false, editorSlotAllowed = false): BlueUiNode | BlueStatusNode | BlueEditorShellNode {
  if (depth > BLUE_UI_MAX_DEPTH) limit(`Blue UI depth exceeds ${String(BLUE_UI_MAX_DEPTH)}`)
  state.nodes += 1
  if (state.nodes > BLUE_UI_MAX_NODES) limit(`Blue UI tree exceeds ${String(BLUE_UI_MAX_NODES)} nodes`)
  return enter(value, path, state, object => {
    const kind = own(object, 'kind', path)
    if (typeof kind !== 'string') invalid(`${path}.kind must be a string`)
    if (kind === 'editor-control') {
      if (mode !== 'editor' || !editorSlotAllowed) invalid('editor-control is only valid in an editor shell slot')
      state.editorControls += 1
      return { kind }
    }
    if (mode === 'status' && !['text', 'rich-text', 'fields', 'progress', 'stack'].includes(kind)) invalid(`status node kind "${kind}" is interactive or unsupported`)
    if (viewOnly && !['text', 'fields', 'code', 'diff', 'sections'].includes(kind)) invalid(`${path} must be a BlueView`)
    switch (kind) {
      case 'text': {
        const toneValue = own(object, 'tone', path)
        return { kind, content: text(required(object, 'content', path), `${path}.content`, state), ...optional(toneValue === undefined ? undefined : enumeration(toneValue, ['default', 'muted', 'accent', 'success', 'warning', 'danger'], `${path}.tone`), 'tone') }
      }
      case 'fields': return { kind, rows: collection(required(object, 'rows', path), `${path}.rows`).map((item, index) => field(item, `${path}.rows[${String(index)}]`, state)) }
      case 'code': return { kind, code: text(required(object, 'code', path), `${path}.code`, state), ...optional(optionalText(object, 'language', path, state), 'language') }
      case 'diff': return { kind, before: text(required(object, 'before', path), `${path}.before`, state), after: text(required(object, 'after', path), `${path}.after`, state) }
      case 'sections': return { kind, sections: collection(required(object, 'sections', path), `${path}.sections`).map((item, index) => section(item, `${path}.sections[${String(index)}]`, state, depth + 1)) }
      case 'rich-text': return { kind, spans: spans(required(object, 'spans', path), `${path}.spans`, state) }
      case 'stack': {
        const gapValue = own(object, 'gap', path)
        const alignValue = own(object, 'align', path)
        const stack = {
          kind,
          direction: enumeration(required(object, 'direction', path), ['row', 'column'], `${path}.direction`),
          ...optional(gapValue === undefined ? undefined : enumeration(gapValue, [0, 1, 2] as const, `${path}.gap`), 'gap'),
          ...optional(alignValue === undefined ? undefined : enumeration(alignValue, ['stretch', 'start', 'center', 'end'], `${path}.align`), 'align'),
        } as const
        const entries = collection(required(object, 'children', path), `${path}.children`)
        if (mode === 'status') {
          const children: readonly BlueStatusChild[] = entries.map((item, index) => uiChild(item, `${path}.children[${String(index)}]`, state, depth + 1, (child, childPath, childState, childDepth) => node(child, childPath, childState, childDepth, 'status')))
          return { ...stack, children }
        }
        if (mode === 'editor') {
          const children: readonly BlueEditorChild[] = entries.map((item, index) => uiChild(item, `${path}.children[${String(index)}]`, state, depth + 1, (child, childPath, childState, childDepth) => node(child, childPath, childState, childDepth, 'editor', false, true)))
          return { ...stack, children }
        }
        const children: readonly BlueUiChild[] = entries.map((item, index) => uiChild(item, `${path}.children[${String(index)}]`, state, depth + 1, (child, childPath, childState, childDepth) => node(child, childPath, childState, childDepth, 'ui')))
        return { ...stack, children }
      }
      case 'surface': {
        const chromeValue = own(object, 'chrome', path)
        const paddingValue = own(object, 'padding', path)
        const badgesValue = own(object, 'badges', path)
        const footerValue = own(object, 'footer', path)
        const surface = { kind, ...optional(optionalText(object, 'title', path, state), 'title'), ...optional(optionalText(object, 'subtitle', path, state), 'subtitle'), ...optional(badgesValue === undefined ? undefined : spans(badgesValue, `${path}.badges`, state), 'badges'), ...optional(chromeValue === undefined ? undefined : enumeration(chromeValue, ['none', 'lane', 'surface', 'overlay'], `${path}.chrome`), 'chrome'), ...optional(paddingValue === undefined ? undefined : enumeration(paddingValue, [0, 1, 2] as const, `${path}.padding`), 'padding') } as const
        if (mode === 'editor') {
          const child = node(required(object, 'child', path), `${path}.child`, state, depth + 1, 'editor', false, true)
          const footer = footerValue === undefined ? undefined : node(footerValue, `${path}.footer`, state, depth + 1, 'editor', false, true)
          return { ...surface, child, ...optional(footer, 'footer') }
        }
        const child = node(required(object, 'child', path), `${path}.child`, state, depth + 1, 'ui')
        const footer = footerValue === undefined ? undefined : node(footerValue, `${path}.footer`, state, depth + 1, 'ui')
        return { ...surface, child, ...optional(footer, 'footer') }
      }
      case 'scroll': {
        if (state.scrollDepth > 0) invalid('nested scroll nodes are not supported')
        const followValue = own(object, 'follow', path)
        const scrollbarValue = own(object, 'scrollbar', path)
        state.scrollDepth += 1
        try {
          return { kind, child: node(required(object, 'child', path), `${path}.child`, state, depth + 1, 'ui'), ...optional(followValue === undefined ? undefined : enumeration(followValue, ['none', 'start', 'end'], `${path}.follow`), 'follow'), ...optional(scrollbarValue === undefined ? undefined : boolean(scrollbarValue, `${path}.scrollbar`), 'scrollbar') }
        } finally {
          state.scrollDepth -= 1
        }
      }
      case 'tabs': {
        const items = collection(required(object, 'items', path), `${path}.items`).map((item, index): BlueTabItem => enter(item, `${path}.items[${String(index)}]`, state, entry => {
          const disabledValue = own(entry, 'disabled', `${path}.items[${String(index)}]`)
          const countValue = own(entry, 'count', `${path}.items[${String(index)}]`)
          return { id: text(required(entry, 'id', path), `${path}.items[${String(index)}].id`, state), label: text(required(entry, 'label', path), `${path}.items[${String(index)}].label`, state), ...optional(disabledValue === undefined ? undefined : boolean(disabledValue, `${path}.items[${String(index)}].disabled`), 'disabled'), ...optional(countValue === undefined ? undefined : finiteInteger(countValue, `${path}.items[${String(index)}].count`), 'count') }
        }))
        uniqueIds(items, `${path}.items`)
        const activeId = identifier(required(object, 'activeId', path), `${path}.activeId`, state)
        if (!items.some(item => item.id === activeId)) invalid(`${path}.activeId is not present in items`)
        return { kind, id: identifier(required(object, 'id', path), `${path}.id`, state, true), activeId, items }
      }
      case 'list': {
        const modeValue = own(object, 'mode', path)
        const emptyValue = own(object, 'empty', path)
        const items = collection(required(object, 'items', path), `${path}.items`).map((item, index) => listItem(item, `${path}.items[${String(index)}]`, state))
        uniqueIds(items, `${path}.items`)
        const selectedIds = collection(required(object, 'selectedIds', path), `${path}.selectedIds`).map((item, index) => text(item, `${path}.selectedIds[${String(index)}]`, state))
        if (new Set(selectedIds).size !== selectedIds.length) invalid(`${path}.selectedIds contains duplicate ids`)
        if ((modeValue ?? 'single') === 'single' && selectedIds.length > 1) invalid(`${path}.selectedIds has more than one id in single mode`)
        if (selectedIds.some(id => !items.some(item => item.id === id))) invalid(`${path}.selectedIds contains an unknown id`)
        return { kind, id: identifier(required(object, 'id', path), `${path}.id`, state, true), ...optional(modeValue === undefined ? undefined : enumeration(modeValue, ['single', 'multiple'], `${path}.mode`), 'mode'), selectedIds, items, ...optional(optionalText(object, 'filter', path, state), 'filter'), ...optional(emptyValue === undefined ? undefined : node(emptyValue, `${path}.empty`, state, depth + 1, 'ui'), 'empty') }
      }
      case 'form': {
        const fields = collection(required(object, 'fields', path), `${path}.fields`).map((item, index) => formField(item, `${path}.fields[${String(index)}]`, state))
        uniqueIds(fields, `${path}.fields`)
        const id = identifier(required(object, 'id', path), `${path}.id`, state, true)
        for (const field of fields) {
          if (field.id.trim().length === 0) invalid(`${path}.fields id must not be empty`)
          if (state.controlIds.has(field.id)) invalid(`control id "${field.id}" is duplicated`)
          state.controlIds.add(field.id)
        }
        const submitActionId = optionalText(object, 'submitActionId', path, state)
        const cancelActionId = optionalText(object, 'cancelActionId', path, state)
        for (const actionId of [submitActionId, cancelActionId]) if (actionId !== undefined) {
          if (actionId.trim().length === 0) invalid(`${path} action id must not be empty`)
          if (state.controlIds.has(actionId)) invalid(`control id "${actionId}" is duplicated`)
          state.controlIds.add(actionId)
        }
        return { kind, id, fields, ...optional(submitActionId, 'submitActionId'), ...optional(cancelActionId, 'cancelActionId') }
      }
      case 'actions': {
        const items = collection(required(object, 'items', path), `${path}.items`).map((item, index) => actionItem(item, `${path}.items[${String(index)}]`, state))
        uniqueIds(items, `${path}.items`)
        for (const item of items) {
          if (item.id.trim().length === 0) invalid(`${path}.items id must not be empty`)
          if (state.controlIds.has(item.id)) invalid(`control id "${item.id}" is duplicated`)
          state.controlIds.add(item.id)
        }
        return { kind, id: text(required(object, 'id', path), `${path}.id`, state), items }
      }
      case 'loader': {
        const variantValue = own(object, 'variant', path)
        const elapsedValue = own(object, 'elapsedMs', path)
        const cancelActionId = optionalText(object, 'cancelActionId', path, state)
        if (cancelActionId !== undefined) {
          if (cancelActionId.trim().length === 0) invalid(`${path}.cancelActionId must not be empty`)
          if (state.controlIds.has(cancelActionId)) invalid(`control id "${cancelActionId}" is duplicated`)
          state.controlIds.add(cancelActionId)
        }
        return { kind, message: text(required(object, 'message', path), `${path}.message`, state), ...optional(variantValue === undefined ? undefined : enumeration(variantValue, ['braille', 'tide'], `${path}.variant`), 'variant'), ...optional(elapsedValue === undefined ? undefined : finiteInteger(elapsedValue, `${path}.elapsedMs`), 'elapsedMs'), ...optional(cancelActionId, 'cancelActionId') }
      }
      case 'empty': {
        const actionsValue = own(object, 'actions', path)
        const actions = actionsValue === undefined ? undefined : node(actionsValue, `${path}.actions`, state, depth + 1, 'ui')
        if (actions !== undefined && actions.kind !== 'actions') invalid(`${path}.actions must be an actions node`)
        return { kind, title: text(required(object, 'title', path), `${path}.title`, state), ...optional(optionalText(object, 'description', path, state), 'description'), ...optional(actions, 'actions') }
      }
      case 'progress': {
        const maximum = finiteInteger(required(object, 'max', path), `${path}.max`, 1)
        const current = finiteInteger(required(object, 'value', path), `${path}.value`)
        return { kind, ...optional(optionalText(object, 'label', path, state), 'label'), value: Math.min(current, maximum), max: maximum }
      }
      case 'spacer': {
        const sizeValue = own(object, 'size', path)
        return { kind, ...optional(sizeValue === undefined ? undefined : enumeration(sizeValue, [1, 2] as const, `${path}.size`), 'size') }
      }
      case 'divider': return { kind, ...optional(optionalText(object, 'label', path, state), 'label') }
      default: invalid(`unknown Blue UI kind "${kind}"`)
    }
  })
}

function freeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freeze(child)
  return Object.freeze(value)
}

function validate<Value>(value: unknown, mode: ValidationMode): BlueResult<Value> {
  const state: ValidationState = { active: new WeakSet(), nodes: 0, text: 0, scrollDepth: 0, editorControls: 0, controlIds: new Set() }
  try {
    const result = mode === 'ui'
      ? node(value, '$', state, 0, 'ui')
      : mode === 'status'
        ? node(value, '$', state, 0, 'status')
        : node(value, '$', state, 0, 'editor', false, true)
    if (mode === 'editor' && state.editorControls !== 1) invalid(`editor shell must contain exactly one editor-control; received ${String(state.editorControls)}`)
    return { ok: true, value: freeze(result) as Value }
  } catch (error) {
    if (error instanceof ValidationFault) return { ok: false, code: error.code, message: error.message }
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'Blue UI validation failed safely' }
  }
}

/** Validate, sanitize, canonicalize, and freeze an ordinary public UI tree. */
export function validateBlueUiNode(value: unknown): BlueResult<BlueUiNode> {
  return validate(value, 'ui')
}

/** Validate the recursively narrowed, non-interactive status tree. */
export function validateBlueStatusNode(value: unknown): BlueResult<BlueStatusNode> {
  return validate(value, 'status')
}

/** Validate an editor shell and require exactly one host-owned control slot. */
export function validateBlueEditorShellNode(value: unknown): BlueResult<BlueEditorShellNode> {
  return validate(value, 'editor')
}
