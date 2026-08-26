# FAQ

## Why not a plain `npm install @dsh-blue/blue`?

Blue is a plugin bundle installed into a dsh profile, not a standalone app — a bare install only drops the package into node_modules, with no host and no profile assembly, so there is nothing to run. The supported paths: the `blue` shell (`npm i -g @dsh-blue/blue-cli@rc`), or `dsh plugin --profile blue add @dsh-blue/blue@rc`; see [Quickstart](/en/guide/). Preview releases publish only under the **`rc` dist-tag** (`latest` is reserved for the stable line; npm refuses to delete `latest` before the first stable exists, so it currently aliases the newest rc as a mere placeholder). The current preview is `v0.1.0-rc.9-test.5`; `0.1.0-rc.1` shipped broken tarballs (missing files) — if it is installed, upgrade. The contributor development install lives in the developer manual under [Contributing to Blue](/en/plugins/contributing).

## `@rc` does not resolve the newest preview?

pnpm 11 enables a `minimumReleaseAge` cooldown by default: dist-tag resolution silently skips versions published inside the window and falls back to an older one. If `dsh plugin --profile blue add @dsh-blue/blue@rc` installs a stale version, either:

- install the exact version right away — `dsh plugin --profile blue add @dsh-blue/blue@0.1.0-rc.9-test.5` (match the repository's newest tag);
- or re-run the same `@rc` command once the cooldown window has passed (upgrading = re-running the same `plugin add`).

Upgrading through `/update` avoids the trap entirely: it resolves the target from registry metadata, always pins the exact version, and inside the cooldown window it answers with the retry time (an ETA) instead of installing a stale build.

## How do I upgrade Blue?

Two paths:

- **Shell users**: re-run `npm i -g @dsh-blue/blue-cli@rc` — reinstalling is the upgrade (the shell calibrates the profile's Blue to its own version and pins the host line with it); start with `blue` as usual afterwards.
- **Direct-dsh users**:
  - **In-app (recommended)**: type `/update` in the session — it runs the safety pre-flight first (profile health, whether the global dsh CLI meets the target release's harness line, the cooldown window), then after a typed `y` confirmation it snapshots the current install, installs the exact version in one transaction, verifies the whole package set, and boot-smokes the result (a module import sweep plus a real boot); any failure **rolls back automatically** to the previous version, with a progress panel and a log path throughout. `/update <version>` pins an explicit target; a bare `/update` doubles as a read-only check. After a successful update the current session keeps running the old version — a restart applies it.
  - **Manually**: re-run the same `dsh plugin --profile blue add @dsh-blue/blue@rc` (or the exact-version form in the previous question).

Blue also checks for a newer release in the background at startup (at most once per 24h, silent on failure, reads registry metadata only, sends nothing); when one exists it appends a two-line notice to the scroll area (below the banner at boot). To turn the startup check off, write this into `~/.dsh/settings.yaml`:

```yaml
blue:
  updateCheck: false
```

## Pasting an image does nothing?

Ctrl-V paste depends on two things:

1. **Terminal environment**: the platform's own clipboard path is probed — `wl-paste` then `xclip` on Linux (3s timeout), one PowerShell call on Windows (10s), osascript on macOS (5s);
2. **Model capability**: pasted images enter the message as image content blocks. If the current model route has no image input, messages containing image blocks are rejected — that is the upstream harness capability negotiation; switch to a vision-capable model.

Images land in the attachment store (default `~/.dsh/attachments`; relocate via `DSH_BLUE_ATTACHMENT_DIR` or `DSH_HOME`), capped at 10MB per image, 8 images / 30MB / 16M pixels per message.

You can copy image content from an application or copy one or more local PNG/JPEG/WebP/GIF files in your file manager (Ubuntu Files, Windows Explorer, macOS Finder — all paste as one ordered batch). The file-manager path only accepts local regular files; remote URIs, directories, symlinks, and special files are refused with a reason.

## Why doesn't the injected AGENTS.md context show up in the transcript?

The harness injects workspace instructions (AGENTS.md and friends) and runtime-context snapshots into the session as synthetic user messages. Blue sorts by message source: human input renders as usual (`»` message blocks); **synthetic messages render as nothing** — no item, no placeholder — keeping the transcript clean. The content is still sent to the model in full; it is just not rendered.

## Can I customize key bindings?

Not yet. Keys register through `blueKeymap` (duplicate bindings are rejected), but user-facing customization is deferred to a later phase (same for alt-screen surfaces). See [Key bindings](/en/reference/keys) for everything available today.

## `/quit` does nothing?

In the brief window before the agent attaches, `/quit` shows `no active session` instead of exiting — command dispatch checks for a current agent. Retry a moment later. **Double Ctrl-C within 1 second** also exits interactive mode.

## When does the status-bar git badge refresh?

The git badge probes lazily through a TTL cache (branch 5s, status 15s), refreshed on whatever redraw comes next (typing and streaming both trigger one) — switching branches in the same directory shows up within seconds. The cache is built per working directory: a session switch (`/new`, `/resume`, or a restart) that lands on a new cwd rebuilds the cache for it.

## What happens when the status bar runs out of room?

The footer has at most two rows, each split into a left and a right cluster (entries land via their `band`/`row`). When width runs short, an over-wide entry truncates to the remaining budget (entries declaring `overflow: hide` hide entirely rather than truncate), and once a cluster is full, later entries stop appearing. The order is registration order (the bundle's row order); the priority tiers the built-ins declare (0 / 5 / 10 / 20 / 30) are metadata the status footer does not currently consume (priority ordering applies to dock panes).

## Does bash-mode output enter the session history?

No. Commands in `!` bash mode run through Blue's own executor and echo into the scroll area as shell cards — **deliberately outside the session transcript**, invisible to the model. Paste results back into the prompt, or let the model run a tool, when it needs to know.
