# FAQ

## Why does a bare `npm install @dsh-blue/blue` find nothing?

Preview releases are published only under the **`rc` dist-tag** (`latest` stays reserved for the stable line), and a bare install resolves `latest` — an uncontrolled version — use `dsh plugin --profile blue add @dsh-blue/blue@rc` instead, see [Quickstart](/en/guide/). The current preview is `v0.1.0-rc.4`; `0.1.0-rc.1` shipped broken tarballs (missing files) — if it is installed, upgrade. The contributor development install lives in the developer manual under [Contributing to Blue](/en/plugins/contributing).

## `@rc` does not resolve the newest preview?

pnpm 11 enables a `minimumReleaseAge` cooldown by default: dist-tag resolution silently skips versions published inside the window and falls back to an older one. If `dsh plugin --profile blue add @dsh-blue/blue@rc` installs a stale version, either:

- install the exact version right away — `dsh plugin --profile blue add @dsh-blue/blue@0.1.0-rc.4` (match the repository's newest tag);
- or re-run the same `@rc` command once the cooldown window has passed (upgrading = re-running the same `plugin add`).

Upgrading through `/update` avoids the trap entirely: it resolves the target from registry metadata, always pins the exact version, and inside the cooldown window it answers with the retry time (an ETA) instead of installing a stale build.

## How do I upgrade Blue?

Two paths:

- **In-app (recommended)**: type `/update` in the session — it runs the safety pre-flight first (profile health, whether the global dsh CLI meets the target release's harness line, the cooldown window), then after a typed `y` confirmation it snapshots the current install, installs the exact version in one transaction, verifies the six-package set, and boot-smokes the result (a module import sweep plus a real boot); any failure **rolls back automatically** to the previous version, with a progress panel and a log path throughout. `/update <version>` pins an explicit target; a bare `/update` doubles as a read-only check. After a successful update the current session keeps running the old version — restart dsh to apply.
- **Manually**: re-run the same `dsh plugin --profile blue add @dsh-blue/blue@rc` (or the exact-version form in the previous question).

Blue also checks for a newer release in the background at startup (at most once per 24h, silent on failure, reads registry metadata only, sends nothing); when one exists it posts a two-line notice at the top of the scroll area. To turn the startup check off, write this into `~/.dsh/settings.yaml`:

```yaml
blue:
  updateCheck: false
```

## Pasting an image does nothing?

Ctrl-V paste depends on two things:

1. **Terminal environment**: a clipboard tool is probed — `wl-paste` then `xclip` on Linux (3s timeout);
2. **Model capability**: pasted images enter the message as image content blocks. If the current model route has no image input, messages containing image blocks are rejected — that is the upstream harness capability negotiation; switch to a vision-capable model.

Images land in the attachment store (default `~/.dsh/attachments`; relocate via `DSH_BLUE_ATTACHMENT_DIR` or `DSH_HOME`), capped at 10MB per image, 8 images / 30MB / 16M pixels per message.

You can copy image content from an application or copy one or more local PNG/JPEG/WebP/GIF files in Ubuntu Files. The file-manager path only accepts local regular files; remote URIs, directories, symlinks, and special files are refused with a reason.

## Why doesn't the injected AGENTS.md context show up in the transcript?

The harness injects workspace instructions (AGENTS.md and friends) and runtime-context snapshots into the session as synthetic user messages. Blue sorts by message source: human input renders as usual (`❯` bubbles); **synthetic messages render as nothing** — no item, no placeholder — keeping the transcript clean. The content is still sent to the model in full; it is just not rendered.

## Can I customize key bindings?

Not yet. Keys register through `blueKeymap` (duplicate bindings are rejected), but user-facing customization is deferred to a later phase (same for alt-screen surfaces). See [Key bindings](/en/reference/keys) for everything available today.

## `/quit` does nothing?

In the brief window before the agent attaches, `/quit` shows `no active session` instead of exiting — command dispatch checks for a current agent. Retry a moment later. **Double Ctrl-C within 1 second** also exits interactive mode.

## When does the status-bar git badge refresh?

The git badge probes lazily through a TTL cache (branch 5s, status 15s), but the probe is session-scoped: switching branches mid-session waits until the next session switch (`/new`, `/resume`, or restart) to show the new branch.

## What happens when the status bar runs out of room?

The footer has at most two rows. Entries that don't fit are dropped lowest-priority-first; over-wide entries truncate within their cluster budget. Ordering and eviction come from registry priorities (built-in entries occupy 0 / 5 / 10 / 20 / 30), not hardcoded positions.

## Does bash-mode output enter the session history?

No. Commands in `!` bash mode run through Blue's own executor and echo into the scroll area as shell cards — **deliberately outside the session transcript**, invisible to the model. Paste results back into the prompt, or let the model run a tool, when it needs to know.
