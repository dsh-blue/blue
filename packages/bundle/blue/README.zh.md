# `@dsh-blue/blue`

[English](README.md) | 中文

可安装的 dsh Blue 终端 UI bundle。它的 flat `cordis.patch.yml` 在
`dsh-base` 上增加 35 个 sibling：6 个 dsh 支撑行和 29 个 Blue product
行。

插件直接继承 dsh 原生 service，并通过 `bluePanes`、`blueStatus`、
`blueOverlays` 与 `blueEditorExtensions` 贡献终端 UI。当前 Agent 由
`blueCurrentAgent` 提供。Blue 官方功能使用完全相同的 service。

`blue-cordis` preset 包含临时原型、普通持久 Cordis 插件开发与 composition
编辑 skill。不需要专用 Blue manifest、capability host、adapter 或插件作者
CLI。
