# `@dsh-blue/blue-context`

F3 dsh-context vertical slice. `OfficialContextSource` is the narrow compatibility adapter over the official `sessionProjections.snapshot()` / `onChanged()` surface. It reads the dsh-context-owned `contextTimeline` projection and token-meter-owned `contextPressure`, `contextBreakdown`, and `tokenUsage` keys as one renderer-neutral whole-value model. It never exports or retains an Agent/Session outside the adapter; the opaque current-session handle exists only long enough to call the official service.

The projection registry emits once per changed key while driving a committed event. The adapter coalesces those callbacks through one microtask and then reads a consistent snapshot, so multiple keys at one seq cannot be lost to watermark dedupe. It buffers the newest cut across the baseline-to-subscribe gap, drops late events after disposal, and re-attaches on `blue/session-changed`. Invalid projection keys degrade independently.

The model includes usage, pressure, composition, current-surface categories, request/event summaries, and a status provider. Official projections are push-driven and expose no refresh action; compatibility `ContextSource` implementations may still advertise `refresh`, in which case the panel publishes the structured `context.refresh` action. Remove that bridge once every supported host has the official projection path.

The legacy `blue-status-context` and old `/context` facts reader remain fallbacks until live TUI acceptance. The optional `blue-context` bundle row supplies the official feature; it does not own or duplicate the dsh-context domain fold.
