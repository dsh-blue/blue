/**
 * Public API package tests: manifest validation and renderer-independent
 * contract exports.
 *
 * @module @dsh-blue/blue-api/tests/api
 */

import { describe, expect, it } from 'vitest'
import { BLUE_API_VERSION, BLUE_VERSION, validateBlueManifest } from '../src/index.ts'

describe('@dsh-blue/blue-api', () => {
  it('exports the public version owners', () => {
    expect(BLUE_API_VERSION).toBe('1.0.0')
    expect(BLUE_VERSION).toBe('0.1.0-rc.2')
  })

  it('accepts namespaced manifests and rejects malformed declarations', () => {
    expect(validateBlueManifest({ id: '@acme/example', api: '^1.0.0', capabilities: ['status'] })).toEqual({ ok: true })
    expect(validateBlueManifest({ id: 'bad id', api: '^1.0.0', capabilities: [] }).ok).toBe(false)
    expect(validateBlueManifest({ id: 'example', api: '', capabilities: [] }).ok).toBe(false)
    expect(validateBlueManifest({ id: 'example', api: '^1.0.0', capabilities: ['status', 'status'] }).ok).toBe(false)
  })
})
