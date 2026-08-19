/**
 * The streaming-phase tracker — the fold's streaming stage as a standalone
 * pure machine over `SessionEvent`s. The transcript fold owns the *items*;
 * this module owns the *phase* the activity pane renders: which broad thing
 * the attached agent is doing right now. Both consume the same filtered
 * event stream (the attached session's events, in seq order), so the phase
 * never drifts from what the fold mounts — the kimi `resolveActivityPaneMode`
 * shape, minus its dialog state (Blue's dialog hangup arrives as the
 * `'blue/editor-slot-swapped'` event and stays the pane's own fact).
 *
 * The mapping mirrors kimi's controller transitions: turn/step begins and
 * tool results park the pane in `waiting`, reasoning deltas in `thinking`
 * (the pane empties — the spinner belongs to the thinking block itself),
 * text deltas in `composing`, tool activity in `tool`, and `turn/end`
 * settles `idle` (the pane's placeholder row; the running agent may drain a
 * moment longer). Whitespace-only reasoning keeps the current phase until
 * visible thinking text exists — an empty reasoning stream must not blank
 * the pane while no thinking component ever mounts (the kimi
 * `handleThinkingDelta` guard). Harness rc.7 has no step-retry session
 * event, so kimi's retry-detail surface is cropped: retries simply look
 * like `waiting`.
 *
 * @module @dsh-blue/blue-transcript/phase
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** What the attached agent is doing; consumed by the activity pane. */
export type StreamingPhase = 'waiting' | 'thinking' | 'composing' | 'tool' | 'idle'

/**
 * Pure phase tracker over one session's event stream. Events must arrive in
 * ascending seq order (the same discipline as `TranscriptFolder`).
 */
export class StreamingPhaseTracker {
  private phase: StreamingPhase = 'waiting'
  /** Reasoning accumulated for the streaming step before any of it is visible. */
  private pendingReasoning = ''

  /**
   * @returns the current phase (a fresh tracker reads `waiting` — an
   *   attached running agent shows the moon until its first event lands).
   */
  get current(): StreamingPhase {
    return this.phase
  }

  /**
   * Fold one event into the phase.
   * @param event - the next session event, in ascending seq order.
   * @returns the new phase when this event changed it, else `null`.
   */
  apply(event: SessionEvent): StreamingPhase | null {
    const next = this.resolve(event)
    if (next === null || next === this.phase) return null
    this.phase = next
    // The whitespace buffer only gates the waiting→thinking transition; once
    // the phase moves anywhere else, the next step's reasoning starts fresh.
    if (next !== 'thinking') this.pendingReasoning = ''
    return next
  }

  /** The phase this event implies, or null to keep the current one. */
  private resolve(event: SessionEvent): StreamingPhase | null {
    switch (event.type) {
      case 'turn/start':
      case 'step/start':
      case 'user/message':
      case 'tool/result':
        return 'waiting'
      case 'turn/end':
        return 'idle'
      case 'tool/call':
        return 'tool'
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if (chunk.type === 'tool-call-delta') return 'tool'
        if (chunk.type === 'reasoning-delta') {
          // A reasoning delta whose accumulated text is still invisible
          // (encrypted/whitespace reasoning) keeps the moon up: flipping to
          // `thinking` here would blank the pane while no thinking block
          // with visible content ever mounts.
          if (this.phase !== 'thinking') {
            this.pendingReasoning += chunk.text
            if (this.pendingReasoning.trim() === '') return null
          }
          return 'thinking'
        }
        if (chunk.type === 'text-delta') return 'composing'
        return null
      }
      default:
        // assistant/message keeps the residual generation phase until the
        // next event decides (kimi: no transition on message completion);
        // request/*, todo/write, session/*, and merge-extended types are
        // phase-less.
        return null
    }
  }
}
