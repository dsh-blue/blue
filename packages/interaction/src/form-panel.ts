/**
 * `FormPanel` — the multi-field dialog form (the kimi
 * `CustomRegistryImportDialogComponent` port over Blue's input primitive):
 * labeled embedded editors, Tab/↑/↓ moving between fields, Enter advancing
 * (submitting from the last field), and an in-panel error line that swaps
 * the subtitle without closing the panel. Masked fields never render the
 * real editor rows — the panel derives a bullet row from the tracked text
 * so a pasted key is never echoed. The panel forwards only text-editing
 * sequences to the focused field's editor; form keys are intercepted ahead
 * of it, so Enter never inserts a newline and arrows never move the caret
 * across lines.
 *
 * @module @dsh-blue/blue-interaction/form-panel
 */

import type { BlueComponents, BlueEditor, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import {
  ACTION_CANCEL,
  ACTION_MOVE_DOWN,
  ACTION_MOVE_UP,
  ACTION_SUBMIT,
} from './keys.ts'

/** One input field of a {@link FormPanel}. */
export interface FormField {
  /** The field's key in the submitted values record. */
  readonly id: string
  /** The rendered label row. */
  readonly label: string
  /** Render bullets instead of the editor rows (API keys). */
  readonly mask?: boolean
  /** Reject submission when the trimmed value is empty. */
  readonly required?: boolean
  /** Pre-fill the editor. */
  readonly initial?: string
  /**
   * Field-level validation: the error line's text when the value is
   * unacceptable, or `undefined` to accept.
   */
  readonly validate?: (value: string) => string | undefined
  /** Extra hint under the label (e.g. the protocol list). */
  readonly hint?: string
}

/** Construction options for {@link FormPanel}. */
export interface FormPanelOptions {
  /** Keybinding registry used to resolve the form keys. */
  readonly keymap: BlueKeymap
  /** Theme supplying the label, error, and rule colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the embedded editors. */
  readonly components: BlueComponents
  /** Dialog title. */
  readonly title: string
  /** Muted line under the title; the error line replaces it when set. */
  readonly subtitle?: string
  /** The fields, in order; must not be empty. */
  readonly fields: readonly FormField[]
  /**
   * Called with every field's current value when the last field's Enter (or
   * an earlier field's Enter on a single-field form) passes validation.
   * @param values - the field id → trimmed text record.
   */
  readonly onSubmit: (values: Record<string, string>) => void
  /** Called when the cancel key is pressed. */
  readonly onCancel: () => void
}

/**
 * Render one input row as bullets, one per character — the masked-field
 * display derived from the tracked text.
 * @param text - the field's current text.
 * @returns the bullet row.
 */
export function maskRow(text: string): string {
  return text.length === 0 ? '' : '•'.repeat(text.length)
}

/**
 * The multi-field form panel. Tab/Shift-Tab/Down move forward, Up moves
 * back, Enter advances (submitting from the last field), Escape cancels;
 * everything else edits the focused field.
 */
export class FormPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private active = 0
  private readonly editors: BlueEditor[]
  private readonly values: Record<string, string> = {}
  private error: string | undefined

  /**
   * @param options - see {@link FormPanelOptions}.
   */
  constructor(private readonly options: FormPanelOptions) {
    this.editors = options.fields.map(field => {
      const editor = options.components.createEditor()
      // onChange first: the fake (and the wrapped editor) fire it
      // synchronously from setText, so the prefill lands in `values`.
      editor.onChange = text => {
        this.values[field.id] = text
        // Any edit clears the error line (kimi's subtitle-swap behavior).
        this.error = undefined
      }
      if (field.initial !== undefined && field.initial.length > 0) editor.setText(field.initial)
      return editor
    })
  }

  /**
   * Show an error line in the panel without closing it — the flow-level
   * failures (a rejected settings write, a shadowed credential) land here.
   * @param text - the error line; `undefined` restores the subtitle.
   */
  setError(text: string | undefined): void {
    this.error = text
  }

  /**
   * Focus one field (the validation failure's jump target).
   * @param id - the field id.
   */
  focusField(id: string): void {
    const index = this.options.fields.findIndex(field => field.id === id)
    if (index >= 0) this.active = index
  }

  /**
   * Dispatch one input sequence: form keys are intercepted ahead of the
   * focused editor, everything else edits it.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap } = this.options
    if (keymap.matches(data, ACTION_MOVE_DOWN) || data === '\t' || data === '\x1b[Z') {
      this.active = (this.active + 1) % this.editors.length
      return
    }
    if (keymap.matches(data, ACTION_MOVE_UP)) {
      this.active = (this.active - 1 + this.editors.length) % this.editors.length
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      if (this.active === this.editors.length - 1) this.submit()
      else this.active += 1
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) {
      this.options.onCancel()
      return
    }
    this.editors[this.active]?.handleInput?.(data)
  }

  /** Drop the editors' cached render state. */
  invalidate(): void {
    for (const editor of this.editors) editor.invalidate()
  }

  /**
   * Render the framed form: the subtitle-or-error line, then per field a
   * label (accent bold when active, muted otherwise), its optional hint,
   * and the input — the editor's own rows, or the derived bullet row for
   * masked fields. The focused editor's `focused` flag tracks the panel's.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { fields, theme } = this.options
    const colors = theme.colors
    const boldOpen = '\x1b[1m'
    const boldClose = '\x1b[22m'
    const lines: string[] = ['', colors.muted(`  ${this.error ?? this.subtitleOrBlank()}`), '']
    fields.forEach((field, index) => {
      const active = index === this.active
      const label = active
        ? `${boldOpen}${colors.accent(`  ${field.label}`)}${boldClose}`
        : colors.muted(`  ${field.label}`)
      lines.push(label)
      if (field.hint !== undefined) lines.push(colors.textMuted(`    ${field.hint}`))
      const editor = this.editors[index]
      /* v8 ignore next -- fields and editors stay index-aligned */
      if (editor === undefined) return
      editor.focused = this.focused && active
      if (field.mask === true) {
        lines.push(colors.text(`  ${maskRow(this.values[field.id] ?? '')}`))
      } else {
        lines.push(...editor.render(width))
      }
      lines.push('')
    })
    /* v8 ignore next -- the form keys are always registered */
    const key = (action: string): string => this.options.keymap.getKeys(action)[0] ?? action
    return framePanel(lines.slice(0, -1), width, {
      title: this.options.title,
      titlePaint: colors.primary,
      rulePaint: colors.primary,
      footer: [
        `tab/↑↓ fields`,
        this.active === fields.length - 1 ? `${key(ACTION_SUBMIT)} submit` : `${key(ACTION_SUBMIT)} next field`,
        `${key(ACTION_CANCEL)} cancel`,
      ],
      footerPaint: colors.textMuted,
    })
  }

  /** The subtitle, or a blank line when the form carries none. */
  private subtitleOrBlank(): string {
    return this.options.subtitle ?? ' '
  }

  /** Validate every field, then submit or surface the first failure. */
  private submit(): void {
    for (const field of this.options.fields) {
      const value = (this.values[field.id] ?? '').trim()
      if (field.required === true && value.length === 0) {
        this.error = `${field.label} cannot be empty`
        this.focusField(field.id)
        return
      }
      const verdict = field.validate?.(value)
      if (verdict !== undefined) {
        this.error = verdict
        this.focusField(field.id)
        return
      }
    }
    const values: Record<string, string> = {}
    for (const field of this.options.fields) {
      values[field.id] = (this.values[field.id] ?? '').trim()
    }
    this.options.onSubmit(values)
  }
}
