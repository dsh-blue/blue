/**
 * Blue's bundle-local preset roster: it carries all four modes, exposes the
 * Blue creative metadata, and never points at the host's shipped root.
 *
 * @module @dsh-blue/blue/tests/presets
 */

import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface SkillFrontmatter {
  readonly name?: unknown
  readonly description?: unknown
}

interface AuthorSkillEvals {
  readonly skill?: unknown
  readonly cases?: readonly { readonly id?: unknown }[]
}

const require = createRequire(import.meta.url)
const skillFilesystemRoot = dirname(require.resolve('@deepseek-ai/dsh-skill-filesystem/package.json'))
const { parse } = createRequire(join(skillFilesystemRoot, 'package.json'))('yaml') as {
  parse(source: string): unknown
}

function skillFrontmatter(source: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)
  expect(match, 'skill must start with YAML frontmatter').not.toBeNull()
  return parse(match![1]!) as SkillFrontmatter
}

describe('Blue preset roster', () => {
  it('ships all four metadata rows with a Blue-specific creative mode', () => {
    const blueRoot = new URL('../presets/', import.meta.url)
    const metadata = ['standard', 'code', 'minimal', 'cordis'].map(id => readFileSync(new URL(`${id}/preset.yml`, blueRoot), 'utf8'))
    expect(metadata).toHaveLength(4)
    expect(metadata[3]).toContain('name: 创造模式')
    expect(metadata[3]).toContain('Blue')
  })

  it('keeps the non-creative presets byte-for-byte on the pinned harness line', () => {
    const harnessRoot = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'config', 'agent-presets')
    const blueRoot = new URL('../presets/', import.meta.url)
    for (const id of ['standard', 'code', 'minimal']) {
      for (const file of ['agent.cordis.yml', 'preset.yml']) {
        expect(readFileSync(new URL(`${id}/${file}`, blueRoot), 'utf8')).toBe(readFileSync(join(harnessRoot, id, file), 'utf8'))
      }
    }
  })

  it('ships discoverable creative skills with valid frontmatter', () => {
    const skillsRoot = new URL('../presets/cordis/skills/', import.meta.url)
    const directories = readdirSync(skillsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    expect(directories).toEqual([
      'blue-plugin-development',
      'cordis-plugin-development',
      'editing-cordis-compositions',
    ])
    for (const directory of directories) {
      const frontmatter = skillFrontmatter(readFileSync(new URL(`${directory}/SKILL.md`, skillsRoot), 'utf8'))
      expect(frontmatter.name).toBe(directory)
      expect(typeof frontmatter.description).toBe('string')
      expect((frontmatter.description as string).trim().length).toBeGreaterThan(0)
    }
  })

  it('ships the machine-driven author skill and its four authority evals', () => {
    const skillRoot = new URL('../presets/cordis/skills/blue-plugin-development/', import.meta.url)
    const source = readFileSync(new URL('SKILL.md', skillRoot), 'utf8')
    const evals = JSON.parse(readFileSync(new URL('evals.json', skillRoot), 'utf8')) as AuthorSkillEvals

    for (const command of ['catalog --json', 'blue-plugin create', 'blue-plugin validate', 'blue-plugin conformance']) {
      expect(source).toContain(command)
    }
    expect(source).not.toContain('commands, status, panes, overlays, notifications.publish')
    expect(evals.skill).toBe('blue-plugin-development')
    expect(evals.cases?.map(value => value.id)).toEqual([
      'accepted-new-local-plugin',
      'existing-harness-plugin-entry',
      'missing-capability',
      'accepted-does-not-authorize-publish',
    ])
  })

  it('carries the published author bin in the installable bundle closure', () => {
    const bundle = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const pluginKit = JSON.parse(readFileSync(require.resolve('@dsh-blue/blue-plugin-kit/package.json'), 'utf8')) as {
      readonly bin?: Readonly<Record<string, string>>
    }
    expect(bundle.dependencies?.['@dsh-blue/blue-plugin-kit']).toBe('workspace:*')
    expect(pluginKit.bin).toEqual({ 'blue-plugin': 'lib/bin.js' })
  })
})
