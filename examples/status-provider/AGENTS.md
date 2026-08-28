# `@dsh-blue-example/status-provider`

Renderer-neutral provider example scoped to the host candidate registry and
one consumer Fiber. Registration is inert: the package never reads or writes
settings, priority does not activate it, and only the Blue composition owner
may render it after explicit user selection. The callback is synchronous and
side-effect free.

Registration is host-scoped and durable across frontend-owner boot gaps: this
sibling row may apply before `blue-status-provider-owner`, whose initial
snapshot then replays the inert candidate. Owner reload retains the candidate;
consumer unload removes it. Selection, rendering, LKG, breaker, and fallback
remain frontend-tree owner state.

Keep the package opt-in and outside the product bundle. Its manifest, entry
name, package name, and one-row Cordis patch id/name remain identical.
