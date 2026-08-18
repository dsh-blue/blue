/**
 * Blue application contracts shared with the transcript and interaction
 * layers: the live-session reference service and the session-switch events.
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-blue-app/types
 */

import type { Agent } from '@deepseek-ai/dsh-agent'

/**
 * `ctx.blueSession` — the mutable reference to the Agent the Blue UI
 * currently shows. The app plugin owns this object for the process lifetime
 * and mutates `current` in place; consumers re-read it on every
 * `'blue/session-changed'` event instead of caching the Agent.
 */
export interface BlueSessionRef {
  /** The currently active Agent, or `null` before the first create/resume completes. */
  current: Agent | null
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Blue app's live-session reference; provided by blue-app before it creates or resumes the first Agent. */
    blueSession: BlueSessionRef
  }

  interface Events {
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
     * A UI command (the interaction layer's `/resume`) asked the app to
     * switch to a persisted session. The app resumes it, disposes the
     * previous Agent, and broadcasts `'blue/session-changed'`; a failed
     * resume keeps the current session and reports to stderr instead.
     * Unfiltered: only the app plugin answers this request.
     * @param sessionId - the persisted session id to resume.
     * @mode emit
     */
    'blue/request-resume'(sessionId: string): void
  }
}
