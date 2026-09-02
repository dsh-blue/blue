# `@dsh-blue/blue`

This package is the installable flat Cordis composition. Its module entry owns
no product behavior.

`cordis.patch.yml` inserts 36 ordinary siblings over `dsh-base`: six dsh
support rows and 30 Blue rows. Dynamic plugins, official Blue rows, and native
dsh services share one service graph. There is no Cordis group/isolate,
service deny-list, host facade, adapter layer, or provider owner.

Ordering requirements are explicit `inject` dependencies, never YAML
position. Blue UI services mount before their consumers; app supplies
`blueCurrentAgent`; transcript and interaction consume native dsh services
and publish direct UI contributions.

The preset ships three user-facing skills: process-local Cordis prototyping,
durable ordinary Cordis plugin development, and user-owned composition
editing. They must teach direct native dsh services and the four Blue UI
services. They must not teach a special manifest, capability request, author
CLI, private realm, or Blue host.

Patch, preset, skill, dependency, or composition changes require bundle and
preset tests, `pnpm run check:agent-docs`, `pnpm run verify:full`,
`pnpm run check:pack`, dedicated-profile install, PTY smoke, and human
acceptance. Do not merge or remove the acceptance profile before approval.
