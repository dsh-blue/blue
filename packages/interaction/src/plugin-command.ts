/**
 * User-facing `/plugin` command family. Read operations use the official
 * marketplace registry; installation is delegated to the profile owner and
 * takes effect after a restart, so the live Cordis tree is never replaced.
 *
 * @module @dsh-blue/blue-interaction/plugin-command
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

const run = promisify(execFile)
const REGISTRY_URL = 'https://raw.githubusercontent.com/dsh-blue/marketplace/master/registry.json'

interface Entry { readonly id?: string, readonly package?: string, readonly version?: string, readonly title?: { readonly zh?: string, readonly en?: string }, readonly capabilities?: readonly string[], readonly verified?: boolean }

async function entries(): Promise<readonly Entry[]> {
  const response = await fetch(process.env.BLUE_MARKETPLACE_REGISTRY ?? REGISTRY_URL)
  if (!response.ok) throw new Error(`marketplace registry returned HTTP ${response.status}`)
  const value = await response.json() as { plugins?: readonly Entry[] }
  return value.plugins ?? []
}

function profile(): string {
  const args = process.argv
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg?.startsWith('--profile=')) return arg.slice('--profile='.length)
    if (arg === '--profile' && args[i + 1] !== undefined) return args[i + 1]!
  }
  return 'blue'
}

/** Register `/plugin` and its read/install operations. */
export function registerPluginCommand(ctx: Context): () => void {
  const dispose = ctx.commands.register({
    name: 'plugin',
    description: 'Search, inspect, verify, and install Blue plugins',
    input: { hint: '<list|search|info|verify|install> [id|spec]' },
    handler: async invocation => {
      const [action = 'list', ...rest] = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
      try {
        if (action === 'list' || action === 'search' || action === 'info') {
          const all = await entries()
          if (action === 'list') return { kind: 'success', text: all.map(entry => `${entry.id ?? ''}@${entry.version ?? ''}`).join('\n') || 'marketplace is empty' } satisfies CommandResult
          if (action === 'search') {
            const query = rest.join(' ').toLowerCase()
            const found = all.filter(entry => JSON.stringify(entry).toLowerCase().includes(query))
            return { kind: 'success', text: found.map(entry => `${entry.id ?? ''} — ${entry.title?.en ?? entry.title?.zh ?? ''}`).join('\n') || 'no matching plugins' } satisfies CommandResult
          }
          const entry = all.find(value => value.id === rest[0] || value.package === rest[0])
          return entry === undefined
            ? { kind: 'error', text: `plugin not found: ${rest[0] ?? ''}` }
            : { kind: 'success', text: JSON.stringify(entry) } satisfies CommandResult
        }
        if (action === 'verify') return { kind: 'success', text: `verification requested for ${rest[0] ?? ''}; use blue-plugin-validate and the packed fixture before enabling` } satisfies CommandResult
        if (action === 'install') {
          const spec = rest[0]
          if (spec === undefined) return { kind: 'error', text: 'usage: /plugin install <marketplace id, npm spec, or pinned GitHub commit>' }
          if (/github\.com\//u.test(spec) && !/@[0-9a-f]{7,40}$/iu.test(spec) && !/^github:[^/]+\/[^@]+@[0-9a-f]{7,40}$/iu.test(spec)) return { kind: 'error', text: 'GitHub plugins must be pinned to a commit (append @<sha>)' }
          const result = await run('dsh', ['plugin', '--profile', profile(), 'add', spec], { encoding: 'utf8', timeout: 120000 })
          const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
          return { kind: 'success', text: `${output}\ninstalled; restart Blue to apply` } satisfies CommandResult
        }
        return { kind: 'error', text: `unknown plugin action: ${action}` } satisfies CommandResult
      } catch (error) {
        return { kind: 'error', text: `plugin operation failed: ${error instanceof Error ? error.message : String(error)}` } satisfies CommandResult
      }
    },
  })
  ctx.effect(() => dispose)
  return dispose
}
