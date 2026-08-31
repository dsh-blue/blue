# @dsh-blue/blue-cli

`blue` 将经过测试的 dsh 宿主封装为预打包的公共层和平台运行时归档。npm 只安装一个无依赖包，不会解析 Harness 依赖图，也不会执行其中的生命周期脚本。

安装 profile 管理所需的 pnpm 11，然后用一条 Blue 安装命令完成安装：

```sh
npm i -g pnpm@11
npm i -g @dsh-blue/blue-cli@alpha
blue
```

第一个需要 dsh 的命令只会把公共层和当前平台层以有界内存、原子发布的方式展开到 `DSH_HOME` 下的版本化用户缓存；后续调用直接复用，解压过程不访问 npm。profile 继续由 dsh 官方的 pnpm 工作区路径管理。profile 已经携带壳包精确版本后，普通启动不会再次调用 pnpm。重装壳包即可升级；需要显式管理 profile 时使用 `blue plugin`。

壳包只拥有三个参数面，其余参数原样转发给固定宿主。`blue -V`（或 `--version`）无需展开运行时即可输出壳包版本、固定的 `@dsh-blue/blue` bundle 版本与内嵌 Harness 版本。`blue plugin ...` 映射为内嵌宿主的 plugin 子命令，并在 `plugin` 一词之后插入 `--profile blue`。用户传入的任何 `--profile` 都会被吞掉：profile 永远是 `blue`。

创造模式完全由 `@dsh-blue/blue` bundle 提供；启动器只负责交付宿主和选择 profile。
