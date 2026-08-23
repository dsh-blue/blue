/**
 * Tests for the shared slash-command filter's alias matching (the kimi
 * rule): the canonical name scores first, aliases count only when it
 * misses, the best alias score wins, and a tie keeps the canonical-name
 * match ahead. The FakeBlueComponents `fuzzyMatch` scores contiguity (-2
 * per character found in place, -1 per gap), which makes the alias
 * comparisons deterministic.
 */

import { describe, expect, it } from 'vitest'
import { filterSlashCommands, slashCommandLabel } from '../src/slash-filter.ts'
import { FakeBlueComponents } from './fakes.ts'

const components = new FakeBlueComponents()

describe('slash-filter alias matching', () => {
  it('replaces the best alias score when a later alias scores better', () => {
    // `aq` scores -1 (the q sits behind a gap), `q` scores -2 (contiguous):
    // the second alias wins, exercising the score-improvement branch.
    const matches = filterSlashCommands(
      [{ name: 'xyzzy', aliases: ['aq', 'q'] }],
      'q',
      components,
    )
    expect(matches).toEqual([{ command: { name: 'xyzzy', aliases: ['aq', 'q'] }, viaAlias: true }])
  })

  it('keeps the best alias score when a later alias scores worse', () => {
    const matches = filterSlashCommands(
      [{ name: 'xyzzy', aliases: ['q', 'aq'] }],
      'q',
      components,
    )
    expect(matches).toEqual([{ command: { name: 'xyzzy', aliases: ['q', 'aq'] }, viaAlias: true }])
  })

  it('skips an alias that misses and keeps the best of the rest', () => {
    // `exi` cannot match the alias `q` (no such character), then hits `exit`.
    const matches = filterSlashCommands(
      [{ name: 'xyzzy', aliases: ['q', 'exit'] }],
      'exi',
      components,
    )
    expect(matches).toEqual([{ command: { name: 'xyzzy', aliases: ['q', 'exit'] }, viaAlias: true }])
  })

  it('misses a command whose canonical name and every alias fail the query', () => {
    expect(filterSlashCommands([{ name: 'xyzzy', aliases: ['q'] }], 'exi', components)).toEqual([])
    // Without an alias list the loop never runs.
    expect(filterSlashCommands([{ name: 'xyzzy' }], 'exi', components)).toEqual([])
  })

  it('ranks a canonical-name match ahead of an alias match on equal scores', () => {
    const matches = filterSlashCommands(
      [{ name: 'xyzzy', aliases: ['q'] }, { name: 'quilt', aliases: [] }],
      'q',
      components,
    )
    expect(matches).toEqual([
      { command: { name: 'quilt', aliases: [] }, viaAlias: false },
      { command: { name: 'xyzzy', aliases: ['q'] }, viaAlias: true },
    ])
  })

  it('labels canonical hits plainly and alias hits with the alias list', () => {
    expect(slashCommandLabel({ command: { name: 'quit' }, viaAlias: false })).toBe('/quit')
    expect(slashCommandLabel({ command: { name: 'quit', aliases: ['q', 'exit'] }, viaAlias: true }))
      .toBe('/quit (q, exit)')
  })
})
