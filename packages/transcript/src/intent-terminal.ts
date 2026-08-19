/**
 * `blue-intent-terminal` plugin: the `'terminal'` render-intent card. Tool
 * items whose resolved view is a `TerminalCallView`/`TerminalResultView`
 * render here as a shell card instead of the generic `● name(args)` row.
 * Rendering scheme: an optional muted description line above the card (the
 * call view alone carries one), then a `diffMeta` cwd line (omitted without a
 * cwd), then the command line — `shellMode('$')` marker plus the title
 * (result title ?? call title ?? tool name), with an exit badge appended once
 * completed: `error(\`exit N\`)` for a nonzero exit code, nothing for zero, and
 * `warning(signal)` when a signal killed the run. Captured `output` renders
 * as `textMuted` rows below (the kimi dim shell card), capped at 10 rows
 * collapsed and 120 expanded (Ctrl-O through `setExpanded`) with a
 * `textMuted(\`… N more lines\`)` counter, and a completed run without
 * output states `(no output)`.
 * The component assumes by construction that its view carries
 * `card: 'terminal'` — the mounter only routes terminal views here — and
 * defensively renders just the title line when the shape does not match. The
 * render cache keys on width, expansion, and view identity.

 * @module @deepseek-ai/dsh-blue-transcript/intent-terminal
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponents,
  BlueSemanticColors,
} from '@deepseek-ai/dsh-blue-core'
import type { BlueIntentComponent, BlueIntentProps, TranscriptToolItem } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-intent-terminal'

/** Services required before the terminal card can register. */
export const inject = ['blueIntents', 'blueTheme', 'blueComponents']

/** Collapsed cap: output rows rendered. */
export const TERMINAL_COLLAPSED_ROWS = 10

/** Expanded cap: output rows rendered. */
export const TERMINAL_EXPANDED_ROWS = 120

/**
 * Whether the item's view selects this card: `card: 'terminal'`. Both the
 * call and the result view satisfy this; the fields each carries are read
 * individually below (description and cwd only exist on the call view, output
 * and exit status only on the result view).
 * @param view - the item's resolved view.
 * @returns true when the view is a terminal view.
 */
function isTerminalView(view: NonNullable<TranscriptToolItem['view']>): view is {
  card: 'terminal'
  title?: string
  description?: string
  cwd?: string
  output?: string
  exitCode?: number
  signal?: string
} {
  return view.card === 'terminal'
}

/** The terminal view fields the card reads, narrowed to one shape. */
interface TerminalView {
  title?: string
  description?: string
  cwd?: string
  output?: string
  exitCode?: number
  signal?: string
}

/**
 * The terminal card component: description, cwd, the `$ command` line with
 * its exit badge, and the capped plain output rows.
 */
export class TerminalCardComponent implements BlueIntentComponent {
  private readonly item: TranscriptToolItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private expanded: boolean
  private cache: { key: string, lines: string[] } | null = null

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
   * Switch between the collapsed and expanded output caps. The flag joins
   * the render cache key, so the next render rebuilds.
   * @param expanded - true raises the cap to {@link TERMINAL_EXPANDED_ROWS}.
   */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const { colors, components } = this
    const view = this.item.view
    const key = `${width}:${this.expanded}:${view === undefined ? 'none' : JSON.stringify(view)}:${this.item.result === undefined}`
    if (this.cache?.key === key) return this.cache.lines

    const terminal = view !== undefined && isTerminalView(view) ? view as TerminalView : undefined
    const title = terminal?.title ?? this.item.name

    const lines: string[] = []
    if (terminal?.description !== undefined) {
      lines.push(colors.muted(components.truncateToWidth(terminal.description, width)))
    }
    if (terminal?.cwd !== undefined) {
      lines.push(colors.diffMeta(components.truncateToWidth(terminal.cwd, width)))
    }

    // The command line: shell-mode `$` marker, title, and — once completed —
    // the exit badge (nonzero exit code or a kill signal; a zero exit is
    // silence).
    let command = `${colors.shellMode('$')} ${title}`
    if (terminal !== undefined && this.item.result !== undefined) {
      const badge = terminal.signal !== undefined
        ? colors.warning(terminal.signal)
        : terminal.exitCode !== undefined && terminal.exitCode !== 0
          ? colors.error(`exit ${terminal.exitCode}`)
          : ''
      if (badge !== '') command += ` ${badge}`
    }
    lines.push(components.truncateToWidth(command, width))

    if (terminal?.output !== undefined && terminal.output !== '') {
      const rows = terminal.output.split('\n')
      const cap = this.expanded ? TERMINAL_EXPANDED_ROWS : TERMINAL_COLLAPSED_ROWS
      const shown = Math.min(rows.length, cap)
      // The output dims one step below the command (the kimi shell card);
      // the command body itself renders in the default foreground.
      for (const row of rows.slice(0, shown)) {
        lines.push(colors.textMuted(components.truncateToWidth(row, width)))
      }
      if (rows.length > shown) {
        lines.push(colors.textMuted(components.truncateToWidth(`… ${rows.length - shown} more lines`, width)))
      }
    } else if (this.item.result !== undefined) {
      // A completed run with no captured output still says so (kimi's
      // '(no output)'); a pending call renders no output rows.
      lines.push(colors.textMuted('(no output)'))
    }

    this.cache = { key, lines }
    return lines
  }
}

/**
 * Register the terminal intent entry. Effect-bound so unloading the fiber
 * unregisters the entry from `ctx.blueIntents`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.blueIntents.register({
    intent: 'terminal',
    create: props => new TerminalCardComponent(props),
  }))
}
