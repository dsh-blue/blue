# `@dsh-blue-example/ui-gallery`

Interaction example scoped to one consumer Fiber and the host `panes`
registry. It registers one static right-lane gallery that composes only
public `@dsh-blue/blue-ui` builders across content, rich-document/chart, layout, and pattern
groups, degrades into the bottom lane when narrow, and owns no mutable
host/session state: the active tab, list selection, form values, and busy
flags are fixed canonical snapshots with no event handler, so the tab strip
acts as a legend for the labeled groups below it. The host owns admission,
layout, width, refresh, and unload cleanup.

The source request and packaged manifest target the executable Blue API
`^1.0.0-beta.2`; this example is Beta evidence, not a Stable v1 claim.

Keep the package opt-in and outside the product bundle. Its manifest, entry
name, package name, and one-row Cordis patch id/name remain identical.
