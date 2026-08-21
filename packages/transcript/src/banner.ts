/**
 * `blue-banner` plugin: the welcome banner, mounted once at boot as the
 * scroll area's first child — the kimi-code-style single column: the logo
 * beside the welcome and `/help` lines, then the Directory/Model/Version
 * label rows, all inside one full-viewport box. Below
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
 * frozen theme tokens — the frame, the logo, and the welcome line share
 * `primary`, the kimi welcome-box treatment, so the banner reads as one
 * blue unit.
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
import { BLUE_VERSION } from './banner-content.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-banner'

/** Services required before the banner can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'agentDefaultModel']

/** Below this viewport width the banner renders zero rows rather than overflow. */
export const BANNER_MIN_WIDTH = 40

/** The two `│` frame columns every row spends; also the rules'. */
const BANNER_FRAME_COLUMNS = 2

/** Blank columns between each `│` and the content — the box's inner inset. */
const BANNER_INNER_PAD = 2

/** Columns between the logo and the header text beside it. */
const LOGO_TEXT_GAP = 2

/** The info rows' labels, hand-aligned to {@link LABEL_WIDTH} columns. */
const DIRECTORY_LABEL = 'Directory: '
const MODEL_LABEL = 'Model:     '
const VERSION_LABEL = 'Version:   '

/** The visible width every info-row label occupies. */
const LABEL_WIDTH = 11

/** One width computation for a banner render. */
export interface BannerLayout {
  /** The exact box width — the full viewport width; every line is this many columns. */
  readonly total: number
  /** The content cell's width: what the frame columns and the inner inset leave. */
  readonly innerWidth: number
}

/**
 * The banner's width plan for a viewport: `null` below
 * {@link BANNER_MIN_WIDTH}; otherwise a full-width box with one content
 * cell.
 * @param width - current viewport width in columns.
 * @returns the layout, or `null` when the banner renders nothing.
 */
export function bannerLayout(width: number): BannerLayout | null {
  if (width < BANNER_MIN_WIDTH) return null
  return {
    total: width,
    innerWidth: width - BANNER_FRAME_COLUMNS - BANNER_INNER_PAD,
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
  /** The version shown in the Version row. */
  readonly version: string
  /** The default model id for the model row. */
  readonly model: string
  /** The default provider route for the model row. */
  readonly provider: string
  /** The working directory, already home-shortened. */
  readonly cwd: string
}

/** The theme tokens the banner paints with, keyed by segment role. */
type BannerStyle = 'frame' | 'strong' | 'logo' | 'accent' | 'muted' | 'text'

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
 * yield plain, measurable text. The single column stacks the logo-headed
 * welcome lines above the three label rows; nothing ever wraps — over-wide
 * header and value runs truncate first.
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
  const { total, innerWidth } = layout
  const paint: Record<BannerStyle, (text: string) => string> = {
    // kimi parity for the welcome box: the whole frame, the logo, and the
    // welcome line are the brand's interactive blue (`primary`), with only
    // the labels staying gray — the boot screen's one big color moment.
    frame: deps.colors.primary,
    strong: deps.colors.primary,
    logo: deps.colors.primary,
    accent: deps.colors.accent,
    muted: deps.colors.muted,
    text: deps.colors.text,
  }
  const line = (segments: readonly BannerSegment[]): string =>
    segments.map(segment => paint[segment.style](segment.text)).join('')
  const logoWidth = Math.max(...LOGO_ART.map(art => deps.visibleWidth(art)))

  const rule = (left: string, right: string): string =>
    line([{ text: `${left}${'─'.repeat(total - BANNER_FRAME_COLUMNS)}${right}`, style: 'frame' }])
  const blankRow = (): string =>
    line([{ text: `│${' '.repeat(total - BANNER_FRAME_COLUMNS)}│`, style: 'frame' }])

  // A header row: the logo padded level with its widest row, the gap, then
  // the text truncated to the remaining budget.
  const headerRow = (logo: string, text: string, style: BannerStyle): string => {
    const budget = innerWidth - logoWidth - LOGO_TEXT_GAP
    const fit = deps.truncate(text, budget)
    const pad = budget - deps.visibleWidth(fit)
    return line([
      { text: '│', style: 'frame' },
      { text: ' '.repeat(BANNER_INNER_PAD), style: 'frame' },
      { text: logo + ' '.repeat(logoWidth - deps.visibleWidth(logo)), style: 'logo' },
      { text: `${' '.repeat(LOGO_TEXT_GAP)}${fit}${' '.repeat(pad)}`, style },
      { text: '│', style: 'frame' },
    ])
  }

  // An info row: the aligned label, then the value truncated to the rest.
  const infoRow = (label: string, value: string, style: BannerStyle): string => {
    const budget = innerWidth - LABEL_WIDTH
    const fit = deps.truncate(value, budget)
    const pad = budget - deps.visibleWidth(fit)
    return line([
      { text: '│', style: 'frame' },
      { text: ' '.repeat(BANNER_INNER_PAD), style: 'frame' },
      { text: label, style: 'muted' },
      { text: `${fit}${' '.repeat(pad)}`, style },
      { text: '│', style: 'frame' },
    ])
  }

  return [
    rule('╭', '╮'),
    blankRow(),
    headerRow(LOGO_ART[0], 'Welcome to Blue!', 'strong'),
    headerRow(LOGO_ART[1], 'Send /help for help information.', 'muted'),
    blankRow(),
    infoRow(DIRECTORY_LABEL, content.cwd, 'text'),
    infoRow(MODEL_LABEL, `${content.model} · ${content.provider}`, 'accent'),
    infoRow(VERSION_LABEL, content.version, 'text'),
    blankRow(),
    rule('╰', '╯'),
  ]
}

/**
 * The welcome banner: every render re-composes from the current content,
 * so it tracks viewport resizes; the model row tracks the live selection
 * through {@link BannerComponent.update} (the cwd stays the boot snapshot
 * — the S24a dogfood ruling only pulled the model line into the live
 * tier).
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
 * Mount the welcome banner as the scroll area's first child. The cwd
 * snapshots at boot; the model line re-derives from the live session's
 * selection ref on session switches and committed model picks (the S24a
 * dogfood ruling — the banner used to freeze the boot-time default,
 * surviving `/model` switches and even `/new`), falling back to the
 * default-model service before the app publishes the ref. The mount is
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
  })
  const rederive = (): void => {
    const selection = ctx.get('blueSession')?.modelRef?.current ?? ctx.agentDefaultModel.currentSelection()
    banner.update({
      version: BLUE_VERSION,
      model: selection.model,
      provider: selection.provider,
      cwd: shortenHome(process.cwd(), homedir()),
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
