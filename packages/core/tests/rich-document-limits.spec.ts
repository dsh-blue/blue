/** Synthetic vendor-output limits for the Mermaid adapter. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('beautiful-mermaid', async importOriginal => {
  const actual = await importOriginal<typeof import('beautiful-mermaid')>()
  return {
    ...actual,
    renderMermaidASCII: (source: string, options?: import('beautiful-mermaid').AsciiRenderOptions): string => {
      if (source === 'TEST_TRAILING') return 'ok\n\n'
      if (source === 'TEST_EMPTY') return ''
      if (source === 'TEST_LINES') return Array.from({ length: 201 }, () => 'x').join('\n')
      if (source === 'TEST_CELLS') return 'x'.repeat(20_001)
      return actual.renderMermaidASCII(source, options)
    },
  }
})

import { renderMermaidRows } from '../src/rich-document.ts'

describe('renderMermaidRows vendor output limits', () => {
  it('normalizes trailing rows and rejects empty, tall, and cell-heavy output', () => {
    expect(renderMermaidRows('TEST_TRAILING', 80)).toEqual(['ok'])
    expect(renderMermaidRows('TEST_EMPTY', 80)).toBeUndefined()
    expect(renderMermaidRows('TEST_LINES', 80)).toBeUndefined()
    expect(renderMermaidRows('TEST_CELLS', 30_000)).toBeUndefined()
    expect(renderMermaidRows('TEST_TRAILING', Number.NaN)).toBeUndefined()
  })
})
