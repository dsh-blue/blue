/**
 * Renderer-independent Blue contracts shared by official and third-party
 * effects.
 *
 * @module @dsh-blue/blue-api/contracts
 */

import type { BluePluginManifest } from './manifest.ts'

/** Stable error taxonomy returned by Blue actions. */
export type BlueErrorCode =
  | 'BLUE_API_INCOMPATIBLE'
  | 'BLUE_CAPABILITY_DENIED'
  | 'BLUE_CAPABILITY_ABSENT'
  | 'BLUE_DUPLICATE_ID'
  | 'BLUE_INVALID_CONTRIBUTION'
  | 'BLUE_LIMIT_EXCEEDED'
  | 'BLUE_ABORTED'
  | 'BLUE_SESSION_UNAVAILABLE'
  | 'BLUE_ACTION_REJECTED'

/** A structured action result; plugin errors never cross the public boundary as thrown objects. */
export type BlueResult<Value = void> =
  | { readonly ok: true, readonly value: Value }
  | { readonly ok: false, readonly code: BlueErrorCode, readonly message: string }

/** A registration owned by the caller's Cordis Fiber. */
export interface BlueRegistration {
  readonly disposed: boolean
  dispose(): void
}

/** Shared contribution metadata. */
export interface BlueContributionMeta {
  readonly id: string
  readonly priority?: number
}

/** A stable command contribution exposed to plugins. */
export interface BlueCommandContribution extends BlueContributionMeta {
  readonly label: string
  readonly execute: (args: readonly string[], options?: { readonly signal?: AbortSignal }) => Promise<BlueResult>
}

/** A renderer-neutral status contribution. */
export interface BlueStatusContribution extends BlueContributionMeta {
  readonly render: () => BlueView | null
}

/** A renderer-neutral dock contribution. */
export interface BlueDockContribution extends BlueContributionMeta {
  readonly view: BlueView | (() => BlueView | null)
  readonly priority?: number
  readonly preferredRows?: number
  readonly minRows?: number
  readonly collapsible?: boolean
}

/** A notification emitted by a plugin. */
export interface BlueNotification {
  readonly id: string
  readonly view: BlueView
  readonly tone?: BlueTone
}

/** Registration handle owned by a consumer Fiber. */
export interface BlueRegistry<T> {
  register(contribution: T): BlueResult<BlueRegistration>
  list(): readonly T[]
}

/** Public, capability-scoped façade opened for one Cordis consumer. */
export interface BluePluginApi {
  readonly manifest: BluePluginManifest
  readonly commands?: BlueRegistry<BlueCommandContribution>
  readonly status?: BlueRegistry<BlueStatusContribution>
  readonly dock?: BlueRegistry<BlueDockContribution>
  readonly notifications?: {
    publish(notification: BlueNotification): BlueResult
    subscribe(listener: (notification: BlueNotification) => void): BlueRegistration
  }
}

/** Host service that validates manifests and scopes all registrations. */
export interface BluePluginHost {
  readonly version: string
  open(consumer: { effect(callback: () => void | (() => void)): unknown }, manifest: BluePluginManifest): BlueResult<BluePluginApi>
}

/** Semantic text tone; ANSI and theme functions stay inside core. */
export type BlueTone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'

/** A safe inline text run. */
export interface BlueInlineSpan {
  readonly text: string
  readonly tone?: BlueTone
  readonly emphasis?: 'normal' | 'strong'
}

/** JSON-shaped data accepted by stable panel and command APIs. */
export type BlueJson = null | boolean | number | string | readonly BlueJson[] | {
  readonly [key: string]: BlueJson
}

/** A renderer-independent view. */
export type BlueView =
  | { readonly kind: 'text', readonly content: string, readonly tone?: BlueTone }
  | { readonly kind: 'fields', readonly rows: readonly BlueField[] }
  | { readonly kind: 'code', readonly code: string, readonly language?: string }
  | { readonly kind: 'diff', readonly before: string, readonly after: string }
  | { readonly kind: 'sections', readonly sections: readonly BlueSection[] }

/** A labelled field in a structured view. */
export interface BlueField {
  readonly label: string
  readonly value: readonly BlueInlineSpan[]
}

/** A titled view section. */
export interface BlueSection {
  readonly title?: string
  readonly body: BlueView
  readonly collapsed?: boolean
}

/** A readonly snapshot of the currently attached session. */
export interface BlueSessionSnapshot {
  readonly id: string
  readonly cwd: string
  readonly status: 'idle' | 'running' | 'waiting' | 'failed'
  readonly mode: 'normal' | 'plan' | 'yolo'
  readonly model?: { readonly id: string, readonly provider?: string, readonly effort?: string }
}

/** Actions allowed through the session façade. */
export type BlueSessionAction =
  | { readonly kind: 'followup', readonly text: string }
  | { readonly kind: 'steer', readonly text: string }
  | { readonly kind: 'interrupt' }

/** Read and narrowly act on the current session without exposing Agent/Session. */
export interface BlueSessionReader {
  current(): BlueSessionSnapshot | null
  subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void): BlueRegistration
  request(action: BlueSessionAction, options?: { readonly signal?: AbortSignal }): Promise<BlueResult>
}

/** Request lifecycle shared by transcript and activity projections. */
export type BlueRequestState =
  | 'started'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'interrupted'

/** Stable identity for stale-event rejection. */
export interface BlueRequestRef {
  readonly sessionEpoch: number
  readonly requestEpoch: number
  readonly scope: 'main' | 'btw' | 'subagent'
}

/** A lifecycle transition emitted by the session projection. */
export interface BlueRequestLifecycle {
  readonly ref: BlueRequestRef
  readonly state: BlueRequestState
  readonly reason?: string
}
