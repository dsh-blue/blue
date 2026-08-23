/**
 * The `blueIntents` registry: registration discipline and the unknown-intent
 * fallback chain (exact → generic → first-registrant).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BlueIntentsError, BlueIntentsService } from '../src/intents.ts'
import type { BlueIntentEntry } from '../src/types.ts'

/** A minimal entry; identity is what the specs assert on. */
function entry(intent: string): BlueIntentEntry {
  return {
    intent,
    create: () => ({ render: () => [] }) as never,
  }
}

/** A fresh registry on a throwaway context (the Service base needs one). */
function service(): BlueIntentsService {
  return new BlueIntentsService(new Context())
}

describe('BlueIntentsService', () => {
  it('resolves an exact registration', () => {
    const intents = service()
    const diff = entry('diff')
    intents.register(diff)
    expect(intents.resolve('diff')).toBe(diff)
  })

  it('falls back to generic for an unknown intent', () => {
    const intents = service()
    const generic = entry('generic')
    intents.register(generic)
    intents.register(entry('diff'))
    expect(intents.resolve('terminal')).toBe(generic)
  })

  it('falls back to the first registrant when generic is absent', () => {
    const intents = service()
    const first = entry('diff')
    intents.register(first)
    intents.register(entry('terminal'))
    expect(intents.resolve('unknown-card')).toBe(first)
  })

  it('throws DUPLICATE_INTENT on a second claim of one intent', () => {
    const intents = service()
    intents.register(entry('diff'))
    expect(() => intents.register(entry('diff'))).toThrowError(BlueIntentsError)
    try {
      intents.register(entry('diff'))
    } catch (error) {
      expect((error as BlueIntentsError).code).toBe('DUPLICATE_INTENT')
    }
  })

  it('throws NO_INTENTS when resolving an empty registry', () => {
    const intents = service()
    expect(() => intents.resolve('anything')).toThrowError(BlueIntentsError)
    try {
      intents.resolve('anything')
    } catch (error) {
      expect((error as BlueIntentsError).code).toBe('NO_INTENTS')
    }
  })

  it('makes the disposer idempotent', () => {
    const intents = service()
    const dispose = intents.register(entry('diff'))
    dispose()
    dispose()
    // One unregistration: the slot is free again exactly once-over.
    intents.register(entry('diff'))
    expect(intents.resolve('diff').intent).toBe('diff')
  })

  it('allows unregister and re-register of the same intent', () => {
    const intents = service()
    const first = entry('diff')
    const dispose = intents.register(first)
    dispose()
    const second = entry('diff')
    intents.register(second)
    expect(intents.resolve('diff')).toBe(second)
  })
})
