/**
 * Tests for the command alias registry: registration, last-wins
 * re-registration, generation-tagged disposal, the conflict guards (an
 * alias claimed by a different canonical, and self-alias), and the lookup
 * helpers `canonicalOf` / `aliasesOf` / `withCommandAliases`.
 */

import { describe, expect, it } from 'vitest'
import {
  CommandAliasRegistry,
} from '../src/command-meta.ts'

describe('command-meta alias registry', () => {
  const registry = (): CommandAliasRegistry => new CommandAliasRegistry()

  it('resolves aliases to their canonical command and lists them back', () => {
    const aliases = registry()
    const clear = aliases.register('quit', ['q', 'exit'])
    try {
      expect(aliases.canonicalOf('q')).toBe('quit')
      expect(aliases.canonicalOf('exit')).toBe('quit')
      // A canonical name is not its own alias.
      expect(aliases.canonicalOf('quit')).toBeUndefined()
      expect(aliases.canonicalOf('unknown')).toBeUndefined()
      // Queried by canonical or alias name alike.
      expect(aliases.aliasesOf('quit')).toEqual(['q', 'exit'])
      expect(aliases.aliasesOf('q')).toEqual(['q', 'exit'])
      expect(aliases.aliasesOf('unknown')).toEqual([])
      // The candidate mapper attaches each command's aliases for the filter.
      expect(aliases.withCommandAliases([{ name: 'quit' }, { name: 'plain' }])).toEqual([
        { name: 'quit', aliases: ['q', 'exit'] },
        { name: 'plain', aliases: [] },
      ])
    } finally {
      clear()
    }
  })

  it('rejects an alias that is its own canonical name', () => {
    const aliases = registry()
    expect(() => aliases.register('quit', ['quit', 'q'])).toThrow('cannot be its own alias')
    // The failed registration left nothing behind.
    expect(aliases.canonicalOf('q')).toBeUndefined()
  })

  it('rejects an alias already claimed by a different canonical', () => {
    const aliases = registry()
    const clear = aliases.register('quit', ['q'])
    try {
      expect(() => aliases.register('question', ['q'])).toThrow(
        'command alias: /q is already an alias of /quit',
      )
      // The conflict aborted before any partial state: /question has no entry.
      expect(aliases.aliasesOf('question')).toEqual([])
    } finally {
      clear()
    }
  })

  it('re-registering the same canonical replaces its aliases (last-wins)', () => {
    const aliases = registry()
    const first = aliases.register('quit', ['q'])
    const second = aliases.register('quit', ['exit'])
    try {
      expect(aliases.aliasesOf('quit')).toEqual(['exit'])
      expect(aliases.canonicalOf('q')).toBeUndefined()
      expect(aliases.canonicalOf('exit')).toBe('quit')
    } finally {
      second()
      first()
    }
  })

  it('allows a re-registration whose aliases overlap the previous ones', () => {
    // `q` was already claimed by the same canonical: the overlap is a
    // re-registration, not a conflict, and the stale `exit` mapping falls
    // away with the replaced entry.
    const aliases = registry()
    const first = aliases.register('quit', ['q', 'exit'])
    const second = aliases.register('quit', ['q'])
    try {
      expect(aliases.aliasesOf('quit')).toEqual(['q'])
      expect(aliases.canonicalOf('q')).toBe('quit')
      expect(aliases.canonicalOf('exit')).toBeUndefined()
    } finally {
      second()
      first()
    }
  })

  it('a stale disposer never clears a newer registration', () => {
    const aliases = registry()
    const first = aliases.register('quit', ['q'])
    const second = aliases.register('quit', ['exit'])
    try {
      // Disposing the replaced registration first must leave the newer one
      // intact.
      first()
      expect(aliases.canonicalOf('exit')).toBe('quit')
      expect(aliases.aliasesOf('quit')).toEqual(['exit'])
      expect(aliases.canonicalOf('q')).toBeUndefined()
    } finally {
      second()
    }
  })

  it('the disposer removes the registration, and re-registration then works', () => {
    const aliases = registry()
    const clear = aliases.register('quit', ['q', 'exit'])
    clear()
    expect(aliases.canonicalOf('q')).toBeUndefined()
    expect(aliases.aliasesOf('quit')).toEqual([])
    // The cleared slot is free again.
    const again = aliases.register('quit', ['q'])
    try {
      expect(aliases.canonicalOf('q')).toBe('quit')
    } finally {
      again()
    }
  })
})
