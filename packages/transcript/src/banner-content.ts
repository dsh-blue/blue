/**
 * The welcome banner's editable copy: the displayed version and the two
 * right-column sections. This module is the placeholder content seam — the
 * S8 banner ships structure with placeholder tips and what's-new lines, and
 * real copy lands here later without touching the layout code in
 * `banner.ts`. Every line must fit the right-column budget (51 visible
 * columns) or it renders truncated.
 *
 * @module @dsh-blue/blue-transcript/banner-content
 */

/**
 * The version shown in the banner's title rule. Keep in sync with
 * `package.json` — `tests/banner.spec.ts` fails the suite on drift.
 */
export const BLUE_VERSION = '0.1.0-rc.7'

/** One right-column section: a heading plus indented body lines. */
export interface BannerSection {
  /** The section heading, rendered in the theme's text color. */
  readonly heading: string
  /** The section body lines, rendered muted. */
  readonly lines: readonly string[]
}

/** Placeholder: quick-start tips for the banner's right column. */
export const BANNER_TIPS: BannerSection = {
  heading: 'Tips for getting started',
  lines: [
    'Type a task and press Enter to send it',
    'Press / for commands, ! for shell mode',
    'Ctrl-O folds tool output, Ctrl-T toggles todos',
  ],
}

/** Placeholder: what's-new lines for the banner's right column. */
export const BANNER_WHATS_NEW: BannerSection = {
  heading: "What's new",
  lines: [
    'Welcome banner with the pixel castle',
    'Diff and terminal render intents for tool calls',
    'Paste images with Ctrl-V into the editor',
  ],
}
