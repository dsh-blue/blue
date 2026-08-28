# `@dsh-blue-example/status-provider`

Renderer-neutral provider example scoped to the host candidate registry and
one consumer Fiber. Registration is inert: the package never reads or writes
settings, priority does not activate it, and only the Blue composition owner
may render it after explicit user selection. The callback is synchronous and
side-effect free.

Keep the package opt-in and outside the product bundle. Its manifest, entry
name, package name, and one-row Cordis patch id/name remain identical.
