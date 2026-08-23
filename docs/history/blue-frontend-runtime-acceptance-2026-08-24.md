# Blue Frontend Runtime Acceptance (2026-08-24)

> Archived acceptance record for `p2/frontend-runtime`. Living implementation
> state remains in `docs/blue-implementation-plan.md` and the package-level
> `AGENTS.md` files.

## Scope

Acceptance used only the dedicated linked profile
`dsh --profile blue-frontend-runtime`. The npm-only production `blue` profile
was not linked, overwritten, or used as the acceptance target. The accepted
build identified itself as `0.1.0-rc.2+frontend-runtime.14e2570`.

The production cutover enables `blue-context`, `blue-conversation`,
`blue-transcript-official`, `blue-openpencil`, and `blue-lark` by default.
Capability absence and provider unload remain supported paths: context falls
back to the legacy facts reader, transcript restores the legacy event fold,
and the ecosystem adapters contribute nothing when their public capability is
absent.

## Human Acceptance

The user exercised the live profile and reported these outcomes:

- specialized version identity was correct;
- subagent invocation succeeded after its fix;
- tmux drag selection copied through the native tmux clipboard path;
- the duplicate Editor/footer render during `/goal` no longer reproduced;
- no additional issue was found;
- explicit final decision: `验收通过，允许合并到主分支。`

## Automated Evidence

Before the live decision, the dedicated profile passed install, official
context projection, live and resumed conversation projection, manual scroll,
new-message notice, End-follow, narrow-width resize, selection copy, and clean
exit. Isolated tmux 3.6 verification used `set-clipboard external` and
`allow-passthrough off`; `tmux load-buffer -w -` populated both the tmux paste
buffer and the outer OSC 52 payload with `Welcome`.

Remote Unix/SSH fixtures covered authenticated negotiation, multiple sessions,
resume, question/approval, lease contention/expiry, reconnect, and late-event
cleanup. Installed-package fixtures covered frontend-runtime providers and the
context, conversation, transcript, OpenPencil, and Lark consumers against the
current `0.1.1-rc.2` and previous `0.1.1-rc.1` Harness lines with no skipped
scenario.

After the production-row switch, the final repository test and coverage gates
passed 2,127 tests in 136 files. Per-file coverage remained 100%: 9,795/9,795
statements, 6,143/6,143 branches, 1,986/1,986 functions, and 8,113/8,113
lines. The same closure also passed typecheck, lint, diagrams, build/export,
website, real-process smoke, validator, and installed-package fixtures recorded
by the merge summary.

## Follow-up Boundary

`/goal` tool results still use the plain JSON renderer instead of a specialized
tool wrapper. This is visible but did not block acceptance; it remains a later
official-surface migration slice.

Human acceptance does not authorize deleting compatibility code. The legacy
context reader, transcript fold, editor, panes, and tool renderers remain until
the exact consumer and fallback deletion conditions in
`docs/blue-surface-migration-matrix.md` are independently satisfied.
