/**
 * Git-backed change collection shared by local verification commands.
 *
 * @module script/change-files
 */

import { execFileSync } from 'node:child_process'
import { normalizeChangedFiles } from './test-impact.mjs'

function git(args, optional = false) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', optional ? 'ignore' : 'inherit'],
    })
  } catch (error) {
    if (optional) return ''
    throw error
  }
}

function paths(args) {
  return git([...args, '-z']).split('\0').filter(Boolean)
}

/** Resolve the comparison branch without requiring a network fetch. */
export function defaultBase() {
  if (git(['rev-parse', '--verify', 'origin/master'], true).trim() !== '') return 'origin/master'
  return 'master'
}

/** Collect committed, staged, unstaged, and untracked paths. */
export function collectChangedFiles(base = defaultBase()) {
  return normalizeChangedFiles([
    ...paths(['diff', '--name-only', '--diff-filter=ACMRD', `${base}...HEAD`]),
    ...paths(['diff', '--name-only', '--diff-filter=ACMRD']),
    ...paths(['diff', '--cached', '--name-only', '--diff-filter=ACMRD']),
    ...paths(['ls-files', '--others', '--exclude-standard']),
  ])
}

/** Collect deleted paths, which cannot receive focused coverage. */
export function collectDeletedFiles(base = defaultBase()) {
  return normalizeChangedFiles([
    ...paths(['diff', '--name-only', '--diff-filter=D', `${base}...HEAD`]),
    ...paths(['diff', '--name-only', '--diff-filter=D']),
    ...paths(['diff', '--cached', '--name-only', '--diff-filter=D']),
  ])
}
