# Upstream issue draft: dsh `plugin add` on Windows — missing pnpm is misdiagnosed (exit 9009, ENOENT branch unreachable)

> 交付物（D56）：以下英文成稿供提交到上游 dsh 仓库的 issue tracker；提交前按上游模板微调标题/章节。上游修复后，Blue 壳侧的 win32 预检与 9009 判类可随 roadmap S40 退役。

---

**Title:** `plugin add` on Windows: a missing pnpm surfaces as exit 9009 + "pnpm failed in profile directory" — the `ENOENT` branch is unreachable

**Environment:** `@deepseek-ai/dsh` 0.1.1-rc.2, Windows (any supported version), pnpm NOT installed (or not on the shell's `PATH`).

**Steps to reproduce:**

1. On Windows, make sure `pnpm` is not on `PATH` (`where pnpm` finds nothing).
2. Run any plugin add, e.g. `dsh plugin --profile t add <any-spec>`.

**Actual:**

```
dsh: pnpm failed in profile directory <dir>
```

…with the process exiting 9009 — the generic-failure branch. The `"pnpm not found on PATH"` branch never fires, so the user gets a misleading message (pnpm did not "fail"; it does not exist) with no install hint.

**Expected:** the `ENOENT` branch's message — `pnpm not found on PATH — install pnpm to manage profile plugins` (exit 127).

**Root cause:** in the `plugin` command's runner:

```js
const result = spawnSync("pnpm", args.map(...), {
  cwd: dir,
  stdio: "inherit",
  shell: process.platform === "win32"
})
```

With `shell: true` on win32, Node spawns `cmd.exe /d /s /c "pnpm ..."`. When cmd.exe cannot find the command it prints "'pnpm' is not recognized…" and **exits with status 9009** — `result.error` stays `undefined`, so the `result.error.code === "ENOENT"` check can never match. The same swallowing happens on posix if `ComSpec`/shell resolution is involved (`/bin/sh` returns 127 the same way). Verified experimentally: `spawnSync('missing-cmd', { shell: true })` → `error: undefined, status: 127` (posix) / `9009` (win32 cmd).

**Suggested fixes (any one):**

1. After a `shell: true` spawn, map exit 9009 (win32 cmd) / 127 (posix sh) to the not-found branch before the generic failure.
2. On win32, drop `shell: true` and spawn `pnpm.cmd` directly — both npm-installed and corepack-enabled pnpm ship a `.cmd` shim — restoring a true ENOENT.
3. Pre-probe with `where.exe pnpm` (win32) / `command -v pnpm` (posix) before the real spawn.

**Downstream impact:** `@dsh-blue/blue-cli`'s first-run bootstrap spawns the nested dsh `plugin add`; on a fresh Windows machine with only npm installed, users saw `blue: bootstrap failed — dsh: pnpm failed in profile directory …` instead of the pnpm install hint. We now classify the 9009 exit ourselves (dsh-blue/blue D56: pre-flight probe through ComSpec + post-install 9009 mapping), but an upstream fix removes the need for every downstream consumer to work around it.

