# `@dsh-blue/blue`

English | [中文](README.zh.md)

The installable Blue terminal UI bundle for dsh. Its flat
`cordis.patch.yml` composition adds 36 sibling rows over `dsh-base`: six
dsh support rows and 30 Blue product rows.

Plugins inherit native dsh services directly and opt into terminal UI with
`bluePanes`, `blueStatus`, `blueOverlays`, and
`blueEditorExtensions`. The current Agent is available through
`blueCurrentAgent`. Official Blue features use those same services.

The `blue-cordis` preset includes skills for temporary prototyping, durable
ordinary Cordis plugin authoring, and composition editing. No special Blue
manifest, capability host, adapter, or plugin-author CLI is required.
