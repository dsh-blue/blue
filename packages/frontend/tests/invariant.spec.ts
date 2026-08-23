import { describe, expect, it } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('frontend invariant companion', () => {
  it('has a stable plugin entry', () => { expect(invariant.name).toBe('blue-frontend-invariant'); expect(() => invariant.apply({} as never)).not.toThrow() })
})
