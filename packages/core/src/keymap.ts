/**
 * `ctx.blueKeymap` service: the Blue keybinding registry. Key matching
 * delegates to pi-tui's `matchesKey`; conflict detection runs at
 * registration and fails loud, so a key is claimed by at most one
 * registered action at a time. `dispatch` runs the global half of the
 * registry: handler-carrying actions fire in registration order ahead of
 * focus routing.
 *
 * @module @deepseek-ai/dsh-blue-core/keymap
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { type KeyId, matchesKey } from '@earendil-works/pi-tui'
import type { BlueKeyAction, BlueKeymap } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueKeymap: BlueKeymapService
  }
}

/** Stable error taxonomy for keymap registration failures. */
export class BlueKeymapError extends Error {
  /** Machine-readable failure kind. */
  readonly code: 'KEY_CONFLICT' | 'DUPLICATE_ACTION'

  /**
   * @param message - the conflicting key and the actions claiming it.
   * @param code - the failure kind.
   */
  constructor(message: string, code: 'KEY_CONFLICT' | 'DUPLICATE_ACTION') {
    super(message)
    this.name = 'BlueKeymapError'
    this.code = code
  }
}

interface RegisteredAction {
  keys: string[]
  description?: string
  handler?: () => void
}

/** Dedupe one action's key list, preserving order. */
function normalizeKeys(keys: string | string[]): string[] {
  const list = typeof keys === 'string' ? [keys] : keys
  return [...new Set(list)]
}

/**
 * The `blueKeymap` service. Unregistered automatically when the plugin's
 * fiber unloads.
 */
export class BlueKeymapService extends Service implements BlueKeymap {
  private readonly actions = new Map<string, RegisteredAction>()
  private readonly keyOwner = new Map<string, string>()

  /**
   * Create and register the service.
   * @param ctx - the owning Cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'blueKeymap')
  }

  /**
   * Register a batch of actions after validating it as a unit.
   * @param actions - the actions to register.
   * @returns a disposer unregistering exactly this batch; safe to call twice.
   */
  register(actions: BlueKeyAction[]): () => void {
    // Validate the whole batch against existing registrations and itself
    // before committing anything, so a failure leaves the registry untouched.
    const batch = new Map<string, RegisteredAction>()
    const batchClaims = new Map<string, string>()
    for (const action of actions) {
      if (this.actions.has(action.id) || batch.has(action.id)) {
        throw new BlueKeymapError(`key action "${action.id}" is already registered`, 'DUPLICATE_ACTION')
      }
      const keys = normalizeKeys(action.keys)
      for (const key of keys) {
        const owner = this.keyOwner.get(key) ?? batchClaims.get(key)
        if (owner !== undefined) {
          throw new BlueKeymapError(
            `key "${key}" is claimed by both "${owner}" and "${action.id}"`,
            'KEY_CONFLICT',
          )
        }
        batchClaims.set(key, action.id)
      }
      const entry: RegisteredAction = {
        keys,
        // exactOptionalPropertyTypes forbids assigning undefined to the
        // optional slots, so each is spread in only when present.
        ...(action.description === undefined ? {} : { description: action.description }),
        ...(action.handler === undefined ? {} : { handler: action.handler }),
      }
      batch.set(action.id, entry)
    }
    for (const [id, entry] of batch) {
      this.actions.set(id, entry)
      for (const key of entry.keys) this.keyOwner.set(key, id)
    }

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      for (const [id, entry] of batch) {
        this.actions.delete(id)
        for (const key of entry.keys) this.keyOwner.delete(key)
      }
    }
  }

  /**
   * Test whether one input sequence triggers a registered action.
   * @param data - the input sequence as read from the terminal.
   * @param action - the action id; unknown ids never match.
   * @returns whether the input triggers the action.
   */
  matches(data: string, action: string): boolean {
    const entry = this.actions.get(action)
    if (entry === undefined) return false
    // KeyId is a compile-time union over key-id strings; L1 accepts plain
    // strings per its own contract and pi-tui matches them at runtime.
    return entry.keys.some(key => matchesKey(data, key as KeyId))
  }

  /**
   * Run the global dispatch: walk handler-carrying actions in registration
   * order (Map insertion order), invoking the first whose key matches.
   * @param data - the input sequence as read from the terminal.
   * @returns whether a handler ran for the input.
   */
  dispatch(data: string): boolean {
    for (const entry of this.actions.values()) {
      if (entry.handler === undefined) continue
      if (entry.keys.some(key => matchesKey(data, key as KeyId))) {
        entry.handler()
        return true
      }
    }
    return false
  }

  /**
   * Resolve the key ids currently bound to an action.
   * @param action - the action id.
   * @returns the bound key ids, empty for unknown actions.
   */
  getKeys(action: string): string[] {
    return [...(this.actions.get(action)?.keys ?? [])]
  }

  /**
   * Snapshot every registered action in registration order (Map insertion
   * order). Each entry is a fresh object with a copied key list, so callers
   * cannot reach the registry's internal state through the result.
   * @returns the currently registered actions.
   */
  list(): readonly BlueKeyAction[] {
    return [...this.actions].map(([id, entry]) => ({
      id,
      keys: [...entry.keys],
      // exactOptionalPropertyTypes forbids assigning undefined to the
      // optional slots, so each is spread in only when present.
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.handler === undefined ? {} : { handler: entry.handler }),
    }))
  }
}
