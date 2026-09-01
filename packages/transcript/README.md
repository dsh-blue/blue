# `@dsh-blue/blue-transcript`

English | [中文](README.zh.md)

Projection-backed transcript rendering, semantic tool cards, the status
footer, and Blue's shipped pane/status contributions.

The package reads the selected Agent through `blueCurrentAgent` and consumes
native dsh `sessionProjections` and tool services. Status entries register on
`blueStatus`; activity, todo, BTW, Agent, and workflow panes register on
`bluePanes`. The todo title reflects the native `goal` projection, the jobs
status reads native `ctx.jobs`, and workflow runs are attributed through
native child Sessions. These are the same direct services available to
external Cordis plugins.
