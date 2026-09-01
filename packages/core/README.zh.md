# `@dsh-blue/blue-core`

[English](README.md) | 中文

Blue 的终端 renderer，也是仓库唯一的 pi-tui adapter。它持有终端启停、raw
mode、alternate screen、focus、键盘 dispatch、layout、theme、node
校验/编译与 visible width。

Core 直接订阅 `ctx.bluePanes` 与 `ctx.blueOverlays`。Pane/overlay 的
render 函数返回 renderer-neutral `BlueUiNode`，core 校验并编译成具体
component。Registry 与 renderer 之间没有 plugin host 或 bridge。

Core 也持有富终端渲染：共享 Markdown adapter 会增强闭合的 Mermaid fence，
结构化 chart node 则通过当前 semantic theme 完成适配。无效、不安全、超 quota
或超宽的输入会通过受宽度约束的源码或文本 fallback 保持可见。

本包也为 Blue 自有 TUI 包提供底层 `blueScreen`、`blueKeymap`、
`blueTerminalInfo`、`blueComponents` 与 theme service。
