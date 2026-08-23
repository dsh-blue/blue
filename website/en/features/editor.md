# Input editor

The input editor is the rounded-box component at the bottom of the terminal: `>` prompt, multi-line editing, history and kill-ring, undo — the text-editing machinery comes from the underlying pi-tui Editor; Blue layers context and enhancements on top.

## Slash-command context

Input starting with `/` turns the frame `primary` blue and enters command context:

- **Fuzzy autocomplete** — the query splits on whitespace into tokens, each matched as a subsequence, ranked by score; every dropdown entry shows a two-part `hint — description`, Enter accepts the preselected entry and submits.
- **Discovery hints** — while the dropdown is closed, the hint line flashes up to three fuzzy matches sharing the same filter — the discovery path into slash commands.
- **Argument ghost hints** — shown at most one space after `/command` (e.g. `/resume <session-id>`); a leading space is added before you type the separator.

All commands live in the [Slash commands reference](/en/reference/commands).

## `!` bash mode

When the buffer is exactly `!`, bash mode engages (the `!` never enters the buffer) with a triple cue: the `!` prompt, the ` ! shell mode ` frame label, and the `shellMode` violet frame. Submitting returns to prompt mode automatically.

Commands run through Blue's own executor and echo as shell cards (sanitized, truncated per stream: 200 lines / 64KB each), failures keep an `exit code N` line — **deliberately outside the session transcript**, invisible to the model. Prompt and bash submissions share one history (Up recall is not mode-filtered).

## `@` file completion

`@` triggers file-path completion: fd first, filesystem scan fallback, 200-entry cap, fuzzy-ranked. Completion covers file paths; command-argument completion is deferred.

## `#` skill invocation

`#` triggers skill-name completion (the same fuzzy matching as slash completion; the `/skills` panel, grouped by source layer, is the full catalog). On submit, `#name` is rewritten to `/name` and routed through the harness's skill gesture path — the transcript echoes the rewritten `/name`, and the skill's injection renders zero lines per the injected-context rule.

## Large-paste folding

Pasting more than 10 lines or 1000 characters folds into a `[paste #N +M lines]` marker (the full text lives in the editor and expands automatically before submit — the model receives everything); the transcript side folds the same message into a 3-line preview plus a hint row, with `Ctrl-O` expanding on equal terms. History recall (Up) brings back the expanded full text.

## Ctrl-G external editor

`Ctrl-G` hands the current draft to `$VISUAL` (falling back to `$EDITOR`) for full-screen editing: Blue suspends rendering and yields the terminal to the child process; on a normal editor exit the screen restores and the text is read back (paste markers survive the round trip). Quitting with `:cq` counts as cancellation — the draft stays as it was.

## Ctrl-V image paste

Ctrl-V stores the clipboard image in the attachment library and inserts an `[image #N]` marker at the cursor; on submit the markers split into image content blocks. Markers survive theme switches.

Dependencies and limits: probes `wl-paste` then `xclip` on Linux; 10MB per image, 8 images / 30MB / 16M pixels per message; the model must accept image input (see the [FAQ](/en/guide/faq)).

## Editor-context keys

With the editor focused, a contextual key chain applies (see [Key bindings](/en/reference/keys)): Escape first dismisses the completion popup, then closes a side-question pane mounted above, then clears the draft, then interrupts a running agent; Ctrl-C clears → interrupts → a second press within 1 second exits; Ctrl-S steers the non-empty draft into the current turn; ↑/↓ on an empty buffer scroll the side pane first, then recall queued messages (without the queue pane, they go to editor history).

## Draft survival

The unsubmitted draft, input mode (bash triple cue included), and hint history are mirrored into a draft stash — a `/theme` hot-switch rebuilds the editor fiber and restores everything, so a just-submitted `/theme light` won't vanish from Up history either.
