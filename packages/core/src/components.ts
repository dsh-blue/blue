/**
 * `ctx.blueComponents` service: the L1 component factory. Maps the active
 * semantic color table to pi-tui's per-component themes inside L0, so the
 * color-table → renderer-theme mapping lives in exactly one place and no
 * pi-tui type crosses the package boundary. Width helpers are re-exported
 * under Blue signatures, passing straight through to pi-tui.
 *
 * @module @deepseek-ai/dsh-blue-core/components
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  Editor,
  Markdown,
  SelectList,
  SettingsList,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type EditorOptions,
  type EditorTheme,
  type MarkdownTheme,
  type SelectListTheme,
  type SettingItem,
  type SettingsListTheme,
  type TUI,
} from '@earendil-works/pi-tui'
import type {
  BlueAutocompleteProvider,
  BlueColorFn,
  BlueComponents,
  BlueEditor,
  BlueEditorOptions,
  BlueMarkdown,
  BlueMarkdownOptions,
  BlueSelectItem,
  BlueSelectList,
  BlueSelectListOptions,
  BlueSemanticColors,
  BlueSettingsList,
  BlueSettingsListOptions,
  BlueTheme,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueComponents: BlueComponentsService
  }
}

/** Map the palette to an editor theme: border plus autocomplete dropdown. */
function editorTheme(colors: BlueSemanticColors): EditorTheme {
  return { borderColor: colors.border, selectList: selectListTheme(colors) }
}

/** Map the palette to a select-list theme. */
function selectListTheme(colors: BlueSemanticColors): SelectListTheme {
  return {
    selectedPrefix: colors.accent,
    selectedText: colors.accent,
    description: colors.muted,
    scrollInfo: colors.muted,
    noMatch: colors.warning,
  }
}

/** Map the palette to a markdown theme: the ten md* tokens plus emphasis. */
function markdownTheme(colors: BlueSemanticColors): MarkdownTheme {
  return {
    heading: colors.mdHeading,
    link: colors.mdLink,
    linkUrl: colors.mdLinkUrl,
    code: colors.mdCode,
    codeBlock: colors.mdCodeBlock,
    codeBlockBorder: colors.mdCodeBlockBorder,
    quote: colors.mdQuote,
    quoteBorder: colors.mdQuoteBorder,
    hr: colors.mdHr,
    listBullet: colors.mdListBullet,
    bold: colors.textStrong,
    italic: colors.text,
    strikethrough: colors.muted,
    underline: colors.text,
  }
}

/** Map the palette to a settings-list theme; `cursor` is a plain string. */
function settingsListTheme(colors: BlueSemanticColors): SettingsListTheme {
  return {
    label: (text, selected) => (selected ? colors.accent(text) : colors.text(text)),
    value: (text, selected) => (selected ? colors.accent(text) : colors.muted(text)),
    description: colors.muted,
    cursor: colors.accent('❯ '),
    hint: colors.muted,
  }
}

/** Delegate exposing a pi-tui `Editor` through the Blue contract. */
class EditorAdapter implements BlueEditor {
  constructor(private readonly editor: Editor) {}

  get focused(): boolean {
    return this.editor.focused
  }

  set focused(value: boolean) {
    this.editor.focused = value
  }

  get onSubmit(): ((text: string) => void) | undefined {
    return this.editor.onSubmit
  }

  set onSubmit(callback: ((text: string) => void) | undefined) {
    if (callback === undefined) delete this.editor.onSubmit
    else this.editor.onSubmit = callback
  }

  get onChange(): ((text: string) => void) | undefined {
    return this.editor.onChange
  }

  set onChange(callback: ((text: string) => void) | undefined) {
    if (callback === undefined) delete this.editor.onChange
    else this.editor.onChange = callback
  }

  get disableSubmit(): boolean {
    return this.editor.disableSubmit
  }

  set disableSubmit(value: boolean) {
    this.editor.disableSubmit = value
  }

  getText(): string {
    return this.editor.getText()
  }

  setText(text: string): void {
    this.editor.setText(text)
  }

  addToHistory(text: string): void {
    this.editor.addToHistory(text)
  }

  setBorderColor(color: BlueColorFn): void {
    this.editor.borderColor = color
  }

  setAutocompleteProvider(provider: BlueAutocompleteProvider): void {
    // BlueAutocompleteProvider is structurally identical to pi-tui's
    // AutocompleteProvider, so it passes through without wrapping; the pi-tui
    // type itself never crosses the Blue signature.
    this.editor.setAutocompleteProvider(provider)
  }

  getExpandedText(): string {
    return this.editor.getExpandedText()
  }

  render(width: number): string[] {
    return this.editor.render(width)
  }

  handleInput(data: string): void {
    this.editor.handleInput(data)
  }

  invalidate(): void {
    this.editor.invalidate()
  }
}

/** Delegate exposing a pi-tui `Markdown` through the Blue contract. */
class MarkdownAdapter implements BlueMarkdown {
  constructor(private readonly markdown: Markdown) {}

  setText(text: string): void {
    this.markdown.setText(text)
  }

  render(width: number): string[] {
    return this.markdown.render(width)
  }

  invalidate(): void {
    this.markdown.invalidate()
  }
}

/** Delegate exposing a pi-tui `SelectList` through the Blue contract. */
class SelectListAdapter implements BlueSelectList {
  constructor(private readonly list: SelectList) {}

  getSelectedItem(): BlueSelectItem | null {
    return this.list.getSelectedItem()
  }

  render(width: number): string[] {
    return this.list.render(width)
  }

  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  invalidate(): void {
    this.list.invalidate()
  }
}

/** Delegate exposing a pi-tui `SettingsList` through the Blue contract. */
class SettingsListAdapter {
  constructor(private readonly list: SettingsList) {}

  render(width: number): string[] {
    return this.list.render(width)
  }

  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  invalidate(): void {
    this.list.invalidate()
  }
}

/** Constructor config for {@link BlueComponentsService} (Cordis class-plugin arity). */
export interface BlueComponentsDeps {
  /** The active semantic color provider. */
  theme: BlueTheme
  /** The stable TUI reference the editor component binds to (pi-tui type, core-internal). */
  tui: TUI
}

/**
 * The `blueComponents` service. Mounted by the `blue-core` plugin as a
 * sub-plugin injecting `blueTheme`, so a theme-provider swap rebuilds this
 * service — and every component created afterwards — through Cordis reload
 * semantics. Unregistered automatically when the fiber unloads.
 */
export class BlueComponentsService extends Service implements BlueComponents {
  private readonly theme: BlueTheme
  private readonly tui: TUI

  /**
   * Create and register the service.
   * @param ctx - the owning Cordis context.
   * @param deps - the active theme and the stable TUI reference.
   */
  constructor(ctx: Context, deps: BlueComponentsDeps) {
    super(ctx, 'blueComponents')
    this.theme = deps.theme
    this.tui = deps.tui
  }

  /**
   * Create a palette-themed multi-line input editor.
   * @param options - editor options.
   * @returns the editor component.
   */
  createEditor(options?: BlueEditorOptions): BlueEditor {
    const editorOptions: EditorOptions = {}
    if (options?.paddingX !== undefined) editorOptions.paddingX = options.paddingX
    return new EditorAdapter(new Editor(this.tui, editorTheme(this.theme.colors), editorOptions))
  }

  /**
   * Create a palette-themed streamed-Markdown component.
   * @param options - markdown options.
   * @returns the markdown component.
   */
  createMarkdown(options?: BlueMarkdownOptions): BlueMarkdown {
    return new MarkdownAdapter(
      new Markdown(options?.text ?? '', options?.paddingX ?? 0, options?.paddingY ?? 0, markdownTheme(this.theme.colors)),
    )
  }

  /**
   * Create a palette-themed single-selection list.
   * @param options - items and selection callbacks.
   * @returns the list component.
   */
  createSelectList(options: BlueSelectListOptions): BlueSelectList {
    const list = new SelectList(options.items, options.maxVisible ?? 10, selectListTheme(this.theme.colors))
    if (options.onSelect !== undefined) list.onSelect = options.onSelect
    if (options.onCancel !== undefined) list.onCancel = options.onCancel
    if (options.onSelectionChange !== undefined) list.onSelectionChange = options.onSelectionChange
    return new SelectListAdapter(list)
  }

  /**
   * Create a palette-themed settings list.
   * @param options - items and change callbacks.
   * @returns the settings component.
   */
  createSettingsList(options: BlueSettingsListOptions): BlueSettingsList {
    // SettingsListOptions is not re-exported from pi-tui's package root;
    // its only field is enableSearch.
    const listOptions: { enableSearch?: boolean } = {}
    if (options.enableSearch !== undefined) listOptions.enableSearch = options.enableSearch
    // BlueSettingItem and pi-tui's SettingItem are structurally identical
    // (the BlueComponent submenu result satisfies pi-tui's Component), so
    // the item list passes through unchanged.
    return new SettingsListAdapter(
      new SettingsList(
        options.items as SettingItem[],
        options.maxVisible ?? 10,
        settingsListTheme(this.theme.colors),
        options.onChange,
        options.onCancel,
        listOptions,
      ),
    )
  }

  /**
   * Measure the visible width of styled text in terminal columns.
   * @param text - the text, ANSI styling allowed.
   * @returns the width in columns.
   */
  visibleWidth(text: string): number {
    return visibleWidth(text)
  }

  /**
   * Word-wrap styled text to a column width, preserving ANSI styling.
   * @param text - the text, ANSI styling and newlines allowed.
   * @param width - the maximum visible width per line.
   * @returns the wrapped lines, not padded.
   */
  wrapText(text: string, width: number): string[] {
    return wrapTextWithAnsi(text, width)
  }

  /**
   * Truncate styled text to a maximum visible width.
   * @param text - the text, ANSI styling allowed.
   * @param width - the maximum visible width.
   * @param ellipsis - the ellipsis string; defaults to `'...'`.
   * @returns the truncated text.
   */
  truncateToWidth(text: string, width: number, ellipsis?: string): string {
    return truncateToWidth(text, width, ellipsis)
  }
}
