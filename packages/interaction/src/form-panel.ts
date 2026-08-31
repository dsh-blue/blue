/**
 * Canonical multi-field form controller for editor-slot overlays.
 * Core owns field rendering, masking, focus, and text editing.
 *
 * @module @dsh-blue/blue-interaction/form-panel
 */

import type { BlueJson, BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { interpolateLocaleMessage, type BlueTranslate } from '@dsh-blue/blue-frontend'
import { CanonicalPanelAdapter } from './canonical-panel.ts'
import { ACTION_CANCEL, ACTION_SUBMIT } from './keys.ts'

/** One canonical input field and its interaction validation. */
export interface FormField {
  readonly id: string
  readonly label: string
  readonly mask?: boolean
  readonly required?: boolean
  readonly initial?: string
  readonly validate?: (value: string) => string | undefined
  readonly hint?: string
}

/** Construction options for {@link CanonicalFormController}. */
export interface FormPanelOptions {
  readonly keymap: BlueKeymap
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly title: string
  readonly subtitle?: string
  readonly fields: readonly FormField[]
  readonly onSubmit: (values: Record<string, string>) => void
  readonly onCancel: () => void
  readonly cancelLabel?: string
  readonly onDelete?: () => void
  /** Dynamic translator for package-owned form chrome. */
  readonly t?: BlueTranslate
}

/** Render bullets for compatibility with callers that inspect masked text. */
export function maskRow(text: string): string { return text.length === 0 ? '' : '•'.repeat(text.length) }

/** Canonical form controller preserving advance, validation, and delete keys. */
export class CanonicalFormController implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private active = 0
  private readonly values: Record<string, string>
  private error: string | undefined
  private errorField = -1
  private editing = false
  private submitDirection: 1 | -1 = 1

  constructor(private readonly options: FormPanelOptions) {
    this.values = Object.fromEntries(options.fields.map(field => [field.id, field.initial ?? '']))
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onFocusChange: identity => this.syncActive(identity.controlId),
      ...(options.t === undefined ? {} : { t: options.t }),
      contextHints: () => [
        ...(!this.editing ? [{ id: 'dismiss', keys: 'Esc', label: this.options.cancelLabel ?? 'cancel', priority: 95 }] : []),
        ...(this.editing && this.active === this.options.fields.length - 1
          ? [{ id: 'activate', keys: 'Enter', label: 'submit', priority: 100 }]
          : []),
        ...(this.options.onDelete === undefined ? [] : [{ id: 'delete', keys: 'Ctrl+D', label: 'delete', priority: 85 }]),
      ],
      onTextSubmit: (controlId) => {
        const index = this.options.fields.findIndex(field => field.id === controlId)
        /* v8 ignore next -- core only submits ids from this form. */
        if (index >= 0) this.active = index
        if (!this.validateActive()) return
        this.editing = false
        const next = this.active + this.submitDirection
        if (next >= 0 && next < this.options.fields.length) this.focusIndex(next)
        else if (this.submitDirection > 0) this.submit()
      },
      onUnhandledEscape: options.onCancel,
      /* v8 ignore next -- an empty form has no focus target that can ask for fallback. */
      fallbackFocusIdentity: () => this.options.fields[this.active] === undefined
        ? undefined
        : { controlId: this.options.fields[this.active]!.id },
      startEditing: () => this.editing,
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  setError(text: string | undefined): void {
    this.error = text
    this.errorField = text === undefined ? -1 : this.active
    this.editing = false
    this.adapter.invalidate()
  }

  focusField(id: string): void {
    const index = this.options.fields.findIndex(field => field.id === id)
    if (index >= 0) { this.active = index; this.editing = false; this.adapter.focus({ controlId: id }) }
  }

  handleInput(data: string): void {
    const { keymap } = this.options
    if (data === '\t' || data === '\x1b[Z') {
      this.submitDirection = data === '\t' ? 1 : -1
      this.adapter.handleInput(data)
      this.submitDirection = 1
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      const wasEditing = this.editing
      this.submitDirection = 1
      this.adapter.handleInput(data)
      if (!wasEditing) this.editing = true
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) { this.adapter.handleInput(data); this.editing = false; return }
    if (data === '\x04' && this.options.onDelete !== undefined) { this.options.onDelete(); return }
    this.adapter.handleInput(data)
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  /** Current canonical form overlay. */
  currentNode(): BlueUiNode {
    const t: BlueTranslate = this.options.t ?? interpolateLocaleMessage
    return {
      kind: 'surface', chrome: 'overlay', title: t(this.options.title),
      ...(this.error === undefined && this.options.subtitle !== undefined ? { subtitle: t(this.options.subtitle) } : {}),
      child: {
        kind: 'form', id: 'form-panel',
        fields: this.options.fields.map((field, index) => ({
          kind: field.mask === true ? 'secret' : 'input', id: field.id,
          label: field.hint === undefined ? t(field.label) : `${t(field.label)} · ${t(field.hint)}`,
          value: this.values[field.id]!,
          ...(this.error !== undefined && this.errorField === index ? { error: this.error } : {}),
        })),
      },
    }
  }

  private focusIndex(index: number): void {
    const field = this.options.fields[index]
    /* v8 ignore next -- callers bounds-check the next field index. */
    if (field === undefined) return
    this.editing = false
    this.active = index
    this.adapter.focus({ controlId: field.id })
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind === 'value-change' && typeof event.value === 'string') {
      this.values[event.controlId] = event.value
      this.editing = true
      if (this.error !== undefined) { this.error = undefined; this.errorField = -1; this.adapter.invalidate() }
      return
    }
    if (event.kind === 'submit' && event.controlId === 'form-panel') this.options.onSubmit(event.values as Record<string, string>)
  }

  private submit(): void {
    for (const index of this.options.fields.keys()) {
      this.active = index
      if (!this.validateActive()) return
    }
    const values: Record<string, string> = {}
    for (const field of this.options.fields) values[field.id] = this.values[field.id]!.trim()
    this.onEvent({ kind: 'submit', controlId: 'form-panel', values: values as BlueJson })
  }

  private validateActive(): boolean {
    const field = this.options.fields[this.active]
    /* v8 ignore next -- active is initialized or assigned from this field list. */
    if (field === undefined) return true
    const t: BlueTranslate = this.options.t ?? interpolateLocaleMessage
    const value = this.values[field.id]!.trim()
    const verdict = field.required === true && value.length === 0
      ? t('{label} cannot be empty', { label: t(field.label) })
      : field.validate?.(value)
    if (verdict === undefined) return true
    this.error = verdict
    this.errorField = this.active
    this.editing = true
    this.adapter.focus({ controlId: field.id })
    return false
  }

  private syncActive(controlId: string): void {
    const index = this.options.fields.findIndex(field => field.id === controlId)
    /* v8 ignore next -- core reports only visible fields from this form. */
    if (index < 0 || index === this.active) return
    this.active = index
    this.editing = false
  }
}
