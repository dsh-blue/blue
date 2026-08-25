# @dsh-blue/blue-cli

`blue` 壳包自带经过测试的 dsh 宿主，并在首次运行时校准 `blue` profile。

请用 npm 安装壳包，并在首次启动前安装 pnpm 11：

```sh
npm i -g @dsh-blue/blue-cli@rc
npm i -g pnpm@11
blue
```

profile 继续由 dsh 官方的 pnpm 工作区路径管理。profile 已经携带壳包精确版本后，普通启动不会再次调用 pnpm。重装壳包即可升级；需要显式管理 profile 时使用 `dsh plugin`。

创造模式完全由 `@dsh-blue/blue` bundle 提供。壳包不再改写其嵌套 dsh 安装，因此 `blue` 与直接 `dsh --profile` 启动使用同一套隔离的 preset roster。
