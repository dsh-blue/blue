/**
 * `blue-intent-cordis` plugin: the `'cordis'` render-intent card (S39) for
 * the harness's self-referential Cordis toolset (`dsh-tool-cordis` —
 * `cordis_define`/`cordis_run`/`cordis_stop`/`cordis_undefine`/
 * `cordis_inspect*`). Every one of those tools presents a `GenericCallView`,
 * so the mounter routes them here by the `cordis_` name prefix
 * (`present.ts`'s `intentForToolItem`), not by the view card — the web
 * client ships its own keyed cordis card (`dsh-client-ui-cordis`), and this
 * is Blue's counterpart: without it the inspect tools' pretty-printed JSON
 * documents render as raw JSON walls through the generic card.
 *
 * The header is the shared kimi card header — the three-state bullet (solid
 * `text` `● ` running, `✓ `/`✗ ` finished) behind `Using/Used ToolName
 * (keyArg)` with the tool name bold `primary` and the key argument dim (the
 * shared `extractKeyArgument` whitelist); no chip. The body splits on the
 * verb. `cordis_define` reads the submitted definition from
 * `parsedArguments` (every field defended — a missing or mis-shaped
 * `purpose`/`code` degrades gracefully): the muted wrapped `purpose`, a
 * muted halves line `host · N lines` (plus ` · client · M lines (web only —
 * no Blue surface)` when the definition ships a client half Blue never
 * renders), then the `code.host` source as the kimi Write-style numbered
 * preview (dim `    N  ` numbers over the plain rows, trailing empty row
 * kept, capped at {@link CORDIS_COLLAPSED_ROWS} collapsed /
 * {@link CORDIS_EXPANDED_ROWS} expanded under the kimi
 * `... (N more lines, M total, ctrl+o to expand)` hint); a failed define
 * appends the error text in `error`. `cordis_run`/`cordis_stop`/
 * `cordis_undefine` (and any future `cordis_*` name) render the result text
 * like the generic card's preview — `text` on success, `error` on failure,
 * the wrap-aware {@link RESULT_PREVIEW_LINES}-row collapsed cap with the
 * same hint, uncapped expanded. The `cordis_inspect*` verbs render the
 * result text as a fenced ```json block through `createMarkdown` when it
 * parses (the markdown factory routes fences through core's `highlightCode`
 * syntax coloring), falling back to the plain result-text rows when it does
 * not; both paths cap at {@link CORDIS_COLLAPSED_ROWS} collapsed /
 * {@link CORDIS_EXPANDED_ROWS} expanded with the hint. A pending call
 * renders no body rows except define's argument preview (its arguments are
 * known at call time, the diff card's call-view precedent). Every row is
 * measured through the components factory's width helpers (D48). The render
 * cache keys on width, expansion, and result identity.
 *
 * @module @dsh-blue/blue-transcript/intent-cordis
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponents,
  BlueMarkdown,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import { COMMAND_PREVIEW_LINES, RESULT_PREVIEW_LINES } from './components.ts'
import { extractKeyArgument } from './present.ts'
import type { BlueIntentComponent, BlueIntentProps, TranscriptToolItem } from './types.ts'

/** Bold SGR pair (the S18 local-constant precedent). */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** Body indent: the kimi two-column card-content indent. */
const PREVIEW_INDENT = '  '

/** Stable Cordis plugin name. */
export const name = 'blue-intent-cordis'

/** Services required before the cordis card can register. */
export const inject = ['blueIntents', 'blueTheme', 'blueComponents']

/** Collapsed cap: preview rows rendered (kimi's Write/Edit cap). */
export const CORDIS_COLLAPSED_ROWS = COMMAND_PREVIEW_LINES

/** Expanded cap: preview rows rendered. */
export const CORDIS_EXPANDED_ROWS = 200

/** The define verb: the one cordis tool whose body reads the arguments. */
const CORDIS_DEFINE_TOOL = 'cordis_define'

/** The inspect verbs: the cordis tools whose result is a JSON document. */
const CORDIS_INSPECT_TOOLS: ReadonlySet<string> = new Set([
  'cordis_inspect',
  'cordis_inspect_list',
  'cordis_inspect_query',
  'cordis_inspect_self',
])

/** The `cordis_define` argument fields the card reads, defended. */
interface DefineArgs {
  /** The human purpose string, when present and non-empty. */
  purpose?: string
  /** The submitted host-half source, when present and non-empty. */
  host?: string
  /** The submitted client-half source (web-only), when present and non-empty. */
  client?: string
}

/**
 * Read the define card's fields out of the raw parsed arguments. Every field
 * is optional in the observed payloads and the tool defends its own input,
 * so a missing or mis-shaped field simply drops its rows.
 * @param parsed - the item's `parsedArguments` (`undefined` when the raw
 *   arguments string was invalid JSON).
 * @returns the defended define fields.
 */
function defineArgs(parsed: unknown): DefineArgs {
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) return {}
  const args = parsed as Record<string, unknown>
  const code = args['code']
  const codeRecord = code !== null && typeof code === 'object'
    ? code as Record<string, unknown>
    : undefined
  const purpose = args['purpose']
  const host = codeRecord?.['host']
  const client = codeRecord?.['client']
  return {
    ...(typeof purpose === 'string' && purpose !== '' ? { purpose } : {}),
    ...(typeof host === 'string' && host !== '' ? { host } : {}),
    ...(typeof client === 'string' && client !== '' ? { client } : {}),
  }
}

/** The halves-line count wording: kimi's unconditional `line`/`lines` split. */
function lineCount(source: string): string {
  const count = source.split('\n').length
  return `${count} ${count === 1 ? 'line' : 'lines'}`
}

/** The kimi expand hint row text (shared by every capped body). */
function expandHint(hidden: number, total: number): string {
  return `... (${hidden} more lines, ${total} total, ctrl+o to expand)`
}

/**
 * The cordis card component: the kimi card header, then the verb's body —
 * define's argument preview, the inspect verbs' fenced JSON, or the generic
 * result preview — capped per the expansion state.
 */
export class CordisCardComponent implements BlueIntentComponent {
  private readonly item: TranscriptToolItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private expanded: boolean
  private cache: { key: string, lines: string[] } | null = null
  /** The lazily held markdown for the inspect verbs' fenced JSON block. */
  private markdown: BlueMarkdown | null = null

  /**
   * @param props - the item, colors, factory, and expansion state at creation.
   */
  constructor(props: BlueIntentProps) {
    this.item = props.item
    this.colors = props.colors
    this.components = props.components
    this.expanded = props.expanded
  }

  /** Drop the cached lines; the next render rebuilds from the item. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * Switch between the collapsed and expanded body caps. The flag joins the
   * render cache key, so the next render rebuilds.
   * @param expanded - true raises the caps to {@link CORDIS_EXPANDED_ROWS}
   *   (the result preview uncaps, the generic card's behavior).
   */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded
  }

  /** The kimi card header: bullet, verb, bold name, key arg; no chip. */
  private renderHeader(width: number): string {
    const { colors, components } = this
    const result = this.item.result
    const bullet = result === undefined
      ? colors.text('● ')
      : result.isError
        ? colors.error('✗ ')
        : colors.success('✓ ')
    const verb = result === undefined ? 'Using' : 'Used'
    const name = `${BOLD_OPEN}${colors.primary(this.item.name)}${BOLD_CLOSE}`
    const keyArg = extractKeyArgument(this.item)
    const argStr = keyArg === undefined ? '' : colors.muted(` (${keyArg})`)
    return components.truncateToWidth(`${bullet}${verb} ${name}${argStr}`, width)
  }

  /** The body content width: the viewport minus the two-column indent. */
  private contentWidth(width: number): number {
    return Math.max(1, width - this.components.visibleWidth(PREVIEW_INDENT))
  }

  /**
   * Paint and budget one indented body row: colored first, then truncated to
   * the viewport (pi-tui's truncation is ANSI-aware, so the paint survives —
   * and a degenerate width crossed mid-resize-drag still honors D48).
   */
  private bodyRow(painted: string, width: number): string {
    return this.components.truncateToWidth(`${PREVIEW_INDENT}${painted}`, width)
  }

  /** The kimi Write-style numbered source preview (the diff card's shape). */
  private renderCodePreview(source: string, width: number): string[] {
    const { colors, components } = this
    // kimi's `highlightLines` shape keeps the trailing empty row (a final
    // newline renders as an empty numbered line).
    const rows = source.split('\n')
    const cap = Math.min(rows.length, this.expanded ? CORDIS_EXPANDED_ROWS : CORDIS_COLLAPSED_ROWS)
    const lines: string[] = []
    for (let index = 0; index < cap; index += 1) {
      const number = colors.muted(`${String(index + 1).padStart(4)}  `)
      lines.push(components.truncateToWidth(`  ${number}${rows[index]!}`, width))
    }
    if (rows.length > cap) {
      lines.push(colors.textMuted(components.truncateToWidth(expandHint(rows.length - cap, rows.length), width)))
    }
    return lines
  }

  /**
   * The define body: purpose, the halves line, the host source preview —
   * all from the arguments, so a pending call previews what it submitted —
   * then a failed define's error text.
   */
  private renderDefineBody(width: number): string[] {
    const { colors, components } = this
    const lines: string[] = []
    const args = defineArgs(this.item.parsedArguments)
    const contentWidth = this.contentWidth(width)
    if (args.purpose !== undefined) {
      for (const line of components.wrapText(args.purpose, contentWidth)) {
        lines.push(this.bodyRow(colors.muted(line), width))
      }
    }
    const halves: string[] = []
    if (args.host !== undefined) halves.push(`host · ${lineCount(args.host)}`)
    if (args.client !== undefined) {
      halves.push(`client · ${lineCount(args.client)} (web only — no Blue surface)`)
    }
    if (halves.length > 0) lines.push(this.bodyRow(colors.muted(halves.join(' · ')), width))
    if (args.host !== undefined) lines.push(...this.renderCodePreview(args.host, width))
    const result = this.item.result
    if (result !== undefined && result.isError) {
      const text = (result.fullText ?? result.text).replace(/\n+$/, '')
      if (text !== '') {
        for (const line of components.wrapText(text, contentWidth)) {
          lines.push(this.bodyRow(colors.error(line), width))
        }
      }
    }
    return lines
  }

  /**
   * The result-text body shared by run/stop/undefine and any future
   * `cordis_*` verb: the generic card's wrap-aware collapsed preview,
   * uncapped expanded; nothing while pending.
   */
  private renderResultBody(width: number): string[] {
    const result = this.item.result
    if (result === undefined) return []
    const text = (result.fullText ?? result.text).replace(/\n+$/, '')
    if (text === '') return []
    const { colors, components } = this
    const contentWidth = this.contentWidth(width)
    const paint = (line: string): string =>
      this.bodyRow(result.isError ? colors.error(line) : colors.text(line), width)
    const allLines = components.wrapText(text, contentWidth)
    if (this.expanded) return allLines.map(paint)
    const shown = allLines.slice(0, RESULT_PREVIEW_LINES)
    const lines = shown.map(paint)
    if (allLines.length > shown.length) {
      lines.push(colors.textMuted(components.truncateToWidth(expandHint(allLines.length - shown.length, allLines.length), width)))
    }
    return lines
  }

  /**
   * The inspect body: the result document as a fenced ```json block through
   * the markdown factory (fences route through core's `highlightCode`
   * coloring) when it parses, the plain result rows when it does not; both
   * paths capped per the expansion state. Nothing while pending.
   */
  private renderInspectBody(width: number): string[] {
    const result = this.item.result
    if (result === undefined) return []
    const text = (result.fullText ?? result.text).replace(/\n+$/, '')
    if (text === '') return []
    const { colors, components } = this
    const contentWidth = this.contentWidth(width)
    let rows: string[]
    let parsed = true
    try {
      JSON.parse(text)
    } catch {
      parsed = false
    }
    if (parsed) {
      this.markdown ??= components.createMarkdown({ text: '' })
      this.markdown.setText(`\`\`\`json\n${text}\n\`\`\``)
      rows = this.markdown.render(contentWidth).map(line => this.bodyRow(line, width))
    } else {
      const paint = (line: string): string =>
        this.bodyRow(result.isError ? colors.error(line) : colors.text(line), width)
      rows = components.wrapText(text, contentWidth).map(paint)
    }
    const cap = this.expanded ? CORDIS_EXPANDED_ROWS : CORDIS_COLLAPSED_ROWS
    const shown = rows.slice(0, cap)
    if (rows.length > shown.length) {
      shown.push(colors.textMuted(components.truncateToWidth(expandHint(rows.length - shown.length, rows.length), width)))
    }
    return shown
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const result = this.item.result
    const resultText = result === undefined ? '' : (result.fullText ?? result.text)
    const key = `${width}:${this.expanded}:${result ? `${result.isError}:${resultText}` : 'pending'}`
    if (this.cache?.key === key) return this.cache.lines

    let body: string[]
    if (this.item.name === CORDIS_DEFINE_TOOL) {
      body = this.renderDefineBody(width)
    } else if (CORDIS_INSPECT_TOOLS.has(this.item.name)) {
      body = this.renderInspectBody(width)
    } else {
      body = this.renderResultBody(width)
    }
    const lines = ['', this.renderHeader(width), ...body]
    this.cache = { key, lines }
    return lines
  }
}

/**
 * Register the cordis intent entry. Effect-bound so unloading the fiber
 * unregisters the entry from `ctx.blueIntents`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.blueIntents.register({
    intent: 'cordis',
    create: props => new CordisCardComponent(props),
  }))
}
