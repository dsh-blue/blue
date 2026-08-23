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
import type { BlueScreen, BlueSemanticColors } from '@dsh-blue/blue-core'
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
import { ThinkingComponent } from '../src/thinking.ts'
import { createTranscriptModel, TranscriptModelComponent } from '../src/transcript-model.ts'
import { BlueStatusService, FooterShellComponent } from '../src/status.ts'
import { TerminalCardComponent } from '../src/intent-terminal.ts'
import { DiffCardComponent } from '../src/intent-diff.ts'
import { bannerLayout, composeBannerLines, shortenHome } from '../src/banner.ts'
import type { TranscriptToolItem } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'
import { COLORS } from './intent-fakes.ts'
import { ADVERSARIAL, SCAN_WIDTHS, expectLinesFit } from '../../core/tests/width-scan.ts'

/** Identity colors satisfy BlueSemanticColors where consumed. */
const colors = COLORS as BlueSemanticColors

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
          arguments: '{}', startedAt: 1, presentation: { kind: 'tool', id: 'presented', name: 'custom', result: { kind: 'text', text } },
        },
        { kind: 'transcript-error', id: 'error', seq: 6, turn: 1, message: text },
        { kind: 'transcript-interrupted', id: 'interrupted', seq: 7, turn: 1 },
      ])
      const component = new TranscriptModelComponent(() => model, {
        colors,
        components,
        images: () => ({}),
        intents: {} as never,
        requestRender: () => undefined,
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`TranscriptModel/${name}`, component.render(width), width)
      }
      component.dispose()
    })

    it(`ReadGroupComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`ReadGroup/${name}`, new ReadGroupComponent(bashItem(text), colors, components).render(width), width)
      }
    })

    it(`AgentGroupComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`AgentGroup/${name}`, new AgentGroupComponent(subagentItem(text), colors, components).render(width), width)
      }
    })

    it(`TerminalCardComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      for (const expanded of [false, true]) {
        for (const width of SCAN_WIDTHS) {
          expectLinesFit(`TerminalCard/${name}`, new TerminalCardComponent({
            item: bashItem(text),
            colors,
            components,
            expanded,
          }).render(width), width)
        }
      }
    })

    it(`DiffCardComponent survives ${name}`, () => {
      const components = fakeBlueComponents()
      const item = {
        ...bashItem(text),
        parsedArguments: { path: text, old_string: `${text}\nsecond`, new_string: `${text}!\nother` },
      } as TranscriptToolItem
      for (const expanded of [false, true]) {
        for (const width of SCAN_WIDTHS) {
          expectLinesFit(`DiffCard/${name}`, new DiffCardComponent({ item, colors, components, expanded }).render(width), width)
        }
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

  it('FooterShellComponent survives a truncating long entry at every width', () => {
    class FakeScreen {
      readonly renderRequests: (boolean | undefined)[] = []
      requestRender(force?: boolean): void {
        this.renderRequests.push(force)
      }
    }
    for (const { name, text } of ADVERSARIAL) {
      const components = fakeBlueComponents()
      const status = new BlueStatusService(new Context(), new FakeScreen() as unknown as BlueScreen)
      const footer = new FooterShellComponent(status, components)
      status.register({ id: 'scan-title', priority: 90, render: width => components.truncateToWidth(text, width) })
      status.register({ id: 'scan-left', priority: 10, render: width => components.truncateToWidth(text, width) })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`FooterShell/${name}`, footer.render(width), width)
      }
    }
  })
})
