# `@dsh-blue/blue-openpencil`

面向 `@zseven-w/dsh-openpencil` 的可选 renderer-neutral adapter。它只观察官方 `tools/result` 结果，并发布有界的 Blue tool presentation model；缺少专用展示能力时回退为文本或 diff。

adapter 不复制浏览器 canvas 状态、Agent/Session 对象，也不会把 tool-result metadata 中的签名 editor capability 带入 Blue。即使未安装本 adapter 或缺少 Blue renderer service，OpenPencil 的 headless tools 仍可独立运行。
