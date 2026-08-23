import type { Context } from '@deepseek-ai/cordis'
import { ContextFeature } from './feature.ts'
export interface ContextPlugin { readonly name: string; apply(ctx: Context): void }
export function contextPlugin(feature = new ContextFeature()): ContextPlugin { return { name: 'blue-context-feature', apply(ctx) { ctx.provide('blueContextFeature', feature); ctx.effect(() => () => feature.dispose()) } } }
export const name = 'blue-context'
export const inject: readonly string[] = []
export function apply(ctx: Context): void { contextPlugin().apply(ctx) }
