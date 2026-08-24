---
name: blue-plugin-development
description: Use when creating, changing, or debugging Blue itself — the terminal UI plugin tree in the dsh-blue repository. Covers where a UI behavior lives (which package, which seam), the row-width and effect-bound contracts, the subpath export triangle, the gate commands, and the worktree + dogfood iteration loop. Not for editing compositions — use editing-cordis-compositions for those.
---

# Develop Blue plugins

Blue is a renderer over the harness's Cordis plugin architecture, shipped as seven `@dsh-blue/blue-*` packages. Only `packages/core` touches pi-tui or raw terminal state; every other package programs against the `Blue*` L1 contracts. Preserve that boundary.

## Repository map

```
packages/
  api/          @dsh-blue/blue-api          — stable renderer-independent contracts (BlueView, BlueResult, capabilities)
  core/         @dsh-blue/blue-core         — the ONLY pi-tui adapter: terminal lifecycle, keymap, components, themes, chrome
  transcript/   @dsh-blue/blue-transcript   — session events → transcript items; status footer; dock panes; render intents
  interaction/  @dsh-blue/blue-interaction  — input editor, slash commands, dialogs, completions
  app/          @dsh-blue/blue-app          — CLI startup + Agent driver
  bundle/blue/  @dsh-blue/blue              — the installable unit (cordis.patch.yml, three segments)
  cli/          @dsh-blue/blue-cli          — the `blue` launcher shell (outside the plugin tree)
```

Dependency direction: core ← transcript / interaction ← app ← bundle. Cross-plugin communication uses Cordis services (`ctx.blueScreen`, `ctx.blueKeymap`, `ctx.blueComponents`, `ctx.blueStatus`, `ctx.blueIntents`, `ctx.blueSession`) and events (`'blue/session-changed'`, `'blue/request-resume'`).

## Plugin conventions

Every package entry is a Cordis plugin: `name` (stable string), optional `inject`, `apply(ctx)`. **Every registration must be effect-bound** so unloading the plugin fiber reverts every contribution. Each package ships an `invariant.ts` companion (`<pkg>/invariant` export). Modules open with a JSDoc `@module` header; exports carry JSDoc with `@param`/`@returns`.

## The row-width hard contract (D48)

`BlueComponent.render(width)` must never emit a row whose visible width exceeds `width`. Measure every hand-assembled row with pi-tui's own helpers — through the components service or `@dsh-blue/blue-core/chrome`'s `clampRowsToWidth`; core-internal code and tests import `packages/core/src/width.ts`. **Never hand-roll width math** (codepoint counters are exact only for ASCII and let CJK mis-budgets slip through). A new content-rendering component adds itself to its package's `width-scan.spec.ts`, which renders the shared `ADVERSARIAL` fixtures at every `SCAN_WIDTHS` width.

## The subpath export triangle

Adding, renaming, or removing a package subpath moves **three** manifests together: the package's `package.json` `exports`, its `files` tarball whitelist, and the root `tsdown.config.ts` entry enumeration. Nothing ties them together mechanically except `pnpm check:lib` — run it. A plugin mounted through the package index needs none of the three.

## Tests and gates

Specs live in `packages/*/tests/**/*.spec.ts` (vitest 4, forks pool) and import the package under test through **relative `../src/*.ts` paths** — never through built `lib/` or package names. Commands, from the repo root:

```sh
pnpm run build          # tsc -b types + tsdown runtime bundle — required before any real run
pnpm run test           # unit suites + the bundle's whole-tree e2e
pnpm run test:coverage  # per-file 100% gate on src — write specs accordingly
pnpm run typecheck && pnpm run lint
pnpm check:lib          # the export triangle, mechanically
pnpm check:pack         # the seven publish tarballs (publint, ATTW, budgets)
```

Specs create temp roots with `mkdtempTracked(prefix)` from `packages/core/tests/temp-dir.ts` (relative import) and call `registerTempDirCleanup()` once at module top — raw `mkdtempSync` leaks. Width fakes are forbidden: every `visibleWidth`/`wrapText`/`truncateToWidth` in a fake delegates to pi-tui through `packages/core/src/width.ts`.

## The iteration loop (mandatory)

The runtime entry of every package is `lib/` — source edits alone have no effect on a running install.

1. Open a worktree for the feature from `master` (branch `p2/<slug>`); carry the docs and AGENTS.md updates in the worktree.
2. Pass the full gate in the worktree, commit.
3. Dogfood on a real terminal against the worktree's own profile: `PROFILE=blue-<tag> script/install-dev.sh` from the worktree, exercise the feature, and get the user to live-test `dsh --profile blue-<tag>`. Rebuild with `pnpm --dir <worktree> run build` between looks.
4. Merge only after the user accepts; then rebuild in the main checkout and delete the profile (`rm -rf ~/.dsh/profiles/blue-<tag>`).

Profile lanes: `blue` is production, npm installs only — never link into it. `blue-dev` links the main checkout. `blue-<tag>` is a worktree's acceptance profile.

## Where an edit belongs

- **A terminal behavior** (rendering, keybindings, panes, dialogs, commands): Blue source in the owning package above.
- **A pure assembly change** (which rows mount, row config): the bundle's `packages/bundle/blue/cordis.patch.yml` — three segments; `bundle.spec.ts` pins the thin-host disable list to the web-app's, so keep that lockstep.
- **A session capability** (a tool, a prompt section): an agent preset — see the editing-cordis-compositions skill.
- **A quick behavior experiment**: a host-half-only dynamic plugin via the cordis_* tools — see the cordis-plugin-development skill. There is no browser client half in Blue; do not write `code.client`.

## House style

TypeScript ESM, no semicolons, single quotes, 2-space indent. Relative imports carry the `.ts` extension. Type-only imports use `import type`; empty `import type {}` lines deliberately pull in Cordis declaration merges — do not delete them. Strict flags include `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. When a change alters documented behavior, sync the owning package's `AGENTS.md` (and its bilingual READMEs if user-facing) in the same change.
