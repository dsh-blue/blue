/**
 * Interaction-private adapter from canonical Blue UI nodes to the editor
 * replacement slot. Product panels own only readonly nodes and UI events;
 * core remains the sole validator, compiler, focus, and renderer boundary.
 *
 * @module @dsh-blue/blue-interaction/canonical-panel
 */

import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import {
  compileBlueUiNode,
  type BlueComponents,
  type BlueFocusable,
  type BlueTheme,
  type BlueUiCompileResult,
} from '@dsh-blue/blue-core'

/** A controller that can expose its current canonical node. */
export interface CanonicalNodeSource {
  focused: boolean
  currentNode(): BlueUiNode
  handleInput(data: string): void
  invalidate(): void
}

/** Dependencies for one canonical editor-slot adapter. */
export interface CanonicalPanelAdapterOptions {
  readonly components: BlueComponents
  readonly theme: BlueTheme
  readonly node: () => BlueUiNode
  readonly onEvent: (event: BlueUiEvent) => void
  readonly onUnhandledEscape?: () => void
  readonly maxLeafRows?: number
  readonly focusIndex?: () => number
}

/** Compile canonical nodes lazily while preserving the outer focus identity. */
export class CanonicalPanelAdapter implements BlueFocusable {
  private ownFocused = false
  private revision = 0
  private compiledRevision = -1
  private result: BlueUiCompileResult | undefined
  private columns = 80

  constructor(private readonly options: CanonicalPanelAdapterOptions) {}

  get focused(): boolean { return this.ownFocused }

  set focused(value: boolean) {
    this.ownFocused = value
    const target = this.focusTarget()
    if (target !== null) target.focused = value
  }

  /** Mark the current node stale; the next operation recompiles it. */
  invalidate(): void {
    const component = this.result === undefined
      ? undefined
      : this.result.ok ? this.result.value.component : this.result.errorComponent
    component?.invalidate()
    this.revision += 1
    this.result = undefined
  }

  /** Forward input only through the compiler-owned focus target. */
  handleInput(data: string): void {
    const target = this.focusTarget()
    if (target !== null) target.handleInput?.(data)
    else if (data === '\x1b') this.options.onUnhandledEscape?.()
  }

  /** Render only through the compiler-owned component or safe error surface. */
  render(width: number): string[] {
    this.columns = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
    return this.component().render(this.columns)
  }

  private compile(): BlueUiCompileResult {
    if (this.result !== undefined && this.compiledRevision === this.revision) return this.result
    const result = compileBlueUiNode(this.options.node(), {
      components: this.options.components,
      colors: this.options.theme.colors,
      getViewport: () => ({ columns: this.columns, rows: Number.MAX_SAFE_INTEGER }),
      screenMode: 'main',
      maxLeafRows: this.options.maxLeafRows ?? 256,
      emit: this.options.onEvent,
      ...(this.options.onUnhandledEscape === undefined ? {} : { onUnhandledEscape: this.options.onUnhandledEscape }),
    })
    this.result = result
    this.compiledRevision = this.revision
    const target = result.ok ? result.value.focusTarget : null
    if (target !== null) {
      target.focused = this.ownFocused
      const focusIndex = Math.max(0, Math.floor(this.options.focusIndex?.() ?? 0))
      for (let index = 0; index < focusIndex; index += 1) target.handleInput?.('\t')
    }
    return result
  }

  private component() {
    const result = this.compile()
    return result.ok ? result.value.component : result.errorComponent
  }

  private focusTarget(): BlueFocusable | null {
    const result = this.compile()
    return result.ok ? result.value.focusTarget : null
  }
}
