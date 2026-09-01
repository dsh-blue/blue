# `@dsh-blue/blue-interaction`

English | [中文](README.zh.md)

Blue's input editor, slash-command UX, dialogs, approval/question handling,
interaction state, and editor-extension runtime.

Built-in commands register on native `ctx.commands`. They obtain the selected
Agent from `ctx.blueCurrentAgent` and use native dsh services for projections,
tools, settings, skills, modes, models, sessions, and persistence.

`blueEditorExtensions` adds passive rows, diagnostics, actions, completion,
and submit transforms around the single Blue editor. `bluePanes` and
`blueStatus` carry the shipped queue pane and mode badge. There are no
provider candidates or plugin management facade.

The `./jobs` row registers `/jobs` against native `ctx.jobs`: live jobs sort
first, Enter explicitly consumes output, and `k` kills a live job. The
`./agents-command` row registers `/agents` against native `ctx.subagents`,
`ctx.sessions`, and `ctx.sessionProjections`, using native workflow labels when
one-shot descriptors omit them; its temporary attach view keeps
the parent Agent selected while rendering a child transcript and offering
follow-up or interrupt actions where the child mode permits them. Continuable
attach input always renders its cursor, including before the first character.
