/**
 * Package-private rendering adapter for canonical frontend nodes. It supplies
 * runtime dependencies to core's sole validator/compiler without converting
 * to another model vocabulary or owning width calculations.
 *
 * @module @dsh-blue/blue-transcript/canonical-node-renderer
 */

import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import { compileBlueUiNode, type BlueComponents, type BlueSemanticColors } from '@dsh-blue/blue-core'

/** Renderer dependencies already owned by the active frontend tree. */
export interface CanonicalNodeRenderer {
  readonly components: BlueComponents
  readonly colors: BlueSemanticColors
  readonly viewportRows?: () => number
}

const PASSIVE_EVENT_SINK = Function.prototype as (event: BlueUiEvent) => void

function positiveInteger(value: number): number {
  return Math.max(1, Number.isFinite(value) ? Math.floor(value) : 1)
}

/**
 * Validate, compile, and render one canonical node at the assigned width.
 * @param node - canonical renderer-neutral UI tree.
 * @param width - assigned terminal width.
 * @param renderer - tree-scoped compiler dependencies.
 * @param maxLeafRows - optional official-model leaf budget.
 * @returns width-contained rows or core's structured rejection component.
 */
export function renderCanonicalNode(
  node: BlueUiNode,
  width: number,
  renderer: CanonicalNodeRenderer,
  maxLeafRows?: number,
): string[] {
  const columns = positiveInteger(width)
  const rows = positiveInteger(renderer.viewportRows?.() ?? Number.MAX_SAFE_INTEGER)
  const result = compileBlueUiNode(node, {
    components: renderer.components,
    colors: renderer.colors,
    getViewport: () => ({ columns, rows }),
    screenMode: 'main',
    ...(maxLeafRows === undefined ? {} : { maxLeafRows }),
    emit: PASSIVE_EVENT_SINK,
  })
  return result.ok
    ? result.value.component.render(columns)
    : result.errorComponent.render(columns)
}
