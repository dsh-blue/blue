/**
 * Blue application contracts shared with the transcript and interaction
 * layers: readonly session snapshots, projection values, structured actions,
 * and session-switch requests. Types only — no runtime code.
 *
 * @module @dsh-blue/blue-app/types
 */

import type {
  BlueRegistration,
  BlueRequestLifecycle,
  BlueResult,
  BlueSessionReader,
} from '@dsh-blue/blue-api'
/** Renderer-neutral model route selected for the current session. */
export interface BlueSessionModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

/** Renderer-neutral effective mode of the current session. */
export interface BlueSessionModeState {
  readonly mode: 'normal' | 'plan' | 'yolo'
  readonly pending: boolean
}

/** Four disjoint provider-usage buckets projected for session-info views. */
export interface BlueSessionTokenBuckets {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

/** Current context occupancy facts projected for session-info views. */
export interface BlueSessionContextFacts {
  readonly used?: number | undefined
  readonly window?: number | undefined
}

/** Heuristic request composition projected by the official token meter. */
export interface BlueSessionCompositionFacts {
  readonly system: number
  readonly tools: number
  readonly messages: number
}

/** Immutable detail snapshot used by `/status` and `/context`. */
export interface BlueSessionDetails {
  readonly header: {
    readonly id: string
    readonly cwd?: string | undefined
    readonly createdAt: number
  }
  readonly turns: number
  readonly steps: number
  readonly status: string
  readonly model?: BlueSessionModelSelection | undefined
  readonly usage: {
    readonly buckets: BlueSessionTokenBuckets
    readonly context: BlueSessionContextFacts
  }
  readonly composition?: BlueSessionCompositionFacts | undefined
}

/** Renderer-neutral preset row from the optional host roster. */
export interface BlueSessionPreset {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string | undefined
  readonly description?: string | undefined
  readonly order?: number | undefined
  readonly broken?: string | undefined
}

/** Renderer-neutral tool schema visible through the host registry. */
export interface BlueSessionToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters?: Readonly<Record<string, unknown>> | undefined
}

/** Whole tool-catalog observation for the current session and host. */
export interface BlueSessionToolCatalog {
  readonly sessionLive: boolean
  readonly registered: readonly BlueSessionToolSchema[]
  readonly visible: readonly BlueSessionToolSchema[]
}

/** Renderer-neutral skill summary from the current Agent's layered catalog. */
export interface BlueSessionSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string | undefined
  readonly source: string
  readonly invocation: {
    readonly modelInvocable: boolean
    readonly userInvocable: boolean
  }
}

/** Completeness-qualified current-session skill observation. */
export interface BlueSessionSkillSnapshot {
  readonly complete: boolean
  readonly skills: readonly BlueSessionSkill[]
}

/**
 * Opaque renderer-origin prompt block admitted by the app action boundary.
 * blue-app validates it by constructing the official user-message value;
 * consumers cannot inspect a Harness message through this type.
 */
export type BluePromptBlock = unknown

/** Receipt for one prompt accepted by the current Agent. */
export interface BluePromptReceipt {
  readonly messageId: string
}

/** Renderer-neutral queued-message row owned by the app session boundary. */
export interface BlueQueuedMessage {
  readonly id: string
  readonly target: 'turn' | 'step'
  readonly text: string
}

/** Renderer-neutral branch point projected from one direct user turn. */
export interface BlueRewindCandidate {
  readonly turn: number
  readonly boundarySeq: number
  readonly prompt: string
  readonly response?: string | undefined
  readonly time: number
}

/** One immutable value from the official current-session projection registry. */
export interface BlueSessionProjectionSnapshot {
  readonly sessionEpoch: number
  readonly asOfSeq: number
  readonly value: unknown
}

/** One direct child session's immutable official projection value. */
export interface BlueChildSessionProjectionSnapshot {
  readonly id: string
  readonly asOfSeq: number
  readonly value: unknown
}

/** The presenter hooks a resolved tool definition may carry (host face, structural). */
export interface BlueToolPresenterHost {
  readonly presentCall?: (args: unknown) => unknown
  readonly presentResult?: (args: unknown, result: unknown) => unknown
}

/**
 * Presenter-view resolution for the tool cards of the session being rendered.
 * Harness tool registrations are agent-scoped — the plain global view misses
 * the builtins — so the app, the tree's only Agent owner, binds the active
 * Agent as the viewing scope at the session commit point. The host object
 * never crosses this seam; consumers see only presenter hooks.
 */
export interface BlueToolPresentationSource {
  /** Bind the viewing scope (the active Agent); `undefined` restores the global view. */
  bind(scope: object | undefined): void
  /** The presenter-bearing definition the scope resolves, or `undefined` when none is visible. */
  get(name: string): BlueToolPresenterHost | undefined
}

/**
 * Current-session projection reader. It keeps the Harness Session private to
 * blue-app and publishes only immutable projection values and sequence facts.
 */
export interface BlueSessionProjectionReader {
  current(key: string): BlueSessionProjectionSnapshot | undefined
  /** Read several current-session projection values from one consistent cut. */
  currentMany(keys: readonly string[]): { readonly sessionEpoch: number, readonly asOfSeq: number, readonly values: Readonly<Record<string, unknown>> } | undefined
  subscribe(listener: (key: string, value: unknown, seq: number, sessionEpoch: number) => void): () => void
  /** Snapshot one projection key across direct subagent children of the active session. */
  children(key: string): readonly BlueChildSessionProjectionSnapshot[]
  /** Subscribe to projection changes from direct subagent children of the active session. */
  subscribeChildren(listener: (child: BlueChildSessionProjectionSnapshot & { readonly key: string }) => void): () => void
}

/** Renderer-neutral command descriptor projected for discovery surfaces. */
export interface BlueSessionCommand {
  readonly name: string
  readonly description?: string | undefined
  readonly inputHint?: string | undefined
}

/** Command outcome admitted across the app action boundary. */
export interface BlueSessionCommandExecution {
  readonly result: {
    readonly kind: 'success' | 'error'
    readonly text?: string | undefined
  }
}

/** Agent status values admitted across the side-session action boundary. */
export type BlueSideSessionStatus = 'running' | 'idle'

/**
 * App-owned handle for one throwaway side session. The Harness Agent and
 * Session stay private to blue-app; projection consumers receive only an
 * opaque identity suitable for the official session-projection service.
 */
export interface BlueSideSession {
  /** Opaque identity accepted by the official session-projection service. */
  readonly projectionSession: unknown
  /** Post one plain human follow-up to the side session. */
  followup(text: string): void
  /** Subscribe to the side Agent's admitted running/idle status changes. */
  subscribeStatus(listener: (status: BlueSideSessionStatus) => void): () => void
  /** Release subscriptions and dispose the owned side Agent. */
  dispose(): Promise<void>
}

/** Narrow app action surface for renderer-neutral side-session workflows. */
export interface BlueSessionActions {
  /** Submit structured prompt content as an ordinary follow-up. */
  followup(blocks: readonly BluePromptBlock[]): BlueResult<BluePromptReceipt>
  /** Submit structured prompt content at the next step boundary. */
  steer(blocks: readonly BluePromptBlock[]): BlueResult<BluePromptReceipt>
  /** Interrupt the current request and any running continuable descendants. */
  interrupt(): BlueResult
  /** Project the current Agent's pending inbox without exposing it. */
  queued(): readonly BlueQueuedMessage[]
  /** Flush the current session through the host persistence coordinator. */
  flush(): Promise<BlueResult>
  /** Project safe branch points from the current session, newest first. */
  rewindCandidates(): readonly BlueRewindCandidate[]
  /** Project commands available to the current Agent. */
  commands(): readonly BlueSessionCommand[]
  /** Execute one canonical command line for the current Agent. */
  executeCommand(line: string, signal?: AbortSignal): Promise<BlueSessionCommandExecution | undefined>
  /** Read the effective plan/yolo mode without exposing its Agent-keyed controllers. */
  modeState(): BlueSessionModeState | undefined
  /** Whether the host composed the upstream plan-mode controller. */
  planModeAvailable(): boolean
  /** Apply the Blue yolo stance to the current session. */
  setYolo(active: boolean): BlueResult
  /** Read the effective permission preset for the current session. */
  permissionPreset(): string | undefined
  /** Read one immutable status/context snapshot for the current session. */
  sessionDetails(): BlueSessionDetails | undefined
  /** Read the current model selection without exposing its mutable ref. */
  modelSelection(): BlueSessionModelSelection | undefined
  /** Whether the current session has assembled at least one request header. */
  hasRequestHeader(): boolean
  /** Commit a model selection for the next request and return the replaced value. */
  selectModel(selection: BlueSessionModelSelection): BlueResult<BlueSessionModelSelection>
  /** Whether an opaque Harness request owner is the current Agent. */
  isCurrentAgent(candidate: unknown): boolean
  /** Steer feedback only when the opaque request owner is still current. */
  steerCurrentAgent(candidate: unknown, text: string): BlueResult
  /** List the optional host preset roster. */
  presets(): Promise<BlueResult<readonly BlueSessionPreset[]>>
  /** Read the preset currently composed for the active Agent. */
  currentPreset(): string | undefined
  /** Recompose a blank idle session onto one preset and log the selection. */
  selectPreset(id: string): Promise<BlueResult<string>>
  /** Read global and session-visible tool schemas without exposing Agent scope. */
  toolCatalog(): Promise<BlueResult<BlueSessionToolCatalog>>
  /** Snapshot the current Agent's layered skill catalog. */
  skillSnapshot(): Promise<BlueResult<BlueSessionSkillSnapshot>>
  /** Subscribe to host skill-registry invalidations without exposing its service. */
  subscribeSkillChanges(listener: () => void): BlueRegistration
  /**
   * Fork the active session into an uncommitted throwaway side session.
   * @returns an owned handle, or `undefined` when no active session exists.
   */
  createSideSession(): Promise<BlueSideSession | undefined>
}

/** Identity of one live turn removed from Blue's visible conversation. */
export interface BlueTurnRetraction {
  readonly sessionEpoch: number
  readonly requestEpoch: number
  readonly turn: number
}

/** App-owned gate for retracting the currently running human message. */
export interface BlueRetractionService {
  /**
   * Retract the open main turn containing `messageId` when no tool activity
   * has begun.
   * @param messageId - stable id of the submitted human message.
   * @returns whether retraction committed; false means the caller should use ordinary interruption.
   */
  tryRetract(messageId: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Safe main-turn retraction gate provided by blue-app. */
    blueRetractions: BlueRetractionService
    /** App-owned side-session actions; no Harness Agent or Session crosses this seam. */
    blueSessionActions: BlueSessionActions
    /** Stable renderer-neutral snapshot surface for the active session. */
    blueSessionReader: BlueSessionReader
    /** Official projection values for the active session, with no Session handle. */
    blueSessionProjections: BlueSessionProjectionReader
    /** Presenter-view resolution for the session being rendered (scope bound by blue-app). */
    blueToolPresentations: BlueToolPresentationSource
  }

  interface Events {
    /** The current Agent's pending inbox changed; emitted after the mutation. */
    'blue/queue-changed'(): void
    /** A request lifecycle transition shared by transcript and activity projections. */
    'blue/request-state-changed'(lifecycle: BlueRequestLifecycle): void
    /** A frame/session operation was committed and stale event guards may advance. */
    'blue/session-epoch-changed'(sessionEpoch: number): void
    /** A safe retraction committed; transcript consumers remove this turn immediately. */
    'blue/turn-retracted'(retraction: BlueTurnRetraction): void
    /** App-owned mode reconciliation produced a user-facing command result. */
    'blue/mode-notice'(text: string): void
    /**
     * The live session's model selection changed. Reader consumers re-derive
     * after this signal because the pick routes the next request immediately,
     * before a new `request/header` projection exists.
     * @mode emit
     */
    'blue/model-changed'(): void
    /**
     * A UI command (the interaction layer's `/resume`) asked the app to
     * switch to a persisted session. The app resumes it, disposes the
     * previous Agent, and publishes the next reader snapshot; a failed resume
     * keeps the current session and reports to stderr instead.
     * Unfiltered: only the app plugin answers this request.
     * @param sessionId - the persisted session id to resume.
     * @mode emit
     */
    'blue/request-resume'(sessionId: string): void
    /**
     * A UI command asked the app to start a fresh session. The app creates
     * a new Agent with the same parameters as startup creation, disposes the
     * previous Agent, and publishes the next reader snapshot; a failed
     * creation keeps the current session and reports to stderr instead.
     * With no live session the app simply creates one.
     * Unfiltered: only the app plugin answers this request.
     * @mode emit
     */
    'blue/request-new'(): void
    /**
     * A UI command asked the app to fork the current session: create a new
     * Agent seeded with the full event prefix of the active session, then
     * dispose the previous Agent and publish the next reader snapshot.
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
