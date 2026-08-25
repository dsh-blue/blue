/**
 * `blue-intent-cordis` plugin: the cordis card's rendering (the shared kimi
 * header states, the define verb's purpose/halves/numbered-source preview
 * with its caps and error tail, the run/stop/undefine result preview, the
 * inspect verbs' structured catalogs/details and plain-text fallback, the unknown-verb
 * fallback, expansion and caching, width truncation) and the registration
 * contract (effect-bound register/unregister, duplicate-intent conflict).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/intent-cordis.ts'
import {
  CORDIS_COLLAPSED_ROWS,
  CORDIS_EXPANDED_ROWS,
  CordisCardComponent,
} from '../src/intent-cordis.ts'
import { BlueIntentsError, BlueIntentsService } from '../src/intents.ts'
import type { BlueIntentProps, TranscriptToolItem } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'
import { bootIntentPlugin, COLORS, tagged } from './intent-fakes.ts'

function toolItem(partial: Partial<TranscriptToolItem> = {}): TranscriptToolItem {
  return { kind: 'tool', seq: 1, callId: 'c1', name: 'cordis_run', arguments: '{}', ...partial }
}

/** Build props with the tagged color table and the fake factory. */
function props(item: TranscriptToolItem, expanded = false): BlueIntentProps {
  return { item, colors: tagged(), components: fakeBlueComponents(), expanded }
}

describe('CordisCardComponent', () => {
  describe('header', () => {
    it('renders the pending three-state header with the key argument', () => {
      const item = toolItem({
        name: 'cordis_run',
        parsedArguments: { mode: 'run', packageId: 'pkg-1', pluginId: 'prob-1' },
      })
      expect(new CordisCardComponent(props(item)).render(80)).toEqual([
        '',
        '[T]● [/T]Using \x1b[1m[P]cordis_run[/P]\x1b[22m[M] (run)[/M]',
      ])
    })

    it('renders the success and error bullets once finished', () => {
      const ok = toolItem({ parsedArguments: {} })
      ok.result = { text: 'done', isError: false }
      expect(new CordisCardComponent(props(ok)).render(80)[1])
        .toBe('✓ Used \x1b[1m[P]cordis_run[/P]\x1b[22m')
      const bad = toolItem({ parsedArguments: {} })
      bad.result = { text: 'nope', isError: true }
      expect(new CordisCardComponent(props(bad)).render(80)[1])
        .toBe('[E]✗ [/E]Used \x1b[1m[P]cordis_run[/P]\x1b[22m')
    })

    it('omits the key argument when no argument qualifies', () => {
      const item = toolItem({ parsedArguments: { mode: 42 } })
      expect(new CordisCardComponent(props(item)).render(80)[1])
        .toBe('[T]● [/T]Using \x1b[1m[P]cordis_run[/P]\x1b[22m')
    })
  })

  describe('cordis_define', () => {
    function defineItem(partial: Partial<TranscriptToolItem> = {}): TranscriptToolItem {
      return toolItem({
        name: 'cordis_define',
        parsedArguments: {
          plugin: { kind: 'new', idPrefix: 'prob' },
          name: 'probe-ui-services',
          purpose: 'Probe whether the UI services respond',
          code: { host: 'return {\n  ok: true\n}', client: 'render()\nmount()' },
        },
        ...partial,
      })
    }

    it('renders the purpose, the halves line, and the numbered host preview', () => {
      expect(new CordisCardComponent(props(defineItem())).render(80)).toEqual([
        '',
        '[T]● [/T]Using \x1b[1m[P]cordis_define[/P]\x1b[22m[M] (probe-ui-services)[/M]',
        '  [M]Probe whether the UI services respond[/M]',
        '  [M]host · 3 lines · client · 2 lines (web only — no Blue surface)[/M]',
        '  [M]   1  [/M]return {',
        '  [M]   2  [/M]  ok: true',
        '  [M]   3  [/M]}',
      ])
    })

    it('keeps the trailing empty row a final newline produces (kimi shape)', () => {
      const item = defineItem({ parsedArguments: { code: { host: 'a\n' } } })
      expect(new CordisCardComponent(props(item)).render(80)).toEqual([
        '',
        '[T]● [/T]Using \x1b[1m[P]cordis_define[/P]\x1b[22m',
        '  [M]host · 2 lines[/M]',
        '  [M]   1  [/M]a',
        '  [M]   2  [/M]',
      ])
    })

    it('renders purpose and halves only when no host code ships', () => {
      const item = defineItem({ parsedArguments: { purpose: 'web probe', code: { client: 'boot()' } } })
      expect(new CordisCardComponent(props(item)).render(80)).toEqual([
        '',
        '[T]● [/T]Using \x1b[1m[P]cordis_define[/P]\x1b[22m[M] (web probe)[/M]',
        '  [M]web probe[/M]',
        '  [M]client · 1 line (web only — no Blue surface)[/M]',
      ])
    })

    it('caps the collapsed code preview at ten rows with the kimi hint', () => {
      const host = Array.from({ length: 15 }, (_, n) => `l${n}`).join('\n')
      const item = defineItem({ parsedArguments: { code: { host } } })
      const rendered = new CordisCardComponent(props(item)).render(80)
      // Separator + header + halves + capped rows + hint.
      expect(rendered).toHaveLength(3 + CORDIS_COLLAPSED_ROWS + 1)
      expect(rendered.at(-1)).toBe(
        `[TM]... (${15 - CORDIS_COLLAPSED_ROWS} more lines, 15 total, ctrl+o to expand)[/TM]`)
    })

    it('raises the code cap when expanded and re-collapses back', () => {
      const host = Array.from({ length: 12 }, (_, n) => `l${n}`).join('\n')
      const item = defineItem({ parsedArguments: { code: { host } } })
      const component = new CordisCardComponent(props(item))
      const collapsed = component.render(80)
      component.setExpanded(true)
      const expanded = component.render(80)
      // Separator + header + halves + all twelve rows, no hint.
      expect(expanded).toHaveLength(3 + 12)
      expect(expanded.at(-1)).toBe('  [M]  12  [/M]l11')
      component.setExpanded(false)
      expect(component.render(80)).toEqual(collapsed)
    })

    it('caps the expanded code preview at 200 rows with the hint', () => {
      const host = Array.from({ length: 210 }, (_, n) => `l${n}`).join('\n')
      const item = defineItem({ parsedArguments: { code: { host } } })
      const component = new CordisCardComponent(props(item))
      component.setExpanded(true)
      const expanded = component.render(80)
      expect(expanded).toHaveLength(3 + CORDIS_EXPANDED_ROWS + 1)
      expect(expanded.at(-1)).toBe('[TM]... (10 more lines, 210 total, ctrl+o to expand)[/TM]')
    })

    it('respects the expansion state passed at construction', () => {
      const host = Array.from({ length: 12 }, (_, n) => `l${n}`).join('\n')
      const item = defineItem({ parsedArguments: { code: { host } } })
      expect(new CordisCardComponent(props(item, true)).render(80)).toHaveLength(3 + 12)
    })

    it('appends the error text in error red on a failed define', () => {
      const item = defineItem({ parsedArguments: { code: { host: 'a' } } })
      item.result = { text: 'short', fullText: 'Error: duplicate id\ndetails here', isError: true }
      const rendered = new CordisCardComponent(props(item)).render(80)
      expect(rendered[1]).toContain('[E]✗ [/E]Used ')
      expect(rendered.slice(-2)).toEqual([
        '  [E]Error: duplicate id[/E]',
        '  [E]details here[/E]',
      ])
    })

    it('skips the error tail when the failure carries no text', () => {
      const item = defineItem({ parsedArguments: { purpose: 'p' } })
      item.result = { text: '', isError: true }
      expect(new CordisCardComponent(props(item)).render(80)).toEqual([
        '',
        '[E]✗ [/E]Used \x1b[1m[P]cordis_define[/P]\x1b[22m[M] (p)[/M]',
        '  [M]p[/M]',
      ])
    })

    it('degrades gracefully on missing or mis-shaped arguments', () => {
      // No parsed arguments at all.
      expect(new CordisCardComponent(props(defineItem({ parsedArguments: undefined }))).render(80))
        .toEqual(['', '[T]● [/T]Using \x1b[1m[P]cordis_define[/P]\x1b[22m'])
      const headerOnly = (parsedArguments: unknown): string[] =>
        new CordisCardComponent(props(defineItem({ parsedArguments }))).render(80)
      // Null, non-object, empty fields, and a non-object code half.
      for (const parsed of [
        null,
        'nope',
        { purpose: '', code: { host: '', client: '' } },
        { code: 'nope' },
        { purpose: 42 },
      ]) {
        expect(headerOnly(parsed)).toHaveLength(2)
      }
    })
  })

  describe('cordis_run / cordis_stop / cordis_undefine', () => {
    it('renders the one-line ack in the normal color on success', () => {
      const item = toolItem({ name: 'cordis_run' })
      item.result = { text: 'Package pkg-1 is now running', isError: false }
      expect(new CordisCardComponent(props(item)).render(80)).toEqual([
        '',
        '✓ Used \x1b[1m[P]cordis_run[/P]\x1b[22m',
        '  [T]Package pkg-1 is now running[/T]',
      ])
    })

    it('renders the stop and undefine one-liners the same way', () => {
      for (const [name, text] of [['cordis_stop', 'Stopped prob-1'], ['cordis_undefine', 'Undefined prob-1']] as const) {
        const item = toolItem({ name })
        item.result = { text, isError: false }
        expect(new CordisCardComponent(props(item)).render(80)[2]).toBe(`  [T]${text}[/T]`)
      }
    })

    it('paints the failure in error red', () => {
      const item = toolItem({ name: 'cordis_run' })
      item.result = { text: 'Error: pkg-1 is not defined', isError: true }
      expect(new CordisCardComponent(props(item)).render(80)[2])
        .toBe('  [E]Error: pkg-1 is not defined[/E]')
    })

    it('renders no body rows while pending', () => {
      expect(new CordisCardComponent(props(toolItem({ name: 'cordis_stop' }))).render(80))
        .toHaveLength(2)
    })

    it('caps the collapsed preview at three wrapped rows, uncapped expanded', () => {
      const item = toolItem({ name: 'cordis_run' })
      item.result = { text: 'short', fullText: 'l1\nl2\nl3\nl4\nl5', isError: false }
      const component = new CordisCardComponent(props(item))
      const collapsed = component.render(80)
      expect(collapsed).toHaveLength(2 + 3 + 1)
      expect(collapsed.at(-1)).toBe('[TM]... (2 more lines, 5 total, ctrl+o to expand)[/TM]')
      component.setExpanded(true)
      expect(component.render(80)).toHaveLength(2 + 5)
    })

    it('renders no body rows for an empty result text', () => {
      const item = toolItem({ name: 'cordis_run' })
      item.result = { text: '\n\n', isError: false }
      expect(new CordisCardComponent(props(item)).render(80)).toHaveLength(2)
    })
  })

  describe('cordis_inspect*', () => {
    it('renders Service.listService as a concise service catalog', () => {
      const item = toolItem({ name: 'cordis_inspect_query' })
      item.result = {
        text: JSON.stringify({
          platform: 'host',
          provider: 'Service',
          method: 'listService',
          data: {
            mode: 'catalog',
            services: [
              {
                key: 'agentDefaultModel',
                description: 'Read and persist the default model',
                methods: [{ signature: 'getSelection(): ModelSelection' }],
              },
              { key: 'bluePluginHost', status: 'available' },
            ],
          },
        }, null, 2),
        isError: false,
      }
      expect(new CordisCardComponent(props(item)).render(120)).toEqual([
        '',
        '✓ Used \x1b[1m[P]cordis_inspect_query[/P]\x1b[22m',
        '  [M]host · Service.listService · catalog · 2 services[/M]',
        '  [A]•[/A] [P]agentDefaultModel[/P][M] — Read and persist the default model · 1 method[/M]',
        '  [A]•[/A] [P]bluePluginHost[/P][M] — available[/M]',
      ])
    })

    it('renders the provider directory with platform, descriptions, and method counts', () => {
      const item = toolItem({ name: 'cordis_inspect_list' })
      item.result = {
        text: JSON.stringify({ providers: [
          { id: 'Service', platform: 'host', description: 'Service discovery', methods: [{ name: 'listService' }] },
          { id: 'Slots', platform: 'client', description: 'Slot discovery', methods: [] },
        ] }),
        isError: false,
      }
      expect(new CordisCardComponent(props(item)).render(100).slice(2)).toEqual([
        '  [M]2 providers[/M]',
        '  [A]•[/A] [P]Service[/P][M] — Service discovery · host · 1 method[/M]',
        '  [A]•[/A] [P]Slots[/P][M] — Slot discovery · client · 0 methods[/M]',
      ])
    })

    it('caps catalog items when collapsed and reveals more when expanded', () => {
      const services = Array.from({ length: 12 }, (_, n) => ({ key: `service-${n}` }))
      const item = toolItem({ name: 'cordis_inspect_query' })
      item.result = { text: JSON.stringify({
        platform: 'host', provider: 'Service', method: 'listService',
        data: { mode: 'catalog', services },
      }), isError: false }
      const component = new CordisCardComponent(props(item))
      const collapsed = component.render(80)
      expect(collapsed).toHaveLength(2 + 1 + CORDIS_COLLAPSED_ROWS + 1)
      expect(collapsed.at(-1)).toBe('[TM]... (+2 more, 12 total, ctrl+o to expand)[/TM]')
      component.setExpanded(true)
      expect(component.render(80)).toHaveLength(2 + 1 + 12)
    })

    it('keeps the expanded catalog bounded at 200 items', () => {
      const item = toolItem({ name: 'cordis_inspect' })
      item.result = { text: JSON.stringify({ tools: Array.from({ length: 205 }, (_, n) => ({ name: `tool-${n}` })) }), isError: false }
      const component = new CordisCardComponent(props(item))
      component.setExpanded(true)
      const expanded = component.render(80)
      expect(expanded).toHaveLength(2 + 1 + CORDIS_EXPANDED_ROWS + 1)
      expect(expanded.at(-1)).toBe('[TM]... (+5 more, 205 total, ctrl+o to expand)[/TM]')
    })

    it('renders an exact Service contract without dumping referenced type declarations', () => {
      const item = toolItem({ name: 'cordis_inspect_query' })
      item.result = { text: JSON.stringify({
        platform: 'host', provider: 'Service', method: 'listService',
        data: {
          mode: 'service',
          service: {
            key: 'timer',
            description: 'Fiber-bound timers',
            methods: [
              { signature: 'timeout(callback: () => void, ms: number): () => void', description: 'Schedule once' },
              { signature: 'interval(callback: () => void, ms: number): () => void' },
            ],
          },
          referencedTypes: [{ name: 'TimerCallback', declaration: 'very long declaration' }],
        },
      }), isError: false }
      expect(new CordisCardComponent(props(item)).render(120).slice(2)).toEqual([
        '  [M]host · Service.listService · service · timer · 2 methods · 1 referenced type[/M]',
        '  [A]•[/A] [P]timer[/P][M] — Fiber-bound timers · 2 methods[/M]',
        '  [A]•[/A] [P]timeout(callback: () => void, ms: number): () => void[/P][M] — Schedule once[/M]',
        '  [A]•[/A] [P]interval(callback: () => void, ms: number): () => void[/P]',
      ])
      expect(new CordisCardComponent(props(item)).render(200).join('\n')).not.toContain('very long declaration')
    })

    it('renders other query catalogs and exact entities through the structured fallback', () => {
      const catalog = toolItem({ name: 'cordis_inspect_query' })
      catalog.result = { text: JSON.stringify({
        platform: 'client', provider: 'Event', method: 'listEvents',
        data: { mode: 'catalog', events: [{ name: 'blue/change', mode: 'broadcast', summary: 'A change occurred' }] },
      }), isError: false }
      expect(new CordisCardComponent(props(catalog)).render(100).slice(2)).toEqual([
        '  [M]client · Event.listEvents · catalog · 1 event[/M]',
        '  [A]•[/A] [P]blue/change[/P][M] — A change occurred · broadcast[/M]',
      ])

      const exact = toolItem({ name: 'cordis_inspect_query' })
      exact.result = { text: JSON.stringify({
        platform: 'host', provider: 'Event', method: 'listEvents',
        data: { mode: 'event', event: { name: 'blue/change', description: 'A change occurred', status: 'stable' } },
      }), isError: false }
      expect(new CordisCardComponent(props(exact)).render(100).slice(2)).toEqual([
        '  [M]host · Event.listEvents · event · blue/change[/M]',
        '  [A]•[/A] [P]blue/change[/P][M] — A change occurred · stable[/M]',
      ])
    })

    it('falls back to the plain result rows when the text does not parse', () => {
      const item = toolItem({ name: 'cordis_inspect_self' })
      item.result = { text: 'not json at all', isError: false }
      expect(new CordisCardComponent(props(item)).render(80)).toEqual([
        '',
        '✓ Used \x1b[1m[P]cordis_inspect_self[/P]\x1b[22m',
        '  [T]not json at all[/T]',
      ])
    })

    it('paints the unparseable failure in error red', () => {
      const item = toolItem({ name: 'cordis_inspect' })
      item.result = { text: '{\n  "error": "no such plugin"\n}', isError: true }
      expect(new CordisCardComponent(props(item)).render(80).slice(2)).toEqual([
        '  [E]{[/E]',
        '  [E]  "error": "no such plugin"[/E]',
        '  [E]}[/E]',
      ])
    })

    it('caps long plain-text fallbacks and expands them', () => {
      const item = toolItem({ name: 'cordis_inspect_self' })
      item.result = { text: Array.from({ length: 12 }, (_, n) => `line ${n}`).join('\n'), isError: false }
      const component = new CordisCardComponent(props(item))
      expect(component.render(80).at(-1)).toBe('[TM]... (2 more lines, 12 total, ctrl+o to expand)[/TM]')
      component.setExpanded(true)
      expect(component.render(80)).toHaveLength(2 + 12)
    })

    it('summarizes arrays, scalar values, and shallow object fields', () => {
      const render = (value: unknown): string[] => {
        const item = toolItem({ name: 'cordis_inspect_self' })
        item.result = { text: JSON.stringify(value), isError: false }
        return new CordisCardComponent(props(item)).render(120).slice(2)
      }
      expect(render(['alpha', 2, null])).toEqual([
        '  [M]3 items[/M]',
        '  [A]•[/A] [P]alpha[/P]',
        '  [A]•[/A] [P]2[/P]',
        '  [A]•[/A] [P]null[/P]',
      ])
      expect(render(true)).toEqual(['  [M]value[/M]', '  [A]•[/A] [P]true[/P]'])
      expect(render({
        enabled: false,
        retries: 3,
        note: '  two\n lines ',
        empty: '',
        optional: null,
        nested: { secret: { deep: true }, other: true },
        single: { only: true },
        values: [1, 2],
      })).toEqual([
        '  [M]8 fields[/M]',
        '  [A]•[/A] [P]enabled[/P][M] — false[/M]',
        '  [A]•[/A] [P]retries[/P][M] — 3[/M]',
        '  [A]•[/A] [P]note[/P][M] — two lines[/M]',
        '  [A]•[/A] [P]empty[/P][M] — (empty)[/M]',
        '  [A]•[/A] [P]optional[/P][M] — null[/M]',
        '  [A]•[/A] [P]nested[/P][M] — 2 fields[/M]',
        '  [A]•[/A] [P]single[/P][M] — 1 field[/M]',
        '  [A]•[/A] [P]values[/P][M] — 2 items[/M]',
      ])
    })

    it('summarizes generic arrays and identity fields without recursive JSON', () => {
      const item = toolItem({ name: 'cordis_inspect' })
      item.result = { text: JSON.stringify({ records: [
        { title: 'Title', purpose: 'Purpose' },
        { path: '/tmp/example', provider: 'local' },
        { kind: 'worker', packages: [{}] },
        { type: 'leaf', referencedTypes: [] },
        { name: '', unknown: { deep: { payload: 'hidden' } } },
      ] }), isError: false }
      const output = new CordisCardComponent(props(item)).render(100).slice(2)
      expect(output[0]).toBe('  [M]5 items[/M]')
      expect(output.slice(1)).toEqual([
        '  [A]•[/A] [P]Title[/P][M] — Purpose[/M]',
        '  [A]•[/A] [P]/tmp/example[/P][M] — local[/M]',
        '  [A]•[/A] [P]worker[/P][M] — 1 package[/M]',
        '  [A]•[/A] [P]leaf[/P][M] — 0 referenced types[/M]',
        '  [A]•[/A] [P]item 5[/P]',
      ])
      expect(output.join('\n')).not.toContain('payload')
    })

    it('handles query envelopes with array, scalar, or missing data', () => {
      const render = (value: object): string[] => {
        const item = toolItem({ name: 'cordis_inspect_query' })
        item.result = { text: JSON.stringify(value), isError: false }
        return new CordisCardComponent(props(item)).render(100).slice(2)
      }
      expect(render({ platform: 'host', provider: 'Tool', data: [{ name: 'bash' }] })).toEqual([
        '  [M]host · Tool · 1 item[/M]',
        '  [A]•[/A] [P]bash[/P]',
      ])
      expect(render({ method: 'health', data: 'ok' })).toEqual([
        '  [M]health[/M]',
        '  [A]•[/A] [P]ok[/P]',
      ])
      expect(render({ platform: 'host', provider: 'Unknown' })).toEqual([
        '  [M]host · Unknown[/M]',
        '  [A]•[/A] [P]undefined[/P]',
      ])
      expect(render({ platform: 'host' })).toEqual([
        '  [M]host[/M]',
        '  [A]•[/A] [P]undefined[/P]',
      ])
      expect(render({ data: 'ok' })).toEqual([
        '  [M]value[/M]',
        '  [A]•[/A] [P]ok[/P]',
      ])
    })

    it('renders explicit empty states for empty catalogs and objects', () => {
      const catalog = toolItem({ name: 'cordis_inspect_query' })
      catalog.result = { text: JSON.stringify({
        platform: 'host', provider: 'Service', method: 'listService',
        data: { mode: 'catalog', services: [] },
      }), isError: false }
      expect(new CordisCardComponent(props(catalog)).render(80).slice(2)).toEqual([
        '  [M]host · Service.listService · catalog · 0 services[/M]',
        '  [TM](no services)[/TM]',
      ])
      const empty = toolItem({ name: 'cordis_inspect_self' })
      empty.result = { text: '{}', isError: false }
      expect(new CordisCardComponent(props(empty)).render(80).slice(2)).toEqual([
        '  [M]0 fields[/M]',
        '  [TM](no fields)[/TM]',
      ])
      empty.result = { text: '{"only":1}', isError: false }
      expect(new CordisCardComponent(props(empty)).render(80).slice(2)[0]).toBe('  [M]1 field[/M]')
    })

    it('handles an exact entity without optional details or method arrays', () => {
      const item = toolItem({ name: 'cordis_inspect_query' })
      item.result = { text: JSON.stringify({
        platform: 'host', provider: 'Event', method: 'listEvents',
        data: { mode: 'event', event: { name: 'bare/event' } },
      }), isError: false }
      expect(new CordisCardComponent(props(item)).render(80).slice(2)).toEqual([
        '  [M]host · Event.listEvents · event · bare/event[/M]',
        '  [A]•[/A] [P]bare/event[/P]',
      ])
    })

    it('renders no body rows while pending or empty', () => {
      expect(new CordisCardComponent(props(toolItem({ name: 'cordis_inspect' }))).render(80))
        .toHaveLength(2)
      const item = toolItem({ name: 'cordis_inspect' })
      item.result = { text: '\n', isError: false }
      expect(new CordisCardComponent(props(item)).render(80)).toHaveLength(2)
    })
  })

  describe('unknown cordis verb', () => {
    it('falls back to the generic-like result preview', () => {
      const item = toolItem({ name: 'cordis_future' })
      item.result = { text: 'ok', isError: false }
      expect(new CordisCardComponent(props(item)).render(80)).toEqual([
        '',
        '✓ Used \x1b[1m[P]cordis_future[/P]\x1b[22m',
        '  [T]ok[/T]',
      ])
    })
  })

  it('caches by width, expansion, and result identity, and rebuilds on invalidate', () => {
    const item = toolItem({ name: 'cordis_run' })
    item.result = { text: 'done', isError: false }
    const component = new CordisCardComponent(props(item))
    const first = component.render(80)
    expect(component.render(80)).toBe(first)
    expect(component.render(40)).not.toBe(first)
    component.invalidate()
    expect(component.render(80)).toEqual(first)
    // A settling result changes the cache key, so the next render rebuilds.
    const pending = new CordisCardComponent(props(toolItem({ name: 'cordis_run' })))
    const before = pending.render(80)
    pending.item.result = { text: 'done', isError: false }
    expect(pending.render(80)).not.toBe(before)
  })

  it('truncates long rows to the viewport width', () => {
    const components = fakeBlueComponents()
    const item = toolItem({
      name: 'cordis_define',
      parsedArguments: { purpose: 'x'.repeat(100), code: { host: `y\n${'z'.repeat(100)}` } },
    })
    // Identity colors: the fake truncate counts every character, tags included.
    const lines = new CordisCardComponent({ item, colors: COLORS, components, expanded: false }).render(12)
    for (const line of lines) expect(components.visibleWidth(line)).toBeLessThanOrEqual(12)
  })
})

describe('blue-intent-cordis plugin', () => {
  it('registers the cordis intent and unregisters on unload', async () => {
    const harness = await bootIntentPlugin(plugin)
    expect(plugin.name).toBe('blue-intent-cordis')
    expect(plugin.inject).toEqual(['blueIntents', 'blueTheme', 'blueComponents'])
    expect(harness.entry.intent).toBe('cordis')
    const component = harness.entry.create(props(toolItem()))
    expect(component).toBeInstanceOf(CordisCardComponent)
    await harness.dispose()
    expect(harness.registry.entries).toHaveLength(0)
  })

  it('conflicts with a second claim of the cordis intent over the real registry', async () => {
    const ctx = new Context()
    // The Service base registers `blueIntents` on the context itself.
    const registry = new BlueIntentsService(ctx)
    ctx.reflect.provide('blueTheme', { colors: COLORS })
    ctx.reflect.provide('blueComponents', fakeBlueComponents())
    const fiber = await ctx.plugin(plugin)
    const extra = { intent: 'cordis', create: () => ({ render: () => [] }) as never }
    expect(() => registry.register(extra)).toThrowError(BlueIntentsError)
    await fiber.dispose()
    // The effect-bound unregister frees the slot again.
    registry.register(extra)
    expect(registry.resolve('cordis')).toBe(extra)
    await ctx.fiber.dispose()
  })
})
