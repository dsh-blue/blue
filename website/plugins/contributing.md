# 贡献本仓库

面向 **Blue 仓库贡献者**的本地开发安装:从源码检出、link 安装进 dsh profile、迭代回路与冒烟检查。在自己的仓库里写 Blue 插件的下游开发者请看[编写第一个插件](/plugins/)——那条路径不需要本页。

::: info
用户安装路径是 npm——`dsh plugin --profile blue add @dsh-blue/blue@rc`,见[快速上手](/guide/)。本页只服务改 Blue 本体的贡献者。
:::

## 前置条件

| 依赖 | 版本 |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11 |
| dsh CLI | `>=0.1.1-rc.2`（`npm i -g @deepseek-ai/dsh`） |

## 一键安装

```sh
script/install-dev.sh
# 覆盖项：DSH_BIN=/path/to/dsh PROFILE=my-profile DSH_HOME=/custom/home script/install-dev.sh
```

脚本会构建整个 workspace，并把 bundle 加十二个 runtime 库（共十三个包）link 安装进 dsh profile。

## 手动安装（等价步骤）

```sh
pnpm install && pnpm run build   # lib/ 是每个包的运行时入口

# 一次性 profile 设置：
dsh plugin --profile blue-dev add \
  link:/path/to/blue/packages/bundle/blue \
  link:/path/to/blue/packages/api \
  link:/path/to/blue/packages/frontend \
  link:/path/to/blue/packages/harness-adapter \
  link:/path/to/blue/packages/context \
  link:/path/to/blue/packages/conversation \
  link:/path/to/blue/packages/remote \
  link:/path/to/blue/packages/core \
  link:/path/to/blue/packages/interaction \
  link:/path/to/blue/packages/transcript \
  link:/path/to/blue/packages/openpencil \
  link:/path/to/blue/packages/lark \
  link:/path/to/blue/packages/app

dsh --profile blue-dev [task]           # 执行任务，或进入交互模式
dsh --profile blue-dev --resume <id>    # 恢复一个已持久化的会话
```

**为什么要 link 十三个包**：十二个库包是 bundle 的 `workspace:^` 依赖，在 workspace 之外无法解析。`dsh plugin` 原样转发给 pnpm，`link:` 协议把检出本身安装为符号链接；链入的 bundle 再经 profile 自己的 `node_modules` 链接解析它的兄弟包。十二个非 bundle 链接是普通依赖——各会有一条 `declares no dsh.bundle` 警告，属预期行为（它们是库，不是装配层）。`script/install-dev.sh` 是这份列表的权威来源。

::: tip 三条泳道，别混
- **`blue`** = 生产 profile,**只走 npm 安装**（`@dsh-blue/blue@rc` / 精确版本号）。永远不要往里 `link:`——后续 npm 升级只会覆盖点名的包，残留的链接悬空后启动即 `ERR_MODULE_NOT_FOUND`（且 `pnpm add` 对混装零告警）。
- **`blue-dev`** = 本检出（主仓 master）的 link 开发 profile，`script/install-dev.sh` 的默认目标。
- **`blue-<tag>`** = worktree 验收 profile（`PROFILE=blue-<tag> script/install-dev.sh` 从 worktree 内跑）；分支合并后连同 profile 目录一起删。

若你的 profile 在包改名之前链过（当时包名为 `@dsh-blue/blue*`），或混装过 link 与 npm 包：开发 profile 最省事的修复是删除 profile 目录后重跑 `script/install-dev.sh`；生产 profile 则删除后重新安装 `@dsh-blue/blue@<v>`，让包管理器一次解析完整依赖闭包。
:::

## 迭代开发

**改 src → `pnpm run build` → 重跑 `dsh --profile blue-dev`**。链接指向包目录，重建后的 `lib/` 直接生效，无需重装；只有依赖图变化（新增包或改 `dependencies`）才需要再次 `dsh plugin --profile blue-dev add`/`install`。

无头冒烟检查（经 `script(1)` 伪 TTY）：

```sh
(sleep 10; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue-dev" /tmp/blue-smoke.typescript
# 断言：启动时 bracketed-paste 开（\x1b[?2004h）、退出时关（\x1b[?2004l）、退出码 0。
```

## 测试与门禁

```sh
pnpm run test           # vitest：单元套件 + bundle 的全树 e2e
pnpm run test:coverage  # packages/*/src 逐文件 100% 覆盖率门禁
pnpm run build          # tsc -b 产 lib/types，tsdown 打包 lib/
pnpm run lint           # oxlint
pnpm run typecheck      # tsc -b
```

测试从源码跑：spec 经相对 `../src/*.ts` 路径 import 被测包，所有 `@deepseek-ai/*` 依赖从 `node_modules` 解析。
