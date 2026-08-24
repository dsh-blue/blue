# @dsh-blue/blue-cli

`blue` 壳包自带经过测试的 dsh 宿主，并在首次运行时校准 `blue` profile。

请用 npm 安装壳包，并在首次启动前安装 pnpm 11：

```sh
npm i -g @dsh-blue/blue-cli@rc
npm i -g pnpm@11
blue
```

profile 继续由 dsh 官方的 pnpm 工作区路径管理。profile 已经携带壳包精确版本后，普通启动不会再次调用 pnpm。重装壳包即可升级；需要显式管理 profile 时使用 `dsh plugin`。

壳包还自带 Blue 自己的创造模式：每次启动时把一份面向 Blue 的 `cordis` preset（Blue 插件与组装创作指导、host 半的运行时检查）同步覆盖嵌套宿主里的随附副本。id 与选择器显示名保持 `cordis` / 创造模式，因此在 Blue 中选择创造模式得到的一定是 Blue 版。这只改写壳包自己的嵌套 dsh 安装——同机器上的另一份 dsh 安装（比如 Web UI 所用）的官方创造模式不受任何影响。若嵌套宿主不可写（root 所有的全局前缀），当次启动会警告一次并退回随附的创造模式。
