/**
 * The changelog drift guard (the `version.spec.ts` pattern):
 * `src/changelog-content.ts` is the runtime source of the `/changelog`
 * panel because `docs/release-notes/` lives at the repository root and
 * never ships in the package tarballs. This spec keeps the two in
 * lockstep: every `v*.md` release-notes file maps to exactly one entry,
 * compared after marker-stripping normalization (bold/backticks removed,
 * hard-wrapped lines joined, whitespace collapsed). The `## Install`
 * section is deliberately not carried. Adding a release-notes file
 * without transcribing it into the content module fails here.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHANGELOG_ENTRIES } from '../src/changelog-content.ts'

/** One parsed release-notes file. */
interface ReleaseNote {
  readonly version: string
  readonly summary: string
  readonly highlights: readonly string[]
  readonly knownIssues: readonly string[]
}

/**
 * Normalize one logical markdown line to the plain text the content module
 * carries: bold markers and backticks stripped, whitespace collapsed.
 * @param text - the raw markdown text.
 * @returns the plain text.
 */
function normalize(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Parse the bullets of one `##` section body: a `- ` line starts a bullet,
 * following non-empty non-bullet lines append to it (the notes are
 * hard-wrapped).
 * @param body - the section body lines.
 * @returns the normalized bullets.
 */
function parseBullets(body: readonly string[]): string[] {
  const bullets: string[] = []
  for (const line of body) {
    if (line.startsWith('- ')) {
      bullets.push(line.slice(2))
    } else if (line.trim() !== '' && bullets.length > 0) {
      bullets[bullets.length - 1] += ` ${line.trim()}`
    }
  }
  return bullets.map(normalize)
}

/**
 * Parse one release-notes markdown file into its guarded parts.
 * @param name - the file name inside `docs/release-notes/`.
 * @returns the parsed note.
 */
function parseNote(name: string): ReleaseNote {
  const version = name.replace(/^v/, '').replace(/\.md$/, '')
  const text = readFileSync(new URL(`../../../docs/release-notes/${name}`, import.meta.url), 'utf8')
  expect(text, `${name} title`).toContain(`# Blue ${version}`)
  const lines = text.split('\n')
  const sections = new Map<string, string[]>()
  const lead: string[] = []
  let current: string[] | undefined
  let seenTitle = false
  for (const line of lines) {
    if (line.startsWith('# ')) {
      seenTitle = true
      continue
    }
    if (line.startsWith('## ')) {
      current = []
      sections.set(line.slice(3).trim(), current)
      continue
    }
    if (current !== undefined) current.push(line)
    else if (seenTitle) lead.push(line)
  }
  return {
    version,
    summary: normalize(lead.join(' ')),
    highlights: parseBullets(sections.get('Highlights') ?? []),
    knownIssues: parseBullets(sections.get('Known issues') ?? []),
  }
}

/**
 * Compare two release versions numerically (`0.1.0-rc.10` > `0.1.0-rc.5`).
 * @param left - the first version.
 * @param right - the second version.
 * @returns negative when `left` is the newer release.
 */
function compareNewestFirst(left: string, right: string): number {
  const parts = (version: string) => version.split(/[.-]/).map(part => Number(part) || 0)
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (b[index] ?? 0) - (a[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** All release-notes files, parsed. */
const NOTES: readonly ReleaseNote[] = readdirSync(new URL('../../../docs/release-notes/', import.meta.url))
  .filter(name => /^v.*\.md$/.test(name))
  .map(parseNote)

describe('changelog content drift guard', () => {
  it('every release-notes file maps to exactly one entry, newest first', () => {
    expect(NOTES.length).toBeGreaterThan(0)
    const noteVersions = NOTES.map(note => note.version).sort(compareNewestFirst)
    expect(CHANGELOG_ENTRIES.map(entry => entry.version)).toEqual(noteVersions)
  })

  it('every entry carries its file\'s summary, highlights, and known issues', () => {
    for (const note of NOTES) {
      const entry = CHANGELOG_ENTRIES.find(candidate => candidate.version === note.version)
      expect(entry, `entry for ${note.version}`).toBeDefined()
      expect(entry!.summary, `${note.version} summary`).toBe(note.summary)
      expect(entry!.highlights, `${note.version} highlights`).toEqual(note.highlights)
      expect(entry!.knownIssues, `${note.version} known issues`).toEqual(note.knownIssues)
    }
  })
})

