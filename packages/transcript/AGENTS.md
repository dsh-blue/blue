# `@dsh-blue/blue-transcript`

Transcript owns the projection-backed transcript renderer, tool presentation,
status footer, and shipped pane/status contributors.

It consumes the exact Agent from `blueCurrentAgent` and reads native
`sessionProjections` snapshots. It may consume native dsh tool, command,
settings, title, and model services where required. It must not fold a second
copy of Harness session events or expose Agent/Session through renderer models.

Official conversation projection is the transcript source of truth.
Read/search grouping derives bounded semantic facts at the projection consumer
layer. Renderer caches are keyed by stable model identity, width, and local
presentation policy, and are disposed on replacement, eviction, detach, or
unload.

`SessionFactsService` also mirrors the official `goal` projection for the todo
badge and clears it on Agent replacement. Jobs status reads the native `jobs`
registry for the exact current Agent. Workflow rows fold native lifecycle
facts only after a member child id is attributed through the current Agent's
native Sessions; settled rows clear on the next turn, while live timers and all
event subscriptions are Fiber-owned.

Status producers register directly with `blueStatus`; pane producers register
directly with `bluePanes`. Blue's shipped rows use the same definitions and
Fiber cleanup as external plugins. There are no package-private status/pane
registries, public bridges, provider candidates, or provider selection state.

Every row must fit `render(width)` and all width operations use core helpers.
Locale translates Blue chrome only. Lifecycle, projection, pane, status, tool
presentation, or width changes require the owning suite and width scan, bundle
e2e, `pnpm run verify:full`, and dedicated-profile acceptance.
