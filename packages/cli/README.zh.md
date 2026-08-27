# @dsh-blue/blue-cli

`blue` 是运行在独立安装、经过测试的 dsh 宿主之上的轻量壳包。它在首次运行时校准 `blue` profile，但不会让 npm 在安装壳包时解析完整 Harness 依赖图。

先安装 Harness 宿主和 pnpm 11，再安装轻量壳包：

```sh
npm i -g @deepseek-ai/dsh@0.1.1-rc.2
npm i -g pnpm@11
npm i -g @dsh-blue/blue-cli@rc
blue
```

profile 继续由 dsh 官方的 pnpm 工作区路径管理。profile 已经携带壳包精确版本后，普通启动不会再次调用 pnpm。重装壳包即可升级；需要显式管理 profile 时使用 `dsh plugin`。

壳包只拥有三个参数面，其余参数原样转发给宿主。它先探测全局 `dsh`，版本不在测试线上时会在修改 profile 前快速失败。`blue -V`（或 `--version`）输出壳包版本、固定的 `@dsh-blue/blue` bundle 版本与检测到的 Harness 版本。`blue plugin ...` 映射为宿主的 plugin 子命令，并在 `plugin` 一词之后插入 `--profile blue`。用户传入的任何 `--profile` 都会被吞掉：profile 永远是 `blue`。

创造模式完全由 `@dsh-blue/blue` bundle 提供。`blue` 与直接 `dsh --profile blue` 启动使用同一个全局宿主和隔离的 preset roster。
