/** Shared dock registration helper for passive panes and fixed editor slots. */

/** @module @dsh-blue/blue-core/dock */

import type { BlueComponent, BlueDockOptions, BlueScreen } from './types.ts'

/** Mount a component through the shared dock allocator when available. */
export function mountDockChild(
  screen: BlueScreen,
  component: BlueComponent,
  options?: BlueDockOptions,
): () => void {
  return screen.addDockChild?.(component, options) ?? screen.addBottomChild(component)
}
