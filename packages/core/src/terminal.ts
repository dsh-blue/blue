/**
 * L0 pi-tui adapter: the only code in the tree that constructs pi-tui
 * renderers and touches the process terminal. Owns the terminal lifecycle
 * (start, drain, stop) and the stable TUI reference behind which a future
 * renderer hot-swap can happen without consumers re-resolving.
 *
 * @module @deepseek-ai/dsh-blue-core/terminal
 */

import { ProcessTerminal, TuiMainScreen, type Terminal, type TUI } from '@earendil-works/pi-tui'
import type { BlueComponent, BlueOverlayHandle, BlueOverlayOptions } from './types.ts'

/**
 * The Blue-typed face of the running terminal stack. L1 services consume
 * this; pi-tui types stay inside this module.
 */
export interface BlueTerminalRuntime {
  /** Current terminal width in columns. */
  readonly columns: number
  /**
   * Mount a root component on the live renderer, above every bottom-pinned
   * component.
   * @param component - the component to mount.
   */
  addChild(component: BlueComponent): void
  /**
   * Mount a root component pinned to the bottom of the live renderer: it
   * renders after every component mounted through `addChild`.
   * @param component - the component to pin.
   */
  addBottomChild(component: BlueComponent): void
  /**
   * Unmount a root component from the live renderer.
   * @param component - the component to unmount.
   */
  removeChild(component: BlueComponent): void
  /**
   * Move keyboard focus on the live renderer.
   * @param component - the component to focus, or `null`.
   */
  setFocus(component: BlueComponent | null): void
  /**
   * Show an overlay on the live renderer.
   * @param component - the overlay component.
   * @param options - positioning and sizing options.
   * @returns the overlay's control handle.
   */
  showOverlay(component: BlueComponent, options?: BlueOverlayOptions): BlueOverlayHandle
  /**
   * Schedule a re-render of the live renderer.
   * @param force - reset differential render state before drawing.
   */
  requestRender(force?: boolean): void
  /**
   * Restore the terminal: drain pending input, then stop the renderer and
   * the underlying terminal. Idempotent.
   * @returns settles when the terminal state is restored.
   */
  stop(): Promise<void>
}

/**
 * Stable `TUI` reference for consumers while the runtime replaces the active
 * renderer. Mirrors pi's `createInteractiveTuiReference`: property reads and
 * method calls resolve against the current renderer at call time.
 * @param getTui - accessor for the current renderer.
 * @returns a proxy implementing the full pi-tui `TUI` interface.
 */
export function createStableTuiReference(getTui: () => TUI): TUI {
  return new Proxy({} as TUI, {
    get: (_target, property) => {
      const tui = getTui()
      const value: unknown = Reflect.get(tui, property, tui)
      if (typeof value !== 'function') return value
      let methodTui = tui
      let method = value as (this: TUI, ...args: unknown[]) => unknown
      return (...args: unknown[]) => {
        const currentTui = getTui()
        if (currentTui !== methodTui) {
          const currentMethod: unknown = Reflect.get(currentTui, property, currentTui)
          if (typeof currentMethod !== 'function') {
            throw new TypeError(`TUI property ${String(property)} is not callable`)
          }
          methodTui = currentTui
          method = currentMethod as (this: TUI, ...args: unknown[]) => unknown
        }
        return Reflect.apply(method, methodTui, args)
      }
    },
    set: (_target, property, value) => Reflect.set(getTui(), property, value, getTui()),
    has: (_target, property) => Reflect.has(getTui(), property),
    getPrototypeOf: () => Reflect.getPrototypeOf(getTui()),
  })
}

/**
 * The Blue terminal stack active in this process, or `undefined` before the
 * plugin loads and after it unloads. At most one is active: the underlying
 * `ProcessTerminal` owns process stdin/stdout.
 */
let activeRuntime: BlueTerminalRuntime | undefined

/**
 * Terminal restore function factory for `installFailLoud(binName, proc,
 * release)`. The returned function stops the active Blue terminal stack
 * (restoring raw mode, bracketed paste, and keyboard protocols) and is a
 * no-op when no stack is active.
 * @returns the release function to hand to `installFailLoud`.
 */
export function createTerminalRelease(): () => Promise<void> {
  return async () => {
    await activeRuntime?.stop()
  }
}

/**
 * Start the Blue terminal stack: a `TuiMainScreen` renderer over a
 * `ProcessTerminal`, started immediately and registered as the process-active
 * runtime. MVP runs the main-screen renderer only; the returned runtime
 * delegates through the stable reference so a renderer swap needs no
 * consumer change.
 * @param terminal - the terminal to drive; defaults to a real
 *   `ProcessTerminal` on process stdin/stdout. Tests inject a fake.
 * @returns the running stack's Blue-typed face.
 */
export function startBlueTerminal(terminal: Terminal = new ProcessTerminal()): BlueTerminalRuntime {
  const current: TUI = new TuiMainScreen(terminal)
  const stable = createStableTuiReference(() => current)
  current.start()
  let stopped = false
  // Bottom-pinned components (the input editor) must render after transcript
  // content no matter when each side mounts: pi-tui renders root children in
  // array order, and transcript components mount only after the app's
  // session-changed broadcast, long after the editor.
  const bottomChildren = new Set<BlueComponent>()
  const runtime: BlueTerminalRuntime = {
    get columns() {
      return current.terminal.columns
    },
    addChild(component) {
      if (bottomChildren.size === 0) {
        stable.addChild(component)
        return
      }
      const index = stable.children.findIndex(child => bottomChildren.has(child as BlueComponent))
      /* v8 ignore next -- pinned components are always mounted on the renderer, so findIndex cannot miss */
      stable.children.splice(index === -1 ? stable.children.length : index, 0, component)
    },
    addBottomChild(component) {
      bottomChildren.add(component)
      stable.addChild(component)
    },
    removeChild(component) {
      bottomChildren.delete(component)
      stable.removeChild(component)
    },
    setFocus(component) {
      stable.setFocus(component)
    },
    showOverlay(component, options) {
      return stable.showOverlay(component, options)
    },
    requestRender(force) {
      stable.requestRender(force)
    },
    async stop() {
      if (stopped) return
      stopped = true
      // Drain before stopping so in-flight Kitty key releases cannot leak
      // into the parent shell as literal escape sequences.
      await terminal.drainInput()
      current.stop()
      if (activeRuntime === runtime) activeRuntime = undefined
    },
  }
  activeRuntime = runtime
  return runtime
}
