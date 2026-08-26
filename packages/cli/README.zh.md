# @dsh-blue/blue-cli

`blue` 壳包自带经过测试的 dsh 宿主，并在首次运行时校准 `blue` profile。

请用 npm 安装壳包，并在首次启动前安装 pnpm 11：

```sh
npm i -g @dsh-blue/blue-cli@rc
npm i -g pnpm@11
blue
```

profile 继续由 dsh 官方的 pnpm 工作区路径管理。profile 已经携带壳包精确版本后，普通启动不会再次调用 pnpm。重装壳包即可升级；需要显式管理 profile 时使用 `dsh plugin`。

壳包只拥有三个参数面，其余参数原样转发给宿主。`blue -V`（或 `--version`）由壳包自行应答——一行输出版本：壳包版本、固定的 `@dsh-blue/blue` bundle 版本与 harness 宿主版本。`blue plugin ...` 映射为宿主的 plugin 子命令，并在 `plugin` 一词之后插入 `--profile blue`。用户传入的任何 `--profile` 都会被吞掉：profile 永远是 `blue`，未来的 Blue 参数也不会与宿主参数冲突。子进程携带 `BLUE_LAUNCHER=blue`，应用的帮助文本与退出告别语因此从 `dsh --profile blue` 改写为 `blue`。

创造模式完全由 `@dsh-blue/blue` bundle 提供。壳包不再改写其嵌套 dsh 安装，因此 `blue` 与直接 `dsh --profile` 启动使用同一套隔离的 preset roster。
