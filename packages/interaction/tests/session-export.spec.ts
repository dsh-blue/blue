/**
 * Tests for the S26 session-export command family: the `/export` and
 * `/copy` handlers over the shared raw-artifact read path (fake
 * persistence), the pure `buildExportMarkdown`/`lastAssistantText`
 * helpers, and the registration/dispose lifecycle.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { TranscriptItem } from '@dsh-blue/blue-transcript'
import { setClipboardTextWriter } from '../src/clipboard-write.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { buildExportMarkdown, lastAssistantText } from '../src/session-export.ts'
import { fakeBlueContext, FakeBlueEditor } from './fakes.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'

registerTempDirCleanup()

/** One JSONL storage line for the fake raw artifact. */
function logLine(event: unknown): string {
  return JSON.stringify(event)
}

/** A minimal persisted turn: one user message and one assistant reply. */
function singleTurnLog(userText: string, answerText: string): string {
  return [
    logLine({ type: 'turn/start', seq: 1, time: 1, data: { turn: 0 } }),
    logLine({ type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: userText }], source: { kind: 'user' } } }),
    logLine({ type: 'step/start', seq: 3, time: 3, data: { turn: 0, step: 0 } }),
    logLine({ type: 'assistant/message', seq: 4, time: 4, data: {
      turn: 0,
      step: 0,
      message: {
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'text', text: answerText }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
    } }),
    logLine({ type: 'step/end', seq: 5, time: 5, data: { turn: 0, step: 0 } }),
    logLine({ type: 'turn/end', seq: 6, time: 6, data: { turn: 0, reason: { kind: 'completed' } } }),
  ].join('\n')
}

describe('buildExportMarkdown', () => {
  const baseItems = (): TranscriptItem[] => ([
    {
      kind: 'user', seq: 1, turn: 0,
      text: 'first question',
      images: [{ attachmentId: 'a1' as never, mediaType: 'image/png', bytes: 4, width: 1, height: 1 }],
    },
    {
      kind: 'thinking', seq: 2, turn: 0, step: 0, text: 'reasoning trail', streaming: false,
    },
    {
      kind: 'assistant', seq: 3, turn: 0, step: 0, text: '**answer** text',
    },
    {
      kind: 'tool', seq: 4, turn: 0, step: 0, callId: 'c1', name: 'bash',
      arguments: '{"command":"ls"}',
      parsedArguments: { command: 'ls' },
      result: { text: 'summarized', fullText: 'file1\nfile2', isError: false },
    },
    {
      kind: 'error', seq: 5, turn: 1, message: 'endpoint 404', code: 'ENDPOINT_404',
    },
    {
      kind: 'interrupted', seq: 6, turn: 2,
    },
    {
      kind: 'step-summary', seq: 7, turn: 3, step: 0, toolNames: ['read', 'read'], thinking: 1,
    },
  ])

  it('writes front-matter, overview, and per-turn sections in fold order', () => {
    const markdown = buildExportMarkdown({
      sessionId: 'sess-12345678',
      workDir: '/tmp/spec',
      items: baseItems(),
      exportedAt: new Date('2026-08-21T07:15:30.000Z'),
    })
    expect(markdown).toContain('session_id: sess-12345678')
    expect(markdown).toContain('exported_at: 2026-08-21T07:15:30.000Z')
    expect(markdown).toContain('work_dir: /tmp/spec')
    expect(markdown).toContain('message_count: 7')
    expect(markdown).toContain('# Blue Session Export')
    // Overview: first user topic, 4 distinct turns, 1 tool call.
    expect(markdown).toContain('- **Topic**: first question')
    expect(markdown).toContain('- **Conversation**: 4 turns | 1 tool call')
    // The user section carries the image placeholder.
    expect(markdown).toContain('### User')
    expect(markdown).toContain('[image]')
    // Thinking renders as a collapsible block above the assistant reply.
    expect(markdown).toContain('<details><summary>Thinking</summary>')
    expect(markdown).toContain('reasoning trail')
    expect(markdown).toContain('### Assistant')
    expect(markdown).toContain('**answer** text')
    // Tool call with hint, fenced arguments, and the full result.
    expect(markdown).toContain('#### Tool Call: bash (`ls`)')
    expect(markdown).toContain('```json\n{\n  "command": "ls"\n}')
    expect(markdown).toContain('<details><summary>Tool Result: bash (`ls`)</summary>')
    expect(markdown).toContain('file1\nfile2')
    // Failure, interruption, and folded-step rows.
    expect(markdown).toContain('> ✗ request failed: endpoint 404 (ENDPOINT_404)')
    expect(markdown).toContain('> (interrupted)')
    expect(markdown).toContain('#### (folded step · 2 tool calls · 1 thinking block)')
    // Turn sections carry the fold's own turn numbers (0-based), in
    // first-seen order.
    const turn1 = markdown.indexOf('## Turn 1')
    const turn2 = markdown.indexOf('## Turn 2')
    const turn3 = markdown.indexOf('## Turn 3')
    expect(turn1).toBeGreaterThan(-1)
    expect(turn2).toBeGreaterThan(turn1)
    expect(turn3).toBeGreaterThan(turn2)
  })

  it('drops empty thinking, skips empty assistant bodies, and uses result fallbacks', () => {
    const items: TranscriptItem[] = [
      { kind: 'user', seq: 1, turn: 0, text: 'q', images: [] },
      { kind: 'thinking', seq: 2, turn: 0, step: 0, text: '   ', streaming: false },
      { kind: 'assistant', seq: 3, turn: 0, step: 0, text: '' },
      {
        kind: 'tool', seq: 4, turn: 0, step: 0, callId: 'c1', name: 'read',
        arguments: 'not-json', parsedArguments: undefined,
        result: { text: 'summarized only', isError: true },
      },
    ]
    const markdown = buildExportMarkdown({
      sessionId: 's', workDir: undefined, items, exportedAt: new Date('2026-08-21T00:00:00.000Z'),
    })
    expect(markdown).not.toContain('<summary>Thinking</summary>')
    expect(markdown).not.toContain('### Assistant')
    // Unparsable arguments export verbatim; the hint stays absent.
    expect(markdown).toContain('#### Tool Call: read')
    expect(markdown).toContain('```json\nnot-json\n```')
    expect(markdown).not.toContain('(`')
    // The result falls back to the summarized text when fullText is absent.
    expect(markdown).toContain('summarized only')
    // Empty work_dir renders as an empty field.
    expect(markdown).toContain('work_dir: ')
  })

  it('caps the overview topic at 80 characters and pluralizes the tool count', () => {
    const items: TranscriptItem[] = [
      { kind: 'user', seq: 1, turn: 0, text: `${'x'.repeat(200)} more`, images: [] },
      { kind: 'tool', seq: 2, turn: 0, step: 0, callId: 'a', name: 'read', arguments: '{}', parsedArguments: {} },
      { kind: 'tool', seq: 3, turn: 0, step: 0, callId: 'b', name: 'read', arguments: '{}', parsedArguments: {} },
    ]
    const markdown = buildExportMarkdown({
      sessionId: 's', workDir: undefined, items, exportedAt: new Date('2026-08-21T00:00:00.000Z'),
    })
    expect(markdown).toContain(`- **Topic**: ${'x'.repeat(80)}…`)
    expect(markdown).toContain('- **Conversation**: 1 turn | 2 tool calls')
  })

  it('keeps the hint from non-whitelist string arguments and absent parse', () => {
    const items: TranscriptItem[] = [
      { kind: 'tool', seq: 1, turn: 0, step: 0, callId: 'a', name: 'read', arguments: '{"path":"/x"}', parsedArguments: { path: '/x' } },
      { kind: 'tool', seq: 2, turn: 0, step: 0, callId: 'b', name: 'read', arguments: '{"path":"/x","nested":{"file_path":"deep"}}', parsedArguments: { path: '/x', nested: { file_path: 'deep' } } },
    ]
    const markdown = buildExportMarkdown({
      sessionId: 's', workDir: undefined, items, exportedAt: new Date('2026-08-21T00:00:00.000Z'),
    })
    expect(markdown).toContain('#### Tool Call: read (`/x`)')
    // The whitelist scans only the top level: nested file_path does not win
    // over the first short string.
    expect(markdown).toContain('#### Tool Call: read (`/x`)')
  })

  it('renders the remaining per-turn variants: second user, empty user text, named images, pluralization arms, codeless errors, over-long hints', () => {
    const items: TranscriptItem[] = [
      // Empty user text skips the body but still opens the section.
      { kind: 'user', seq: 1, turn: 0, text: '', images: [] },
      // A second user item reuses the opened header; a named image keeps
      // its name in the placeholder.
      {
        kind: 'user', seq: 2, turn: 0, text: 'second user',
        images: [{ attachmentId: 'a' as never, mediaType: 'image/png', bytes: 4, width: 1, height: 1, name: 'shot.png' }],
      },
      // An error without a machine code drops the parenthetical.
      { kind: 'error', seq: 3, turn: 0, message: 'no code' },
      // Singular tool count and no thinking section.
      { kind: 'step-summary', seq: 4, turn: 0, step: 0, toolNames: ['read'], thinking: 0 },
      // Plural thinking blocks (the two-or-more arm).
      { kind: 'step-summary', seq: 5, turn: 1, step: 0, toolNames: ['read'], thinking: 2 },
      // Only over-long arguments: the hint falls through both lists.
      { kind: 'tool', seq: 6, turn: 0, step: 0, callId: 'c', name: 'x', arguments: '{"long":"zzz"}', parsedArguments: { long: 'z'.repeat(100) } },
    ]
    const markdown = buildExportMarkdown({
      sessionId: 's', workDir: undefined, items, exportedAt: new Date('2026-08-21T00:00:00.000Z'),
    })
    expect(markdown).toContain('### User')
    expect(markdown).toContain('second user')
    expect(markdown).toContain('[image shot.png]')
    expect(markdown).toContain('> ✗ request failed: no code')
    expect(markdown).toContain('#### (folded step · 1 tool call)')
    expect(markdown).toContain('#### (folded step · 1 tool call · 2 thinking blocks)')
    // The over-long hint leaves the plain tool heading.
    expect(markdown).toContain('#### Tool Call: x')
    expect(markdown).not.toContain('#### Tool Call: x (`')
  })
})

describe('lastAssistantText', () => {
  it('returns the newest non-empty assistant text', () => {
    const items: TranscriptItem[] = [
      { kind: 'user', seq: 1, turn: 0, text: 'q', images: [] },
      { kind: 'assistant', seq: 2, turn: 0, step: 0, text: 'first answer' },
      { kind: 'user', seq: 3, turn: 1, text: 'q2', images: [] },
      { kind: 'assistant', seq: 4, turn: 1, step: 0, text: 'second answer' },
    ]
    expect(lastAssistantText(items)).toBe('second answer')
  })

  it('skips empty assistant items and answers empty when none has text', () => {
    const user = { kind: 'user' as const, seq: 1, turn: 0, text: 'q', images: [] }
    const empty = { kind: 'assistant' as const, seq: 2, turn: 0, step: 0, text: '   ' }
    const kept = { kind: 'assistant' as const, seq: 3, turn: 1, step: 0, text: 'kept' }
    // The newest non-empty reply wins (the empty item sits behind it).
    expect(lastAssistantText([user, empty, kept])).toBe('kept')
    // With only empty replies the scan passes them and answers ''.
    expect(lastAssistantText([user, empty])).toBe('')
    expect(lastAssistantText([])).toBe('')
  })

  it('skips an undefined tail entry when the window hands back nothing', () => {
    const items = [
      undefined,
      { kind: 'assistant', seq: 2, turn: 0, step: 0, text: 'survives' },
    ] as unknown as TranscriptItem[]
    expect(lastAssistantText(items)).toBe('survives')
  })
})

describe('registerExportCommands', () => {
  let notices: string[]
  let copied: string[]

  beforeEach(() => {
    notices = []
    copied = []
    setSharedEditor({
      editor: new FakeBlueEditor(),
      submitPrompt: () => {},
      notice: text => notices.push(text),
    })
    setClipboardTextWriter(async text => {
      copied.push(text)
    })
  })

  afterEach(() => {
    setClipboardTextWriter(undefined)
    clearSharedEditor()
  })

  interface MountOptions {
    /** `false` leaves `blueSession` unprovided; `'null'` provides `current: null`. */
    attach?: boolean | 'null'
    persistence?: FakePersistence | undefined
    cwd?: string
  }

  interface FakePersistence {
    content: string
    supportsRawArtifacts?: boolean
    /** When set, `readRaw` resolves this value instead of the content. */
    rawResult?: { content: string, header: { id: string } } | undefined
    /** When set, `readRaw` throws this value (a non-Error exercises the
     * `describe` fallback). */
    throwRaw?: unknown
  }

  async function mount(options: MountOptions = {}): Promise<{
    ctx: Context
    agent: Agent
    fiber: { dispose(): Promise<void> }
  }> {
    const { ctx } = fakeBlueContext()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(
      SessionId('export-spec'),
      options.cwd === undefined ? {} : { meta: { cwd: options.cwd } },
    )
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    if (options.attach === 'null') {
      ctx.provide('blueSession', { current: null, modelRef: undefined })
    } else if (options.attach !== false) {
      ctx.provide('blueSession', { current: agent, modelRef: { current: { provider: 'mock', model: 'mock' } } })
    }
    const persistence = options.persistence
    if (persistence !== undefined) {
      // `'rawResult' in` distinguishes an explicit `undefined` (the backend
      // has no artifact) from the absent field (build from `content`).
      const raw = 'rawResult' in persistence
        ? persistence.rawResult
        : { content: persistence.content, header: { id: agent.id } }
      const service = {
        supportsRawArtifacts: persistence.supportsRawArtifacts ?? true,
        readRaw: vi.fn(async () => {
          if ('throwRaw' in persistence) throw persistence.throwRaw
          return raw
        }),
      } as unknown as SessionPersistence
      ctx.provide('sessionPersistence', service)
    }
    const fiber = await ctx.plugin(commandsPlugin)
    return { ctx, agent, fiber }
  }

  async function run(ctx: Context, agent: Agent, line: string) {
    const execution = await ctx.commands.execute(agent, line, new AbortController().signal)
    return execution?.result
  }

  it('registers /export and /copy on the runtime and unregisters on dispose', async () => {
    const { ctx, fiber } = await mount({ persistence: { content: singleTurnLog('hi', 'hello') } })
    const names = ctx.commands.list().map(command => command.name)
    expect(names).toContain('export')
    expect(names).toContain('copy')
    await fiber.dispose()
    const after = ctx.commands.list().map(command => command.name)
    expect(after).not.toContain('export')
    expect(after).not.toContain('copy')
  })

  it('exports to an explicit path and notices the item count', async () => {
    const root = mkdtempTracked('blue-export-explicit-')
    const target = join(root, 'out.md')
    const { ctx, agent, fiber } = await mount({ persistence: { content: singleTurnLog('hi', 'hello') } })
    const result = await run(ctx, agent, `/export ${target}`)
    expect(result).toEqual({ kind: 'success' })
    expect(readFileSync(target, 'utf8')).toContain('# Blue Session Export')
    expect(readFileSync(target, 'utf8')).toContain('hello')
    expect(notices.join('\n')).toContain(`exported 2 items to ${target}`)
    await fiber.dispose()
  })

  it('exports to the session cwd under the default blue-export name', async () => {
    const root = mkdtempTracked('blue-export-default-')
    const { ctx, agent, fiber } = await mount({ persistence: { content: singleTurnLog('hi', 'hello') }, cwd: root })
    const result = await run(ctx, agent, '/export')
    expect(result).toEqual({ kind: 'success' })
    const matches = readdirSync(root).filter(name => name.startsWith('blue-export-') && name.endsWith('.md'))
    expect(matches).toHaveLength(1)
    expect(readFileSync(join(root, matches[0]!), 'utf8')).toContain('session_id:')
    await fiber.dispose()
  })

  it('falls back to the process cwd when the session header recorded none', async () => {
    const root = mkdtempTracked('blue-export-nocwd-')
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      const { ctx, agent, fiber } = await mount({ persistence: { content: singleTurnLog('hi', 'hello') } })
      const result = await run(ctx, agent, '/export')
      expect(result).toEqual({ kind: 'success' })
      const matches = readdirSync(root).filter(name => name.startsWith('blue-export-') && name.endsWith('.md'))
      expect(matches).toHaveLength(1)
      await fiber.dispose()
    } finally {
      cwdSpy.mockRestore()
    }
  })

  it('decodes packed chunk rows through the dsh storage decoder', async () => {
    const log = [
      logLine({ type: 'turn/start', seq: 1, time: 1, data: { turn: 0 } }),
      logLine({ type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } }),
      // A packed text-chunks run replaces the individual assistant/chunk lines.
      logLine({
        type: 'text-chunks',
        seq0: 3,
        time0: 3,
        data: { turn: 0, step: 0, index: 0, dt: [1], texts: ['streamed ', 'answer'] },
      }),
      logLine({ type: 'step/end', seq: 5, time: 5, data: { turn: 0, step: 0 } }),
      logLine({ type: 'turn/end', seq: 6, time: 6, data: { turn: 0, reason: { kind: 'completed' } } }),
    ].join('\n')
    const root = mkdtempTracked('blue-export-chunks-')
    const target = join(root, 'out.md')
    const { ctx, agent, fiber } = await mount({ persistence: { content: log } })
    const result = await run(ctx, agent, `/export ${target}`)
    expect(result).toEqual({ kind: 'success' })
    expect(readFileSync(target, 'utf8')).toContain('streamed answer')
    await fiber.dispose()
  })

  it('guards every stop of the read path', async () => {
    // No live session (unprovided and explicitly-null slots).
    const noSession = await mount({ attach: false })
    expect(await run(noSession.ctx, noSession.agent, '/export')).toEqual({ kind: 'error', text: 'no session is live yet' })
    expect(await run(noSession.ctx, noSession.agent, '/copy')).toEqual({ kind: 'error', text: 'no session is live yet' })
    await noSession.fiber.dispose()
    const nullSession = await mount({ attach: 'null' })
    expect(await run(nullSession.ctx, nullSession.agent, '/export')).toEqual({ kind: 'error', text: 'no session is live yet' })
    await nullSession.fiber.dispose()
    // A read failure thrown as a non-Error renders through String() on
    // both commands.
    const stringThrow = await mount({ persistence: { content: singleTurnLog('hi', 'hello'), throwRaw: 'backend exploded' } })
    expect(await run(stringThrow.ctx, stringThrow.agent, '/export'))
      .toEqual({ kind: 'error', text: 'backend exploded' })
    expect(await run(stringThrow.ctx, stringThrow.agent, '/copy'))
      .toEqual({ kind: 'error', text: 'backend exploded' })
    await stringThrow.fiber.dispose()
    // No persistence service.
    const noPersistence = await mount()
    expect(await run(noPersistence.ctx, noPersistence.agent, '/export'))
      .toEqual({ kind: 'error', text: 'session persistence is unavailable' })
    await noPersistence.fiber.dispose()
    // A backend without raw artifacts.
    const noRaw = await mount({ persistence: { content: '', supportsRawArtifacts: false } })
    expect(await run(noRaw.ctx, noRaw.agent, '/export'))
      .toEqual({ kind: 'error', text: 'this session persistence backend does not expose raw artifacts' })
    await noRaw.fiber.dispose()
    // No stored artifact.
    const noArtifact = await mount({ persistence: { content: '', rawResult: undefined } })
    expect(await run(noArtifact.ctx, noArtifact.agent, '/export'))
      .toEqual({ kind: 'error', text: 'the session has no stored artifact yet' })
    await noArtifact.fiber.dispose()
    // An empty artifact folds to nothing.
    const emptyLog = await mount({ persistence: { content: '' } })
    expect(await run(emptyLog.ctx, emptyLog.agent, '/export'))
      .toEqual({ kind: 'error', text: 'nothing to export yet' })
    await emptyLog.fiber.dispose()
    // A corrupt line refuses the export instead of silently dropping it.
    const corrupt = await mount({ persistence: { content: 'not-json\n' } })
    expect(await run(corrupt.ctx, corrupt.agent, '/export'))
      .toEqual({ kind: 'error', text: 'corrupt session log: invalid JSONL line' })
    await corrupt.fiber.dispose()
  })

  it('reports a write failure as an error result', async () => {
    const root = mkdtempTracked('blue-export-writefail-')
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'file in the way')
    const { ctx, agent, fiber } = await mount({ persistence: { content: singleTurnLog('hi', 'hello') } })
    const result = await run(ctx, agent, `/export ${join(blocker, 'out.md')}`)
    expect(result?.kind).toBe('error')
    expect(result?.text).toContain('could not write export:')
    await fiber.dispose()
  })

  it('copies the last assistant message through the clipboard pipeline', async () => {
    const log = [
      logLine({ type: 'turn/start', seq: 1, time: 1, data: { turn: 0 } }),
      logLine({ type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: 'q1' }], source: { kind: 'user' } } }),
      logLine({ type: 'assistant/message', seq: 3, time: 3, data: {
        turn: 0, step: 0,
        message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'first' }], source: { kind: 'model', provider: 'mock', model: 'mock' } },
      } }),
      logLine({ type: 'turn/end', seq: 4, time: 4, data: { turn: 0, reason: { kind: 'completed' } } }),
      logLine({ type: 'turn/start', seq: 5, time: 5, data: { turn: 1 } }),
      logLine({ type: 'user/message', seq: 6, time: 6, data: { content: [{ type: 'text', text: 'q2' }], source: { kind: 'user' } } }),
      logLine({ type: 'assistant/message', seq: 7, time: 7, data: {
        turn: 1, step: 0,
        message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'second' }], source: { kind: 'model', provider: 'mock', model: 'mock' } },
      } }),
      logLine({ type: 'turn/end', seq: 8, time: 8, data: { turn: 1, reason: { kind: 'completed' } } }),
    ].join('\n')
    const { ctx, agent, fiber } = await mount({ persistence: { content: log } })
    const result = await run(ctx, agent, '/copy')
    expect(result).toEqual({ kind: 'success' })
    expect(copied).toEqual(['second'])
    expect(notices.join('\n')).toContain('copied the last assistant message (6 characters)')
    await fiber.dispose()
  })

  it('guards /copy when there is no assistant message or the clipboard fails', async () => {
    const userOnly = await mount({ persistence: { content: logLine({ type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } } }) } })
    expect(await run(userOnly.ctx, userOnly.agent, '/copy'))
      .toEqual({ kind: 'error', text: 'no assistant message to copy' })
    await userOnly.fiber.dispose()

    setClipboardTextWriter(async () => {
      throw new Error('wl-copy missing')
    })
    const failing = await mount({ persistence: { content: singleTurnLog('hi', 'hello') } })
    expect(await run(failing.ctx, failing.agent, '/copy'))
      .toEqual({ kind: 'error', text: 'could not copy to clipboard: wl-copy missing' })
    await failing.fiber.dispose()
    setClipboardTextWriter(undefined)
  })
})
