/**
 * `blue-banner` plugin: the welcome banner, mounted once at boot as the
 * scroll area's first child — the Claude-Code-style layout: a centered left
 * column ("Welcome to Blue!", the pixel logo, the model line and cwd) beside a
 * right column carrying the tips and what's-new sections separated by a
 * divider rule. The box spans the full viewport width once the right column
 * has room; below that the left column absorbs the width, and below
 * {@link BANNER_MIN_WIDTH} the banner renders nothing.
 *
 * The banner is a boot snapshot except the model line: it reads
 * `blueSession.modelRef.current` (never `inject` — resolved lazily, so the
 * mount keeps no ordering coupling with the transcript's history mounting)
 * and re-derives on `'blue/session-changed'`/`'blue/model-changed'` (the
 * S24a dogfood ruling). In the bundle patch the row sits before
 * `blue-transcript` so the two fibers resolve in the same `blueComponents`
 * activation round in row order — the banner stays the first scroll child
 * across initial mounts and `/theme` reloads.
 *
 * Every over-wide run truncates; nothing ever wraps. Styling uses only
 * frozen theme tokens — frame, logo, and the welcome line share `primary`,
 * the kimi welcome-box treatment, so the banner reads as one blue unit.
 *
 * @module @dsh-blue/blue-transcript/banner
 */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import {
  GutterComponent,
  type BlueComponent,
  type BlueComponents,
  type BlueSemanticColors,
} from '@dsh-blue/blue-core'
// Empty type import carries the `agentDefaultModel` Context merge this
// plugin's inject resolves.
import type {} from '@deepseek-ai/dsh-agent-default-model'
// Empty type import carries the app-owned `blueSession` Context merge and
// the `'blue/session-changed'`/`'blue/model-changed'` Events merges the
// model-line tracking consumes.
import type {} from '@dsh-blue/blue-app'
import { LOGO_ART } from './banner-art.ts'
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

/**
 * The left column's fixed width once the right column joins; below that
 * threshold the left column absorbs the viewport width instead.
 */
export const BANNER_LEFT_WIDTH = 44

/** The right-column width at which the right column joins the box. */
export const BANNER_RIGHT_MIN = 30

/** Columns reserved around the title inside the top rule: `╭─── `, ` `, `╮`. */
const BANNER_TITLE_RESERVE = 7

/** The two `│` frame columns every body row spends; also the bottom rule's. */
const BANNER_FRAME_COLUMNS = 2

/** One width computation for a banner render. */
export interface BannerLayout {
  /** The exact box width — the full viewport width; every line is this many columns. */
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
 * {@link BANNER_MIN_WIDTH}; otherwise a full-width box whose left column is
 * fixed once the viewport leaves a {@link BANNER_RIGHT_MIN}-column right
 * cell, which then takes the rest.
 * @param width - current viewport width in columns.
 * @returns the layout, or `null` when the banner renders nothing.
 */
export function bannerLayout(width: number): BannerLayout | null {
  if (width < BANNER_MIN_WIDTH) return null
  const withRight = width - BANNER_FRAME_COLUMNS >= BANNER_LEFT_WIDTH + 1 + BANNER_RIGHT_MIN
  const leftWidth = withRight ? BANNER_LEFT_WIDTH : width - BANNER_FRAME_COLUMNS
  return {
    total: width,
    leftWidth,
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
 * yield plain, measurable text. The left column centers its rows (welcome,
 * logo, model, cwd); the right column pads its rows with a divider rule
 * between the two sections; nothing ever wraps — over-wide model, cwd, and
 * section lines truncate first.
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

  // A left-column row: truncate to the cell, then center the remainder.
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
    centered('Welcome to Blue!', 'strong'),
    blank(leftWidth, 'frame'),
    ...LOGO_ART.map(art => centered(art, 'logo')),
    blank(leftWidth, 'frame'),
    centered(`${content.model} · ${content.provider}`, 'accent'),
    centered(content.cwd, 'muted'),
  ]

  // A right-column row: one leading space, the truncated text, then padding.
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
        ...sectionRows(content.tips, 'muted'),
        [
          { text: ' ', style: 'muted' },
          { text: '─'.repeat(rightWidth - 2), style: 'muted' },
          { text: ' ', style: 'muted' },
        ],
        ...sectionRows(content.whatsNew, 'muted'),
      ]
    : []

  const bodyHeight = Math.max(leftRows.length, rightRows.length)
  const lines = [line(top)]
  for (let row = 0; row < bodyHeight; row++) {
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
 * The welcome banner: every render re-composes from the current content,
 * so it tracks viewport resizes; the model line tracks the live selection
 * through {@link BannerComponent.update} (the cwd and the static sections
 * stay the boot snapshot — the S24a dogfood ruling only pulled the model
 * line into the live tier).
 */
class BannerComponent implements BlueComponent {
  private content: BannerContent

  /**
   * @param colors - the semantic color table.
   * @param components - the component factory providing truncation.
   * @param content - the boot-time banner facts.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    content: BannerContent,
  ) {
    this.content = content
  }

  /** Swap the banner facts; the next render re-composes. */
  update(content: BannerContent): void {
    this.content = content
  }

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
 * Mount the welcome banner as the scroll area's first child. The cwd and
 * the static sections snapshot at boot; the model line re-derives from the
 * live session's selection ref on session switches and committed model
 * picks (the S24a dogfood ruling — the banner used to freeze the boot-time
 * default, surviving `/model` switches and even `/new`), falling back to
 * the default-model service before the app publishes the ref. The mount is
 * effect-bound so unloading this fiber (a `/theme` swap) unmounts and
 * re-mounts it in place.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const boot = ctx.agentDefaultModel.currentSelection()
  const banner = new BannerComponent(ctx.blueTheme.colors, ctx.blueComponents, {
    version: BLUE_VERSION,
    model: boot.model,
    provider: boot.provider,
    cwd: shortenHome(process.cwd(), homedir()),
    tips: BANNER_TIPS,
    whatsNew: BANNER_WHATS_NEW,
  })
  const rederive = (): void => {
    const selection = ctx.get('blueSession')?.modelRef?.current ?? ctx.agentDefaultModel.currentSelection()
    banner.update({
      version: BLUE_VERSION,
      model: selection.model,
      provider: selection.provider,
      cwd: shortenHome(process.cwd(), homedir()),
      tips: BANNER_TIPS,
      whatsNew: BANNER_WHATS_NEW,
    })
    ctx.blueScreen.requestRender()
  }
  ctx.on('blue/session-changed', () => {
    rederive()
  })
  ctx.on('blue/model-changed', () => {
    rederive()
  })
  // Effect-bound so unloading this fiber unmounts the banner.
  ctx.effect(() => ctx.blueScreen.addChild(new GutterComponent(banner)))
  // addChild schedules no render on its own.
  ctx.blueScreen.requestRender()
}
