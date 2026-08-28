/**
 * Renderer-neutral command projection and the sole structured-action consumer
 * for the official Harness command runtime.
 *
 * @module @dsh-blue/blue-interaction/command-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Action, CommandModel } from '@dsh-blue/blue-frontend'
import type { BlueSessionCommand, BlueSessionCommandExecution } from '@dsh-blue/blue-app'
import type {} from '@dsh-blue/blue-app'
import { interactionTranslator } from './locale.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { blueCommandModels: CommandModelService }
}

/** Renderer-neutral projection of the Harness command registry. */
export class CommandModelService extends Service {
  private readonly listeners = new Set<() => void>()
  private readonly offChange: () => void
  private readonly context: Context
  private readonly active = new Set<AbortController>()
  private disposed = false
  private readonly offLocale: () => void
  constructor(ctx: Context) {
    super(ctx, 'blueCommandModels')
    this.context = ctx
    const registration = ctx.get('blueSessionReader')?.subscribe(() => {
      for (const listener of this.listeners) listener()
    })
    this.offChange = () => registration?.dispose()
    ctx.effect(() => this.offChange)
    let initialized = false
    this.offLocale = ctx.get('blueLocale')?.subscribe(() => {
      if (!initialized) { initialized = true; return }
      for (const listener of this.listeners) listener()
    }) ?? (() => {})
    ctx.effect(() => this.offLocale)
  }
  list(): readonly CommandModel[] {
    if (this.disposed) return []
    const t = interactionTranslator(this.context)
    return this.context.get('blueSessionActions')?.commands().map(command => toModel(command, t)) ?? []
  }
  async execute(action: Action | undefined, signal: AbortSignal = new AbortController().signal): Promise<BlueSessionCommandExecution | undefined> {
    if (this.disposed || action?.kind !== 'command.execute') return undefined
    const name = action.name
    const input = action.input
    if (typeof name !== 'string' || (input !== undefined && typeof input !== 'string')) return undefined
    const actions = this.context.get('blueSessionActions')
    if (actions === undefined) return undefined
    const controller = new AbortController()
    const forward = (): void => controller.abort(signal.reason)
    signal.addEventListener('abort', forward, { once: true })
    if (signal.aborted) forward()
    this.active.add(controller)
    const separator = input === undefined || input === '' || /^\s/u.test(input) ? '' : ' '
    try {
      const execution = await actions.executeCommand(`/${name}${separator}${input ?? ''}`, controller.signal)
      return this.disposed ? undefined : execution
    } finally {
      signal.removeEventListener('abort', forward)
      this.active.delete(controller)
    }
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  dispose(): void { if (this.disposed) return; this.disposed = true; for (const controller of this.active) controller.abort(); this.active.clear(); this.listeners.clear(); this.offChange(); this.offLocale() }
}

function toModel(command: BlueSessionCommand, t: (key: string) => string): CommandModel {
  return Object.freeze({
    kind: 'command',
    id: `command.${command.name}`,
    label: `/${command.name}`,
    ...(command.description === undefined ? {} : { description: t(command.description) }),
    enabled: true,
    action: { kind: 'command.execute', name: command.name },
  })
}
