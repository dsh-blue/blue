/**
 * Blue application contracts shared with the transcript and interaction
 * layers: the live-session reference service and the session-switch events.
 * Types only — no runtime code.
 *
 * @module @dsh-blue/blue-app/types
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueRequestLifecycle } from '@dsh-blue/blue-api'
import type { BlueModelSelectionRef } from './model-ref.ts'

/**
 * `ctx.blueSession` — the mutable reference to the Agent the Blue UI
 * currently shows. The app plugin owns this object for the process lifetime
 * and mutates `current`/`modelRef` in place; consumers re-read them on every
 * `'blue/session-changed'` event instead of caching the Agent.
 */
export interface BlueSessionRef {
  /** The currently active Agent, or `null` before the first create/resume completes. */
  current: Agent | null
  /**
   * The live Agent's model-selection handle, or `undefined` before the first
   * create/resume completes. Published at the same commit point as `current`
   * (never mid-switch); reading `modelRef.current` resolves an in-session
   * pick, then the session log's last request header, then the process
   * default — see `src/model-ref.ts`.
   */
  modelRef: BlueModelSelectionRef | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Blue app's live-session reference; provided by blue-app before it creates or resumes the first Agent. */
    blueSession: BlueSessionRef
  }

  interface Events {
    /** A request lifecycle transition shared by transcript and activity projections. */
    'blue/request-state-changed'(lifecycle: BlueRequestLifecycle): void
    /** A frame/session operation was committed and stale event guards may advance. */
    'blue/session-epoch-changed'(sessionEpoch: number): void
    /**
     * The Blue app's active Agent changed: the initial create/resume
     * completed, or a `'blue/request-resume'` switch committed. Fired only
     * after `blueSession.current` already points at the new Agent.
     * Unfiltered: every Blue UI layer tracks the same single active Agent.
     * @param agent - the newly active Agent.
     * @mode emit
     */
    'blue/session-changed'(agent: Agent): void
    /**
     * The live session's model selection changed: the model-family
     * commands committed a pick into `blueSession.modelRef.current`
     * (a `/model`/`/effort` switch — picker or argument, persisted or
     * session-only). Unfiltered: the footer's model entry and the banner's
     * model line re-derive on it — the pick routes the next request, so
     * they show it immediately instead of waiting for the next logged
     * `request/header` (the S24a dogfood ruling).
     * @mode emit
     */
    'blue/model-changed'(): void
    /**
     * A UI command (the interaction layer's `/resume`) asked the app to
     * switch to a persisted session. The app resumes it, disposes the
     * previous Agent, and broadcasts `'blue/session-changed'`; a failed
     * resume keeps the current session and reports to stderr instead.
     * Unfiltered: only the app plugin answers this request.
     * @param sessionId - the persisted session id to resume.
     * @mode emit
     */
    'blue/request-resume'(sessionId: string): void
    /**
     * A UI command asked the app to start a fresh session. The app creates
     * a new Agent with the same parameters as startup creation, disposes the
     * previous Agent, and broadcasts `'blue/session-changed'`; a failed
     * creation keeps the current session and reports to stderr instead.
     * With no live session the app simply creates one.
     * Unfiltered: only the app plugin answers this request.
     * @mode emit
     */
    'blue/request-new'(): void
    /**
     * A UI command asked the app to fork the current session: create a new
     * Agent seeded with the full event prefix of the active session, then
     * dispose the previous Agent and broadcast `'blue/session-changed'`.
     * The request is refused (stderr, no switch) when no session is live or
     * the active Agent is not `idle`; a failed creation keeps the current
     * session and reports to stderr instead.
     * Unfiltered: only the app plugin answers this request.
     * @mode emit
     */
    'blue/request-fork'(): void
    /**
     * A UI command asked the app to create a child session from a complete
     * event prefix of the active session. The parent remains persisted and
     * the new Agent is committed through the normal session switch path.
     * @param sessionId - the session the UI inspected.
     * @param boundarySeq - number of events to retain in the child seed.
     * @mode emit
     */
    'blue/request-rewind'(sessionId: string, boundarySeq: number): void
  }
}
