# @dsh-blue/blue-plugin-kit

Blue 插件的公开作者命令。它可以生成 canonical 本地包，并运行与 Blue 仓库相同的
package validator 和 packed-install conformance，无需克隆 Blue 仓库。

```sh
npx @dsh-blue/blue-plugin-kit catalog --json
npx @dsh-blue/blue-plugin-kit create ./my-blue-plugin --name @acme/my-blue-plugin
npx @dsh-blue/blue-plugin-kit validate ./my-blue-plugin
npx @dsh-blue/blue-plugin-kit conformance ./my-blue-plugin
npx @dsh-blue/blue-plugin-kit conformance ./my-blue-plugin --harness-line 0.1.1-rc.1
```

全局安装或作为项目工具安装后可以使用更短的 `blue-plugin` 命令。
`catalog --json` 是可用 capability 版本、resource、limit 与 quota 的机器真相；
`create` 拒绝非空目录，生成一个无需构建的 ESM 基线，作者再按实际 grant 调整。

这些命令不会发布包、创建仓库或修改 dsh profile。Conformance 禁用 lifecycle
scripts 后打包，以正常 peer resolution 安装到临时项目，并验证公开入口、Host
准入、20/40/80/120 宽度、Fiber unload 与 capability-absent fallback。它验证兼容性，
不是安全沙箱。
