// Generates the headless bump task prompt (stdout) from the DRIFT_CURRENT
// and DRIFT_TARGET environment variables the harness-drift workflow
// injects. The agent edits files ONLY — every git operation and every gate
// stays with the workflow's deterministic steps, so a misbehaving agent can
// never push, and a broken tree never reaches a PR.
//
// Run: node script/harness-drift-task.mjs   (requires DRIFT_CURRENT and
// DRIFT_TARGET; the output is consumed as the `dsh --profile headless`
// task text)

const current = process.env.DRIFT_CURRENT
const target = process.env.DRIFT_TARGET
if (current === undefined || target === undefined) {
  console.error('harness-drift-task: DRIFT_CURRENT and DRIFT_TARGET env vars are required')
  process.exit(1)
}

console.log(`Bump this repository's pinned harness dependency line from ${current} to ${target}. The repo is a pnpm workspace; its root AGENTS.md section "Dependency and workspace notes" describes the exact bump posture — read it first.

Definition of done: packages/transcript/tests/version.spec.ts passes. That spec is the completeness proof — it asserts that every exact-pinned @deepseek-ai/dsh-* dependency and devDependency across the five package manifests, every ^-ranged dsh peer, every pnpm-workspace.yaml minimumReleaseAgeExclude entry, and the HARNESS_LINE constant in packages/interaction/src/session-commands.ts all agree on one line. Verify with: pnpm vitest run packages/transcript/tests/version.spec.ts

Files that carry the pinned line literally: the six package.json manifests (root + core, interaction, transcript, app, bundle/blue), pnpm-workspace.yaml, packages/interaction/src/session-commands.ts, packages/transcript/tests/version.spec.ts, packages/interaction/tests/session-commands.spec.ts, packages/bundle/blue/tests/e2e.spec.ts, README.md, README.zh.md, AGENTS.md, packages/interaction/README.md, packages/interaction/README.zh.md. The .github/workflows/ci.yml CLI pin is DERIVED from HARNESS_LINE via script/harness-line.mjs — never edit workflow files.

Lockfile posture (from the AGENTS.md notes): run pnpm install --no-frozen-lockfile --config.minimumReleaseAge=0; transitive dsh packages the old lockfile satisfies at ${current} do not move by themselves — force them with a temporary overrides: block in pnpm-workspace.yaml pinned to ${target}, reinstall, then delete the block and reinstall again; keep non-dsh transitive packages at their previous resolutions where the release-age policy objects (push them back like jose in R1, never widen minimumReleaseAgeExclude). Do NOT run pnpm clean --lockfile.

Narrative edits, not just literals: update the R1 row in docs/blue-roadmap.md's release table with the new pin move, and re-derive the session-title bridge verdict in packages/bundle/blue/AGENTS.md and packages/interaction/AGENTS.md — compare the upstream package's ${current} vs ${target} published tarballs (npm pack @deepseek-ai/dsh-session-title@<version> and diff) to state whether the ordering bug is fixed; if you cannot verify, keep the bridge and write "not re-verified at this pin move". Never rewrite historical bookkeeping rows (docs/blue-decisions.md, docs/history/, roadmap's dated history lines).

Hard rules: no git commands (no commit, no push, no branch); never modify anything under .github/; do not touch website/; do not upgrade any package outside the @deepseek-ai/dsh-* line. Finish by running pnpm vitest run packages/transcript/tests/version.spec.ts and report its pass/fail plus the list of files you changed.`)
