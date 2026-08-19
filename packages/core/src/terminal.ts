/**
 * L0 pi-tui adapter: the only code in the tree that constructs pi-tui
 * renderers and touches the process terminal. Owns the terminal lifecycle
 * (start, drain, stop) and the stable TUI reference behind which a future
 * renderer hot-swap can happen without consumers re-resolving.
 *
 * @module @deepseek-ai/dsh-blue-core/terminal
 */

import { ProcessTerminal, TuiMainScreen, type Terminal, type TUI } from '@earendil-works/pi-tui'
import { probeTerminalBackground, backgroundFromRgb, type BlueProbeProcess } from './terminal-info.ts'
import type { BlueComponent, BlueOverlayHandle, BlueOverlayOptions, BlueRgbColor } from './types.ts'

/**
 * The Blue-typed face of the running terminal stack. L1 services consume
 * this; pi-tui types stay inside this module.
 */
export interface BlueTerminalRuntime {
  /** Current terminal width in columns. */
  readonly columns: number
  /** Current terminal height in rows. */
  readonly rows: number
  /** The probed background luminance class, or `undefined` when the probe failed. */
  readonly background: 'dark' | 'light' | undefined
  /** Whether the Kitty keyboard protocol is active on the terminal. */
  readonly kittyKeyboard: boolean
  /** The stable TUI reference behind the runtime; core-internal (pi-tui type). */
  readonly tui: TUI
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
   * @param position - `'bottom'` renders the component below the rest of
   *   the dock (the two-row footer shell mounts there, keeping the status
   *   on the terminal's last rows beneath the editor and any dialog panel
   *   that pulls up over it).
   */
  addBottomChild(component: BlueComponent, position?: 'bottom'): void
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
 * `ProcessTerminal`, registered as the process-active runtime. The OSC 11
 * background probe runs first, before the renderer takes stdin into raw
 * mode; then the renderer starts and subscribes to terminal color-scheme
 * (mode 2031) notifications, forwarded through `onSchemeChange`.
 * MVP runs the main-screen renderer only; the returned runtime
 * delegates through the stable reference so a renderer swap needs no
 * consumer change.
 * @param terminal - the terminal to drive; defaults to a real
 *   `ProcessTerminal` on process stdin/stdout. Tests inject a fake.
 * @param probe - the background probe; defaults to the OSC 11 query on the
 *   live process. Tests inject a recording fake.
 * @param onSchemeChange - called when the terminal reports a dark/light
 *   color-scheme switch.
 * @returns the running stack's Blue-typed face.
 */
export async function startBlueTerminal(
  terminal: Terminal = new ProcessTerminal(),
  probe: (proc?: BlueProbeProcess) => Promise<BlueRgbColor | undefined> = () => probeTerminalBackground(),
  onSchemeChange?: (scheme: 'dark' | 'light') => void,
): Promise<BlueTerminalRuntime> {
  const current: TUI = new TuiMainScreen(terminal)
  const stable = createStableTuiReference(() => current)
  // Bottom-pinned components (the input editor dock) must render after
  // transcript content no matter when each side mounts: pi-tui renders root
  // children in array order, and transcript components mount only after the
  // app's session-changed broadcast, long after the editor. `bottomPinned`
  // members render below the rest of the dock — the footer shell mounts
  // there so the two-row status stays on the terminal's last rows beneath
  // the editor, the kimi layout (its dialogs pull up from the editor's
  // slot while the statusline remains visible below).
  const bottomChildren = new Set<BlueComponent>()
  const bottomPinned = new Set<BlueComponent>()
  // The dock must also sit on the terminal's last rows even when the mounted
  // content is shorter than the viewport (boot with no session yet, a fresh
  // /new) — pi-tui stacks root children top-down, so an unpadded tree leaves
  // the editor floating right under the content. Wrapping the renderer's own
  // line collection is the one seam where the flat output can be split back
  // into content and dock: the dock block is measured again (its components
  // are a few cheap rows) and blank filler is inserted between the blocks
  // until the frame spans the viewport. Full viewports render untouched, and
  // an empty or dock-less tree pads nothing (no blank flood at boot).
  const collectLines = current.render.bind(current)
  current.render = (width: number): string[] => {
    const lines = collectLines(width)
    if (lines.length === 0 || lines.length >= terminal.rows || bottomChildren.size === 0) return lines
    let dockRows = 0
    for (const child of orderedDock()) dockRows += child.render(width).length
    const filler = terminal.rows - lines.length
    const boundary = lines.length - dockRows
    return [
      ...lines.slice(0, boundary),
      ...Array.from({ length: filler }, () => ''),
      ...lines.slice(boundary),
    ]
  }
  /** Dock children in render order: the regular block, then the pinned tail. */
  function orderedDock(): BlueComponent[] {
    return [
      ...[...bottomChildren].filter(child => !bottomPinned.has(child)),
      ...bottomPinned,
    ]
  }
  const background = backgroundFromRgb(await probe())
  current.start()
  current.setTerminalColorSchemeNotifications(true)
  if (onSchemeChange !== undefined) current.onTerminalColorSchemeChange(onSchemeChange)
  let stopped = false
  const runtime: BlueTerminalRuntime = {
    get columns() {
      return current.terminal.columns
    },
    get rows() {
      return terminal.rows
    },
    background,
    get kittyKeyboard() {
      return terminal.kittyProtocolActive
    },
    tui: stable,
    addChild(component) {
      if (bottomChildren.size === 0) {
        stable.addChild(component)
        return
      }
      const index = stable.children.findIndex(child => bottomChildren.has(child as BlueComponent))
      /* v8 ignore next -- pinned components are always mounted on the renderer, so findIndex cannot miss */
      stable.children.splice(index === -1 ? stable.children.length : index, 0, component)
    },
    addBottomChild(component, position) {
      bottomChildren.add(component)
      if (position === 'bottom') {
        // Pinned members render at the very bottom of the dock: re-append
        // on the renderer so the array order — and therefore the painted
        // row order — keeps them after every regular dock child.
        bottomPinned.add(component)
        stable.removeChild(component)
        stable.addChild(component)
      } else {
        bottomPinned.delete(component)
        // Regular dock children insert before the first pinned member (or
        // append when none is pinned), preserving mount order among
        // themselves while the pinned tail stays last.
        const index = stable.children.findIndex(child => bottomPinned.has(child as BlueComponent))
        /* v8 ignore next -- pinned components are always mounted on the renderer, so findIndex cannot miss */
        stable.children.splice(index === -1 ? stable.children.length : index, 0, component)
      }
    },
    removeChild(component) {
      bottomChildren.delete(component)
      bottomPinned.delete(component)
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
