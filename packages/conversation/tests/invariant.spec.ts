import { describe, expect, it } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('conversation invariant companion', () => {
  it('has a stable inert entry', () => {
    expect(invariant.name).toBe('blue-conversation-invariant')
    expect(() => invariant.apply({} as never)).not.toThrow()
  })
})
