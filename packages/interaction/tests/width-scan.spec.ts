/**
 * The width-scan contract for the interaction panels (D48): every
 * content-rendering panel renders each adversarial fixture at each scan
 * width and must honor the `BlueComponent` contract — every output line's
 * visible width within the width it was given. A red row here is a latent
 * pi-tui width-guard crash (before the D48 exit clamp) or a
 * blue-overflow.log entry (after it). The plugin-boot components (mode
 * status, pane queue, approval, editor-plus echo) render through these
 * same panel primitives and carry their own real-semantics width
 * assertions in their specs.
 */

import { describe, expect, it, vi } from 'vitest'
import { CanonicalFormController, type FormField } from '../src/form-panel.ts'
import { HelpOverlay, type HelpSection } from '../src/help.ts'
import { InfoPanel, type InfoSection } from '../src/info-panel.ts'
import { CanonicalDocumentController } from '../src/frontend-panel.ts'
import { PlanReviewPanel, planReviewChoices } from '../src/plan-review-panel.ts'
import { Questionnaire } from '../src/questionnaire.ts'
import { CanonicalSettingsController, SettingsNoticeController } from '../src/settings-command.ts'
import { UpdateNoticeComponent } from '../src/update-notice.ts'
import { fakeBlueContext, FakeBlueComponents, FakeKeymap } from './fakes.ts'
import { ADVERSARIAL, SCAN_WIDTHS, expectLinesFit } from '../../core/tests/width-scan.ts'

/**
 * Identity theme: the width scan measures rows through the same visible
 * width the renderer uses, so marker paints (whose literals add columns the
 * production SGR paints do not) would read as false overflows.
 */
const id = (text: string): string => text
const IDENTITY_THEME = {
  colors: {
    text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
    borderFocus: id, success: id, error: id, warning: id, selectedBg: id, roleUser: id,
    shellMode: id,
    mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
    mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
    diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id,
    diffGutter: id, diffMeta: id,
  },
}

/** One questionnaire ask whose option label and description are the fixture. */
function ask(text: string) {
  return {
    id: 'q1',
    question: text,
    options: [
      { label: text, description: text },
      { label: 'Beta' },
    ],
  }
}

/** A plan-review ask whose question and options carry the fixture. */
function planAsk(text: string) {
  return {
    id: 'pr',
    question: text,
    options: [
      { label: text.slice(0, 40), description: text },
      { label: 'Keep planning', description: 'Stay in plan mode; refine first.' },
    ],
    intent: { kind: 'plan-review', approve: text.slice(0, 40) },
  }
}

describe('interaction width-scan', () => {
  for (const { name, text } of ADVERSARIAL) {
    it(`UpdateNoticeComponent survives ${name}`, () => {
      const { components } = fakeBlueContext()
      const notice = new UpdateNoticeComponent(
        (line, width) => components.truncateToWidth(line, width),
        { current: '0.1.0-rc.2', target: text.slice(0, 20), command: `dsh plugin --profile blue add @dsh-blue/blue@${text.slice(0, 12)}` },
      )
      for (const width of SCAN_WIDTHS) expectLinesFit(`UpdateNotice/${name}`, notice.render(width), width)
    })
    it(`canonical form survives ${name}`, () => {
      const { keymap, components } = fakeBlueContext()
      const fields: FormField[] = [
        { id: 'f1', label: text, required: true },
        { id: 'f2', label: 'Short' },
      ]
      const panel = new CanonicalFormController({
        keymap, theme: IDENTITY_THEME as never, components,
        title: text,
        subtitle: text,
        fields,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`canonical-form/${name}`, panel.render(width), width)
      }
    })

    it(`HelpOverlay survives ${name}`, () => {
      const sections: HelpSection[] = [
        {
          heading: 'Commands',
          labelTone: 'accent',
          rows: [
            { label: text, description: text },
            { label: '/short', description: 'fits anywhere' },
          ],
        },
      ]
      const overlay = new HelpOverlay({
        theme: IDENTITY_THEME as never,
        components: new FakeBlueComponents(),
        keymap: new FakeKeymap(),
        sections,
        onClose: vi.fn(),
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`HelpOverlay/${name}`, overlay.render(width), width)
      }
    })

    it(`InfoPanel survives ${name}`, () => {
      const sections: InfoSection[] = [
        {
          heading: 'Session',
          rows: [
            { label: text, segments: [{ text }] },
            { label: 'id', segments: [{ text }, { text, style: 'muted' as const }] },
          ],
        },
      ]
      const panel = new InfoPanel({
        theme: IDENTITY_THEME as never,
        components: new FakeBlueComponents(),
        keymap: new FakeKeymap(),
        title: text,
        sections,
        onClose: vi.fn(),
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`InfoPanel/${name}`, panel.render(width), width)
      }
    })

    it(`canonical document survives ${name}`, () => {
      const panel = new CanonicalDocumentController({
        theme: IDENTITY_THEME as never,
        components: new FakeBlueComponents(),
        keymap: new FakeKeymap(),
        model: () => ({
          kind: 'panel', mode: 'select', title: text,
          header: { kind: 'text', text },
          view: { kind: 'list', filterable: true, grouped: true, items: [
            { id: 'a', label: text, detail: text, group: text, variants: [{ id: 'v', label: text, action: { kind: 'pick' } }] },
            { id: 'b', label: text, group: 'other', action: { kind: 'pick' } },
          ] },
        }),
        onAction: vi.fn(),
        onClose: vi.fn(),
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`canonical-document/${name}`, panel.render(width), width)
      }
    })

    it(`PlanReviewPanel survives ${name}`, () => {
      const question = planAsk(text) as Parameters<typeof planReviewChoices>[0]
      const choices = planReviewChoices(question)
      expect(choices).toBeDefined()
      const panel = new PlanReviewPanel({
        theme: IDENTITY_THEME as never,
        components: new FakeBlueComponents(),
        question,
        choices: choices!,
        viewportRows: () => 24,
        onComplete: vi.fn(),
        onCancel: vi.fn(),
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`PlanReviewPanel/${name}`, panel.render(width), width)
      }
    })

    it(`Questionnaire survives ${name}`, () => {
      const questionnaire = new Questionnaire({
        theme: IDENTITY_THEME as never,
        components: new FakeBlueComponents(),
        questions: [ask(text)] as never,
        onComplete: vi.fn(),
        onCancel: vi.fn(),
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`Questionnaire/${name}`, questionnaire.render(width), width)
      }
      questionnaire.handleInput('\x1b')
    })
    it(`canonical settings survives ${name}`, () => {
      const components = new FakeBlueComponents()
      const items = [
        { id: 'a', label: text, description: text, currentValue: text, values: [text, 'other'] },
        { id: 'b', label: 'Short', currentValue: '1', values: ['1', '2'] },
      ]
      const panel = new CanonicalSettingsController({
        theme: IDENTITY_THEME as never,
        components,
        keymap: new FakeKeymap(),
        title: `settings › ${text}`,
        footer: ['↑↓ select', text, 'esc back'],
        items: [
          ...items,
        ],
        notice: { current: { text, error: true } },
        onChange: vi.fn(),
        onCancel: vi.fn(),
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`canonical-settings/${name}`, panel.render(width), width)
      }
      panel.handleInput('\x1b')
    })

    it(`settings notice survives ${name}`, () => {
      const components = new FakeBlueComponents()
      const tail = new SettingsNoticeController({
        // The inner panel budgets its own rows (the canonical selector
        // contract); the tail's own addition is the truncated notice row.
        inner: {
          focused: false,
          currentNode: () => ({ kind: 'text', content: text }),
          handleInput: () => {},
          invalidate: () => {},
        },
        components,
        theme: IDENTITY_THEME as never,
        notice: { current: { text, error: false } },
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`settings-notice/${name}`, tail.render(width), width)
      }
      tail.handleInput('\x1b')
      tail.invalidate()
    })
  }
})
