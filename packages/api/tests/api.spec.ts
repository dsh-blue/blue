/**
 * Public API package tests: manifest validation and renderer-independent
 * contract exports.
 *
 * @module @dsh-blue/blue-api/tests/api
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BLUE_API_VERSION, BLUE_VERSION, validateBlueManifest } from '../src/index.ts'
import * as publicApi from '../src/index.ts'

const packageDir = dirname(fileURLToPath(import.meta.url))

describe('@dsh-blue/blue-api', () => {
  it('exports the public version owners', () => {
    expect(BLUE_API_VERSION).toBe('1.0.0-beta.2')
    expect(BLUE_VERSION).toBe('0.1.2-alpha.1')
  })

  it('accepts namespaced manifests and rejects malformed declarations', () => {
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['status'] })).toEqual({ ok: true })
    expect(validateBlueManifest({ id: 'bad id', api: '^1.0.0-beta.1', capabilities: [] }).ok).toBe(false)
    expect(validateBlueManifest({ id: 'example', api: '', capabilities: [] }).ok).toBe(false)
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0-beta.1', capabilities: ['status', 'status'] }).ok).toBe(false)
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0-beta.1', capabilities: ['unknown' as never] })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CAPABILITY' })
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0-beta.1', capabilities: [null as never] })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CAPABILITY' })
    expect(validateBlueManifest(null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_MANIFEST' })
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0-beta.1', capabilities: null as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_MANIFEST' })
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0-beta.1', capabilities: [], schemaVersion: 2 as never })).toMatchObject({ ok: false, code: 'BLUE_UNSUPPORTED_MANIFEST_VERSION' })
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0-beta.1', capabilities: [], blue: '???' })).toMatchObject({ ok: false, code: 'BLUE_INVALID_COMPATIBILITY_RANGE' })
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0-beta.1', capabilities: [], entry: 'index.js' })).toMatchObject({ ok: false, code: 'BLUE_INVALID_ENTRY' })
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0-beta.1', capabilities: [], integrity: 'md5-abc' })).toMatchObject({ ok: false, code: 'BLUE_INVALID_INTEGRITY' })
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['commands'], schemaVersion: 1, entry: './index.js', blue: '>=0.1.0', harness: '^0.1.1', node: '>=22', integrity: 'sha512-abc' })).toEqual({ ok: true })
  })

  it('rejects removed capabilities with actionable migrations', () => {
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['dock'] })).toEqual({
      ok: false, code: 'BLUE_LEGACY_CAPABILITY', message: 'capability "dock" was removed; use "panes"',
    })
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['panels'] })).toMatchObject({
      ok: false, code: 'BLUE_LEGACY_CAPABILITY', message: expect.stringContaining('"panes" or "overlays"'),
    })
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['editor'] })).toMatchObject({
      ok: false, code: 'BLUE_LEGACY_CAPABILITY', message: expect.stringContaining('"editor.extensions"'),
    })
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['tools'] })).toEqual({
      ok: false, code: 'BLUE_LEGACY_CAPABILITY', message: 'capability "tools" was removed; no replacement; tool presentation remains Blue-owned',
    })
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['panes', 'overlays', 'notifications.publish', 'editor.extensions', 'status.provider', 'editor.provider'] })).toEqual({ ok: true })
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['notifications' as never] })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CAPABILITY' })
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0-beta.1', capabilities: ['session.act' as never] })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CAPABILITY' })
  })

  it('keeps the published boundary free of source-plane exports', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      files: string[]
    }
    expect(Object.keys(manifest.exports)).toEqual([
      '.',
      './invariant',
      './protocol/v1',
      './capabilities/v1',
      './schema/blue.plugin.v1.schema.json',
      './schema/blue.plugin.v1.corpus.json',
      './package.json',
    ])
    expect(Object.keys(manifest.exports).some(key => key.includes('/src'))).toBe(false)
    expect(manifest.files).toEqual(['lib/**/*', 'schema/*.json'])
    for (const ownerHelper of [
      'attachBluePluginHostCapabilities',
      'attachBluePluginHostSessionReader',
      'snapshotBluePluginHost',
      'subscribeBluePluginHost',
      'subscribeBluePluginNotifications',
      'createBlueUserGesture',
      'runBlueUserGesture',
      'closeBluePluginHostOverlay',
      'createBluePluginControl',
    ]) expect(ownerHelper in publicApi).toBe(false)
  })
})
