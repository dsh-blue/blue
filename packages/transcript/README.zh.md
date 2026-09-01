# `@dsh-blue/blue-transcript`

[English](README.md) | 中文

Projection-backed transcript 渲染、语义 tool card、status footer，以及 Blue
随包提供的 pane/status 贡献。

本包通过 `blueCurrentAgent` 读取当前 Agent，并消费 dsh 原生
`sessionProjections` 与 tool service。Status entry 注册到
`blueStatus`；activity、todo、BTW 与 Agent pane 注册到 `bluePanes`。
外部 Cordis 插件使用的也是同一批直接 service。
