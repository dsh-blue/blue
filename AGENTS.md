# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

**Blue** is the interactive terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It is a renderer over the harness's [Cordis](https://github.com/deepseek-ai/cordis) plugin architecture, built on `@earendil-works/pi-tui`, and shipped as five `@deepseek-ai/dsh-blue-*` packages (all at version `0.1.0-rc.7`). The packages were extracted from the `deepseek-harness` monorepo; this standalone repository builds and tests against the published npm releases of the harness and vendored Cordis. Blue is **not** part of a default `dsh` installation — it is added to a `dsh` profile as an out-of-tree plugin bundle.

- Language: TypeScript (ESM only, `"type": "module"` everywhere).
- Runtime: Node `^22.19.0 || >=24.0.0`; package manager pnpm 11 (pinned, `pnpm@11.7.0`).
- Repository type: pnpm workspace + TypeScript project references; no CI config, no formatter (only oxlint).

## External documentation

Consult these while developing instead of guessing API shapes:

- pi-tui component/rendering model (the L0 renderer behind `packages/core`): <https://pi.dev/docs/latest/tui>
- DeepSeek Harness service and API reference (the host services Blue plugins consume): <https://deepseek-harness.github.io/deepseek-harness/reference/>

## Repository layout

```
packages/
  core/         @deepseek-ai/dsh-blue-core        — the tree's ONLY pi-tui adapter
  transcript/   @deepseek-ai/dsh-blue-transcript  — session events → transcript rendering
  interaction/  @deepseek-ai/dsh-blue-interaction — input editor, slash commands, overlays
  app/          @deepseek-ai/dsh-blue-app         — CLI startup + Agent driver
  bundle/blue/  @deepseek-ai/dsh-blue             — installable bundle (cordis.patch.yml)
script/install-dev.sh  — one-shot local dev install into a dsh profile
docs/                  — design docs: blue-architecture.md (blueprint), blue-roadmap.md (phases),
                         blue-mvp-plan.md (MVP plan), blue-decisions.md (ADR log),
                         blue-p1-design.md (P1 layer design: kimi-code parity map + seam catalog),
                         blue-survey-pi-tui.md / blue-survey-harness.md (research basis)
```

Each package has the same shape: `src/` (source), `tests/` (vitest specs), `lib/` (build output, git-ignored here but the runtime entry), its own `tsconfig.json` extending `tsconfig.base.json`, and `README.md` + `README.zh.md` (bilingual docs — keep both in sync when changing documented behavior).

### Package roles and dependencies

- **core** — terminal lifecycle (`src/terminal.ts`) plus the L1 services: `blueScreen` (`src/screen.ts`), `blueKeymap` (`src/keymap.ts`), `blueTerminalInfo` (`src/terminal-info.ts`, read-only terminal facts from the startup OSC 11 background probe), `blueComponents` (`src/components.ts`, the pi-tui-backed component factory and width pure functions). The `blueTheme` contract lives in `src/types.ts`; its implementation ships as the `./theme-dark` subpath plugin (`src/theme-dark.ts`, `blue-theme-dark`, the built-in 26-token dark palette). Only this package may import `@earendil-works/pi-tui`; it exposes pi-tui-independent contracts in `src/types.ts` so pi-tui breaking changes cannot propagate past it.
- **transcript** — folds session events into transcript items (`src/fold.ts`, which also owns `ellipsize`) and renders them through `blueScreen`, with Markdown and text measurement delegated to `blueComponents` (`src/components.ts`).
- **interaction** — bottom input editor (`src/editor.ts`), slash commands `/quit` and `/resume` (`src/commands-plugin.ts`), user-question and approval overlays (`src/questions-plugin.ts`, `src/approval-plugin.ts`). All key handling resolves through `ctx.blueKeymap`.
- **app** — command-line startup (`src/startup.ts`: `[task]` positional, `--resume <id>`) and the Agent driver (`src/index.ts`) that creates/resumes sessions and publishes them via `blueSession`.
- **bundle/blue** — the installable unit. Its `cordis.patch.yml` inserts the six Blue plugin rows (including `blue-theme-dark` right after `blue-core`, the plain-baseline segment) over `dsh-base`; the bundle module itself mounts nothing. The four library packages are its `workspace:^` dependencies.

Dependency direction: core ← transcript / interaction ← app ← bundle. `@deepseek-ai/cordis` and the `dsh-*` service packages are `peerDependencies` (provided by the host `dsh` installation), mirrored as pinned `devDependencies` for local builds and tests.

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
```

- Build is two-stage: `tsc -b` owns type emission (`lib/types/*.d.ts` + intermediate JS), `tsdown` owns runtime bundling into the published `lib/` layout (`lib/index.js`, `lib/invariant.js`, `lib/startup.js`). Package deps and peer deps stay external.
- **Iteration loop for local runs:** edit `src` → `pnpm run build` → re-run `dsh --profile blue`. The runtime entry of every package is `lib/`, so a rebuild is required; source edits alone have no effect on a running install.
- `script/install-dev.sh` builds and link-installs all five packages into a `dsh` profile (overrides: `DSH_BIN`, `PROFILE`, `DSH_HOME`).

## Testing instructions

- Framework: **vitest 4**, configured in `vitest.config.ts`. Specs live in `packages/*/tests/**/*.spec.ts` (and `packages/bundle/*/tests/`). Worker pool is `forks` (avoids Node 24 worker-thread CJS lexer crashes).
- **Source-plane tests:** specs import the package under test through relative `../src/*.ts` paths — not through the built `lib/` and not through package names. Cross-package imports in tests also use relative paths (e.g. `../../../core/src/index.ts` in the bundle e2e). Every `@deepseek-ai/*` runtime dependency resolves from `node_modules`.
- **Coverage gate:** `pnpm run test:coverage` enforces **per-file 100%** statements/branches/functions/lines on every `packages/*/src/**/*.ts` file (`src/types.ts` files excluded — they carry no executable code). A change that adds uncovered lines will fail CI-equivalent checks; write specs accordingly.
- Fakes/fixtures live next to specs (`packages/core/tests/fake-terminal.ts`, `packages/interaction/tests/fakes.ts`, `packages/transcript/tests/helpers.ts`, `packages/bundle/blue/tests/mock-adapter.ts`).
- The bundle's `tests/e2e.spec.ts` is a whole-tree e2e: all five plugins boot through the real Cordis Loader with a scripted mock LLM adapter (`dsh-agent-loop-testkit`) and core's recording FakeTerminal — only the model and the process terminal are substituted.
- Headless smoke check against a real install (pseudo-TTY via `script(1)`):
  ```sh
  (sleep 10; printf '/quit\r'; sleep 3) \
    | timeout 90 script -qec "dsh --profile blue" /tmp/blue-smoke.typescript
  # Assert: bracketed-paste on (\x1b[?2004h) at boot, off (\x1b[?2004l) at exit, exit code 0.
  ```

## Code style guidelines

Enforced mechanically: `oxlint` (`.oxlintrc.json`) and strict `tsc` (`tsconfig.base.json`). There is no Prettier/ESLint-format setup; match the surrounding code.

Observed conventions:

- **No semicolons**, single quotes, 2-space indent, ESM imports.
- **Relative imports carry the `.ts` extension** (`import { X } from './keymap.ts'`) — enabled by `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`.
- Type-only imports use `import type`. Empty type imports (`import type {} from '...'`) are used deliberately to pull in Cordis `Context`/`Events` declaration merges — do not delete them; add a comment when you introduce one, as existing code does.
- Every module starts with a JSDoc `@module` header block explaining the package/file's role; exported symbols carry JSDoc with `@param`/`@returns`. Keep comment style factual and architectural (why, not what).
- Strict TS flags include `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters` — handle `undefined` from index access and don't leave unused bindings.
- Only `packages/core` touches pi-tui or raw terminal state; other packages program against the `Blue*` L1 contracts. Preserve this boundary.
- oxlint rules `no-control-regex` and `no-useless-escape` are intentionally off: terminal code matches raw ANSI escape sequences on purpose.
- Target is `es2024`, bundler module resolution, `fixedExtension: false` ESM output.

## Dependency and workspace notes

- `pnpm-workspace.yaml` denies the `koffi` build script (`allowBuilds: koffi: false`) — it is a Windows-only native boundary of dsh JSONL persistence and unnecessary on Linux/macOS; install still succeeds. It also pins `minimumReleaseAgeExclude` entries for the `@deepseek-ai/dsh-*@0.1.0-rc.7` line; add new harness deps there in the same format.
- When bumping the harness release line, update the pinned `devDependencies` in all five packages consistently.
- `packages/bundle/blue` depends on the four libraries via `workspace:^`, which is unresolvable outside this workspace — relevant when installing into a `dsh` profile (link all five packages, as `script/install-dev.sh` does).

## Security considerations

- Never commit secrets; nothing in this repo should require credentials at rest (all deps resolve from the public npm registry).
- Terminal code intentionally emits/matches raw ANSI control sequences — keep that confined to `packages/core`, and do not "sanitize" escape handling elsewhere.
- The pnpm `allowBuilds` deny-list for `koffi` is deliberate hardening against unreviewed dependency build scripts; do not enable build scripts for new dependencies without review.
- `cordis.patch.yml` uses `!!js` YAML tags evaluated by the harness loader — treat patch edits as code execution surface and keep them minimal.

## Verification status

As of this writing, `pnpm run test` (203 tests, 26 files), `pnpm run typecheck`, and `pnpm run lint` all pass on Node 22+/pnpm 11.
