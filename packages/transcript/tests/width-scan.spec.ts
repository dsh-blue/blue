/**
 * The width-scan contract for the transcript components (D48): the crash
 * family (#14/#15/#18) all lived here, so every content-rendering component
 * renders each adversarial fixture at each scan width and must honor the
 * `BlueComponent` contract — every output line's visible width within the
 * width it was given. A red row here is a latent pi-tui width-guard crash
 * (before the D48 exit clamp) or a blue-overflow.log entry (after it);
 * either way the component gets fixed, not the harness.
 */

import { homedir } from 'node:os'
import { describe, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BlueStatusService } from '@dsh-blue/blue-api'
import type { BlueSemanticColors } from '@dsh-blue/blue-core'
import {
  AssistantMessageComponent,
  ErrorMessageComponent,
  InterruptedMarkerComponent,
  StepSummaryComponent,
  ToolCallComponent,
  UserMessageComponent,
} from '../src/components.ts'
import { AgentGroupComponent } from '../src/agent-group.ts'
import { ReadGroupComponent } from '../src/read-group.ts'
import { SearchGroupComponent } from '../src/search-group.ts'
import { ThinkingComponent } from '../src/thinking.ts'
import { createTranscriptModel, TranscriptModelComponent } from '../src/transcript-model.ts'
import { StatusFooterComponent } from '../src/status-model.ts'
import { bannerLayout, composeBannerLines, shortenHome } from '../src/banner.ts'
import type { TranscriptToolItem } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'
import { COLORS } from './status-fakes.ts'
import { ADVERSARIAL, SCAN_WIDTHS, expectLinesFit } from '../../core/tests/width-scan.ts'
import {
  interpolateLocaleMessage,
  type BlueLocaleCatalog,
  type BlueLocaleId,
  type BlueTranslate,
} from '../../frontend/src/locale.ts'
import { BANNER_LOCALE, TRANSCRIPT_LOCALE } from '../src/locale.ts'

/** Identity colors satisfy BlueSemanticColors where consumed. */
const colors = COLORS as BlueSemanticColors

/** Bind a catalog directly so width scans cover both shipped languages. */
function translator(catalog: BlueLocaleCatalog, locale: BlueLocaleId): BlueTranslate {
  return (key, values) => interpolateLocaleMessage(catalog[locale][key] ?? catalog.en[key] ?? key, values)
}

/** A bash tool item carrying the fixture text as its command. */
function bashItem(text: string): TranscriptToolItem {
  return {
    kind: 'tool',
    seq: 1,
    turn: 1,
    callId: 'c1',
    name: 'bash',
    arguments: '{}',
    parsedArguments: { command: text, run_in_background: true },
  } as TranscriptToolItem
}

/** A subagent tool item whose description is the fixture text. */
function subagentItem(text: string): TranscriptToolItem {
  return {
    kind: 'tool',
    seq: 1,
    turn: 1,
    callId: 'c2',
    name: 'subagent',
    arguments: '{}',
    parsedArguments: { description: text, prompt: text },
  } as TranscriptToolItem
}

describe('transcript width-scan', () => {
  for (const locale of ['en', 'zh'] as const) {
    it(`localized transcript chrome survives every width in ${locale}`, () => {
      const components = fakeBlueComponents()
      const transcriptT = translator(TRANSCRIPT_LOCALE, locale)
      const longUser = new UserMessageComponent({
        kind: 'user', seq: 1, turn: 1,
        text: Array.from({ length: 12 }, (_, index) => `line ${String(index)} 界🙂`).join('\n'),
        images: [{ attachmentId: 'image', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }],
      }, colors, components, {
        loadImage: () => new Promise(() => {}),
        t: transcriptT,
      })
      const interrupted = new InterruptedMarkerComponent(colors, components, transcriptT)
      const bannerDeps = {
        colors,
        truncate: (text: string, width: number) => components.truncateToWidth(text, width),
        visibleWidth: (text: string) => components.visibleWidth(text),
        t: translator(BANNER_LOCALE, locale),
      }
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`UserMessage/${locale}`, longUser.render(width), width)
        expectLinesFit(`Interrupted/${locale}`, interrupted.render(width), width)
        if (bannerLayout(width) !== null) {
          expectLinesFit(`Banner/${locale}`, composeBannerLines(bannerDeps, {
            version: '0.1.1-rc.2', model: 'deepseek-chat', provider: 'deepseek', cwd: '~/界🙂',
          }, width), width)
        }
      }
    })
  }

  for (const { name, text } of ADVERSARIAL) {
    it(`UserMessageComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      const item = { kind: 'user', seq: 1, turn: 1, text, images: [] }
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`UserMessage/${name}`, new UserMessageComponent(item, colors, components).render(width), width)
      }
    })

    it(`AssistantMessageComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      const item = { kind: 'assistant', seq: 1, turn: 1, step: 1, text }
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`Assistant/${name}`, new AssistantMessageComponent(item, colors, components).render(width), width)
      }
    })

    it(`ToolCallComponent (bash fallback, the #18 seat) survives ${name}`, () => {
      const components = fakeBlueComponents()
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`ToolCall/${name}`, new ToolCallComponent(bashItem(text), colors, components).render(width), width)
      }
    })

    it(`ReadGroupComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      const model = {
        kind: 'transcript-read-group' as const,
        id: 'read-group:r1',
        seq: 1,
        turn: 1,
        step: 0,
        reads: [
          { callId: 'r1', seq: 1, turn: 1, step: 0, path: text, range: { first: 1, last: 9 }, totalLines: 99, state: 'ok' as const, previewLines: [{ number: 4, text }, { number: 5, text }] },
          { callId: 'r2', seq: 2, turn: 1, step: 0, path: text, requestedRange: { first: 10, last: 19 }, state: 'pending' as const },
          { callId: 'r3', seq: 3, turn: 1, step: 0, path: text, state: 'error' as const, error: text },
        ],
      }
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`ReadGroup/${name}`, new ReadGroupComponent(model, colors, components).render(width), width)
        const expanded = new ReadGroupComponent(model, colors, components)
        expanded.setExpanded(true)
        expectLinesFit(`ReadGroupExpanded/${name}`, expanded.render(width), width)
      }
    })

    it(`SearchGroupComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      const model = {
        kind: 'transcript-search-group' as const,
        id: 'search-group:s1',
        seq: 1,
        turn: 1,
        step: 0,
        searches: [
          { callId: 's1', seq: 1, turn: 1, step: 0, pattern: text, shape: 'matches' as const, files: [{ path: text, count: 2, previews: [{ lineNumber: 4, line: text }] }], truncated: true, total: 9, state: 'ok' as const },
          { callId: 's2', seq: 2, turn: 1, step: 0, pattern: text, shape: 'paths' as const, paths: [text], pathsTotal: 9, total: 9, state: 'ok' as const },
          { callId: 's3', seq: 3, turn: 1, step: 0, pattern: text, state: 'pending' as const },
          { callId: 's4', seq: 4, turn: 1, step: 0, pattern: text, state: 'error' as const, error: text },
        ],
      }
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`SearchGroup/${name}`, new SearchGroupComponent(model, colors, components).render(width), width)
        const expanded = new SearchGroupComponent(model, colors, components)
        expanded.setExpanded(true)
        expectLinesFit(`SearchGroupExpanded/${name}`, expanded.render(width), width)
      }
    })

    it(`ErrorMessageComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      const item = { kind: 'error', seq: 1, turn: 1, message: text }
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`Error/${name}`, new ErrorMessageComponent(item, colors, components).render(width), width)
      }
    })

    it(`InterruptedMarkerComponent survives ${name}`, () => {
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`Interrupted/${name}`, new InterruptedMarkerComponent(colors, fakeBlueComponents()).render(width), width)
      }
    })

    it(`StepSummaryComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      const item = { kind: 'step-summary', seq: 1, turn: 1, step: 1, toolNames: [text, text], thinking: 1 }
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`StepSummary/${name}`, new StepSummaryComponent(item, colors, components).render(width), width)
      }
    })

    it(`ThinkingComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      const item = { kind: 'thinking', seq: 1, turn: 1, step: 1, text, streaming: false }
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`Thinking/${name}`, new ThinkingComponent(item, colors, components).render(width), width)
      }
    })

    it(`TranscriptModelComponent semantic bridge survives ${name}`, () => {
      const components = fakeBlueComponents()
      const model = createTranscriptModel('width-scan', [
        { kind: 'transcript-user', id: 'user', seq: 1, turn: 1, text, images: [] },
        { kind: 'transcript-assistant', id: 'assistant', seq: 2, turn: 1, step: 0, text, streaming: false },
        { kind: 'transcript-thinking', id: 'thinking', seq: 3, turn: 1, step: 0, text, streaming: false },
        {
          kind: 'transcript-tool', id: 'tool', seq: 4, turn: 1, step: 0, callId: 'call', name: 'custom',
          arguments: '{}', startedAt: 1, result: { text, fullText: text, isError: false, endedAt: 2 },
        },
        {
          kind: 'transcript-tool', id: 'presented', seq: 5, turn: 1, step: 0, callId: 'presented', name: 'custom',
          arguments: '{}', startedAt: 1, presentation: { kind: 'tool', id: 'presented', name: 'custom', result: { kind: 'text', content: text } },
        },
        { kind: 'transcript-error', id: 'error', seq: 6, turn: 1, message: text },
        { kind: 'transcript-interrupted', id: 'interrupted', seq: 7, turn: 1 },
      ])
      const component = new TranscriptModelComponent(() => model, {
        colors,
        components,
        images: () => ({}),
        requestRender: () => undefined,
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`TranscriptModel/${name}`, component.render(width), width)
      }
      component.dispose()
    })

    it(`AgentGroupComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`AgentGroup/${name}`, new AgentGroupComponent(subagentItem(text), colors, components).render(width), width)
      }
    })

    it(`banner (composeBannerLines) survives ${name}`, () => {
      const components = fakeBlueComponents()
      const content = {
        version: text,
        model: text,
        provider: 'p',
        cwd: shortenHome(text, homedir()),
      }
      const deps = {
        colors,
        truncate: (t: string, target: number) => components.truncateToWidth(t, target),
        visibleWidth: (t: string) => components.visibleWidth(t),
      }
      for (const width of SCAN_WIDTHS) {
        if (bannerLayout(width) === null) continue
        expectLinesFit(`Banner/${name}`, composeBannerLines(deps, content, width), width)
      }
    })
  }

  it('StatusFooterComponent survives truncating long models at every width', () => {
    for (const { name, text } of ADVERSARIAL) {
      const components = fakeBlueComponents()
      const status = new BlueStatusService(new Context())
      const footer = new StatusFooterComponent(status, components, colors)
      status.register({ id: 'scan-title', priority: 90, visible: true, band: 'right', node: { kind: 'text', content: text } })
      status.register({ id: 'scan-left', priority: 10, visible: true, node: { kind: 'text', content: text } })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`FooterShell/${name}`, footer.render(width), width)
      }
    }
  })

})
