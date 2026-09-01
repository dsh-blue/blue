/** Safe rewind rows derived directly from a dsh Session event log.
 * @module @dsh-blue/blue-interaction/rewind
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface RewindCandidate {
  readonly turn: number
  readonly boundarySeq: number
  readonly prompt: string
  readonly response?: string
}

interface MessageLike {
  readonly content?: readonly { readonly type?: string, readonly text?: string }[]
  readonly source?: { readonly kind?: string }
}

function preview(message: MessageLike): string {
  return message.content
    ?.filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join(' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim() ?? ''
}

/** Return direct-user turn boundaries in newest-first order. */
export function rewindCandidates(events: readonly SessionEvent[]): readonly RewindCandidate[] {
  const rows: RewindCandidate[] = []
  let turn = 0
  let boundarySeq = 0
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/start') {
      turn = event.data.turn
      boundarySeq = event.seq
    }
    if (event.type !== 'user/message') continue
    const message = event.data as unknown as MessageLike
    if (message.source?.kind !== 'user') continue
    const nextUser = events.slice(index + 1).findIndex(candidate =>
      candidate.type === 'user/message'
      && (candidate.data as unknown as MessageLike).source?.kind === 'user')
    const end = nextUser < 0 ? events.length : index + 1 + nextUser
    const response = events.slice(index + 1, end)
      .filter(candidate => candidate.type === 'assistant/message')
      .map(candidate => preview(candidate.data.message as unknown as MessageLike))
      .find(text => text.length > 0)
    const previous = rows.at(-1)
    if (previous?.boundarySeq === boundarySeq) {
      rows[rows.length - 1] = {
        ...previous,
        prompt: `${previous.prompt} / ${preview(message) || '(empty prompt)'}`,
        ...(response === undefined ? {} : { response }),
      }
      continue
    }
    rows.push({
      turn,
      boundarySeq,
      prompt: preview(message) || '(empty prompt)',
      ...(response === undefined ? {} : { response }),
    })
  }
  return rows.reverse()
}
