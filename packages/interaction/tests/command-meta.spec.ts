/**
 * Tests for the command alias registry: registration, last-wins
 * re-registration, generation-tagged disposal, the conflict guards (an
 * alias claimed by a different canonical, and self-alias), and the lookup
 * helpers `canonicalOf` / `aliasesOf` / `withCommandAliases`.
 */

import { describe, expect, it } from 'vitest'
import {
  aliasesOf,
  canonicalOf,
  registerCommandAliases,
  withCommandAliases,
} from '../src/command-meta.ts'

describe('command-meta alias registry', () => {
  it('resolves aliases to their canonical command and lists them back', () => {
    const clear = registerCommandAliases('quit', ['q', 'exit'])
    try {
      expect(canonicalOf('q')).toBe('quit')
      expect(canonicalOf('exit')).toBe('quit')
      // A canonical name is not its own alias.
      expect(canonicalOf('quit')).toBeUndefined()
      expect(canonicalOf('unknown')).toBeUndefined()
      // Queried by canonical or alias name alike.
      expect(aliasesOf('quit')).toEqual(['q', 'exit'])
      expect(aliasesOf('q')).toEqual(['q', 'exit'])
      expect(aliasesOf('unknown')).toEqual([])
      // The candidate mapper attaches each command's aliases for the filter.
      expect(withCommandAliases([{ name: 'quit' }, { name: 'plain' }])).toEqual([
        { name: 'quit', aliases: ['q', 'exit'] },
        { name: 'plain', aliases: [] },
      ])
    } finally {
      clear()
    }
  })

  it('rejects an alias that is its own canonical name', () => {
    expect(() => registerCommandAliases('quit', ['quit', 'q'])).toThrow('cannot be its own alias')
    // The failed registration left nothing behind.
    expect(canonicalOf('q')).toBeUndefined()
  })

  it('rejects an alias already claimed by a different canonical', () => {
    const clear = registerCommandAliases('quit', ['q'])
    try {
      expect(() => registerCommandAliases('question', ['q'])).toThrow(
        'command alias: /q is already an alias of /quit',
      )
      // The conflict aborted before any partial state: /question has no entry.
      expect(aliasesOf('question')).toEqual([])
    } finally {
      clear()
    }
  })

  it('re-registering the same canonical replaces its aliases (last-wins)', () => {
    const first = registerCommandAliases('quit', ['q'])
    const second = registerCommandAliases('quit', ['exit'])
    try {
      expect(aliasesOf('quit')).toEqual(['exit'])
      expect(canonicalOf('q')).toBeUndefined()
      expect(canonicalOf('exit')).toBe('quit')
    } finally {
      second()
      first()
    }
  })

  it('allows a re-registration whose aliases overlap the previous ones', () => {
    // `q` was already claimed by the same canonical: the overlap is a
    // re-registration, not a conflict, and the stale `exit` mapping falls
    // away with the replaced entry.
    const first = registerCommandAliases('quit', ['q', 'exit'])
    const second = registerCommandAliases('quit', ['q'])
    try {
      expect(aliasesOf('quit')).toEqual(['q'])
      expect(canonicalOf('q')).toBe('quit')
      expect(canonicalOf('exit')).toBeUndefined()
    } finally {
      second()
      first()
    }
  })

  it('a stale disposer never clears a newer registration', () => {
    const first = registerCommandAliases('quit', ['q'])
    const second = registerCommandAliases('quit', ['exit'])
    try {
      // Disposing the replaced registration first must leave the newer one
      // intact.
      first()
      expect(canonicalOf('exit')).toBe('quit')
      expect(aliasesOf('quit')).toEqual(['exit'])
      expect(canonicalOf('q')).toBeUndefined()
    } finally {
      second()
    }
  })

  it('the disposer removes the registration, and re-registration then works', () => {
    const clear = registerCommandAliases('quit', ['q', 'exit'])
    clear()
    expect(canonicalOf('q')).toBeUndefined()
    expect(aliasesOf('quit')).toEqual([])
    // The cleared slot is free again.
    const again = registerCommandAliases('quit', ['q'])
    try {
      expect(canonicalOf('q')).toBe('quit')
    } finally {
      again()
    }
  })
})
