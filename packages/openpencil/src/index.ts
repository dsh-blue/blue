/**
 * Official dsh-tools result adapter for OpenPencil. It projects canonical tool
 * presentation into Blue models while deliberately dropping signed editor
 * capability metadata and all Agent/Session scope objects.
 *
 * @module @dsh-blue/blue-openpencil
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView, ToolDefinition, ToolExecution, ToolExecutionResult, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { NotificationModel, NotificationModelService } from '@dsh-blue/blue-frontend'
import { createToolPresentationModel, type BlueModelToolService } from '@dsh-blue/blue-transcript/tool-model'
// Type-only imports carry the official tools event and Blue service Context merges.
import type {} from '@deepseek-ai/dsh-tools'

/** Canonical public model-facing names from dsh-openpencil. */
export const OPENPENCIL_TOOL_NAMES = Object.freeze([
  'openpencil_render',
  'openpencil_selection',
  'openpencil_new',
  'openpencil_create',
  'openpencil_edit',
] as const)

/** Default number of settled tool models retained by the adapter. */
export const OPENPENCIL_RETENTION = 100

type OpenPencilToolName = typeof OPENPENCIL_TOOL_NAMES[number]
type PresentationDefinition = Pick<ToolDefinition, 'presentCall' | 'presentResult'>

/** Official tool registry/event face consumed by the adapter. */
export interface OpenPencilToolSource {
  get(name: string, scope?: unknown): PresentationDefinition | undefined
  onResult(listener: (execution: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => void): () => void
}

/** Renderer-neutral sinks supplied by the Blue composition. */
export interface OpenPencilSinks {
  readonly tools: Pick<BlueModelToolService, 'register'>
  readonly notifications: Pick<NotificationModelService, 'push'>
}

/** Adapter construction policy. */
export interface OpenPencilAdapterOptions {
  readonly retention?: number
}

function isOpenPencilTool(name: string): name is OpenPencilToolName {
  return (OPENPENCIL_TOOL_NAMES as readonly string[]).includes(name)
}

function safeCall(definition: PresentationDefinition | undefined, args: unknown): ToolCallView | undefined {
  try { return definition?.presentCall?.(args) } catch { return undefined }
}

function safeResult(definition: PresentationDefinition | undefined, args: unknown, result: ToolResult): ToolResultView | undefined {
  try { return definition?.presentResult?.(args, result) } catch { return undefined }
}

function errorMessage(name: string, result: Readonly<ToolExecutionResult>): string {
  const text = result.content.find(block => block.type === 'text')
  return text?.text ?? `${name} failed`
}

/**
 * Bounded official-result observer. The only retained facts are immutable Blue
 * models, call ids, and their registry disposers.
 */
export class OpenPencilAdapter {
  private readonly modelDisposers = new Map<string, () => void>()
  private readonly notificationDisposers = new Map<string, () => void>()
  private readonly retention: number
  private stopSource: (() => void) | undefined
  private disposed = false

  /** Construct an adapter over renderer-neutral sinks. */
  constructor(private readonly sinks: OpenPencilSinks, options: OpenPencilAdapterOptions = {}) {
    this.retention = Math.max(1, Math.floor(options.retention ?? OPENPENCIL_RETENTION))
  }

  /** Subscribe to the official `tools/result` source, replacing any prior source. */
  start(source: OpenPencilToolSource): void {
    if (this.disposed) return
    this.stopSource?.()
    this.stopSource = source.onResult((execution, result) => this.observe(source, execution, result))
  }

  /** Project one official settled result. Duplicate call ids are ignored. */
  observe(source: Pick<OpenPencilToolSource, 'get'>, execution: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    if (this.disposed || !isOpenPencilTool(execution.name)) return
    const id = String(execution.callId)
    if (this.modelDisposers.has(id)) return
    const definition = source.get(execution.name, execution.agent)
    // `meta` is intentionally absent: it may contain a signed editor grant.
    const outcome: ToolResult = { content: result.content, isError: result.isError }
    const call = safeCall(definition, execution.arguments)
    const resultView = safeResult(definition, execution.arguments, outcome)
    const model = createToolPresentationModel({
      id,
      name: execution.name,
      ...(call === undefined ? {} : { call }),
      ...(resultView === undefined ? {} : { result: resultView }),
      outcome,
    })
    this.modelDisposers.set(id, this.sinks.tools.register(model))
    if (result.isError) {
      const notification: NotificationModel = {
        kind: 'notification',
        id: `openpencil.error.${id}`,
        severity: 'error',
        message: errorMessage(execution.name, result),
        dedupeKey: `openpencil.call.${id}`,
      }
      this.notificationDisposers.set(id, this.sinks.notifications.push(notification))
    }
    this.trim()
  }

  /** Unsubscribe and remove every model and notification owned by this adapter. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopSource?.()
    this.stopSource = undefined
    for (const dispose of this.modelDisposers.values()) dispose()
    for (const dispose of this.notificationDisposers.values()) dispose()
    this.modelDisposers.clear()
    this.notificationDisposers.clear()
  }

  private trim(): void {
    while (this.modelDisposers.size > this.retention) {
      const oldest = this.modelDisposers.keys().next().value as string
      this.modelDisposers.get(oldest)?.()
      this.modelDisposers.delete(oldest)
      this.notificationDisposers.get(oldest)?.()
      this.notificationDisposers.delete(oldest)
    }
  }
}

/** Stable Cordis plugin name. */
export const name = 'blue-openpencil'

/** Official services required before the optional adapter activates. */
export const inject = ['tools', 'blueToolModels', 'blueNotifications']

/** Mount the bounded OpenPencil observer on the current plugin Fiber. */
export function apply(ctx: Context): void {
  const source: OpenPencilToolSource = {
    get: (toolName, scope) => ctx.tools.get(toolName, scope as never),
    onResult: listener => ctx.on('tools/result', (execution, result) => { listener(execution, result); return undefined }),
  }
  const adapter = new OpenPencilAdapter({ tools: ctx.blueToolModels, notifications: ctx.blueNotifications })
  ctx.effect(() => { adapter.start(source); return () => adapter.dispose() })
}
