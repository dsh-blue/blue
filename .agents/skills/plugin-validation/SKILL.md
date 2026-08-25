---
name: plugin-validation
description: Validate a Blue plugin package or migration result for architecture boundaries, public API, package exports, Fiber cleanup, fixtures, and acceptance evidence. Use for a release or migration gate; do not use as a substitute for implementing missing behavior.
---

# Validate A Blue Plugin

Run `node script/blue-plugin-validate.mjs <package>` and treat a nonzero exit as
a failed gate. Consume the JSON report rather than scraping prose.

Verify these groups:

1. `architecture`: domain/adapter/renderer dependency direction; no pi-tui,
   ANSI, raw terminal, React/DOM, terminal width, Agent, or Session leak across
   the renderer-neutral public boundary; no UI-owned event folding or mutable
   product singleton.
2. `package`: stable Cordis `name`, declared `inject`, exported `apply`, built
   `lib` target, `files` coverage, and the package exports/files/tsdown
   triangle.
3. `lifecycle`: Fiber-owned registrations/subscriptions/timers, provider
   unload/swap, abort, replay/resume, stale and late-result rejection.
4. `product`: official consumer, capability-absent/plain fallback, width scan,
   bundle row/disable switch, independent packed install, current/previous
   Harness line, and a dedicated non-production profile.

Run the package fixture with `--install` and compare its `declared`, `executed`,
and `skipped` scenario sets. Run the full repository gate from `AGENTS.md` when
the package changes product behavior. Report exact command, exit code, Harness
line, profile, fallback, unload, and width evidence; never convert missing
human acceptance into an automated pass.
