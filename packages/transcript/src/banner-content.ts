/**
 * The welcome banner's editable copy: the displayed version, the derived
 * tips section, and the what's-new lines. The tips are not hand-written —
 * they derive from {@link STATUS_TIPS} (the footer rotation's pool, the
 * single content source) by the rule below, so a feature's tip surviving in
 * one surface survives in the other. Only the what's-new section is literal
 * editorial copy, rewritten per release. Every over-wide line renders
 * truncated (never wrapped) against the live right-column budget —
 * `width − 47 − 1` columns once the right column joins.
 *
 * @module @dsh-blue/blue-transcript/banner-content
 */

import { STATUS_TIPS, type StatusTip } from './tips-content.ts'

/**
 * The version shown in the banner's title rule. Keep in sync with
 * `package.json` — `tests/banner.spec.ts` fails the suite on drift.
 */
export const BLUE_VERSION = '0.1.0-rc.1'

/** One right-column section: a heading plus indented body lines. */
export interface BannerSection {
  /** The section heading, rendered in the theme's text color. */
  readonly heading: string
  /** The section body lines, rendered muted. */
  readonly lines: readonly string[]
}

/** How many derived tips the section shows. */
const BANNER_TIP_COUNT = 3

/** One pool tip carrying its pool position for the stable tiebreak. */
interface RankedTip {
  readonly tip: StatusTip
  readonly index: number
  readonly weight: number
}

/**
 * The quick-start selection: the three highest-weight tips that may share a
 * row (`solo` tips are long-form, written for the footer's full-width slot —
 * in a column cell they would render as clipped stubs). Weight descends
 * with the pool order breaking ties, matching the footer rotation's notion
 * of importance; three tips plus two what's-new lines exactly fill the
 * right column's eight body rows — level with the left column the compact
 * logo tightened, so the banner carries no filler rows.
 * @returns the selected tip texts, most important first.
 */
function selectBannerTips(): readonly string[] {
  const ranked: RankedTip[] = STATUS_TIPS
    .map((tip, index) => ({ tip, index, weight: tip.priority ?? 1 }))
    .filter(entry => entry.tip.solo !== true)
  ranked.sort((a, b) => b.weight - a.weight || a.index - b.index)
  return ranked.slice(0, BANNER_TIP_COUNT).map(entry => entry.tip.text)
}

/** The banner's quick-start tips, derived from the footer pool. */
export const BANNER_TIPS: BannerSection = {
  heading: 'Tips for getting started',
  lines: selectBannerTips(),
}

/** This release's what's-new lines — literal editorial copy. */
export const BANNER_WHATS_NEW: BannerSection = {
  heading: "What's new",
  lines: [
    'Git status, context usage, and tips in the footer',
    '/btw: side questions while the agent keeps running',
  ],
}
