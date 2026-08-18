/**
 * Shared test doubles for the Blue interaction suites: fake BlueScreen,
 * BlueTheme, and BlueKeymap implementing the L1 contracts with observable
 * state, plus helpers to mount a context with the fakes provided.
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponent,
  BlueFocusable,
  BlueKeyAction,
  BlueKeymap,
  BlueOverlayHandle,
  BlueOverlayOptions,
  BlueScreen,
  BlueSemanticColors,
  BlueTheme,
} from '@deepseek-ai/dsh-blue-core'
import type { BlueScreenService, BlueKeymapService } from '@deepseek-ai/dsh-blue-core'
import {
  ACTION_CANCEL,
  ACTION_CURSOR_LEFT,
  ACTION_CURSOR_RIGHT,
  ACTION_DELETE_BACKWARD,
  ACTION_MOVE_DOWN,
  ACTION_MOVE_UP,
  ACTION_SUBMIT,
  ACTION_TOGGLE,
} from '../src/keys.ts'

/** Decoded sequences the fake keymap binds to each interaction action. */
const FAKE_KEY_SEQUENCES: Record<string, string[]> = {
  [ACTION_SUBMIT]: ['\r'],
  [ACTION_CANCEL]: ['\x1b'],
  [ACTION_CURSOR_LEFT]: ['\x1b[D'],
  [ACTION_CURSOR_RIGHT]: ['\x1b[C'],
  [ACTION_DELETE_BACKWARD]: ['\x7f'],
  [ACTION_MOVE_UP]: ['\x1b[A'],
  [ACTION_MOVE_DOWN]: ['\x1b[B'],
  [ACTION_TOGGLE]: [' '],
}

/** Key-id labels the fake keymap reports for hint text. */
const FAKE_KEY_IDS: Record<string, string[]> = {
  [ACTION_SUBMIT]: ['enter'],
  [ACTION_CANCEL]: ['escape'],
  [ACTION_CURSOR_LEFT]: ['left'],
  [ACTION_CURSOR_RIGHT]: ['right'],
  [ACTION_DELETE_BACKWARD]: ['backspace'],
  [ACTION_MOVE_UP]: ['up'],
  [ACTION_MOVE_DOWN]: ['down'],
  [ACTION_TOGGLE]: ['space'],
}

/** Convenience aliases for the fake key sequences. */
export const KEY = {
  enter: '\r',
  escape: '\x1b',
  left: '\x1b[D',
  right: '\x1b[C',
  backspace: '\x7f',
  up: '\x1b[A',
  down: '\x1b[B',
  space: ' ',
} as const

/** Fake keymap: exact-sequence matching for `matches`, key-id labels for `getKeys`. */
export class FakeKeymap implements BlueKeymap {
  private readonly sequences = new Map<string, string[]>()
  private readonly ids = new Map<string, string[]>()

  /**
   * @param withDefaults - preload the interaction action bindings; pass
   *   false to test unregistered-action fallbacks.
   */
  constructor(withDefaults = true) {
    if (!withDefaults) return
    for (const [action, keys] of Object.entries(FAKE_KEY_SEQUENCES)) this.sequences.set(action, [...keys])
    for (const [action, keys] of Object.entries(FAKE_KEY_IDS)) this.ids.set(action, [...keys])
  }

  register(actions: BlueKeyAction[]): () => void {
    for (const action of actions) {
      const keys = typeof action.keys === 'string' ? [action.keys] : [...action.keys]
      this.ids.set(action.id, keys)
      this.sequences.set(action.id, keys)
    }
    return () => {
      for (const action of actions) {
        this.ids.delete(action.id)
        this.sequences.delete(action.id)
      }
    }
  }

  matches(data: string, action: string): boolean {
    return this.sequences.get(action)?.includes(data) ?? false
  }

  getKeys(action: string): string[] {
    return [...this.ids.get(action) ?? []]
  }
}

const identity = (text: string): string => text

/** Marker-wrapping color functions so tests can assert which role styled a row. */
function fakeColors(): BlueSemanticColors {
  return {
    text: identity,
    textStrong: text => `#${text}#`,
    muted: text => `~${text}~`,
    accent: text => `*${text}*`,
    border: identity,
    borderFocus: text => `%${text}%`,
    success: identity,
    error: text => `!${text}!`,
    warning: text => `?${text}?`,
    selectedBg: identity,
    roleUser: text => `@${text}@`,
    shellMode: text => `$${text}$`,
    mdHeading: identity,
    mdLink: identity,
    mdLinkUrl: identity,
    mdCode: identity,
    mdCodeBlock: identity,
    mdCodeBlockBorder: identity,
    mdQuote: identity,
    mdQuoteBorder: identity,
    mdHr: identity,
    mdListBullet: identity,
    diffAdded: text => `+${text}+`,
    diffRemoved: text => `-${text}-`,
    diffAddedStrong: text => `=${text}=`,
    diffRemovedStrong: text => `/${text}/`,
    diffGutter: text => `:${text}:`,
    diffMeta: text => `;${text};`,
  }
}

/** Fake theme wrapping {@link fakeColors}. */
export class FakeTheme implements BlueTheme {
  readonly colors = fakeColors()
}

/** One overlay observed by {@link FakeScreen}. */
export interface FakeOverlay {
  readonly component: BlueComponent
  readonly options: BlueOverlayOptions | undefined
  readonly handle: BlueOverlayHandle
  hidden: boolean
}

/** Fake screen recording mounts, focus moves, overlays, and render requests. */
export class FakeScreen implements BlueScreen {
  columns = 80
  readonly children: BlueComponent[] = []
  readonly overlays: FakeOverlay[] = []
  focused: BlueComponent | null = null
  renderRequests = 0
  private readonly bottom = new Set<BlueComponent>()

  addChild(component: BlueComponent): () => void {
    // Mirror the runtime's ordering contract: plain mounts land above every
    // bottom-pinned component regardless of mount order.
    const firstBottom = this.children.findIndex(child => this.bottom.has(child))
    this.children.splice(firstBottom === -1 ? this.children.length : firstBottom, 0, component)
    return () => {
      this.removeChild(component)
    }
  }

  addBottomChild(component: BlueComponent): () => void {
    this.bottom.add(component)
    this.children.push(component)
    return () => {
      this.removeChild(component)
    }
  }

  removeChild(component: BlueComponent): void {
    this.bottom.delete(component)
    const index = this.children.indexOf(component)
    if (index >= 0) this.children.splice(index, 1)
  }

  setFocus(component: BlueComponent | null): void {
    if (isFocusable(this.focused)) this.focused.focused = false
    this.focused = component
    if (isFocusable(component)) component.focused = true
  }

  showOverlay(component: BlueComponent, options?: BlueOverlayOptions): BlueOverlayHandle {
    const previous = this.focused
    const overlay: FakeOverlay = {
      component,
      options,
      hidden: false,
      handle: {
        hide: () => {
          overlay.hidden = true
          this.setFocus(previous)
        },
        setHidden: (hidden) => {
          overlay.hidden = hidden
        },
        isHidden: () => overlay.hidden,
        focus: () => {
          this.setFocus(component)
        },
        unfocus: () => {
          this.setFocus(previous)
        },
        isFocused: () => this.focused === component,
      },
    }
    this.overlays.push(overlay)
    this.setFocus(component)
    return overlay.handle
  }

  requestRender(): void {
    this.renderRequests += 1
  }
}

function isFocusable(component: BlueComponent | null): component is BlueFocusable {
  return component !== null && 'focused' in component
}

/** A context with the three fake Blue services provided. */
export function fakeBlueContext(): { ctx: Context; screen: FakeScreen; theme: FakeTheme; keymap: FakeKeymap } {
  const ctx = new Context()
  const screen = new FakeScreen()
  const theme = new FakeTheme()
  const keymap = new FakeKeymap()
  ctx.provide('blueScreen', screen as unknown as BlueScreenService)
  // The theme fake casts to the BlueTheme contract: the concrete
  // BlueThemeService class moved to core's theme-dark subpath plugin.
  ctx.provide('blueTheme', theme as unknown as BlueTheme)
  ctx.provide('blueKeymap', keymap as unknown as BlueKeymapService)
  return { ctx, screen, theme, keymap }
}
