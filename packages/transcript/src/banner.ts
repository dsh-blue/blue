/**
 * `blue-banner` plugin: the Claude Code-style welcome banner, mounted once at
 * boot as the scroll area's first child. The left column centers the pixel
 * castle ({@link packHalfBlockArt} over the frozen grid), a strong
 * "Welcome back!", the default model line (`model · provider`, snapshotted
 * from `agentDefaultModel` at mount), and the home-shortened cwd. The right
 * column — joined once the viewport reaches {@link BANNER_FULL_MIN} columns —
 * carries the tips and what's-new sections from `banner-content.ts`.
 *
 * The banner is a static boot snapshot by design: it never reads
 * `blueSession` (the footer's `blue-status-basic` already tracks the live
 * model), which also keeps its mount free of ordering coupling with the
 * transcript's history mounting. In the bundle patch the row sits before
 * `blue-transcript` so the two fibers resolve in the same `blueComponents`
 * activation round in row order — the banner stays the first scroll child
 * across initial mounts and `/theme` reloads.
 *
 * The box adapts to the viewport: below {@link BANNER_MIN_WIDTH} columns it
 * renders nothing, below {@link BANNER_FULL_MIN} it drops the right column,
 * and it caps at {@link BANNER_MAX_WIDTH}. Every over-wide run truncates;
 * nothing ever wraps. Styling uses only frozen theme tokens — frame and
 * castle share `border`, so the banner reads as one blue unit.
 *
 * @module @deepseek-ai/dsh-blue-transcript/banner
 */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponent,
  BlueComponents,
  BlueSemanticColors,
} from '@deepseek-ai/dsh-blue-core'
// Empty type import carries the `agentDefaultModel` Context merge this
// plugin's inject resolves.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { CASTLE_PIXELS, packHalfBlockArt } from './banner-art.ts'
import {
  BANNER_TIPS,
  BANNER_WHATS_NEW,
  BLUE_VERSION,
  type BannerSection,
} from './banner-content.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-banner'

/** Services required before the banner can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'agentDefaultModel']

/** Below this viewport width the banner renders zero rows rather than overflow. */
export const BANNER_MIN_WIDTH = 40

/** The viewport width at which the right column joins the box. */
export const BANNER_FULL_MIN = 100

/** The box width ceiling on terminals wider than the banner needs. */
export const BANNER_MAX_WIDTH = 120

/** The right column's fixed cell width (left column absorbs the rest). */
export const BANNER_RIGHT_WIDTH = 52

/** Columns reserved around the title inside the top rule: `╭─── `, ` `, `╮`. */
const BANNER_TITLE_RESERVE = 7

/** The two `│` frame columns every body row spends; also the bottom rule's. */
const BANNER_FRAME_COLUMNS = 2

/** One width computation for a banner render. */
export interface BannerLayout {
  /** The exact box width; every rendered line is this many columns. */
  readonly total: number
  /** The left column's cell width. */
  readonly leftWidth: number
  /** The right column's cell width; 0 when it is dropped. */
  readonly rightWidth: number
  /** Whether the right column renders. */
  readonly withRight: boolean
}

/**
 * The banner's width plan for a viewport: `null` below
 * {@link BANNER_MIN_WIDTH}; otherwise a box of `min(width,
 * BANNER_MAX_WIDTH)` columns whose left column absorbs every column not
 * taken by the frame and the optional right cell.
 * @param width - current viewport width in columns.
 * @returns the layout, or `null` when the banner renders nothing.
 */
export function bannerLayout(width: number): BannerLayout | null {
  if (width < BANNER_MIN_WIDTH) return null
  const total = Math.min(width, BANNER_MAX_WIDTH)
  const withRight = width >= BANNER_FULL_MIN
  const rightWidth = withRight ? BANNER_RIGHT_WIDTH : 0
  const leftWidth = total - BANNER_FRAME_COLUMNS - (withRight ? rightWidth + 1 : 0)
  return { total, leftWidth, rightWidth, withRight }
}

/**
 * Shorten a path by replacing the home-directory prefix with `~` — the exact
 * home and anything not under it (or an empty home) passes through.
 * @param path - the path to shorten.
 * @param home - the home directory, already normalized the same way.
 * @returns the shortened path.
 */
export function shortenHome(path: string, home: string): string {
  if (home === '') return path
  if (path === home) return '~'
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`
  return path
}

/** The banner's rendered facts, snapshotted once at mount. */
export interface BannerContent {
  /** The version shown in the title rule. */
  readonly version: string
  /** The default model id for the model line. */
  readonly model: string
  /** The default provider route for the model line. */
  readonly provider: string
  /** The working directory, already home-shortened. */
  readonly cwd: string
  /** The right-column quick-start section. */
  readonly tips: BannerSection
  /** The right-column what's-new section. */
  readonly whatsNew: BannerSection
}

/** The theme tokens the banner paints with, keyed by segment role. */
type BannerStyle = 'frame' | 'title' | 'strong' | 'logo' | 'accent' | 'muted' | 'text'

/** One styled run of a rendered banner line. */
interface BannerSegment {
  readonly text: string
  readonly style: BannerStyle
}

/** The theme-wrapping and measuring primitives `composeBannerLines` needs. */
export interface BannerDeps {
  /** The semantic color table. */
  readonly colors: BlueSemanticColors
  /** ANSI-aware truncation; must never return wider input than asked for. */
  readonly truncate: (text: string, width: number) => string
  /** ANSI-aware visible-width measurement. */
  readonly visibleWidth: (text: string) => number
}

/**
 * Compose the banner's lines for one viewport width — the pure layout core
 * the component delegates to. Identity color functions (the spec fakes)
 * yield plain, measurable text. Every body row centers its left cell,
 * pads its right cell, and never wraps: over-wide model, cwd, and section
 * lines truncate first.
 * @param deps - colors plus the truncate/measure primitives.
 * @param content - the snapshotted banner facts.
 * @param width - current viewport width in columns.
 * @returns the lines; none below {@link BANNER_MIN_WIDTH}.
 */
export function composeBannerLines(
  deps: BannerDeps,
  content: BannerContent,
  width: number,
): string[] {
  const layout = bannerLayout(width)
  if (layout === null) return []
  const { total, leftWidth, rightWidth, withRight } = layout
  const paint: Record<BannerStyle, (text: string) => string> = {
    frame: deps.colors.border,
    title: deps.colors.muted,
    strong: deps.colors.textStrong,
    logo: deps.colors.border,
    accent: deps.colors.accent,
    muted: deps.colors.muted,
    text: deps.colors.text,
  }
  const line = (segments: readonly BannerSegment[]): string =>
    segments.map(segment => paint[segment.style](segment.text)).join('')
  const blank = (cellWidth: number, style: BannerStyle): readonly BannerSegment[] =>
    [{ text: ' '.repeat(cellWidth), style }]

  // A left-cell row: truncate to the cell, then center the remainder.
  const centered = (text: string, style: BannerStyle): readonly BannerSegment[] => {
    const fit = deps.truncate(text, leftWidth)
    const pad = leftWidth - deps.visibleWidth(fit)
    const lead = pad >> 1
    return [
      { text: ' '.repeat(lead), style },
      { text: fit, style },
      { text: ' '.repeat(pad - lead), style },
    ]
  }

  const title = deps.truncate(`blue v${content.version}`, total - BANNER_TITLE_RESERVE)
  const top: readonly BannerSegment[] = [
    { text: '╭─── ', style: 'frame' },
    { text: title, style: 'title' },
    { text: ` ${'─'.repeat(total - BANNER_TITLE_RESERVE - deps.visibleWidth(title))}╮`, style: 'frame' },
  ]

  const leftRows: readonly (readonly BannerSegment[])[] = [
    blank(leftWidth, 'frame'),
    centered('Welcome back!', 'strong'),
    blank(leftWidth, 'frame'),
    ...packHalfBlockArt(CASTLE_PIXELS).map(art => centered(art, 'logo')),
    blank(leftWidth, 'frame'),
    centered(`${content.model} · ${content.provider}`, 'accent'),
    centered(content.cwd, 'muted'),
  ]

  // A right-cell row: one leading space, the truncated text, then padding.
  const rightRow = (text: string, style: BannerStyle): readonly BannerSegment[] => {
    const fit = deps.truncate(text, rightWidth - 1)
    return [
      { text: ' ', style },
      { text: fit, style },
      { text: ' '.repeat(rightWidth - 1 - deps.visibleWidth(fit)), style },
    ]
  }
  const sectionRows = (section: BannerSection, style: BannerStyle): readonly (readonly BannerSegment[])[] => [
    rightRow(section.heading, 'text'),
    ...section.lines.map(entry => rightRow(entry, style)),
  ]
  const rightRows: readonly (readonly BannerSegment[])[] = withRight
    ? [
        blank(rightWidth, 'muted'),
        ...sectionRows(content.tips, 'muted'),
        [
          { text: ' ', style: 'muted' },
          { text: '─'.repeat(rightWidth - 2), style: 'muted' },
          { text: ' ', style: 'muted' },
        ],
        ...sectionRows(content.whatsNew, 'muted'),
      ]
    : []

  const height = withRight ? Math.max(leftRows.length, rightRows.length) : leftRows.length
  const lines = [line(top)]
  for (let row = 0; row < height; row++) {
    const segments: BannerSegment[] = [
      { text: '│', style: 'frame' },
      ...leftRows[row] ?? blank(leftWidth, 'frame'),
    ]
    if (withRight) segments.push({ text: '│', style: 'frame' }, ...rightRows[row] ?? blank(rightWidth, 'muted'))
    segments.push({ text: '│', style: 'frame' })
    lines.push(line(segments))
  }
  lines.push(line([{ text: `╰${'─'.repeat(total - BANNER_FRAME_COLUMNS)}╯`, style: 'frame' }]))
  return lines
}

/**
 * The welcome banner: a static component whose every render re-composes
 * from the snapshotted content, so it tracks viewport resizes and nothing
 * else.
 */
class BannerComponent implements BlueComponent {
  /**
   * @param colors - the semantic color table.
   * @param components - the component factory providing truncation.
   * @param content - the snapshotted banner facts.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    private readonly content: BannerContent,
  ) {}

  /**
   * @param width - current viewport width in columns.
   * @returns the banner lines; none below {@link BANNER_MIN_WIDTH}.
   */
  render(width: number): string[] {
    return composeBannerLines({
      colors: this.colors,
      truncate: (text, target) => this.components.truncateToWidth(text, target),
      visibleWidth: text => this.components.visibleWidth(text),
    }, this.content, width)
  }

  /** Stateless render; nothing to drop. */
  invalidate(): void {}
}

/**
 * Mount the welcome banner as the scroll area's first child. The model
 * line and cwd snapshot here, once; the banner then never re-derives. The
 * mount is effect-bound so unloading this fiber (a `/theme` swap) unmounts
 * and re-mounts it in place.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const selection = ctx.agentDefaultModel.currentSelection()
  const banner = new BannerComponent(ctx.blueTheme.colors, ctx.blueComponents, {
    version: BLUE_VERSION,
    model: selection.model,
    provider: selection.provider,
    cwd: shortenHome(process.cwd(), homedir()),
    tips: BANNER_TIPS,
    whatsNew: BANNER_WHATS_NEW,
  })
  // Effect-bound so unloading this fiber unmounts the banner.
  ctx.effect(() => ctx.blueScreen.addChild(banner))
  // addChild schedules no render on its own.
  ctx.blueScreen.requestRender()
}
