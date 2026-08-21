/**
 * The version shown in the banner's Version row. Keep in sync with
 * `package.json` — `tests/banner.spec.ts` and `tests/version.spec.ts` fail
 * the suite on drift. This module is the public `./banner-content`
 * subpath: `/version` (interaction) imports the constant from here, so the
 * export's home does not move.
 *
 * @module @dsh-blue/blue-transcript/banner-content
 */

/**
 * The displayed Blue version; `tests/banner.spec.ts` fails the suite on
 * drift from `package.json`.
 */
export const BLUE_VERSION = '0.1.0-rc.1'
