/**
 * Blue's bundle-local preset root: upstream owns its shipped roster while
 * this package contributes exactly one uniquely named creative preset.
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
  readonly preset?: unknown
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
  it('ships exactly one bundle-local preset named blue-cordis', () => {
    const blueRoot = new URL('../presets/', import.meta.url)
    const ids = readdirSync(blueRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    expect(ids).toEqual(['blue-cordis'])
    const metadata = readFileSync(new URL('blue-cordis/preset.yml', blueRoot), 'utf8')
    expect(metadata).toContain('name: Blue Cordis')
    expect(metadata).toContain('order: 5')
  })

  it('uses alpha.2 shipped presets and adds blue-cordis without aliases', () => {
    const harnessRoot = join(dirname(require.resolve('@deepseek-ai/dsh-agent-presets/package.json')), 'presets')
    const blueRoot = new URL('../presets/', import.meta.url)
    const shipped = readdirSync(harnessRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    expect(shipped).toEqual(['cordis', 'minimal', 'ptc', 'standard'])
    expect([...shipped, 'blue-cordis'].sort()).toEqual(['blue-cordis', 'cordis', 'minimal', 'ptc', 'standard'])
    expect(shipped).not.toContain('code')

    const upstream = readFileSync(join(harnessRoot, 'cordis', 'agent.cordis.yml'), 'utf8')
    const blue = readFileSync(new URL('blue-cordis/agent.cordis.yml', blueRoot), 'utf8')
    for (const alphaRow of ['- id: command-goal', 'modelSelectionSettings: true', 'fetch: true']) {
      expect(upstream).toContain(alphaRow)
      expect(blue).toContain(alphaRow)
    }
    expect(blue).toContain('agent preset id `blue-cordis`')
  })

  it('ships discoverable creative skills with valid frontmatter', () => {
    const skillsRoot = new URL('../presets/blue-cordis/skills/', import.meta.url)
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

  it('ships the machine-driven author skill and its five authority evals', () => {
    const skillRoot = new URL('../presets/blue-cordis/skills/blue-plugin-development/', import.meta.url)
    const source = readFileSync(new URL('SKILL.md', skillRoot), 'utf8')
    const evals = JSON.parse(readFileSync(new URL('evals.json', skillRoot), 'utf8')) as AuthorSkillEvals

    for (const command of ['catalog --json', ' create', ' validate', ' conformance']) {
      expect(source).toContain(command)
    }
    expect(source).toContain('DSH_BLUE_PLUGIN_NODE')
    expect(source).toContain('DSH_BLUE_PLUGIN_BIN')
    expect(source).not.toContain('commands, status, panes, overlays, notifications.publish')
    expect(evals.skill).toBe('blue-plugin-development')
    expect(evals.preset).toBe('blue-cordis')
    expect(evals.cases?.map(value => value.id)).toEqual([
      'accepted-new-local-plugin',
      'existing-harness-plugin-entry',
      'missing-capability',
      'accepted-does-not-authorize-publish',
      'legacy-plugin-migration',
    ])
    expect(source).toContain('Audit before migrating an existing plugin')
  })

  it('routes preset skills by task and excludes Blue repository maintenance', () => {
    const presetRoot = new URL('../presets/blue-cordis/', import.meta.url)
    const composition = readFileSync(new URL('agent.cordis.yml', presetRoot), 'utf8')
    const editing = readFileSync(new URL('skills/editing-cordis-compositions/SKILL.md', presetRoot), 'utf8')

    expect(composition).toContain('only after the user requests a durable external package')
    expect(composition).toContain('Do not load either plugin-development skill')
    expect(composition).not.toMatch(/blue-plugin-development[^\n]*changing Blue code/u)
    expect(editing).toContain('outside every preset author skill')
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
