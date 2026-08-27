/**
 * VT layout snapshots (R2): whole-tree frames locked against golden files.
 * The same bootBlue tree as the e2e runs, but the terminal is a VtTerminal —
 * every rendered byte feeds a real headless terminal, and the golden frame
 * is that terminal's screen grid (scrollback included, cwd tokenized). The
 * logical-layer specs proved content and width contracts; these frames pin
 * the LAYOUT — what a real terminal would actually show (the D48
 * width-crash family shipped green through the logic layer).
 *
 * Regenerate goldens after an intentional layout change:
 *   pnpm vitest run packages/bundle/blue/tests/vt-snapshot.spec.ts -u
 * The golden diff in the PR is the reviewable statement of the visual
 * change; an unintentional change fails red here.
 *
 * Determinism contract (each case must hold it): frames are captured at
 * agent idle (spinner row empty, timers stopped), the git badge goes
 * through the setGitCommandRunner seam (never the real checkout probe), and
 * the cwd paints only through the cwdNormalizer tokens.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootBlue, currentAgent, executeCommand, resetBlueModuleState, typeLine } from './e2e-boot.ts'
import type { BlueTree } from './e2e-boot.ts'
import { textResponse, toolCallResponse } from './mock-adapter.ts'
import { cwdNormalizer, VtTerminal } from './vt-terminal.ts'
import { waitForRender } from '../../../core/tests/fake-terminal.ts'
import { setActivityTimers } from '../../../transcript/src/pane-activity.ts'
import { setGitCommandRunner } from '../../../transcript/src/status-git.ts'
import { setClipboardImageReader } from '../../../interaction/src/paste-image.ts'
import { ADVERSARIAL } from '../../../core/tests/width-scan.ts'
import { mkdtempTracked } from '../../../core/tests/temp-dir.ts'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Pin the session cwd to a fixed-length throwaway directory: the banner and
// the footer paint process.cwd(), and the frame's truncation and padding
// depend on its LENGTH — goldens must not depend on which checkout (or how
// deeply nested a worktree) runs them. The random suffix is six chars every
// time, so every rendering decision is stable and the normalizer's tokens
// erase the rest.
process.chdir(mkdtempTracked('blue-vt-frame-'))

/** A 1x1 PNG (the paste-image spec's literal). */
const PNG_1X1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
  0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80, 15,
  0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

/** The git badge stays deterministic: never probe the real checkout. */
const NO_GIT = (): null => null

/**
 * Quiesce the screen: first wait until it has ANY content (a boot whose
 * first render lands late would otherwise stabilize on an empty grid —
 * found by the 40-column banner case), then until two dumps 50ms apart
 * agree — asynchronous settles (the image paste load, dock repaints) have
 * to finish before a frame is golden.
 */
async function stableFrame(vt: VtTerminal): Promise<string> {
  const normalize = cwdNormalizer()
  let previous = await vt.frame(normalize)
  await vi.waitFor(async () => {
    await new Promise(resolve => { setTimeout(resolve, 50) })
    previous = await vt.frame(normalize)
    expect(previous.trim().length).toBeGreaterThan(0)
  })
  await vi.waitFor(async () => {
    await new Promise(resolve => { setTimeout(resolve, 50) })
    const next = await vt.frame(normalize)
    expect(next).toBe(previous)
    previous = next
  })
  return previous
}

/**
 * The golden capture: quiesce, force one same-size full clear-and-repaint
 * (the strongest rendering path — every golden frame is the result of a
 * deliberate full repaint, not an incidental incremental diff), wait for
 * the throttled pipeline, and compare the normalized grid against
 * `tests/golden/<name>.txt`.
 *
 * A forced repaint was briefly SUSPECTED of crashing mid-write at 40
 * columns (empty frames during development); a dedicated reproduction
 * matrix disproved it — the empties came from this spec's own premature
 * quiesce, and the forced-repaint path has never thrown. The suspicion is
 * retracted here so nobody chases it again.
 */
async function captureGolden(tree: BlueTree, vt: VtTerminal, name: string): Promise<string> {
  await stableFrame(vt)
  tree.ctx.get('blueScreen')!.requestRender(true)
  await waitForRender()
  const frame = await vt.frame(cwdNormalizer())
  await expect(frame).toMatchFileSnapshot(new URL(`./golden/${name}.txt`, import.meta.url).pathname)
  return frame
}

afterEach(async () => {
  await resetBlueModuleState()
  setActivityTimers(undefined)
  setGitCommandRunner(undefined)
  delete process.env.DSH_BLUE_ATTACHMENT_DIR
})

describe('blue VT layout snapshots (R2)', () => {
  it.each([80, 40, 160])('banner first frame at %i columns', async (columns) => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(columns, 24)
    const tree = await bootBlue([], { script: [], terminal: vt })
    await currentAgent(tree)
    const frame = await captureGolden(tree, vt, `banner-${columns}`)
    // Sanity anchors beside the golden: the banner renders at every width
    // above its 40-column zero-row threshold (D42's min-40); at exactly 40
    // the banner is intentionally absent and the frame carries the rest.
    if (columns > 40) {
      expect(frame).toContain('Welcome to Blue!')
      expect(frame).toContain('Version:')
    }
    expect(frame).toContain('mock')
  })

  it('a markdown turn renders through the real fold', async () => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(80, 24)
    const reply = [
      '# Title',
      '',
      '- item',
      '',
      '[link](https://example.com)',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
    ].join('\n')
    const tree = await bootBlue([], { script: [textResponse(reply)], terminal: vt })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'show markdown')
    await agent.whenIdle()
    const frame = await captureGolden(tree, vt, 'conversation-markdown-80')
    expect(frame).toContain('• item')
  })

  it('tool cards: collapsed, failed, then ctrl+o expanded', async () => {
    setGitCommandRunner(NO_GIT)
    setActivityTimers({
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => {},
    })
    const vt = new VtTerminal(80, 40)
    const tree = await bootBlue([], {
      script: [
        toolCallResponse('call-long', 'long-output', {}),
        toolCallResponse('call-fail', 'boom', {}),
        textResponse('done'),
      ],
      terminal: vt,
    })
    tree.ctx.tools.register({
      name: 'long-output',
      description: 'A tool with a long output tail.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => '' },
      execute: async () => ({}),
    })
    tree.ctx.tools.register({
      name: 'boom',
      description: 'A tool that fails.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => '' },
      execute: async () => { throw new Error('boom exploded') },
    })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'run both')
    await agent.whenIdle()
    const collapsed = await captureGolden(tree, vt, 'tool-card-collapsed-80')
    expect(collapsed).toContain('long-output')
    expect(collapsed).not.toContain('TAILMARKER')
    tree.terminal.sendInput('\x0f')
    await waitForRender()
    const expanded = await captureGolden(tree, vt, 'tool-card-expanded-80')
    expect(expanded).toContain('long-output')
  })

  it('write diff card: new-file panel, then aligned hunks expanded', async () => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(80, 40)
    const notes = Array.from({ length: 8 }, (_, index) => `// trailing note ${String(index + 1)}`)
    const before = [
      'import { Service } from \'@deepseek-ai/cordis\'',
      '',
      'const COUNT = 1',
      'const LABEL = \'beta\'',
      'const MODE = \'draft\'',
      '',
      'export const name = \'demo\'',
      ...notes,
    ].join('\n')
    const after = before
      .replace('const COUNT = 1', 'const COUNT = 2')
      .replace('const LABEL = \'beta\'', 'const LABEL = \'stable\'\nconst OWNER = \'blue\'')
    const tree = await bootBlue([], {
      script: [
        toolCallResponse('call-write', 'write', { file_path: 'src/demo.ts', content: after }),
        textResponse('done'),
      ],
      terminal: vt,
    })
    tree.ctx.tools.register({
      name: 'write',
      description: 'Write a file.',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: () => [{ type: 'text', text: 'wrote src/demo.ts' }],
      },
      execute: () => Promise.resolve('ok'),
      presentCall: (args: unknown) => ({
        card: 'diff',
        title: `Write ${(args as { file_path: string }).file_path}`,
        diffs: [{ path: 'src/demo.ts', oldText: null, newText: after }],
      }),
      presentResult: () => ({
        card: 'diff',
        title: 'Write src/demo.ts',
        diffs: [{ path: 'src/demo.ts', oldText: before, newText: after }],
      }),
    })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'write it')
    await agent.whenIdle()
    // Collapsed shows the call-time create panel: whole-file additions.
    const collapsed = await captureGolden(tree, vt, 'diff-card-80')
    expect(collapsed).toContain('src/demo.ts · new file, +')
    expect(collapsed).toContain('+ const COUNT = 2')
    expect(collapsed).not.toContain('- const COUNT = 1')
    tree.terminal.sendInput('\x0f')
    await waitForRender()
    // Expanded shows the applied result: aligned hunks with change counts and
    // the long shared tail elided.
    const expanded = await captureGolden(tree, vt, 'diff-card-expanded-80')
    expect(expanded).toContain('src/demo.ts · +3 −2')
    expect(expanded).toContain('- const COUNT = 1')
    expect(expanded).toContain('+ const OWNER = \'blue\'')
    expect(expanded).toContain('unchanged lines')
  })

  it('read group: by-file tree collapsed, previews expanded', async () => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(80, 40)
    const files: Record<string, string[]> = {
      'src/a.ts': Array.from({ length: 130 }, (_, index) => `line ${String(index + 1)} of a`),
      'src/b.ts': Array.from({ length: 40 }, (_, index) => `line ${String(index + 1)} of b`),
    }
    const readResultView = (path: string, offset: number, count: number) => ({
      card: 'read' as const,
      path,
      offset,
      lines: files[path]!.slice(offset - 1, offset - 1 + count).map((text, index) => ({ number: offset + index, text })),
      totalLines: files[path]!.length,
    })
    const tree = await bootBlue([], {
      script: [
        toolCallResponse('call-ra1', 'read', { file_path: 'src/a.ts', offset: 1, limit: 100 }),
        toolCallResponse('call-ra2', 'read', { file_path: 'src/a.ts', offset: 101, limit: 30 }),
        toolCallResponse('call-rb', 'read', { file_path: 'src/b.ts', offset: 1, limit: 40 }),
        textResponse('read done'),
      ],
      terminal: vt,
    })
    tree.ctx.tools.register({
      name: 'read',
      description: 'read a file',
      parameters: { type: 'object', properties: {} },
      presentCall: () => ({ card: 'generic', title: 'Read', kind: 'read' }),
      presentResult: (args: unknown) => {
        const { file_path: path, offset = 1, limit = 100 } = args as { file_path: string; offset?: number; limit?: number }
        return readResultView(path, offset, Math.min(limit, (files[path] ?? []).length - offset + 1))
      },
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'read' }] },
      execute: () => Promise.resolve('read'),
    })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'read them')
    await agent.whenIdle()
    // Collapsed: one tree card — files as parents, a.ts's windows nested —
    // and never the file content.
    const collapsed = await captureGolden(tree, vt, 'read-group-80')
    expect(collapsed).toContain('Read 2 files · 3 reads')
    expect(collapsed).toContain('├─ src/a.ts')
    expect(collapsed).toContain('│  ├─ 1-100 of 130')
    expect(collapsed).toContain('│  └─ 101-130')
    expect(collapsed).toContain('└─ src/b.ts · 1-40')
    expect(collapsed).not.toContain('line 1 of a')
    tree.terminal.sendInput('\x0f')
    await waitForRender()
    // Expanded: bounded previews with file line numbers.
    const expanded = await captureGolden(tree, vt, 'read-group-expanded-80')
    expect(expanded).toContain('1  line 1 of a')
  })

  it('search group: pattern rows collapsed, file previews expanded', async () => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(80, 40)
    const tree = await bootBlue([], {
      script: [
        toolCallResponse('call-g1', 'grep', { pattern: 'export const', path: 'src' }),
        toolCallResponse('call-g2', 'grep', { pattern: 'TODO' }),
        toolCallResponse('call-p1', 'glob', { pattern: 'src/**/*.ts' }),
        textResponse('search done'),
      ],
      terminal: vt,
    })
    tree.ctx.tools.register({
      name: 'grep',
      description: 'search file contents',
      parameters: { type: 'object', properties: {} },
      presentCall: () => ({ card: 'generic', title: 'Grep', kind: 'search' }),
      presentResult: (args: unknown) => ({
        card: 'search',
        shape: 'matches',
        files: (args as { pattern: string }).pattern === 'TODO'
          ? []
          : [
            { path: 'src/core/a.ts', matches: [{ lineNumber: 3, line: 'export const one = 1' }, { lineNumber: 9, line: 'export const two = 2' }] },
            { path: 'src/core/b.ts', matches: [{ lineNumber: 41, line: 'export const three = 3' }] },
          ],
        truncated: false,
        total: (args as { pattern: string }).pattern === 'TODO' ? 0 : 3,
      }),
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'matches' }] },
      execute: () => Promise.resolve('matches'),
    })
    tree.ctx.tools.register({
      name: 'glob',
      description: 'find files by pattern',
      parameters: { type: 'object', properties: {} },
      presentCall: () => ({ card: 'generic', title: 'Glob', kind: 'search' }),
      presentResult: () => ({
        card: 'search',
        shape: 'paths',
        paths: ['src/core/a.ts', 'src/core/b.ts'],
        truncated: true,
        total: 12,
      }),
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'paths' }] },
      execute: () => Promise.resolve('paths'),
    })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'search around')
    await agent.whenIdle()
    // Collapsed: one tree card of pattern rows — counts and capped-search
    // honesty, never the match text.
    const collapsed = await captureGolden(tree, vt, 'search-group-80')
    expect(collapsed).toContain('Searched 3 patterns · 2 files, 3 matches, 12 paths')
    expect(collapsed).toContain('├─ "export const" · 2 files, 3 matches')
    expect(collapsed).toContain('├─ "TODO" · 0 matches')
    expect(collapsed).toContain('└─ src/**/*.ts · 12 paths')
    expect(collapsed).not.toContain('export const one')
    tree.terminal.sendInput('\x0f')
    await waitForRender()
    // Expanded: file rows with bounded match previews and the capped path page.
    const expanded = await captureGolden(tree, vt, 'search-group-expanded-80')
    expect(expanded).toContain('3: export const one = 1')
    expect(expanded).toContain('… 10 more paths')
  })

  it.each([80, 40])('the footer under full load at %i columns', async (columns) => {
    setGitCommandRunner((args) => {
      if (args[0] === 'branch') return 'main\n'
      if (args[0] === 'status') return '## main...origin/main [ahead 1]\n M a.ts\n'
      if (args[0] === 'diff') return '2\t1\ta.ts\n'
      return null
    })
    const vt = new VtTerminal(columns, 24)
    const tree = await bootBlue([], { script: [textResponse('ok')], contextWindow: 65_536, terminal: vt })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'run')
    await agent.whenIdle()
    const frame = await captureGolden(tree, vt, `footer-full-${columns}`)
    // The model entry survives every width; the git badge and the context
    // percentage yield progressively under the S15 two-band relief, so only
    // the 80-column frame asserts them.
    expect(frame).toContain('mock')
    if (columns >= 80) {
      expect(frame).toContain('main [')
      expect(frame).toContain('1% (10/64k)')
    }
  })

  it('the /model panel takes over the editor dock (D30)', async () => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(80, 30)
    const tree = await bootBlue([], {
      script: [],
      models: [
        { provider: 'mock', id: 'mock', name: 'Mock' },
        { provider: 'mock', id: 'mock-pro', name: 'Mock Pro' },
      ],
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' as never },
      terminal: vt,
    })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/model')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Select a model') })
    const frame = await captureGolden(tree, vt, 'model-panel-80')
    // D30: the panel owns the dock — the panel header is up, and the editor
    // prompt line is gone (the frame spans scrollback, so the banner's own
    // rounded frame is expected to remain in the history above).
    expect(frame).toContain('Select a model')
    expect(frame).toContain('← current')
  })

  it('the provider form uses compact focused field rows', async () => {
    setGitCommandRunner(NO_GIT)
    const dir = mkdtempTracked('blue-vt-form-')
    const credentialsPath = join(dir, 'credentials.yaml')
    writeFileSync(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: existing-test-key\n', { mode: 0o600 })
    const vt = new VtTerminal(80, 30)
    const tree = await bootBlue(['start'], {
      script: [textResponse('booted')],
      realSettings: { settingsPath: join(dir, 'settings.yaml'), credentialsPath },
      piAi: true,
      terminal: vt,
    })
    const agent = await currentAgent(tree)
    await agent.whenIdle()
    const outcome = executeCommand(tree, agent, '/provider add')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Add provider') })
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Endpoint protocol') })
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Custom endpoint') })
    const frame = await captureGolden(tree, vt, 'form-panel-80')
    expect(frame).toContain('Provider Name')
    expect(frame).toContain('Base URL')
    expect(frame).toContain('API key')
    tree.terminal.sendInput('\x1b')
    await expect(outcome).resolves.toEqual({ kind: 'success', text: 'add provider cancelled' })
  })

  it('the questionnaire uses progress and a shared compact input row', async () => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(80, 30)
    const tree = await bootBlue([], { script: [], terminal: vt })
    await currentAgent(tree)
    const answer = tree.ctx.userQuestions.ask({
      questions: [
        { id: 'q1', question: 'What should we call this project?', header: 'Name' },
        { id: 'q2', question: 'Which runtime?', header: 'Runtime', options: [{ label: 'Node' }, { label: 'Deno' }] },
      ],
    })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('What should we call this project?') })
    const inputFrame = await captureGolden(tree, vt, 'questionnaire-input-80')
    expect(inputFrame).toContain('Answer')
    tree.terminal.sendInput('blue')
    tree.terminal.sendInput('\t')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Which runtime?') })
    const choiceFrame = await captureGolden(tree, vt, 'questionnaire-choice-80')
    expect(choiceFrame).toContain('Runtime')
    tree.terminal.sendInput('\x1b')
    await expect(answer).rejects.toBeDefined()
  })

  it('CJK width: the D48 adversarial corpus at 40 columns', async () => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(40, 24)
    const pick = (name: string): string => ADVERSARIAL.find(entry => entry.name === name)!.text
    const reply = [pick('cjk-heavy'), pick('unbroken-200'), pick('emoji-zwj')].join('\n')
    const tree = await bootBlue([], { script: [textResponse(reply)], terminal: vt })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, '宽度')
    await agent.whenIdle()
    const frame = await captureGolden(tree, vt, 'cjk-40')
    expect(frame).toContain('你')
    // Cell-level width verdicts on the first CJK glyph: wide char, zero-width
    // trailing cell, and no viewport row wider than the terminal.
    let found = false
    for (let y = 0; y < 24 && !found; y += 1) {
      for (let x = 0; x < 40 && !found; x += 1) {
        if (vt.cellChar(x, y) === '你') {
          expect(vt.cellWidth(x, y)).toBe(2)
          expect(vt.cellWidth(x + 1, y)).toBe(0)
          found = true
        }
      }
    }
    expect(found).toBe(true)
    for (let y = 0; y < 24; y += 1) {
      let width = 0
      for (let x = 0; x < 40; x += 1) width += vt.cellWidth(x, y)
      expect(width, `row ${y} total cell width`).toBeLessThanOrEqual(40)
    }
  })

  it('a large pasted user message folds to the D46 preview', async () => {
    setGitCommandRunner(NO_GIT)
    const vt = new VtTerminal(80, 24)
    const tree = await bootBlue([], { script: [textResponse('got it')], terminal: vt })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'x'.repeat(1200))
    await agent.whenIdle()
    const frame = await captureGolden(tree, vt, 'paste-fold-80')
    expect(frame).toContain('ctrl+o to expand')
  })

  it('a pasted image renders its marker block', async () => {
    setGitCommandRunner(NO_GIT)
    const attachmentDir = mkdtempTracked('blue-vt-attachments-')
    process.env.DSH_BLUE_ATTACHMENT_DIR = join(attachmentDir, 'store')
    setClipboardImageReader(() => Promise.resolve({ kind: 'image', data: PNG_1X1, mediaType: 'image/png' }))
    const vt = new VtTerminal(80, 24)
    const tree = await bootBlue([], { script: [textResponse('seen')], terminal: vt })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'look at this ')
    tree.terminal.sendInput('\x16')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('[image #1]') })
    tree.terminal.sendInput('\r')
    await agent.whenIdle()
    const frame = await captureGolden(tree, vt, 'image-80')
    // The marker lived in the editor BEFORE submit; the submitted turn
    // renders the user text plus the image block in the transcript.
    expect(frame).toContain('look at this')
  })
})
