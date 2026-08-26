/**
 * App-owned projection of safe rewind points from the active Harness session.
 * Agent and SessionEvent values stay inside blue-app; consumers receive only
 * immutable renderer-neutral candidate rows.
 *
 * @module @dsh-blue/blue-app/rewind
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { BlueRewindCandidate } from './types.ts'

interface MessageLike {
  readonly content?: readonly { readonly type?: string, readonly text?: string }[]
  readonly source?: { readonly kind?: string }
}

/**
 * Collapse message content into a compact text preview.
 * @param message - a user or assistant message value.
 * @returns the visible one-line text, or an empty string.
 */
export function messagePreview(message: MessageLike): string {
  const text = message.content
    ?.filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join(' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
  return text ?? ''
}

/**
 * Project direct-user rewind points in newest-first order.
 * @param events - the active session's immutable event snapshot.
 * @returns renderer-neutral candidate rows.
 */
export function rewindCandidates(events: readonly SessionEvent[]): readonly BlueRewindCandidate[] {
  const candidates: BlueRewindCandidate[] = []
  let turn = 0
  let turnStartSeq = 0
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    /* v8 ignore next -- index is bounded by events.length. */
    if (event === undefined) continue
    if (event.type === 'turn/start') {
      turn = event.data.turn
      turnStartSeq = event.seq
    }
    if (event.type !== 'user/message') continue
    const message = event.data as unknown as MessageLike
    if (message.source?.kind !== 'user') continue
    const nextUser = events.slice(index + 1).findIndex(candidate =>
      candidate.type === 'user/message' &&
      (candidate.data as unknown as MessageLike).source?.kind === 'user')
    const end = nextUser < 0 ? events.length : index + 1 + nextUser
    const response = events.slice(index + 1, end)
      .filter(candidate => candidate.type === 'assistant/message')
      .map(candidate => messagePreview(candidate.data.message as unknown as MessageLike))
      .find(text => text.length > 0)
    const previous = candidates.at(-1)
    if (previous?.boundarySeq === turnStartSeq) {
      candidates[candidates.length - 1] = Object.freeze({
        ...previous,
        prompt: `${previous.prompt} · ${messagePreview(message) || '(empty prompt)'}`,
        ...(response === undefined ? {} : { response }),
      })
      continue
    }
    candidates.push(Object.freeze({
      turn,
      boundarySeq: turnStartSeq,
      prompt: messagePreview(message) || '(empty prompt)',
      ...(response === undefined ? {} : { response }),
      time: event.time,
    }))
  }
  return Object.freeze(candidates.reverse())
}
