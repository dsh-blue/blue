/**
 * `@`-mention completion support for `blue-editor-plus` — the Blue half of
 * the kimi `FileMentionProvider` composition. The fd-backed pipeline itself
 * comes from L0 (`blueComponents.createFileMentionProvider`, the renderer's
 * combined provider with its scoped queries, substring scoring, and quoted
 * values); this module owns everything around it: the mention-token
 * extraction that gates the `@` branch (the kimi `extractAtPrefix` port),
 * the PATH probe for the `fd` binary (Blue never downloads binaries, unlike
 * kimi's managed-CDN fallback), and the filesystem fallback that keeps `@`
 * completion alive while fd is missing or unspawnable — directories and
 * hidden entries included, `.git` skipped (kimi) plus `node_modules`
 * (Blue's keep: without gitignore awareness a bare JS tree floods the scan
 * cap), capped at 2000 scanned entries and 50 suggestions.
 *
 * @module @dsh-blue/blue-interaction/file-mention
 */

import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import type { BlueAutocompleteItem, BlueAutocompleteSuggestions } from '@dsh-blue/blue-core'

/** Token boundary characters for mention extraction (the kimi set). */
const PATH_DELIMITERS = new Set([' ', '\t', '"', "'", '='])
/** Hard cap on fallback-scan entries, directories included (kimi parity). */
export const MAX_FALLBACK_SCAN = 2000
/** Cap on fallback suggestions returned per query (kimi parity). */
export const MAX_FALLBACK_SUGGESTIONS = 50
/** Directory names the fallback scan never yields nor descends into. */
const FALLBACK_SKIP_DIRS = new Set(['.git', 'node_modules'])

/**
 * The token before the cursor when it is an `@` mention: scan back to the
 * nearest path delimiter; the token from there must start with `@` (the
 * kimi `extractAtPrefix` port, verbatim). Quoted mentions degrade after
 * the first enclosed space — the token restarts at the space, the same
 * corner kimi's app-level extraction has.
 * @param text - the text before the cursor on the cursor's line.
 * @returns the mention token with its `@`, or `null` outside a mention.
 */
export function extractAtPrefix(text: string): string | null {
  let start = 0
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (PATH_DELIMITERS.has(text.charAt(i))) {
      start = i + 1
      break
    }
  }
  if (text.charAt(start) !== '@') return null
  return text.slice(start)
}

/**
 * Probes the PATH for a usable `fd` binary; tests replace this.
 * @returns the resolved binary name, or `null` when none spawns.
 */
export type FdProbe = () => Promise<string | null>

/** Probe one binary by asking for its version. */
function probeBinary(binary: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile(binary, ['--version'], { timeout: 2000 }, error => {
      resolve(error === null)
    })
  })
}

/** The default probe: `fd`, then Debian's `fdfind` alias. */
const defaultFdProbe: FdProbe = async () => {
  if (await probeBinary('fd')) return 'fd'
  if (await probeBinary('fdfind')) return 'fdfind'
  return null
}

let fdProbe: FdProbe = defaultFdProbe
let fdProbeResult: Promise<string | null> | undefined

/**
 * Replace the `fd` probe (tests inject a fake here); also drops the cached
 * result so the next detection re-runs.
 * @param probe - the replacement, or `undefined` to restore the default.
 */
export function setFdProbe(probe: FdProbe | undefined): void {
  fdProbe = probe ?? defaultFdProbe
  fdProbeResult = undefined
}

/**
 * Detect the `fd` binary once per probe generation; concurrent callers
 * share the in-flight promise.
 * @returns the binary name, or `null` when unavailable.
 */
export function detectFdPath(): Promise<string | null> {
  fdProbeResult ??= fdProbe()
  return fdProbeResult
}

/** One fallback candidate: a project-relative path and its kind. */
interface FsMentionCandidate {
  /** Project-relative path, no trailing separator. */
  readonly path: string
  /** Whether the entry is a directory (symlinks resolved). */
  readonly isDirectory: boolean
}

/**
 * Depth-first scan of the project root (the kimi fallback walk): every
 * entry counts toward the scan cap, skipped directories are neither yielded
 * nor descended, and a symlink pointing at a directory counts as one while
 * never being descended (loop safety).
 * @param root - the project root paths are reported relative to.
 * @param signal - aborts the walk between entries.
 * @returns the candidates, in discovery order.
 */
async function collectFsMentionCandidates(root: string, signal: AbortSignal): Promise<FsMentionCandidate[]> {
  const out: FsMentionCandidate[] = []
  const stack = ['']
  let scanned = 0
  // The abort lands in the loop condition: an aborted signal ends the walk
  // between rounds, and the entry-level check below covers mid-directory.
  while (stack.length > 0 && scanned < MAX_FALLBACK_SCAN && !signal.aborted) {
    /* v8 ignore next -- the loop condition guarantees a non-empty stack; the fallback only satisfies the index-access checker */
    const relativeDir = stack.pop() ?? ''
    const absoluteDir = relativeDir.length === 0 ? root : join(root, relativeDir)
    let entries: Dirent[]
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (signal.aborted || scanned >= MAX_FALLBACK_SCAN) break
      if (FALLBACK_SKIP_DIRS.has(entry.name)) continue
      const path = relativeDir.length === 0 ? entry.name : join(relativeDir, entry.name)
      let isDirectory = entry.isDirectory()
      if (!isDirectory && entry.isSymbolicLink()) {
        try {
          isDirectory = (await stat(join(root, path))).isDirectory()
        } catch {
          // Broken symlink or permission error — stays a file candidate.
        }
      }
      scanned += 1
      out.push({ path, isDirectory })
      if (isDirectory && !entry.isSymbolicLink()) stack.push(path)
    }
  }
  return out
}

/**
 * Score one candidate against the query (the kimi fallback scoring,
 * verbatim): empty queries rank shallow entries first; otherwise basename
 * exact / prefix / substring, then full-path substring, with a directory
 * bonus.
 * @param candidate - the fallback candidate.
 * @param lowerQuery - the lowercased query.
 * @returns the score; 0 means no match.
 */
function scoreCandidate(candidate: FsMentionCandidate, lowerQuery: string): number {
  if (lowerQuery.length === 0) {
    const depthPenalty = candidate.path.split('/').length - 1
    return (candidate.isDirectory ? 120 : 100) - depthPenalty
  }
  const lowerPath = candidate.path.toLowerCase()
  const lowerBase = basename(candidate.path).toLowerCase()
  let score = 0
  if (lowerBase === lowerQuery) score = 100
  else if (lowerBase.startsWith(lowerQuery)) score = 80
  else if (lowerBase.includes(lowerQuery)) score = 50
  else if (lowerPath.includes(lowerQuery)) score = 30
  if (candidate.isDirectory && score > 0) score += 10
  return score
}

/**
 * Rank the candidates: score descending, directories first on ties, then
 * path order (kimi verbatim).
 * @param candidates - the scanned candidates.
 * @param query - the raw mention query (without the `@`).
 * @returns the matching candidates, best first.
 */
function rankFsMentionCandidates(candidates: readonly FsMentionCandidate[], query: string): FsMentionCandidate[] {
  const lowerQuery = query.toLowerCase()
  const scored: Array<{ candidate: FsMentionCandidate, score: number }> = []
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, lowerQuery)
    if (score > 0) scored.push({ candidate, score })
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.candidate.isDirectory !== b.candidate.isDirectory) {
      // Branch-free kind ordering: a directory sorts before a file.
      return Number(b.candidate.isDirectory) - Number(a.candidate.isDirectory)
    }
    return a.candidate.path.localeCompare(b.candidate.path)
  })
  return scored.map(entry => entry.candidate)
}

/**
 * Shape one candidate as a mention item, matching the fd pipeline's item
 * contract: the value carries the `@` (quoted when the path has spaces),
 * directories keep their trailing `/` in value and label so acceptance
 * leaves the cursor for drill-down, and the description is the
 * project-relative path (the fd display form; kimi's fallback shows the
 * absolute path — normalized here so both backends read alike).
 * @param candidate - the ranked candidate.
 * @returns the dropdown item.
 */
function toMentionItem(candidate: FsMentionCandidate): BlueAutocompleteItem {
  const valuePath = candidate.isDirectory ? `${candidate.path}/` : candidate.path
  const value = valuePath.includes(' ') ? `@"${valuePath}"` : `@${valuePath}`
  return {
    value,
    label: `${basename(candidate.path)}${candidate.isDirectory ? '/' : ''}`,
    description: candidate.path,
  }
}

/**
 * The filesystem fallback behind the fd pipeline: scan, rank, cap, and
 * shape. Returns `null` when nothing matches so the dropdown closes.
 * @param cwd - the project root.
 * @param atPrefix - the mention token with its `@` (the returned prefix).
 * @param signal - aborts the walk and yields `null` on abort.
 * @returns the suggestion set, or `null`.
 */
export async function fsMentionSuggestions(
  cwd: string,
  atPrefix: string,
  signal: AbortSignal,
): Promise<BlueAutocompleteSuggestions | null> {
  if (signal.aborted) return null
  const query = atPrefix.slice(1)
  const candidates = await collectFsMentionCandidates(cwd, signal)
  if (candidates.length === 0 || signal.aborted) return null
  const ranked = rankFsMentionCandidates(candidates, query).slice(0, MAX_FALLBACK_SUGGESTIONS)
  if (ranked.length === 0) return null
  return { prefix: atPrefix, items: ranked.map(toMentionItem) }
}
