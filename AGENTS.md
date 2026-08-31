# AGENTS.md

Repository-wide guidance for AI coding agents. Read the owning package's
`AGENTS.md` before changing that package. Current architecture is indexed in
[docs/README.md](docs/README.md); use the Harness
<https://deepseek-harness.github.io/deepseek-harness/reference/> and pi-tui
<https://pi.dev/docs/latest/tui> references instead of guessing APIs.

## Project And Packages

Blue is the ESM-only TypeScript terminal UI bundle for DeepSeek Harness. It is
an out-of-tree Cordis bundle, not part of a default `dsh` installation. The
workspace requires Node `^22.19.0 || >=24.0.0` and pinned pnpm 11. Runtime
entries come from built `lib/`; source changes do not affect an installed
profile until the relevant package is rebuilt.

| Area | Responsibility | Instructions |
| --- | --- | --- |
| `packages/api` | Beta renderer-neutral public contracts and plugin host | [AGENTS.md](packages/api/AGENTS.md) |
| `packages/ui` | Pure public wire-node builders | [AGENTS.md](packages/ui/AGENTS.md) |
| `packages/plugin-kit` | Published create/validate/conformance author CLI | [AGENTS.md](packages/plugin-kit/AGENTS.md) |
| `packages/frontend` | Renderer-neutral models, locale, and provider lifecycle | [AGENTS.md](packages/frontend/AGENTS.md) |
| `packages/harness-adapter` | Narrow removable Harness adapters | [AGENTS.md](packages/harness-adapter/AGENTS.md) |
| `packages/conversation` | Official append-origin conversation projection | [AGENTS.md](packages/conversation/AGENTS.md) |
| `packages/app` | Startup, Agent ownership, session readers/projections/actions | [AGENTS.md](packages/app/AGENTS.md) |
| `packages/core` | The only pi-tui and raw-terminal adapter | [AGENTS.md](packages/core/AGENTS.md) |
| `packages/transcript` | Transcript, status, bottom panes, tool presentation | [AGENTS.md](packages/transcript/AGENTS.md) |
| `packages/interaction` | Editor, commands, dialogs, and interaction state | [AGENTS.md](packages/interaction/AGENTS.md) |
| `packages/context` | Validation-only context slice | [AGENTS.md](packages/context/AGENTS.md) |
| `packages/remote` | Validation-only remote transport adapter | [AGENTS.md](packages/remote/AGENTS.md) |
| `packages/openpencil` | Validation-only tool-presentation adapter | [AGENTS.md](packages/openpencil/AGENTS.md) |
| `packages/lark` | Validation-only command/notification adapter | [AGENTS.md](packages/lark/AGENTS.md) |
| `packages/bundle/blue` | Installable composition and `blue-cordis` preset | [AGENTS.md](packages/bundle/blue/AGENTS.md) |
| `packages/cli` | Dependency-free global `blue` launcher | [AGENTS.md](packages/cli/AGENTS.md) |
| `examples` | Publish-shaped external consumers and composition | [AGENTS.md](examples/blue-ecosystem/AGENTS.md) |

`script/package-contract.mjs` is the source of truth for release,
validation-only, and example package sets. `docs/blue-architecture.md` describes
the current runtime; `docs/blue-plugin-contract-v1.md` describes the target
public contract; roadmaps and history do not prove an implementation exists.

## Architecture Rules

- Dependency direction is Harness domain -> projection/action boundary ->
  renderer-neutral frontend model -> renderer adapter. Domain packages do not
  depend on Blue. Only `packages/core` imports pi-tui or handles ANSI, raw
  terminal state, focus, layout, and visible-width truth.
- Events are facts, projections are current readonly state, and actions are
  structured writes. Renderers do not fold Harness session events or retain
  Agent/Session objects as a second source of truth.
- Host, agent, session, frontend-tree, and provider-Fiber state have explicit
  owners. Product mutable state must not be a module singleton. Every
  registration, listener, timer, provider, and asynchronous continuation has
  unload and stale-generation behavior.
- Renderer-neutral models contain readonly data and structured actions only:
  no pi-tui, React/DOM, ANSI, terminal width, focus handle, renderer key
  binding, Promise, Agent, Session, or renderer object.
- Compatibility adapters consume documented APIs, centralize capability and
  version differences, expose only a narrow renderer-neutral seam, and record
  a deletion condition. Missing optional capability uses an absent/plain
  fallback and must not block the Agent loop.
- Provider replacement follows `capture -> abort -> dispose -> activate ->
  restore`; activation failure restores the defined plain fallback.
- New public surfaces need a real consumer, headless lifecycle evidence,
  relevant replay/abort/late-result tests, renderer width coverage, bundle
  composition coverage, and dedicated-profile acceptance.
- Cordis entries export `name`, optional `inject`, and `apply(ctx)`. Effects are
  Fiber-owned. Requests to the app owner use narrow services/events rather
  than carrying Agent or Session objects.

Package `AGENTS.md` files hold only non-obvious implementation boundaries,
ownership, change rules, and verification triggers. Update one when a change
alters those facts, a public/subpath surface, lifecycle, composition, or the
required verification. Ordinary refactors and added tests do not require
documentation churn. Keep user-facing `README.md` and `README.zh.md` in sync.

## Local Verification

Start with the change-aware gate:

```sh
pnpm run verify:changed -- --plan  # inspect the selected checks
pnpm run verify:changed            # execute them
pnpm run verify:full               # complete CI code gate plus happy smoke
```

`verify:changed` compares `origin/master...HEAD` by default and also includes
staged, unstaged, and untracked files; use `--base <ref>` when needed. It fails
closed:

| Change | Local gate |
| --- | --- |
| Agent docs or shipped skills | AGENTS/skill drift and author-doc checks only |
| Ordinary package source | changed-file lint, incremental type/build, related Vitest, exact changed-file 100% coverage |
| Renderer source | ordinary gate plus the owning width scan |
| Lifecycle-sensitive source | the owning package test suite with changed-file coverage |
| Package/build manifests | build, `check:lib`, and package validation |
| Public API/UI, global config, shared test infrastructure, deleted TypeScript, or unknown repository scripts | full gate |
| Website source | strict website build in addition to applicable checks |

The planner is an iteration aid, not the merge authority. CI always runs the
full deterministic code gate. Use `pnpm run verify:full` before handing off a
broad, release, architecture, composition, or workflow change. It runs full
coverage once; do not precede it with a redundant plain `pnpm run test`.

Useful direct commands remain `pnpm run test`, `pnpm run test:coverage`,
`pnpm run typecheck`, `pnpm run lint`, `pnpm run build`,
`pnpm run check:lib`, `pnpm run check:pack`, `pnpm run check:examples`,
`pnpm run website:build`, and the smoke scripts. `pnpm run build:changed`
performs incremental project-reference emission and bundles only changed
runtime packages; structural build changes use the full clean build.

The build contract is derived from package manifests: concrete `exports` and
`bin` targets determine tsdown entries through `script/package-contract.mjs`.
The package `files` whitelist remains independent. Any subpath change must
update its export, source entry, types target, and files inclusion;
`pnpm run check:lib` verifies the built/published closure.

## Test Contracts

- Vitest 4 uses fork workers. Specs import the package under test through
  relative `src/*.ts`; runtime package-name imports inside that source still
  resolve workspace `lib/`, so a fresh worktree needs one full build baseline.
  Coverage is per-file 100% for executable source in packages and examples;
  type-only `src/types.ts` files are excluded.
- A component must never return a row wider than `render(width)`. Add new
  content renderers to the owning `width-scan.spec.ts`; all width helpers in
  runtime code flow through `blueComponents`, and tests use
  `packages/core/src/width.ts`. The frame clamp is only a diagnostic backstop.
- Tests create temporary roots with `mkdtempTracked()` and register
  `registerTempDirCleanup()` from `packages/core/tests/temp-dir.ts`. Do not use
  raw `mkdtempSync` for profile/session fixtures.
- `packages/bundle/blue/tests/e2e.spec.ts` is the whole-tree Cordis test.
  Independent plugin compatibility uses
  `node script/blue-plugin-fixture.mjs <package> --install` on the sole Harness
  line declared by the machine catalog; an override is diagnostic evidence,
  not a new compatibility claim.

## Worktree And Acceptance

Develop every user-visible behavior, public seam, or Website change in a
dedicated worktree and branch. Never link a checkout into the production
`blue` profile. Use `blue-dev` for the main development checkout and
`blue-<tag>` for a worktree.

1. Implement code, tests, docs, and any required package `AGENTS.md` update in
   the worktree. Iterate with `verify:changed`; use `verify:full` before
   acceptance when the classifier, owning package instructions, or the broad
   change rules above require it.
2. Choose acceptance artifacts from the actual change. Documentation-only
   changes do not require a Blue profile. Here, documentation means README,
   `docs/**`, Website pages/assets, and `AGENTS.md`; executable configuration,
   manifests, scripts, preset payload, and shipped `SKILL.md` files are not
   documentation-only even when their syntax is Markdown or YAML.
3. For any `website/**` change, build and serve the result on the local network:

   ```sh
   pnpm run website:build
   pnpm --dir website exec vitepress preview . --host 0.0.0.0 --port <available-port>
   ```

   Keep that process available and give the user the affected routes under
   `http://<actual-lan-ip>:<port>/` for explicit visual/content acceptance.
   `0.0.0.0` is the bind address, not a browser URL; never hand off
   `0.0.0.0`, `localhost`, or `127.0.0.1` for LAN review. A Website-only
   documentation change uses this preview and no Blue profile. A mixed
   Website/runtime change requires both acceptance paths.
4. When runtime behavior, a public seam, composition, preset payload, or
   shipped skill requires a Blue profile, install from the worktree with
   `PROFILE=blue-<tag> script/install-dev.sh`, then run the relevant
   headless/PTY smoke. Give the user `dsh --profile blue-<tag>` together with a
   change-specific acceptance checklist: the primary workflow, expected
   result, relevant fallback or narrow-width/lifecycle case, and the nearby
   behavior that must not regress. Rebuild after source edits; reinstall only
   when the dependency graph changes.
5. Wait for every applicable human acceptance. Do not merge, stop a Website
   preview, remove a profile, or redirect acceptance to the shared `blue`
   profile beforehand.
6. After acceptance, merge, rebuild the main checkout when runtime output is
   involved, then stop previews, remove worktree profiles, and record the
   exercised routes/scenarios in the merge summary.

## Style, Dependencies, And Security

- Match surrounding code: no semicolons, single quotes, 2-space indentation,
  `.ts` relative import extensions, `import type`, strict TypeScript, and a
  factual module-level `@module` JSDoc. Empty type imports may intentionally
  activate declaration merges.
- There is no formatter. Oxlint covers `packages` and `examples`. Do not
  reimplement width math or add pi-tui outside core.
- pnpm's minimum-release-age exclusions and disabled `koffi` build are
  intentional. Harness line changes must update the complete pin/exclusion
  set and pass `packages/transcript/tests/version.spec.ts`; evolve the lockfile
  without broad dependency refreshes.
- Do not commit secrets. Treat `cordis.patch.yml` `!!js` values as executable
  code. Do not enable dependency build scripts without review.

## Skills

Blue repository maintenance has no `.agents/skills` layer: durable maintainer
guidance lives here, in package `AGENTS.md`, and in deterministic commands.
The three skills under
`packages/bundle/blue/presets/blue-cordis/skills/` are shipped to preset users:
dynamic runtime prototyping, durable external Blue plugin creation/migration,
and user-owned composition editing. They are not required for ordinary Blue
source development. Run `pnpm run check:agent-docs` after changing these
instructions and `pnpm run check:plugin-authoring-docs` after changing the
shipped author skill.
