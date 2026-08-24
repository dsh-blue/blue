# AGENTS.md

Guidance for AI coding agents working in this repository. Repo-wide conventions live here; each package's implementation detail lives in its own `packages/*/AGENTS.md` (see the convention below).

## Project overview

**Blue** is the interactive terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It is a renderer over the harness's [Cordis](https://github.com/deepseek-ai/cordis) plugin architecture, built on `@earendil-works/pi-tui`, and shipped as seven `@dsh-blue/blue-*` packages (all at version `0.1.0-rc.6` — the preview line, the number the website's tagline promises; blue-api first published with rc.3, the blue-cli launcher shell joins with its first release). The packages were extracted from the `deepseek-harness` monorepo; this standalone repository builds and tests against the published npm releases of the harness and vendored Cordis. Blue is **not** part of a default `dsh` installation — it is added to a `dsh` profile as an out-of-tree plugin bundle; the `@dsh-blue/blue-cli` shell (S37) wraps that into a single-command install carrying its own pinned host.

- Language: TypeScript (ESM only, `"type": "module"` everywhere).
- Runtime: Node `^22.19.0 || >=24.0.0`; package manager pnpm 11 (pinned, `pnpm@11.7.0`).
- Repository type: pnpm workspace + TypeScript project references; website CI via GitHub Actions (`.github/workflows/website-pages.yml`), no formatter (only oxlint).

## External documentation

Consult these while developing instead of guessing API shapes:

- pi-tui component/rendering model (the L0 renderer behind `packages/core`): <https://pi.dev/docs/latest/tui>
- DeepSeek Harness service and API reference (the host services Blue plugins consume): <https://deepseek-harness.github.io/deepseek-harness/reference/>
- In-repo design docs, indexed (living vs archived): [docs/README.md](docs/README.md)

## Repository layout

```
packages/
  core/         @dsh-blue/blue-core        — the tree's ONLY pi-tui adapter
  transcript/   @dsh-blue/blue-transcript  — session events → transcript rendering
  interaction/  @dsh-blue/blue-interaction — input editor, slash commands, dialogs, /yolo mode cycle
  app/          @dsh-blue/blue-app         — CLI startup + Agent driver
  bundle/blue/  @dsh-blue/blue             — installable bundle (cordis.patch.yml)
  cli/          @dsh-blue/blue-cli         — the `blue` launcher shell (global bin, S37)
script/install-dev.sh  — one-shot local dev install into a dsh profile
website/               — VitePress documentation site (@dsh-blue/website): zh source at the top
                         level, en mirror under website/en/; deployed to GitHub Pages (ADR D32)
.github/workflows/website-pages.yml — website Pages build-check-deploy CI
docs/                  — design docs, indexed by docs/README.md (living docs at the top level,
                         completed phase designs and surveys under docs/history/)
```

Each package has the same shape: `src/` (source), `tests/` (vitest specs), `lib/` (build output, git-ignored here but the runtime entry), its own `tsconfig.json` extending `tsconfig.base.json`, `README.md` + `README.zh.md` (bilingual user-facing docs — keep both in sync), and `AGENTS.md` (implementation detail for agents).

## Package quick reference

| Package | Import name | Role | Owns (key surfaces) | Detail |
|---|---|---|---|---|
| api | `@dsh-blue/blue-api` | stable renderer-independent public contracts and manifest validation | `BlueView` · readonly session/request lifecycle · `BlueResult` · capabilities | [AGENTS.md](packages/api/AGENTS.md) |
| core | `@dsh-blue/blue-core` | the tree's ONLY pi-tui adapter; terminal lifecycle, L1 services, component factory, themes, shared chrome | `blueScreen` · `blueKeymap` · `blueTerminalInfo` · `blueComponents` · 4 theme subpath plugins · `./chrome` | [AGENTS.md](packages/core/AGENTS.md) |
| transcript | `@dsh-blue/blue-transcript` | session events → transcript items and rendering | fold · tool cards/read groups · `blueStatus` + footer shell + 5 status plugins · dock panes (activity/todo/btw/agents) · `blueIntents` + `./intent-diff`/`./intent-terminal` · window/step folding · `./banner` | [AGENTS.md](packages/transcript/AGENTS.md) |
| interaction | `@dsh-blue/blue-interaction` | input editor, slash commands, dialogs | commands + alias registry · dialog panels (D30 editor-slot replacement) · completions (slash/`@`/`#`) · skills pipeline (`#` mark → `/name` gesture + `/skills` panel, S29) · model/session-info/export/tools/preset/permission/plan-review families · shared editor seams · `./attachments`/`./paste-image`/`./pane-queue`/`./editor-plus` | [AGENTS.md](packages/interaction/AGENTS.md) |
| app | `@dsh-blue/blue-app` | CLI startup + Agent driver | startup (`[task]`, `--resume`) · session switch queue · `modelRef` (D38) · preset mount (D37) | [AGENTS.md](packages/app/AGENTS.md) |
| bundle/blue | `@dsh-blue/blue` | installable unit | `cordis.patch.yml` (three segments, 21 Blue rows + thin-host roster/disables) · `bundle.spec.ts` drift guard | [AGENTS.md](packages/bundle/blue/AGENTS.md) |
| cli | `@dsh-blue/blue-cli` | the `blue` launcher shell — standalone global bin, outside the plugin tree | nested pinned `@deepseek-ai/dsh` host · profile calibration (`blue`, link-lane skip) · argv translation (`-V` self-answer, `plugin` subcommand, `--profile` swallow) · `BLUE_LAUNCHER` rebrand env | [AGENTS.md](packages/cli/AGENTS.md) |

Dependency direction: core ← transcript / interaction ← app ← bundle; `cli` stands outside the plugin tree (no workspace dependency edges, its only dependency is the pinned `@deepseek-ai/dsh` host). `@deepseek-ai/cordis` and the `dsh-*` service packages are `peerDependencies` (provided by the host `dsh` installation), mirrored as pinned `devDependencies` for local builds and tests. Core additionally carries `@deepseek-ai/schemastery` as a real runtime dependency (theme-custom config validation) and `cli-highlight` (code-fence syntax coloring behind the markdown `highlightCode` hook), alongside `@earendil-works/pi-tui`.

## Per-package documentation convention

Each package's implementation detail — services and seams, subpath plugin inventory, behaviors, constants, boundaries, D-number citations — lives in that package's `AGENTS.md`, not here. **When changing a package, update its `AGENTS.md` in the same change** (this replaces the old convention of appending to root bullets). Package `README.md`/`README.zh.md` stay user-facing and bilingual; the package `AGENTS.md` must not duplicate them. When a dogfood or docs change alters documented behavior, sync the owning package's `AGENTS.md` too.

### Cordis plugin conventions

Every package entry is a Cordis plugin: it exports `name` (a stable string like `'blue-core'`), optionally `inject`, and `apply(ctx: Context)`. Cross-plugin communication uses Cordis services (`ctx.blueScreen`, `ctx.blueKeymap`, …) and events (`'blue/session-changed'`, `'blue/request-resume'`). All registrations must be effect-bound so unloading the plugin fiber reverts every contribution. Each package also ships an `invariant.ts` companion (`<pkg>/invariant` export) that registers with the `invariants` service.

## Build and test commands

All commands run from the repo root:

```sh
pnpm install            # resolves all deps from the npm registry
pnpm run build          # tsc -b emits lib/types (+ d.ts), then tsdown bundles lib/
pnpm run test           # vitest run: unit suites + the bundle's whole-tree e2e
pnpm run test:coverage  # vitest run --coverage — per-file 100% gate on src
pnpm run typecheck      # tsc -b tsconfig.json (project references)
pnpm run lint           # oxlint packages
pnpm run website:dev     # VitePress dev server at 127.0.0.1:5173 (base '/')
pnpm run website:build   # VitePress build; DOCS_BASE=/blue/ matches the Pages base
  pnpm run website:preview # serves the built site (pass the same DOCS_BASE as the build)
```

Packaging gates: `pnpm check:lib` validates built exports, while `pnpm check:pack` creates and validates the exact seven publish tarballs (publint, ATTW, manifest/bin checks, protocol leakage, shrinkwrap, and size budgets). The release workflow publishes those tarballs to a candidate tag, runs registry install smoke across Linux/macOS/Windows, then promotes `rc` and `latest`; it never rebuilds a second artifact. `pnpm release:lock-cli` is the only supported way to refresh `packages/cli/npm-shrinkwrap.json`, and it resolves in an isolated npm project so pnpm workspace links cannot enter the published lock.

- Build is two-stage: `tsc -b` owns type emission (`lib/types/*.d.ts` + intermediate JS), `tsdown` owns runtime bundling into the published `lib/` layout (`lib/index.js`, `lib/invariant.js`, `lib/startup.js`). Package deps and peer deps stay external.
- **Subpath exports travel in threes.** Adding, renaming, or removing a package subpath moves three independent manifests together: the package's `package.json` `exports`, its `files` tarball whitelist, and the root `tsdown.config.ts` entry enumeration. Nothing ties them together — tsc emits types for subpaths tsdown never bundles, the specs run source-plane (`../src/*.ts` relative imports) so no test walks `lib/`, and a dev profile links the source checkout so the `files` list stays invisible until the first publish. `pnpm check:lib` (a CI gate right after `pnpm build`) verifies the triangle mechanically; each arm shipped once as the S30 incident (`./status-title` missing from the tsdown list boot-crashed every real install, and missing from `files` would have shipped a tarball without it). A plugin mounted through the package index (no subpath of its own) needs none of the three.
- **Iteration loop for local runs:** edit `src` → `pnpm run build` → re-run `dsh --profile blue-dev`. Profile lanes (D51 aftermath): `blue` is production, npm installs only — never link into it (a later npm upgrade half-overwrites the links and boots a Frankenstein tree); `blue-dev` links this checkout; `blue-<tag>` is a worktree's acceptance profile, deleted with the branch. The runtime entry of every package is `lib/`, so a rebuild is required; source edits alone have no effect on a running install.
- `script/install-dev.sh` builds and link-installs the five plugin-tree packages into a `dsh` profile (overrides: `DSH_BIN`, `PROFILE`, `DSH_HOME`); `packages/cli` is not link-installed — it is a global-install shell, exercised via its own specs and the pack-then-install verification.

**Every feature must be developed in a worktree and dogfooded (mandatory workflow).** A feature — any user-visible behavior change (new command, rendering change, new seam) — is NOT done when the code passes the gate:

1. **Open a worktree** for the feature from `master` (branch tag pattern `p2/<slug>` or `worktree-<tag>`; the EnterWorktree name doubles as the profile tag), carrying the work — including its docs and AGENTS.md updates — in the worktree only.
2. Pass the full gate in the worktree (`pnpm run test` / coverage / typecheck / lint) and commit.
3. **Dogfood on a real terminal** against the worktree's own profile: `PROFILE=blue-<tag> script/install-dev.sh` run from the worktree (it builds and link-installs from its own checkout, so the production `blue` profile stays npm-only and untouched); exercise the feature headless via the pseudo-TTY smoke pattern in the Testing section AND **explicitly prompt the user to live-test** `dsh --profile blue-<tag>`, iterating on `pnpm --dir <worktree> run build` between looks (the link install needs re-running only when the dependency graph changes; plain rebuilds flow into the same profile). Fix findings in the worktree and re-run the gate.
4. **Human acceptance gates the merge — nothing else does.** After prompting, WAIT: the branch merges only when the user has actually live-tested `dsh --profile blue-<tag>` and accepted (验收通过). Do not merge, do not delete the dev profile, and do not point the user at the shared `blue` profile for acceptance before that acceptance lands in the conversation.
5. **Merge to master** (`ExitWorktree` keep → merge the branch → **rebuild in the main checkout — the merged `lib/` output is stale until `pnpm run build` runs there**) and clean up: `rm -rf ~/.dsh/profiles/blue-<tag>` — profile deletion comes after the accepted merge, never before it (a profile is a self-contained pnpm workspace under `~/.dsh/profiles/`; example: branch `p2/s11-editor-chrome` → profile `blue-s11`). A dogfood log with the exercised scenarios and their outcomes is part of the merge summary.

## Testing instructions

- Framework: **vitest 4**, configured in `vitest.config.ts`. Specs live in `packages/*/tests/**/*.spec.ts` (and `packages/bundle/*/tests/`). Worker pool is `forks` (avoids Node 24 worker-thread CJS lexer crashes).
- **Source-plane tests:** specs import the package under test through relative `../src/*.ts` paths — not through the built `lib/` and not through package names. Cross-package imports in tests also use relative paths (e.g. `../../../core/src/index.ts` in the bundle e2e). Every `@deepseek-ai/*` runtime dependency resolves from `node_modules`.
- **Coverage gate:** `pnpm run test:coverage` enforces **per-file 100%** statements/branches/functions/lines on every `packages/*/src/**/*.ts` file (`src/types.ts` files excluded — they carry no executable code). A change that adds uncovered lines will fail CI-equivalent checks; write specs accordingly.
- Fakes/fixtures live next to specs (`packages/core/tests/fake-terminal.ts`, `packages/interaction/tests/fakes.ts`, `packages/transcript/tests/helpers.ts`, `packages/bundle/blue/tests/mock-adapter.ts`). **Width fakes are forbidden** (D48): every `visibleWidth`/`wrapText`/`truncateToWidth` in a fake delegates to pi-tui through `packages/core/src/width.ts` (relative import) — the codepoint counters this replaced were exact only for ASCII and let CJK mis-budgets stay green while tripping the real width guard (the D39/#15 lesson).
- **Width-scan contract (D48):** `BlueComponent.render(width)` returning rows whose visible width exceeds `width` is a hard contract violation (`packages/core/src/types.ts`), mechanically enforced by the `width-scan` specs — every content-rendering component renders each fixture of `ADVERSARIAL` at each of `SCAN_WIDTHS` (from `packages/core/tests/width-scan.ts`, shared by relative import) and every row must fit. A new content-rendering component adds itself to its package's `width-scan.spec.ts`. The render-exit clamp (`packages/core/src/frame-clamp.ts`, D48) is the frame backstop — a clamped row still shows up in `blue-overflow.log` and is still a component bug.
- **Temp dirs are tracked and cleaned** (the 2026-08-20 /tmp inode exhaustion): specs create roots with `mkdtempTracked(prefix)` from `packages/core/tests/temp-dir.ts` (imported relatively from the other packages) and call `registerTempDirCleanup()` once at module top — an afterAll removes the file's roots (permission-stripped `locked` fixtures included) and a process-exit hook sweeps whatever a run abandoned. Raw `mkdtempSync` in a spec leaks every boot's session store and profile to the tmpfs; the harness-side `dsh-*` leftovers still in `/tmp` come from the harness monorepo's own suites, not this repo.
- The bundle's `tests/e2e.spec.ts` is a whole-tree e2e: all five plugins boot through the real Cordis Loader with a scripted mock LLM adapter (`dsh-agent-loop-testkit`) and core's recording FakeTerminal — only the model and the process terminal are substituted.
- Headless smoke check against a real install (pseudo-TTY via `script(1)`):
  ```sh
  (sleep 10; printf '/quit\r'; sleep 3) \
    | timeout 90 script -qec "dsh --profile blue-dev" /tmp/blue-smoke.typescript
  # Assert: bracketed-paste on (\x1b[?2004h) at boot, off (\x1b[?2004l) at exit, exit code 0.
  ```
- **Real-process smoke (D48, the width gate's e2e tier):** `pnpm smoke:happy` (CI) boots the built plugin tree through the real `dsh` CLI in a throwaway profile against a local mock LLM streaming width-hostile content at `COLUMNS=40` — green means exit 0, no `exceeds terminal width`, and `blue-overflow.log` empty. `pnpm smoke:pty` (manual) drives the same boot through node-pty's raw-mode key path. Both share `script/smoke-lib.mjs` (dsh discovery + `HARNESS_LINE` version assertion + the throwaway-profile install; the CLI comes from PATH/`DSH_BIN`/CI's global install, never a devDependency — its subtree reshapes hoisting and breaks the S34 /mcp e2e). The smoke's temp-HOME build can dirty the worktree's pnpm deps-status; smoke-lib self-heals with an ambient `pnpm install --config.confirmModulesPurge=false` — same command if your own pnpm runs ever hit the no-TTY purge prompt after a smoke.

## Code style guidelines

Enforced mechanically: `oxlint` (`.oxlintrc.json`) and strict `tsc` (`tsconfig.base.json`). There is no Prettier/ESLint-format setup; match the surrounding code.

Observed conventions:

- **Row width is a hard contract (D48).** Every hand-assembled row — bullet plus wrapped text, indent plus content, badge plus label — is measured with pi-tui's own helpers (via the components service, or `@dsh-blue/blue-core/chrome`'s `clampRowsToWidth` for a whole frame) and must not exceed the width `render(width)` was given. Fixed furniture (indents, bullets, minimum frame widths) can out-wide a degenerate viewport crossed mid-resize-drag; components cut only in that degenerate regime (`clampRowsToWidth` unconditional, framePanel/gutter/model rows conditional on their furniture floor — normal widths emit untouched, so marker-paint test goldens stay honest). The render-exit clamp in `terminal.ts` is the backstop, not a license: a clamped row lands in `blue-overflow.log` and the width-san turns it red.
- **pi-tui's width truth enters through one seam.** Runtime code touches `visibleWidth`/`truncateToWidth` through the components service or `@dsh-blue/blue-core/chrome`; core-internal modules and every test import `packages/core/src/width.ts` (the re-export). No other package declares `@earendil-works/pi-tui` (D4: version resolution stays unique), and no test re-implements width math.
- **No semicolons**, single quotes, 2-space indent, ESM imports.
- **Relative imports carry the `.ts` extension** (`import { X } from './keymap.ts'`) — enabled by `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`.
- Type-only imports use `import type`. Empty type imports (`import type {} from '...'`) are used deliberately to pull in Cordis `Context`/`Events` declaration merges — do not delete them; add a comment when you introduce one, as existing code does.
- Every module starts with a JSDoc `@module` header block explaining the package/file's role; exported symbols carry JSDoc with `@param`/`@returns`. Keep comment style factual and architectural (why, not what).
- Strict TS flags include `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters` — handle `undefined` from index access and don't leave unused bindings.
- Only `packages/core` touches pi-tui or raw terminal state; other packages program against the `Blue*` L1 contracts. Preserve this boundary.
- oxlint rules `no-control-regex` and `no-useless-escape` are intentionally off: terminal code matches raw ANSI escape sequences on purpose.
- Target is `es2024`, bundler module resolution, `fixedExtension: false` ESM output.

## Dependency and workspace notes

- `pnpm-workspace.yaml` denies the `koffi` build script (`allowBuilds: koffi: false`) — it is a Windows-only native boundary of dsh JSONL persistence and unnecessary on Linux/macOS; install still succeeds. It also pins `minimumReleaseAgeExclude` entries for the `@deepseek-ai/dsh-*@0.1.1-rc.2` line; add new harness deps there in the same format.
- **pnpm 11's default 24h `minimumReleaseAge` policy interacts with the rc line** (learned in R1): the exclude table exempts the pinned dsh line from the age check (both fresh resolution and the stored-lockfile verification every `pnpm run` performs), but nothing else — a freshly-published transitive (e.g. `jose@6.2.10`) is rejected until 24h pass, and a half-bumped lockfile (old line entries no longer excluded) hard-fails. Bumping the line: edit the pins, then evolve the lockfile with `pnpm install --no-frozen-lockfile --config.minimumReleaseAge=0`; transitive dsh packages the old lock satisfies at the old version do NOT move by themselves — force them with a temporary `overrides:` block pinned to the new line, reinstall, then delete the block (12 packages needed this in R1); keep non-dsh transitive resolutions at their previous versions where the policy objects (the `^` ranges still match). A full `pnpm clean --lockfile` re-resolution also drags the whole dev toolchain (vitest/vite/rolldown) forward — avoid it for line bumps.
- There are TWO version lines under global control (`packages/transcript/tests/version.spec.ts` fails on any drift). **Blue's release line**: the eight `package.json` versions (seven publishable packages + `website/`), `BLUE_VERSION`, and the website's user-facing copy (`index.md` tagline, guide/faq) must all equal `0.1.0-rc.6` — the preview line, which the site advertises. **The harness line**: every exact-pinned `@deepseek-ai/dsh-*` dev dependency, every `^`-ranged dsh peer, the `pnpm-workspace.yaml` `minimumReleaseAgeExclude` pins, and the `/version` notice's `HARNESS_LINE` constant (`session-commands.ts`) must all agree with each other — they ride the harness prerelease line and are deliberately NOT tied to Blue's number. Bumping Blue touches the eight manifests + `BLUE_VERSION` + the website copy; upgrading the harness line touches the dsh pins + `HARNESS_LINE`.
- `packages/bundle/blue` depends on the four libraries via `workspace:^`, which is unresolvable outside this workspace — relevant when installing into a `dsh` profile (link all five packages, as `script/install-dev.sh` does).

## Harness drift monitoring

The `harness-drift` workflow (`.github/workflows/harness-drift.yml`) watches the npm `next` dist-tags of every `@deepseek-ai/dsh-*` package this tree pins — the rc line rides `next`; `latest` lags on old public lines, which is why no off-the-shelf bot fits. Division of labour: `version.spec.ts` owns internal consistency (every pin agrees with `HARNESS_LINE`); `script/harness-drift.mjs` owns external freshness (that line vs the registry) and never edits a file. Adding a new harness dependency anywhere automatically adds it to the watched set (the script unions the manifests with the `minimumReleaseAgeExclude` table).

- **Daily at 01:23 UTC** (plus manual `workflow_dispatch`): detect classifies `SYNC` / `BUMP_READY` (whole set on one newer same-minor version — rc steps, stable graduation, patch steps) / `MINOR_JUMP` (past the minor or rolled back — R1 ruling: never automatic) / `PARTIAL` (tags disagree — wait; upstream ships in lockstep, and `version.spec` forbids a split tree) / `ERROR` (registry unreachable — deliberately red: a dead monitor must be visible, and scheduled failures are not pushed anywhere, so glance at the Actions tab occasionally).
- On `BUMP_READY`: a `dsh --profile headless` agent edits files ONLY (prompt from `script/harness-drift-task.mjs`; hard rules: no git, never `.github/`, `version.spec` is the completeness proof). The workflow then runs the full gate set deterministically — **all green is the only path to a PR**: force-push `automation/harness-bump`, upsert one PR per line. The gates run inside the drift run because GITHUB_TOKEN-produced events never trigger new workflows — the PR's checks tab stays empty by design, and the human merge push re-triggers master's `ci.yml` as the final check. This is also why the agent may never touch a workflow file: GitHub rejects GITHUB_TOKEN pushes that modify them (and `ci.yml`'s CLI pin is derived via `script/harness-line.mjs`, so a bump has no reason to).
- The bump job needs the `DEEPSEEK_API_KEY` secret (the headless agent's model); without it the job fails loudly rather than skipping.
- Rehearsal path: on any branch, pin the tree back to an old line, `workflow_dispatch` with `apply: true` — the input is an explicit human intent and may run off-master; the schedule never can.
- If branch-protection required checks ever appear, switch the push to a PAT secret so the PR gains native runs; until then the built-in gates are the check.

## Security considerations

- Never commit secrets; nothing in this repo should require credentials at rest (all deps resolve from the public npm registry).
- Terminal code intentionally emits/matches raw ANSI control sequences — keep that confined to `packages/core`, and do not "sanitize" escape handling elsewhere.
- The pnpm `allowBuilds` deny-list for `koffi` is deliberate hardening against unreviewed dependency build scripts; do not enable build scripts for new dependencies without review.
- `cordis.patch.yml` uses `!!js` YAML tags evaluated by the harness loader — treat patch edits as code execution surface and keep them minimal.

## Verification status

As of 2026-08-22, `pnpm run test` (1844 tests, 103 files), `pnpm run test:coverage` (per-file 100%), `pnpm run typecheck`, `pnpm run lint`, and `pnpm run smoke:happy` (real-process width smoke) all pass on Node 22+/pnpm 11 against the 0.1.1-rc.2 harness line.
