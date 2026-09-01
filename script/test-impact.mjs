/**
 * Pure change classification for the repository's local verification loop.
 * Unknown or cross-cutting inputs deliberately widen to the full gate.
 *
 * @module script/test-impact
 */

import { posix } from 'node:path'

const CODE_PATTERN = /\.(?:[cm]?ts|tsx)$/u
const EXECUTABLE_SOURCE_PATTERN = /^(?:packages(?:\/bundle)?|examples)\/[^/]+\/src\/(?!types\.ts$).+\.ts$/u
const GLOBAL_PATHS = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
  'tsdown.config.ts',
  'vitest.config.ts',
  'script/package-contract.mjs',
])
const RENDERER_PACKAGES = new Set(['packages/core', 'packages/interaction', 'packages/transcript', 'examples/blue-user-kit'])
const LIFECYCLE_WORDS = /(?:adapter|action|bridge|host|provider|projection|runtime|service|session)/u

/** Normalize and de-duplicate repository-relative paths. */
export function normalizeChangedFiles(files) {
  return [...new Set(files
    .map(file => posix.normalize(String(file).replaceAll('\\', '/')).replace(/^\.\//u, ''))
    .filter(file => file !== '' && file !== '.'))].sort()
}

/** Return the workspace package directory owning a path, when any. */
export function owningPackage(file) {
  const parts = normalizeChangedFiles([file])[0]?.split('/') ?? []
  if (parts[0] === 'packages' && parts[1] === 'bundle' && parts[2] !== undefined) return parts.slice(0, 3).join('/')
  if ((parts[0] === 'packages' || parts[0] === 'examples') && parts[1] !== undefined) return parts.slice(0, 2).join('/')
  return undefined
}

/** Whether a path changes the package/build graph rather than one implementation. */
export function isStructuralBuildPath(file) {
  return GLOBAL_PATHS.has(file)
    || /^(?:packages\/[^/]+|packages\/bundle\/[^/]+|examples\/[^/]+)\/(?:package\.json|tsconfig\.json|blue\.plugin\.json)$/u.test(file)
    || file === 'script/clean-lib.mjs'
    || file === 'script/prune-types.mjs'
}

/** Expand a plan to the repository's complete deterministic gate. */
export function promoteToFull(plan, reason) {
  return {
    ...plan,
    mode: 'full',
    reasons: [...new Set([...plan.reasons, reason])],
    checks: {
      lint: true,
      typecheck: true,
      build: true,
      checkLib: true,
      agentDocs: true,
      diagrams: true,
      website: plan.checks.website,
      authorDocs: true,
      repoWorkflowTests: true,
    },
  }
}

/** Build a fail-closed local verification plan for a concrete file set. */
export function classifyChanges(inputFiles) {
  const files = normalizeChangedFiles(inputFiles)
  const reasons = []
  const related = new Set()
  const coverage = new Set()
  const packageTests = new Set()
  const directTests = new Set()
  const validatePackages = new Set()
  let full = false
  let lint = false
  let typecheck = false
  let build = false
  let checkLib = false
  let agentDocs = false
  let diagrams = false
  let website = false
  let authorDocs = false
  let repoWorkflowTests = false

  for (const file of files) {
    const owner = owningPackage(file)
    if (GLOBAL_PATHS.has(file) || file.startsWith('.github/workflows/')) {
      full = true
      reasons.push(`${file}: cross-cutting repository input`)
      continue
    }
    if (file.startsWith('script/')) {
      repoWorkflowTests = true
      if (!/^script\/(?:test-impact|change-files|verify-changed|build-changed|check-agent-docs)\.mjs$/u.test(file)
        && !file.startsWith('script/tests/')) {
        full = true
        reasons.push(`${file}: unclassified repository script`)
      }
    }
    if (file === 'script/check-agent-docs.mjs') agentDocs = true
    if (file === 'AGENTS.md' || file.endsWith('/AGENTS.md') || file.includes('/SKILL.md') || file.startsWith('.agents/')
      || file.startsWith('docs/skills/') || file.endsWith('/blue-skills-plan.md')) {
      agentDocs = true
    }
    if (file.startsWith('docs/diagrams/') || file === 'README.md' || file === 'README.zh.md' || file === 'docs/blue-architecture.md') diagrams = true
    if (file.startsWith('website/')) website = true
    if (file.startsWith('packages/bundle/blue/presets/blue-cordis/')) {
      authorDocs = true
      build = true
      directTests.add('packages/bundle/blue/tests/presets.spec.ts')
    }
    if (file.endsWith('/cordis.patch.yml')) {
      full = true
      reasons.push(`${file}: executable composition contract`)
    }
    if (isStructuralBuildPath(file)) {
      build = true
      checkLib = true
      if (owner !== undefined && file.endsWith('package.json')) validatePackages.add(owner)
    }
    if (!CODE_PATTERN.test(file)) continue

    lint ||= file.startsWith('packages/') || file.startsWith('examples/')
    typecheck ||= file.includes('/src/') || file.startsWith('script/')
    if (/\/(?:src|tests)\//u.test(file)) related.add(file)
    if (EXECUTABLE_SOURCE_PATTERN.test(file)) {
      coverage.add(file)
      build = true
    }

    if ((owner === 'packages/api' || owner === 'packages/ui') && file.includes('/src/')) {
      full = true
      reasons.push(`${file}: public contract or construction layer`)
      continue
    }
    if (owner !== undefined && LIFECYCLE_WORDS.test(posix.basename(file))) {
      packageTests.add(`${owner}/tests`)
      reasons.push(`${file}: lifecycle-sensitive implementation`)
    }
    if (owner !== undefined && RENDERER_PACKAGES.has(owner) && file.includes('/src/')) {
      directTests.add(`${owner}/tests/width-scan.spec.ts`)
    }
    if (file === 'packages/core/tests/width-scan.ts' || file === 'packages/core/tests/temp-dir.ts') {
      full = true
      reasons.push(`${file}: shared test infrastructure`)
    }
  }

  const plan = {
    files,
    mode: full ? 'full' : files.length === 0 ? 'none' : 'changed',
    reasons: [...new Set(reasons)],
    checks: { lint, typecheck, build, checkLib, agentDocs, diagrams, website, authorDocs, repoWorkflowTests },
    tests: {
      related: [...related],
      coverage: [...coverage],
      packageTests: [...packageTests],
      direct: [...directTests],
    },
    validatePackages: [...validatePackages],
  }
  return full ? promoteToFull(plan, 'full gate required by change classification') : plan
}
