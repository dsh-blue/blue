/**
 * Pure rewind projection: direct user turns become safe, single-level branch
 * points. The projection never mutates a Session and deliberately ignores
 * synthetic user messages injected by skills, instructions, or tools.
 *
 * @module @dsh-blue/blue-interaction/rewind
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** A user-facing rewind candidate for one direct user turn. */
export interface RewindCandidate {
  /** Number of the turn in the session log. */
  readonly turn: number
  /** Event count retained by the child session seed. */
  readonly boundarySeq: number
  /** One-line direct user prompt preview. */
  readonly prompt: string
  /** One-line assistant preview, when the turn produced one. */
  readonly response?: string
  /** Event time used for stable display. */
  readonly time: number
}

interface MessageLike {
  readonly content?: readonly { readonly type?: string, readonly text?: string }[]
  readonly source?: { readonly kind?: string }
}

/**
 * Collapse a message content block into a compact text preview.
 * @param message - a dsh user or assistant message.
 * @returns the first textual content, or an empty string.
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
 * Find direct-user rewind points in event order, newest first. A point is the
 * event boundary immediately before that user message, so the selected turn
 * and all later work are left out of the child branch.
 * @param events - the immutable session event snapshot.
 * @returns rewind candidates ordered from newest to oldest.
 */
export function rewindCandidates(events: readonly SessionEvent[]): readonly RewindCandidate[] {
  const candidates: RewindCandidate[] = []
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
      candidates[candidates.length - 1] = {
        ...previous,
        prompt: `${previous.prompt} · ${messagePreview(message) || '(empty prompt)'}`,
        ...(response === undefined ? {} : { response }),
      }
      continue
    }
    candidates.push({
      turn,
      boundarySeq: turnStartSeq,
      prompt: messagePreview(message) || '(empty prompt)',
      ...(response === undefined ? {} : { response }),
      time: event.time,
    })
  }
  return candidates.reverse()
}
