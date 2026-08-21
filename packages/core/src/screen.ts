/**
 * `ctx.blueScreen` service: the L1 component-mounting contract, delegating
 * to the L0 terminal runtime.
 *
 * @module @dsh-blue/blue-core/screen
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { BlueTerminalRuntime } from './terminal.ts'
import type { BlueComponent, BlueOverlayHandle, BlueOverlayOptions, BlueScreen } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueScreen: BlueScreenService
  }
}

/**
 * The `blueScreen` service. Registered by the `blue-core` plugin together
 * with the terminal runtime it delegates to; unregistered automatically when
 * the plugin's fiber unloads.
 */
export class BlueScreenService extends Service implements BlueScreen {
  private readonly runtime: BlueTerminalRuntime

  /**
   * Create and register the service.
   * @param ctx - the owning Cordis context.
   * @param runtime - the terminal runtime started by the `blue-core` plugin.
   */
  constructor(ctx: Context, runtime: BlueTerminalRuntime) {
    super(ctx, 'blueScreen')
    this.runtime = runtime
  }

  /** Current terminal width in columns. */
  get columns(): number {
    return this.runtime.columns
  }

  /** Current terminal height in rows. */
  get rows(): number {
    return this.runtime.rows
  }

  /**
   * Mount a component at the root of the tree, above every bottom-pinned
   * component regardless of mount order.
   * @param component - the component to mount.
   * @returns a disposer that unmounts the component; safe to call twice.
   */
  addChild(component: BlueComponent): () => void {
    this.runtime.addChild(component)
    return () => {
      this.runtime.removeChild(component)
    }
  }

  /**
   * Mount a component pinned to the bottom of the tree (the input editor
   * dock); short content is padded so the pinned block spans the terminal's
   * last rows. `position: 'bottom'` renders the component below the rest of
   * the dock — the footer shell uses it to stay on the terminal's last rows
   * beneath the editor (the kimi layout, and what dialog panels pull up
   * over).
   * @param component - the component to pin.
   * @param position - `'bottom'` for the dock's lowest slot.
   * @returns a disposer that unmounts the component; safe to call twice.
   */
  addBottomChild(component: BlueComponent, position?: 'bottom'): () => void {
    this.runtime.addBottomChild(component, position)
    return () => {
      this.runtime.removeChild(component)
    }
  }

  /**
   * Unmount a component; unmounting an absent component is a no-op.
   * @param component - the component to unmount.
   */
  removeChild(component: BlueComponent): void {
    this.runtime.removeChild(component)
  }

  /**
   * Move keyboard focus; `null` releases focus entirely.
   * @param component - the component to focus, or `null`.
   */
  setFocus(component: BlueComponent | null): void {
    this.runtime.setFocus(component)
  }

  /**
   * Mount a component as an overlay above the base content.
   * @param component - the overlay component.
   * @param options - positioning and sizing options.
   * @returns the overlay's control handle.
   */
  showOverlay(component: BlueComponent, options?: BlueOverlayOptions): BlueOverlayHandle {
    return this.runtime.showOverlay(component, options)
  }

  /**
   * Schedule a throttled re-render.
   * @param force - reset differential render state before drawing.
   */
  requestRender(force?: boolean): void {
    this.runtime.requestRender(force)
  }

  /**
   * Suspend the renderer and run `fn` with the terminal released for a
   * child process; resumes with a forced full repaint. See
   * {@link BlueScreen.suspend} for the exclusivity and teardown semantics.
   * @param fn - the async body owning the terminal while it is released.
   * @returns settles with fn's outcome after the renderer resumed.
   */
  suspend<T>(fn: () => Promise<T>): Promise<T> {
    return this.runtime.suspend(fn)
  }

  /**
   * Set the terminal's window/tab title (a sanitized OSC 0 write; inside
   * tmux, the tmux window name).
   * @param title - untrusted title text; control characters are stripped
   *   and the payload capped before the write.
   */
  setTitle(title: string): void {
    this.runtime.setTitle(title)
  }
}
