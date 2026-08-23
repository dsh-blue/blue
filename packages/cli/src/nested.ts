/**
 * Resolve the nested `@deepseek-ai/dsh` host (D50 decision 4, plan A):
 * the shell pins the host as its own dependency, so the booted line is
 * always the tested one — a global `dsh` on PATH is irrelevant, present
 * or absent. The host manifest names its bin entry; running
 * `node <entry>` sidesteps exec-bit and PATH concerns entirely.
 *
 * @module @dsh-blue/blue-cli/nested
 */

import { dirname, join } from 'node:path'
import { cliInternals } from './internals.ts'

/** What the launcher needs to know about the nested host. */
export interface NestedDsh {
  /** The host CLI entry (a JS file run with `node`), `undefined` when the install is broken. */
  readonly binJs: string | undefined
  /** The host's manifest version, `undefined` when unreadable. */
  readonly version: string | undefined
}

/** A package.json bin field: the string form, or the name → path map. */
type BinField = string | Readonly<Record<string, string>> | undefined

/**
 * Read the nested host's facts through the seams. Every failure shape
 * reads as `undefined` fields — `main` turns each into its one-line
 * bootstrap error.
 */
export function nestedDsh(): NestedDsh {
  const manifestPath = cliInternals.resolveNestedDshManifest()
  if (manifestPath === undefined) return { binJs: undefined, version: undefined }
  const text = cliInternals.readTextFile(manifestPath)
  if (text === undefined) return { binJs: undefined, version: undefined }
  let manifest: { version?: unknown, bin?: BinField }
  try {
    manifest = JSON.parse(text) as { version?: unknown, bin?: BinField }
  } catch {
    return { binJs: undefined, version: undefined }
  }
  const version = typeof manifest.version === 'string' ? manifest.version : undefined
  const entry = binEntry(manifest.bin)
  if (entry === undefined) return { binJs: undefined, version }
  return { binJs: join(dirname(manifestPath), entry), version }
}

/** The `dsh` entry of a bin field, `undefined` when it names none. */
function binEntry(bin: BinField): string | undefined {
  if (typeof bin === 'string') return bin
  if (typeof bin !== 'object' || bin === null) return undefined
  const named = bin.dsh
  if (typeof named === 'string') return named
  const first = Object.values(bin)[0]
  return typeof first === 'string' ? first : undefined
}
