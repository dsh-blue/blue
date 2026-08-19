/**
 * `blue-banner` plugin: the welcome banner, mounted once at boot as the
 * scroll area's first child. The box spans the full viewport width in up to
 * three cells: the logo cell hugs the pixel whale's own trimmed width, the
 * info cell beside it carries "Welcome back!", the model line
 * (`model · provider`, snapshotted from `agentDefaultModel` at mount), and
 * the home-shortened cwd — and, once the viewport is wide enough, the tips
 * cell takes the rest with the quick-start section from `banner-content.ts`
 * (the what's-new placeholder returns with S16's real right-column content).
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
 * renders nothing; otherwise it spans the full width and its height is the
 * tallest of the whale art and the info/tips rows (nine rows at the default
 * content). Every over-wide run truncates; nothing ever wraps. Styling uses
 * only frozen theme tokens — frame, whale, and the welcome line share
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
import { WHALE_PIXELS, packHalfBlockArt } from './banner-art.ts'
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

/**
 * The left region's fixed width (logo cell + one space + info cell) once the
 * tips cell joins; below that threshold the left region absorbs the width.
 */
export const BANNER_LEFT_WIDTH = 44

/** The tips cell width at which the tips section joins. */
export const BANNER_RIGHT_MIN = 30

/** Columns reserved around the title inside the top rule: `╭─── `, ` `, `╮`. */
const BANNER_TITLE_RESERVE = 7

/** The two `│` frame columns every body row spends; also the bottom rule's. */
const BANNER_FRAME_COLUMNS = 2

const PACKED_WHALE = packHalfBlockArt(WHALE_PIXELS)
/** The whale art rows, top-aligned in the logo cell; the margins are the design's. */
const WHALE_ROWS: readonly string[] = PACKED_WHALE
/** The logo cell's width — the packed whale art's own uniform width. */
export const BANNER_LOGO_WIDTH = Math.max(...PACKED_WHALE.map(row => row.length))

/** One width computation for a banner render. */
export interface BannerLayout {
  /** The exact box width — the full viewport width; every line is this many columns. */
  readonly total: number
  /** The logo cell's width; the trimmed whale fills it. */
  readonly logoWidth: number
  /** The info cell's width beside the logo. */
  readonly infoWidth: number
  /** The tips cell's width; 0 when it is dropped. */
  readonly rightWidth: number
  /** Whether the tips cell renders. */
  readonly withRight: boolean
}

/**
 * The banner's width plan for a viewport: `null` below
 * {@link BANNER_MIN_WIDTH}; otherwise a full-width box whose left region
 * (logo + info) is fixed once the viewport leaves enough room for a
 * {@link BANNER_RIGHT_MIN}-column tips cell, which then takes the rest.
 * @param width - current viewport width in columns.
 * @returns the layout, or `null` when the banner renders nothing.
 */
export function bannerLayout(width: number): BannerLayout | null {
  if (width < BANNER_MIN_WIDTH) return null
  const leftWidth = width - BANNER_FRAME_COLUMNS >= BANNER_LEFT_WIDTH + 1 + BANNER_RIGHT_MIN
    ? BANNER_LEFT_WIDTH
    : width - BANNER_FRAME_COLUMNS
  const withRight = leftWidth === BANNER_LEFT_WIDTH
  return {
    total: width,
    logoWidth: BANNER_LOGO_WIDTH,
    infoWidth: leftWidth - BANNER_LOGO_WIDTH - 1,
    rightWidth: withRight ? width - BANNER_FRAME_COLUMNS - 1 - BANNER_LEFT_WIDTH : 0,
    withRight,
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
 * yield plain, measurable text. The box spans the full width: the whale art
 * sits top-aligned in its hugging logo cell, the info rows line up beside
 * it, and the tips section pads its cell; nothing ever wraps — over-wide
 * model, cwd, and section lines truncate first.
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
  const { total, logoWidth, infoWidth, rightWidth, withRight } = layout
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

  // An info or tips row: one leading space, the truncated text, then padding.
  const cellRow = (cellWidth: number) =>
    (text: string, style: BannerStyle): readonly BannerSegment[] => {
      const fit = deps.truncate(text, cellWidth - 1)
      return [
        { text: ' ', style },
        { text: fit, style },
        { text: ' '.repeat(cellWidth - 1 - deps.visibleWidth(fit)), style },
      ]
    }
  const infoRow = cellRow(infoWidth)
  const rightRow = cellRow(rightWidth)
  const infoRows: readonly (readonly BannerSegment[])[] = [
    infoRow('Welcome back!', 'strong'),
    infoRow(`${content.model} · ${content.provider}`, 'accent'),
    infoRow(content.cwd, 'muted'),
  ]
  const rightRows: readonly (readonly BannerSegment[])[] = withRight
    ? [
        rightRow(content.tips.heading, 'text'),
        ...content.tips.lines.map(entry => rightRow(entry, 'muted')),
      ]
    : []

  const bodyHeight = Math.max(WHALE_ROWS.length, infoRows.length, rightRows.length)
  const lines = [line(top)]
  for (let row = 0; row < bodyHeight; row++) {
    const art = WHALE_ROWS[row]
    const segments: BannerSegment[] = [
      { text: '│', style: 'frame' },
      ...(art !== undefined ? [{ text: art, style: 'logo' } as BannerSegment] : blank(logoWidth, 'logo')),
      { text: ' ', style: 'frame' },
      ...infoRows[row] ?? blank(infoWidth, 'muted'),
    ]
    if (withRight) {
      segments.push({ text: '│', style: 'frame' }, ...rightRows[row] ?? blank(rightWidth, 'muted'))
    }
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
  })
  // Effect-bound so unloading this fiber unmounts the banner.
  ctx.effect(() => ctx.blueScreen.addChild(banner))
  // addChild schedules no render on its own.
  ctx.blueScreen.requestRender()
}
