# 调试与验证

本篇覆盖插件的本地迭代回路和发布前的两道机械验证：静态边界检查（validate）与打包安装 fixture。

## 迭代回路

```text
改代码 → 重新构建你的包 → 重启 profile
```

link 安装指向包目录，重建产物直接生效，无需重装；只有依赖图变化（新增依赖）才需要重新 `dsh plugin --profile <name> add`。

无头冒烟（经 `script(1)` 伪 TTY，不需要人工敲键盘）：

```sh
(sleep 10; printf '/now\r'; sleep 2; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue-dev" /tmp/my-plugin-smoke.typescript
```

录制文件 `/tmp/my-plugin-smoke.typescript` 里可以 grep 你的命令输出，断言插件真的跑过。

## 卸载语义检查

Fiber 绑定注册是插件模型的核心承诺，每次大改后都值得验证一次：

1. 从 profile 的 `cordis.patch.yml` 删掉你的插件行；
2. 重启 profile；
3. 你的命令、状态条目、dock 面板应当全部消失，不留残骸。

如果留下了残骸，说明有注册绕过了 `open()` 返回的 API（直接注册到 Harness 服务、模块级 singleton 等）——对照[核心概念](/plugins/concepts#设计纪律)排查。

## validate：静态边界检查

Blue 仓库提供静态验证脚本（克隆 Blue 仓库后运行）：

```sh
node script/blue-plugin-validate.mjs /path/to/my-plugin
```

输出 JSON 报告，分三组检查：

| 组 | 检查内容 |
| --- | --- |
| `package` | package.json 存在、`exports` 映射完整、`files` 白名单覆盖所有导出目标、入口导出字面量 `name` 与 `apply`、`inject` 是稳定数组 |
| `architecture` | 渲染器/raw-terminal 依赖不得出现在 core 之外、renderer-neutral 包不得依赖 renderer 特定 API、不跨界 import Agent/Session 包、frontend 不折叠 Harness session 事件 |
| `lifecycle` | 插件入口有可观察的 Fiber 生命周期或注册所有权标记（`ctx.effect` / `.dispose` / `.register` / `.subscribe`） |

::: tip 包名要求
validate 会检查包名能否识别为 Blue 前端包或 adapter——名字里需含 `blue`、`frontend` 或 `adapter` 之一（如 `my-scope/blue-clock`、`my-scope/feature-blue`），否则报 `PACKAGE_NAME_INVALID`。
:::

## fixture：打包安装契约

validate 是静态的；fixture 在**一次性 npm 项目**里真实打包装载你的插件，验证独立安装场景：

```sh
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install
# 钉到上一条 Harness 线验证兼容性：
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install --harness-line 0.1.1-rc.1
```

- `--install` 是独立场景的开关——没有它 fixture 只做浅检查；
- `--harness-line` 的版本覆盖只作用于一次性项目，不污染你的 checkout；报告的 `harnessPackages` 字段会列出每个 Harness 包的实际解析版本，应全部等于你指定的线。

fixture 发现的问题几乎都是"在 monorepo 里好好的、独立安装就坏"：漏声明的 peer、没进 `files` 的产物、依赖了 workspace 协议的版本。

## 发布前清单

1. `validate` 三组全绿；
2. `fixture --install` 通过，且（如果要兼容多条 Harness 线）每条线各跑一次；
3. 卸载语义检查通过；
4. 真实 profile 里人工点过一遍核心路径（dogfood）。

然后就可以[发布](/plugins/publishing)了。
