# `@dsh-blue/blue-core`

[English](README.md) | 中文

Blue 的终端 renderer，也是仓库唯一的 pi-tui adapter。它持有终端启停、raw
mode、alternate screen、focus、键盘 dispatch、layout、theme、node
校验/编译与 visible width。

Core 直接订阅 `ctx.bluePanes` 与 `ctx.blueOverlays`。Pane/overlay 的
render 函数返回 renderer-neutral `BlueUiNode`，core 校验并编译成具体
component。Registry 与 renderer 之间没有 plugin host 或 bridge。

本包也为 Blue 自有 TUI 包提供底层 `blueScreen`、`blueKeymap`、
`blueTerminalInfo`、`blueComponents` 与 theme service。
