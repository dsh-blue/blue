/**
 * Canonical multi-field form controller for editor-slot overlays.
 * Core owns field rendering, masking, focus, and text editing.
 *
 * @module @dsh-blue/blue-interaction/form-panel
 */

import type { BlueJson, BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { CanonicalPanelAdapter } from './canonical-panel.ts'
import { ACTION_CANCEL, ACTION_MOVE_DOWN, ACTION_MOVE_UP, ACTION_SUBMIT } from './keys.ts'

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

  constructor(private readonly options: FormPanelOptions) {
    this.values = Object.fromEntries(options.fields.map(field => [field.id, field.initial ?? '']))
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onTextSubmit: () => {
        if (this.active === this.options.fields.length - 1) this.submit()
        else this.move(1)
      },
      onUnhandledEscape: options.onCancel,
      focusIndex: () => this.active,
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  setError(text: string | undefined): void {
    this.error = text
    this.errorField = text === undefined ? -1 : this.active
    this.adapter.invalidate()
  }

  focusField(id: string): void {
    const index = this.options.fields.findIndex(field => field.id === id)
    if (index >= 0) { this.active = index; this.adapter.invalidate() }
  }

  handleInput(data: string): void {
    const { keymap } = this.options
    if (keymap.matches(data, ACTION_MOVE_DOWN) || data === '\t') { this.move(1); return }
    if (keymap.matches(data, ACTION_MOVE_UP) || data === '\x1b[Z') { this.move(-1); return }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      this.adapter.handleInput(data)
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) { this.options.onCancel(); return }
    if (data === '\x04' && this.options.onDelete !== undefined) { this.options.onDelete(); return }
    this.adapter.handleInput(data)
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  /** Current canonical form overlay. */
  currentNode(): BlueUiNode {
    const cancel = this.options.cancelLabel ?? 'cancel'
    const deleteHint = this.options.onDelete === undefined ? '' : ' · Ctrl+D delete'
    return {
      kind: 'surface', chrome: 'overlay', title: this.options.title,
      ...(this.error === undefined && this.options.subtitle !== undefined ? { subtitle: this.options.subtitle } : {}),
      child: {
        kind: 'form', id: 'form-panel',
        fields: this.options.fields.map((field, index) => ({
          kind: field.mask === true ? 'secret' : 'input', id: field.id,
          label: field.hint === undefined ? field.label : `${field.label} · ${field.hint}`,
          value: this.values[field.id]!,
          ...(this.error !== undefined && this.errorField === index ? { error: this.error } : {}),
        })),
      },
      footer: { kind: 'text', content: `Tab / ↑↓ fields · Enter submit · Esc ${cancel}${deleteHint}`, tone: 'muted' },
    }
  }

  private move(delta: 1 | -1): void {
    const count = this.options.fields.length
    if (count === 0) return
    this.active = (this.active + count + delta) % count
    this.adapter.handleInput(delta === 1 ? '\t' : '\x1b[Z')
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind === 'value-change' && typeof event.value === 'string') {
      this.values[event.controlId] = event.value
      if (this.error !== undefined) { this.error = undefined; this.errorField = -1; this.adapter.invalidate() }
      return
    }
    if (event.kind === 'submit' && event.controlId === 'form-panel') this.options.onSubmit(event.values as Record<string, string>)
  }

  private submit(): void {
    for (const [index, field] of this.options.fields.entries()) {
      const value = this.values[field.id]!.trim()
      const verdict = field.required === true && value.length === 0 ? `${field.label} cannot be empty` : field.validate?.(value)
      if (verdict !== undefined) {
        this.active = index
        this.error = verdict
        this.errorField = index
        this.adapter.invalidate()
        return
      }
    }
    const values: Record<string, string> = {}
    for (const field of this.options.fields) values[field.id] = this.values[field.id]!.trim()
    this.onEvent({ kind: 'submit', controlId: 'form-panel', values: values as BlueJson })
  }
}
