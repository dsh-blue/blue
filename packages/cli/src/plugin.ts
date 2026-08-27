/**
 * Read-only marketplace commands for the standalone Blue launcher. Mutating
 * installs remain delegated to the profile owner (`dsh plugin`) so a running
 * host is never replaced in-process.
 *
 * @module @dsh-blue/blue-cli/plugin
 */

import { cliInternals } from './internals.ts'

interface MarketplaceEntry {
  readonly id?: unknown
  readonly package?: unknown
  readonly version?: unknown
  readonly title?: { readonly zh?: unknown, readonly en?: unknown }
  readonly tagline?: { readonly zh?: unknown, readonly en?: unknown }
  readonly capabilities?: readonly unknown[]
  readonly verified?: unknown
  readonly repo?: unknown
}

interface Registry {
  readonly plugins?: readonly MarketplaceEntry[]
}

const REGISTRY_URL = 'https://raw.githubusercontent.com/dsh-blue/marketplace/master/registry.json'

function label(value: MarketplaceEntry): string {
  const title = value.title?.en ?? value.title?.zh ?? value.id
  return typeof title === 'string' ? title : String(value.id ?? 'unknown')
}

async function registry(): Promise<Registry> {
  const response = await fetch(cliInternals.env.BLUE_MARKETPLACE_REGISTRY ?? REGISTRY_URL, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`marketplace registry returned HTTP ${response.status}`)
  const value: unknown = await response.json()
  if (value === null || typeof value !== 'object') throw new Error('marketplace registry is not an object')
  return value as Registry
}

/** Execute a read-only plugin command. Returns false when dsh should handle it. */
export async function handlePluginCommand(args: readonly string[]): Promise<boolean> {
  const command = args.find(value => !value.startsWith('-'))
  if (command !== 'list' && command !== 'search' && command !== 'info') return false
  try {
    const entries = (await registry()).plugins ?? []
    if (command === 'list') {
      for (const entry of entries) cliInternals.stdout(`${String(entry.id ?? '')}\t${String(entry.version ?? '')}\t${label(entry)}\n`)
      return true
    }
    if (command === 'search') {
      const query = args.slice(args.indexOf(command) + 1).filter(value => !value.startsWith('-')).join(' ').toLowerCase()
      const matches = entries.filter(entry => JSON.stringify(entry).toLowerCase().includes(query))
      for (const entry of matches) cliInternals.stdout(`${String(entry.id ?? '')}\t${label(entry)}\n`)
      return true
    }
    const id = args[args.indexOf(command) + 1]
    if (id === undefined) throw new Error('usage: blue plugin info <id-or-package>')
    const entry = entries.find(value => value.id === id || value.package === id)
    if (entry === undefined) throw new Error(`plugin not found in official marketplace: ${id}`)
    cliInternals.stdout(JSON.stringify({
      id: entry.id,
      package: entry.package,
      version: entry.version,
      title: label(entry),
      tagline: entry.tagline?.en,
      capabilities: entry.capabilities ?? [],
      verified: entry.verified === true,
      repo: entry.repo,
    }, null, 2) + '\n')
    return true
  } catch (error) {
    cliInternals.stderr(`blue plugin: ${error instanceof Error ? error.message : String(error)}\n`)
    cliInternals.exit(1)
    return true
  }
}
