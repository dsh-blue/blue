/**
 * `blue-banner` plugin: the welcome banner, mounted once at boot as the
 * scroll area's first child — a frameless horizontal block: the DeepSeek
 * whale logo on the left, the welcome/help/status lines on the right, no
 * box frame. Below {@link BANNER_MIN_WIDTH} the banner renders nothing.
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
 * frozen theme tokens — the logo and the welcome line share `primary`, the
 * labels stay muted and the model value accent, so the banner reads as one
 * brand-blue unit.
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
import { LOGO_ART, LOGO_GRADIENT, LOGO_ROWS } from './banner-art.ts'
import { BLUE_VERSION } from './banner-content.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-banner'

/** Services required before the banner can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'agentDefaultModel']

/** Below this viewport width the banner renders zero rows rather than overflow. */
export const BANNER_MIN_WIDTH = 40

/** Blank columns between the logo block and the right-hand status column. */
const LOGO_TEXT_GAP = 2

/** The info rows' labels, hand-aligned to {@link LABEL_WIDTH} columns. */
const DIRECTORY_LABEL = 'Directory: '
const MODEL_LABEL = 'Model:     '
const VERSION_LABEL = 'Version:   '

/** The visible width every info-row label occupies. */
const LABEL_WIDTH = 11

/** One width computation for a banner render. */
export interface BannerLayout {
  /** The viewport width budget; every line stays within this many columns. */
  readonly total: number
  /** The width each status value may use, after the logo and its labels. */
  readonly valueWidth: number
}

/**
 * The banner's width plan for a viewport: `null` below
 * {@link BANNER_MIN_WIDTH}; otherwise the frameless horizontal budget. The
 * logo block and its gap are fixed furniture; the value column gets the rest.
 * @param width - current viewport width in columns.
 * @returns the layout, or `null` when the banner renders nothing.
 */
export function bannerLayout(width: number): BannerLayout | null {
  if (width < BANNER_MIN_WIDTH) return null
  const logoWidth = Math.max(...LOGO_ART.map(art => art.length))
  const valueWidth = Math.max(0, width - logoWidth - LOGO_TEXT_GAP - LABEL_WIDTH)
  return { total: width, valueWidth }
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
type BannerStyle = 'logo' | 'strong' | 'accent' | 'muted' | 'text' | 'highlight'

/** The model row's brand-light-blue highlight (theme-independent, like the logo). */
const MODEL_HIGHLIGHT = '#8ca8ff'

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

/** The right-hand status lines, one per banner row. */
interface StatusLine {
  readonly text: string
  readonly style: BannerStyle
}

/**
 * Compose the banner's lines for one viewport width — the pure layout core
 * the component delegates to. Identity color functions (the spec fakes)
 * yield plain, measurable text. The frameless horizontal block stacks the
 * whale logo rows down the left and centers the status column beside them;
 * nothing ever wraps — an over-wide status value or welcome line truncates
 * first.
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
  const { valueWidth } = layout
  const paint: Record<BannerStyle, (text: string) => string> = {
    logo: deps.colors.primary,
    strong: deps.colors.primary,
    accent: deps.colors.accent,
    muted: deps.colors.muted,
    text: deps.colors.text,
    highlight: text => gradientWrap(MODEL_HIGHLIGHT, text),
  }
  const line = (segments: readonly BannerSegment[]): string =>
    segments.map(segment => paint[segment.style](segment.text)).join('')

  // The logo's brand-blue gradient, one hex per row, applied directly (the
  // mark is brand identity — the same sweep in every theme). The gap after
  // the whale stays the frame's neutral tint.
  const gradientWrap = (hex: string, text: string): string => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`
  }

  // The right-hand status column; the welcome and help lines lead, then the
  // three info rows. A blank spacer row separates the two groups.
  const status: StatusLine[] = [
    { text: 'Welcome to Blue!', style: 'strong' },
    { text: 'Send /help for help information.', style: 'muted' },
    { text: '', style: 'text' },
    { text: `${DIRECTORY_LABEL}${content.cwd}`, style: 'text' },
    { text: `${MODEL_LABEL}${content.model} · ${content.provider}`, style: 'highlight' },
    { text: `${VERSION_LABEL}${content.version}`, style: 'text' },
  ]

  // Center the status column against the logo's rows; a negative offset
  // (status taller than the logo) would clip, so clamp to the leading row.
  const statusTopPad = Math.max(0, Math.floor((LOGO_ROWS - status.length) / 2))

  const fit = (text: string, style: BannerStyle, max: number): BannerSegment => {
    const truncated = deps.truncate(text, max)
    const widthOfFit = deps.visibleWidth(truncated)
    const pad = Math.max(0, max - widthOfFit)
    return { text: `${truncated}${' '.repeat(pad)}`, style }
  }

  const rows: string[] = []
  for (let i = 0; i < LOGO_ROWS; i += 1) {
    const logo = LOGO_ART[i]!
    const statusIndex = i - statusTopPad
    const statusLine = status[statusIndex]
    const segments: BannerSegment[] = [
      { text: gradientWrap(LOGO_GRADIENT[i]!, logo), style: 'logo' },
      { text: ' '.repeat(LOGO_TEXT_GAP), style: 'logo' },
    ]
    if (statusLine !== undefined) {
      segments.push(fit(statusLine.text, statusLine.style, valueWidth))
    }
    rows.push(line(segments))
  }
  return rows
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
