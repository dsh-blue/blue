/**
 * `blue-banner` plugin: the welcome banner, mounted once at boot as the
 * scroll area's first child. The banner fills the full viewport width in two
 * cells: the left cell hugs the pixel castle's own (trimmed) width, and the
 * right cell takes everything else — the "Welcome back!" line, the model
 * line (`model · provider`, snapshotted from `agentDefaultModel` at mount),
 * the home-shortened cwd, and — once the right cell is wide enough — the
 * quick-start tips section from `banner-content.ts` (the what's-new
 * placeholder returns with S16's real right-column content).
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
 * renders nothing, otherwise it spans the full width and its height is the
 * taller of the castle art and the right column (a fixed ten rows at the
 * default content). Every over-wide run truncates; nothing ever wraps. The
 * castle centers vertically when the right column is taller. Styling uses
 * only frozen theme tokens — frame, castle, and the welcome line share
 * `primary`, the kimi welcome-box treatment, so the banner reads as one
 * blue unit.
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
  BLUE_VERSION,
  type BannerSection,
} from './banner-content.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-banner'

/** Services required before the banner can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'agentDefaultModel']

/** Below this viewport width the banner renders zero rows rather than overflow. */
export const BANNER_MIN_WIDTH = 40

/** The right-cell width at which the tips section joins the right column. */
export const BANNER_SECTION_MIN = 30

/** Columns reserved around the title inside the top rule: `╭─── `, ` `, `╮`. */
const BANNER_TITLE_RESERVE = 7

/** The two `│` frame columns every body row spends; also the bottom rule's. */
const BANNER_FRAME_COLUMNS = 2

/** The one `│` separator column between the logo and right cells. */
const BANNER_CELL_SEPARATOR = 1

const PACKED_CASTLE = packHalfBlockArt(CASTLE_PIXELS)
/** First column carrying a lit pixel across the packed rows. */
const CASTLE_LEAD = Math.min(...PACKED_CASTLE.map(row => row.search(/\S/)).filter(index => index >= 0))
/** One past the last lit column. */
const CASTLE_EDGE = Math.max(...PACKED_CASTLE.map(row => row.trimEnd().length))
/** The trimmed castle art rows; the logo cell hugs these exactly. */
const CASTLE_ROWS: readonly string[] = PACKED_CASTLE.map(row => row.slice(CASTLE_LEAD, CASTLE_EDGE))
/** The logo cell's width — the trimmed castle art's own width. */
export const BANNER_LOGO_WIDTH = CASTLE_EDGE - CASTLE_LEAD

/** One width computation for a banner render. */
export interface BannerLayout {
  /** The exact box width — the full viewport width; every line is this many columns. */
  readonly total: number
  /** The logo cell's width; the trimmed castle fills it. */
  readonly logoWidth: number
  /** The right cell's width. */
  readonly rightWidth: number
  /** Whether the tips section renders. */
  readonly withSections: boolean
}

/**
 * The banner's width plan for a viewport: `null` below
 * {@link BANNER_MIN_WIDTH}; otherwise a full-width box whose logo cell hugs
 * the trimmed castle and whose right cell takes every remaining column.
 * @param width - current viewport width in columns.
 * @returns the layout, or `null` when the banner renders nothing.
 */
export function bannerLayout(width: number): BannerLayout | null {
  if (width < BANNER_MIN_WIDTH) return null
  const rightWidth = width - BANNER_FRAME_COLUMNS - BANNER_CELL_SEPARATOR - BANNER_LOGO_WIDTH
  return {
    total: width,
    logoWidth: BANNER_LOGO_WIDTH,
    rightWidth,
    withSections: rightWidth >= BANNER_SECTION_MIN,
  }
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
 * yield plain, measurable text. The box spans the full width: the logo cell
 * hugs the trimmed castle, the right cell pads, and nothing ever wraps —
 * over-wide model, cwd, and section lines truncate first. The castle
 * centers vertically when the right column is taller.
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
  const { total, logoWidth, rightWidth, withSections } = layout
  const paint: Record<BannerStyle, (text: string) => string> = {
    // kimi parity for the welcome box: the whole frame, the logo, and the
    // welcome line are the brand's interactive blue (`primary`), with only
    // the info labels staying gray — the boot screen's one big color moment.
    frame: deps.colors.primary,
    title: deps.colors.muted,
    strong: deps.colors.primary,
    logo: deps.colors.primary,
    accent: deps.colors.accent,
    muted: deps.colors.muted,
    text: deps.colors.text,
  }
  const line = (segments: readonly BannerSegment[]): string =>
    segments.map(segment => paint[segment.style](segment.text)).join('')
  const blank = (cellWidth: number, style: BannerStyle): readonly BannerSegment[] =>
    [{ text: ' '.repeat(cellWidth), style }]

  const title = deps.truncate(`blue v${content.version}`, total - BANNER_TITLE_RESERVE)
  const top: readonly BannerSegment[] = [
    { text: '╭─── ', style: 'frame' },
    { text: title, style: 'title' },
    { text: ` ${'─'.repeat(total - BANNER_TITLE_RESERVE - deps.visibleWidth(title))}╮`, style: 'frame' },
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
  const rightRows: readonly (readonly BannerSegment[])[] = [
    rightRow('Welcome back!', 'strong'),
    rightRow(`${content.model} · ${content.provider}`, 'accent'),
    rightRow(content.cwd, 'muted'),
    ...(withSections
      ? [
          blank(rightWidth, 'muted'),
          rightRow(content.tips.heading, 'text'),
          ...content.tips.lines.map(entry => rightRow(entry, 'muted')),
        ]
      : []),
  ]

  // The logo cell: the castle rows, vertically centered when the right
  // column is taller; blank rows pad above and below.
  const bodyHeight = Math.max(CASTLE_ROWS.length, rightRows.length)
  const logoLead = (bodyHeight - CASTLE_ROWS.length) >> 1
  const lines = [line(top)]
  for (let row = 0; row < bodyHeight; row++) {
    const art = row >= logoLead && row < logoLead + CASTLE_ROWS.length
      ? CASTLE_ROWS[row - logoLead]!
      : undefined
    const segments: BannerSegment[] = [
      { text: '│', style: 'frame' },
      ...(art !== undefined ? [{ text: art, style: 'logo' } as BannerSegment] : blank(logoWidth, 'logo')),
      { text: '│', style: 'frame' },
      ...rightRows[row] ?? blank(rightWidth, 'muted'),
      { text: '│', style: 'frame' },
    ]
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
  })
  // Effect-bound so unloading this fiber unmounts the banner.
  ctx.effect(() => ctx.blueScreen.addChild(banner))
  // addChild schedules no render on its own.
  ctx.blueScreen.requestRender()
}
