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
