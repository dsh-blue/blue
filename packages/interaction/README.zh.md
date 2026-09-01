# `@dsh-blue/blue-interaction`

[English](README.md) | 中文

Blue 的输入 editor、slash-command UX、dialog、approval/question 处理、
interaction state 与 editor-extension runtime。

内置 command 注册到原生 `ctx.commands`。它们从
`ctx.blueCurrentAgent` 获取当前 Agent，并用 dsh 原生 service 处理
projection、tool、setting、skill、mode、model、session 与 persistence。

`blueEditorExtensions` 在唯一的 Blue editor 周围添加 passive row、
diagnostic、action、completion 与 submit transform。`bluePanes` 和
`blueStatus` 承载随包提供的 queue pane 与 mode badge。不存在 provider
candidate 或插件管理 facade。
