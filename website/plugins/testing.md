# 调试与验证

本篇覆盖插件的本地迭代回路和发布前的两道机械验证：静态边界检查
（`validate`）与独立打包安装（`conformance`）。这些命令由发布的
`@dsh-blue/blue-plugin-kit` 提供，不需要克隆 Blue 仓库。

## 安装并读取机器契约

```sh
npm install --global @dsh-blue/blue-plugin-kit@0.1.1-rc.3
blue-plugin catalog --json
```

catalog 是能力名、版本、resource、quota、当前 Blue/API 版本和当前/上一 Harness
线的事实来源。新建包时先读 catalog，再运行生成器：

```sh
blue-plugin create ./my-blue-plugin --name @acme/my-blue-plugin
```

## 迭代回路

```text
改代码 -> 重新构建你的包 -> 重启 scratch profile
```

link 安装指向包目录，重建产物直接生效，无需重装；只有依赖图变化才需要重新执行
`dsh plugin --profile <name> add`。profile mutation 由 dsh owner 执行，Blue 不会在
运行中的 Cordis 树里热替换一个持久插件。

无头冒烟（经 `script(1)` 伪 TTY，不需要人工敲键盘）：

```sh
(sleep 10; printf '/now\r'; sleep 2; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue-my-plugin" /tmp/my-plugin-smoke.typescript
```

录制文件中应能找到插件的可观察结果，并确认进程正常退出、bracketed paste 已关闭、
没有 terminal width overflow。

## validate：静态边界检查

```sh
blue-plugin validate /path/to/my-plugin
```

命令输出 JSON 报告，分三组检查：

| 组 | 检查内容 |
| --- | --- |
| `package` | canonical manifest、包名/entry/exports、`files` 与 script-disabled `npm pack` 闭包、直接 peer/dependency 闭包 |
| `architecture` | renderer/raw-terminal 依赖不越界，不 import Agent/Session package internal，不在 frontend 折叠 Harness session event |
| `lifecycle` | 入口存在可观察的 Fiber 生命周期或注册所有权标记 |

`validate` 成功只证明静态包边界；它不执行插件，也不是安全审计。

## conformance：独立打包安装契约

```sh
blue-plugin conformance /path/to/my-plugin
blue-plugin conformance /path/to/my-plugin --harness-line 0.1.1-rc.1
```

`conformance` 会在一次性 npm 项目中 script-disabled pack 插件，以正常 peer resolver
安装并从公开 exports 装载，然后验证 Host 准入、20/40/80/120 宽度、Fiber unload、
capability-absent fallback、输出/超时隔离与临时目录清理。默认运行 catalog 声明的
当前 Harness 线；第二条命令补齐上一条线。

通过报告必须满足：

- `declared` 与 `executed` 完全相等；
- `skipped` 和 `failures` 为空；
- `peerResolution` 为 `normal`；
- `harnessPackages` 全部等于请求的精确版本；
- cleanup 成功。

该命令会导入并执行待测插件代码。script-disabled pack 只阻止生命周期脚本，不是安全
沙箱；只对可信源码运行。

## 卸载与真实 profile

在专用 profile 安装已验证的本地包：

```sh
dsh plugin --profile blue-my-plugin add link:/path/to/my-plugin
dsh --profile blue-my-plugin
```

覆盖插件的核心路径和 120/80/40 列，再移除插件并重启。命令、状态、pane 与 overlay
必须全部消失；若仍有残留，通常是注册绕过了 `open()` 返回的 Fiber-owned API，或把
可变状态放进了 module singleton。

发布前依次关闭：`catalog --json` 复核、`validate`、当前/上一 Harness
`conformance`、卸载检查、无头冒烟和真实终端人工验收。分发目的地仍要由用户明确选择；
验证通过不会自动授权创建 GitHub 仓库或发布 npm。插件市场继续暂停，详见
[发布插件](/plugins/publishing)。
