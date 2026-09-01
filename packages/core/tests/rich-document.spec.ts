/** Bounded Mermaid parsing and terminal-render fallback behavior. */
import { describe, expect, it } from 'vitest'
import {
  MERMAID_MAX_NON_EMPTY_LINES,
  MERMAID_MAX_SOURCE_BYTES,
  renderMermaidRows,
  splitRichDocument,
} from '../src/rich-document.ts'
import { visibleWidth } from '../src/width.ts'

describe('splitRichDocument', () => {
  it('extracts only closed Mermaid fences and normalizes the language', () => {
    expect(splitRichDocument('')).toEqual([{ kind: 'markdown', source: '' }])
    expect(splitRichDocument('before\n``` Mermaid  \ngraph LR; A --> B\n```\nafter')).toEqual([
      { kind: 'markdown', source: 'before\n' },
      { kind: 'mermaid', source: 'graph LR; A --> B', fallback: '``` Mermaid  \ngraph LR; A --> B\n```\n' },
      { kind: 'markdown', source: 'after' },
    ])
    expect(splitRichDocument('```mermaid\ngraph LR; A --> B')).toEqual([
      { kind: 'markdown', source: '```mermaid\ngraph LR; A --> B' },
    ])
    expect(splitRichDocument('```ts\n```mermaid\nnot a diagram\n```\n')).toEqual([
      { kind: 'markdown', source: '```ts\n```mermaid\nnot a diagram\n```\n' },
    ])
  })

  it('supports longer and tilde fences without accepting extra info words', () => {
    expect(splitRichDocument('~~~~MERMAID\ngraph TD; A --> B\n~~~~')).toHaveLength(1)
    expect(splitRichDocument('```mermaid\r\ngraph TD; A --> B\r\n```\r\n')).toHaveLength(1)
    expect(splitRichDocument('```mermaid preview\ngraph TD; A --> B\n```')).toEqual([
      { kind: 'markdown', source: '```mermaid preview\ngraph TD; A --> B\n```' },
    ])
  })

  it('removes the opening-fence indentation before Mermaid parsing', () => {
    expect(splitRichDocument([
      '   ```mermaid',
      '     flowchart TD',
      '       A[开始] --> B[结束]',
      '   ```',
    ].join('\n'))).toEqual([{
      kind: 'mermaid',
      source: '  flowchart TD\n    A[开始] --> B[结束]',
      fallback: '   ```mermaid\n     flowchart TD\n       A[开始] --> B[结束]\n   ```',
    }])
  })
})

describe('renderMermaidRows', () => {
  it('renders flowcharts and xychart-beta without ANSI or overflow', () => {
    for (const source of [
      'graph LR; A[Start] --> B[Done]',
      'xychart-beta\n  x-axis [A, B, C]\n  y-axis "Value" 0 --> 10\n  bar [3, 7, 5]',
    ]) {
      const rows = renderMermaidRows(source, 80)
      expect(rows).toBeDefined()
      expect(rows!.join('\n')).not.toContain('\x1b')
      expect(rows!.every(row => visibleWidth(row) <= 80)).toBe(true)
    }
  })

  it('renders CJK and emoji labels while preserving the terminal width contract', () => {
    const source = [
      'flowchart TD',
      '  A[开始] --> B{是否满足条件?}',
      '  B -- 是 --> C[执行动作 A]',
      '  B -- 否 --> D[执行动作 🙂]',
      '  C --> E[结束]',
      '  D --> E[结束]',
    ].join('\n')
    const rows = renderMermaidRows(source, 80)
    expect(rows).toBeDefined()
    expect(rows!.join('\n')).toContain('开始')
    expect(rows!.join('\n')).toContain('🙂')
    expect(rows!.every(row => visibleWidth(row) <= 80)).toBe(true)
  })

  it('returns the source fallback signal for invalid, oversized, and too-narrow diagrams', () => {
    expect(renderMermaidRows('not a diagram', 80)).toBeUndefined()
    expect(renderMermaidRows(`graph LR; A[${'x'.repeat(MERMAID_MAX_SOURCE_BYTES)}]`, 80)).toBeUndefined()
    expect(renderMermaidRows(Array.from({ length: MERMAID_MAX_NON_EMPTY_LINES + 1 }, (_, index) => `A${String(index)} --> B${String(index)}`).join('\n'), 80)).toBeUndefined()
    expect(renderMermaidRows('graph LR; A --> B --> C', 5)).toBeUndefined()
  })
})
