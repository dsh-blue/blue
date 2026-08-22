/**
 * L0 width-truth seam: the single entry point for pi-tui's width utilities
 * inside core and in cross-package tests (the source-plane convention —
 * transcript/interaction specs import this file by relative path). Only
 * core declares `@earendil-works/pi-tui` as a dependency, so routing every
 * consumer through here keeps version resolution unique (D4: no other
 * package names pi-tui) and lets the width-property spec pin the semantics
 * the `BlueComponent` contract and the exit clamp depend on.
 *
 * @module @dsh-blue/blue-core/width
 */

export { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
