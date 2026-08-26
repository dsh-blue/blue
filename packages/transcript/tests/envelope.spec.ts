/**
 * The XML-envelope parser and summarizer: conservative recognition of the
 * file tools' model-facing envelope (path/type/content triples), footer
 * descriptors for read windows, write confirmations, image facts, and the
 * untouched passthrough for everything else.
 */

import { describe, expect, it } from 'vitest'
import { parseXmlEnvelope, summarizeToolText } from '../src/envelope.ts'

const READ_ENVELOPE = `<path>src/a.ts</path>
<type>file</type>
<content>
1: const x = 1
2: const y = 2

(Showing lines 1-2 of 342. Use offset=3 to continue.)
</content>`

describe('parseXmlEnvelope', () => {
  it('parses a read envelope into ordered inline and block pairs', () => {
    expect(parseXmlEnvelope(READ_ENVELOPE)).toEqual([
      { tag: 'path', value: 'src/a.ts' },
      { tag: 'type', value: 'file' },
      { tag: 'content', value: '1: const x = 1\n2: const y = 2\n\n(Showing lines 1-2 of 342. Use offset=3 to continue.)' },
    ])
  })

  it('tolerates trailing blank lines and parses inline-only pairs', () => {
    expect(parseXmlEnvelope('<path>a</path>\n<type>file</type>\n\n')).toEqual([
      { tag: 'path', value: 'a' },
      { tag: 'type', value: 'file' },
    ])
  })

  it('keeps lines that merely resemble a close tag inside the block value', () => {
    const text = `<path>a</path>
<content>
  </content>
</content>`
    expect(parseXmlEnvelope(text)).toEqual([
      { tag: 'path', value: 'a' },
      { tag: 'content', value: '  </content>' },
    ])
  })

  it('rejects prose, single pairs, unterminated blocks, and blank text', () => {
    expect(parseXmlEnvelope('hello <b>world</b>')).toBeUndefined()
    expect(parseXmlEnvelope('<path>only</path>')).toBeUndefined()
    expect(parseXmlEnvelope('<path>a</path>\n<content>\nnever closed')).toBeUndefined()
    expect(parseXmlEnvelope('')).toBeUndefined()
    expect(parseXmlEnvelope('\n \n')).toBeUndefined()
  })

  it('rejects a stray line between pairs', () => {
    expect(parseXmlEnvelope('<path>a</path>\nplain\n<type>file</type>')).toBeUndefined()
  })
})

describe('summarizeToolText', () => {
  it('collapses read envelopes to the window descriptor', () => {
    expect(summarizeToolText(READ_ENVELOPE)).toBe('src/a.ts · lines 1-2 of 342')
  })

  it('maps each read footer wording to its descriptor', () => {
    const wrap = (footer: string): string => `<path>p</path>\n<type>file</type>\n<content>\n1: x\n\n${footer}\n</content>`
    expect(summarizeToolText(wrap('(Output capped. Showing lines 5-9. Use offset=10 to continue.)'))).toBe('p · lines 5-9 (output capped)')
    expect(summarizeToolText(wrap('(End of file - total 7 lines)'))).toBe('p · end of file, 7 total lines')
    expect(summarizeToolText(wrap('(Some future footer.)'))).toBe('p · 1: x')
  })

  it('falls back to the first content line and bare paths', () => {
    expect(summarizeToolText('<path>main.ts</path>\n<type>file</type>\n<content>\nCreated file\n</content>')).toBe('main.ts · Created file')
    expect(summarizeToolText('<path>img.png</path>\n<type>image</type>\n<content>\nimage/png image, 800x600 px, 120 bytes\n</content>')).toBe('img.png · image/png image, 800x600 px, 120 bytes')
    expect(summarizeToolText('<path>p</path>\n<content>\n\n(Showing lines 1-1 of 1. Use offset=2 to continue.)\n</content>')).toBe('p · lines 1-1 of 1')
    expect(summarizeToolText('<path></path>\n<content>\nUpdated file\n</content>')).toBe('Updated file')
    expect(summarizeToolText('<type>file</type>\n<content>\n\n</content>')).toBe('file')
    // An envelope without a content pair leans on the remaining pair; with
    // no descriptor at all the path alone survives.
    expect(summarizeToolText('<path>a</path>\n<type>file</type>')).toBe('a · file')
    expect(summarizeToolText('<path>p</path>\n<content>\n\n</content>')).toBe('p')
  })

  it('ellipsizes long summaries and passes non-envelopes through untouched', () => {
    const long = `<path>${'d/very-deep/'.repeat(12)}a.ts</path>
<type>file</type>
<content>\nCreated file\n</content>`
    expect(summarizeToolText(long, 40)).toHaveLength(40)
    expect(summarizeToolText(long, 40).endsWith('…')).toBe(true)
    const plain = 'line one\nline two'
    expect(summarizeToolText(plain)).toBe(plain)
  })
})
