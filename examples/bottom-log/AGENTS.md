# `@dsh-blue-example/bottom-log`

Interaction example scoped to one consumer Fiber and the host `panes`
registry. It contributes a passive, bounded bottom log with no subscription,
timer, background task, or duplicate state source. Core owns layout and
renderer behavior.

Keep the package opt-in and outside the product bundle. Its manifest, entry
name, package name, and one-row Cordis patch id/name remain identical.
