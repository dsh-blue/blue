# `@dsh-blue-example/editor-provider`

Renderer-neutral provider example scoped to the host candidate registry and
one consumer Fiber. Registration is inert and never mutates selection
settings. Its synchronous shell tree contains exactly one unconditional
`editor-control`; Blue retains draft, history, attachments, focus, IME, and
submit ownership.

`editor.provider` is an Experimental/reference Beta API facet. This example
validates the retained runtime and does not advertise a Stable v1 provider
capability.

Registration is host-scoped and durable across frontend-owner boot gaps: this
sibling row may apply before `blue-editor-provider-owner`, whose initial
snapshot then replays the inert candidate. Owner reload retains the candidate;
consumer unload removes it. Selection, shell/LKG state, breaker, gestures, and
fallback remain frontend-tree owner state.

Keep the package opt-in and outside the product bundle. Its manifest, entry
name, package name, and one-row Cordis patch id/name remain identical.
