import type { Context } from '@deepseek-ai/cordis'
import { ActionCoordinator, SessionBridge } from '@dsh-blue/blue-harness-adapter'
import { CurrentSessionBinding } from './binding.ts'
import { ProjectionRegistry } from './registry.ts'

type Plugin = { readonly name: string; apply(ctx: Context): void }
function provide<T extends { dispose(): void }>(name: string, value: T): Plugin { return { name, apply(ctx) { ctx.provide(name, value); ctx.effect(() => () => value.dispose()) } } }
export function sessionRuntimePlugin(session = new SessionBridge(), actions = new ActionCoordinator()): Plugin { return provide('blueSessionBinding', new CurrentSessionBinding(session, actions)) }
export function projectionRegistryPlugin(registry = new ProjectionRegistry()): Plugin { return provide('blueProjectionRegistry', registry) }
export const name = 'blue-remote-runtime'
export const inject: readonly string[] = []
export function apply(ctx: Context): void { projectionRegistryPlugin().apply(ctx); sessionRuntimePlugin().apply(ctx) }
