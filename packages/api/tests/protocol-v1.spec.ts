/**
 * Machine-contract tests shared by schema, runtime, and package validation.
 *
 * @module @dsh-blue/blue-api/tests/protocol-v1
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  BLUE_PLUGIN_CAPABILITIES_V1,
  BLUE_PLUGIN_MANIFEST_SCHEMA_URL,
  BLUE_PLUGIN_MANIFEST_SCHEMA_VERSION,
  BLUE_PLUGIN_MANIFEST_V1_SCHEMA,
  BLUE_PLUGIN_PROTOCOL_VERSION,
  BLUE_PRODUCT_PROTOCOL_VERSIONS,
  validateBluePluginManifestV1,
  type BluePluginCapabilityNameV1,
  type BluePluginManifestV1,
  type BluePluginManifestV1IssueCode,
} from '../src/protocol-v1.ts'

interface CorpusCase {
  readonly id: string
  readonly valid: boolean
  readonly code?: BluePluginManifestV1IssueCode
  readonly manifest: unknown
}

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const corpus = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')) as {
  readonly protocol: string
  readonly cases: readonly CorpusCase[]
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeepFrozen(child)
}

describe('@dsh-blue/blue-api protocol v1', () => {
  it('publishes one immutable seven-capability catalog and product mapping', () => {
    expectTypeOf<BluePluginCapabilityNameV1>().toEqualTypeOf<
      | 'commands'
      | 'status'
      | 'panes'
      | 'overlays'
      | 'notifications.publish'
      | 'session.read'
      | 'session.projections.read'
    >()
    expect(BLUE_PLUGIN_PROTOCOL_VERSION).toBe('1.0.0-beta.1')
    expect(BLUE_PLUGIN_MANIFEST_SCHEMA_VERSION).toBe(1)
    expect(BLUE_PLUGIN_MANIFEST_SCHEMA_URL).toBe(BLUE_PLUGIN_MANIFEST_V1_SCHEMA.$id)
    expect(BLUE_PRODUCT_PROTOCOL_VERSIONS).toEqual({
      '0.1.1-rc.2': '1.0.0-beta.1',
      '0.1.1-rc.3': '1.0.0-beta.1',
      '0.1.2-alpha.1': '1.0.0-beta.1',
    })
    expect(BLUE_PLUGIN_CAPABILITIES_V1).toEqual([
      'commands',
      'status',
      'panes',
      'overlays',
      'notifications.publish',
      'session.read',
      'session.projections.read',
    ])
    expectDeepFrozen(BLUE_PLUGIN_MANIFEST_V1_SCHEMA)
    expectDeepFrozen(BLUE_PRODUCT_PROTOCOL_VERSIONS)
  })

  it.each(corpus.cases)('matches the shared corpus for $id', testCase => {
    const result = validateBluePluginManifestV1(testCase.manifest)
    expect(result.ok).toBe(testCase.valid)
    if (result.ok) {
      expectDeepFrozen(result)
      expect(result.value).toEqual(testCase.manifest)
    } else {
      expect(result.issues.length).toBeGreaterThan(0)
      expect(result.issues[0]?.code).toBe(testCase.code)
      expectDeepFrozen(result)
    }
  })

  it('uses formal semver ranges and returns a detached immutable value', () => {
    const source = structuredClone(corpus.cases[0]?.manifest) as BluePluginManifestV1
    const result = validateBluePluginManifestV1(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const originalId = result.value.id
    ;(source as { id: string }).id = 'changed-after-validation'
    expect(result.value.id).toBe(originalId)

    const invalid = structuredClone(result.value) as { api: string }
    invalid.api = ''
    expect(validateBluePluginManifestV1(invalid)).toMatchObject({
      ok: false,
      issues: [{ code: 'BLUE_PLUGIN_MANIFEST_SCHEMA_INVALID' }],
    })
  })

  it('keeps generated TypeScript synchronized with the canonical schema', () => {
    expect(corpus.protocol).toBe(BLUE_PLUGIN_PROTOCOL_VERSION)
    expect(() => execFileSync(process.execPath, ['script/generate-blue-plugin-contract.mjs', '--check'], {
      cwd: repositoryRoot,
      stdio: 'pipe',
    })).not.toThrow()
  })
})
