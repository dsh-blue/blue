/** Tests for the app-owned durable yolo fold. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldYolo } from '../src/mode.ts'

function run(seq: number, name: string, args?: string): SessionEvent {
  return {
    type: 'command/run',
    seq,
    time: seq,
    data: { commandId: `cmd-${String(seq)}`, name, ...(args === undefined ? {} : { args }) },
  } as SessionEvent
}

function other(seq: number): SessionEvent {
  return { type: 'plan/mode', seq, time: seq, data: { active: true } } as unknown as SessionEvent
}

describe('foldYolo', () => {
  it('defaults off and folds bare or arbitrary arguments on', () => {
    expect(foldYolo([])).toBe(false)
    expect(foldYolo([run(0, 'yolo', '')])).toBe(true)
    expect(foldYolo([run(0, 'yolo', ' on')])).toBe(true)
    expect(foldYolo([run(0, 'yolo', ' blah')])).toBe(true)
  })

  it('folds a trimmed off argument off', () => {
    expect(foldYolo([run(0, 'yolo', ' off')])).toBe(false)
    expect(foldYolo([run(0, 'yolo', 'off')])).toBe(false)
    expect(foldYolo([run(0, 'yolo', '  off  ')])).toBe(false)
  })

  it('skips unrecorded args, other commands, and non-command events', () => {
    expect(foldYolo([run(0, 'yolo'), run(1, 'yolo', ' off')])).toBe(false)
    expect(foldYolo([other(0), run(1, 'plan', ''), run(2, 'quit', ' off')])).toBe(false)
    expect(foldYolo([run(0, 'yolo', ' on'), other(1), run(2, 'plan', ' off')])).toBe(true)
  })

  it('lets the last recorded yolo command win', () => {
    expect(foldYolo([run(0, 'yolo', ' on'), run(1, 'yolo', ' off'), run(2, 'yolo', '')])).toBe(true)
    expect(foldYolo([run(0, 'yolo', ''), run(1, 'yolo', ' off')])).toBe(false)
  })
})
