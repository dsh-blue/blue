# 快速上手

::: info 预览阶段说明
Blue 尚未发布到 npm（`v0.1.0-rc.1` 将是首个发布版本）。当前唯一支持的安装方式是**从源码检出进行本地开发安装**——本页描述的即是这条路径。npm 安装段落将在预览版发布后补充于此。
:::

## 前置条件

| 依赖 | 版本 |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11 |
| dsh CLI | `>=0.1.0-rc.7`（`npm i -g @deepseek-ai/dsh`） |

## 一键安装

```sh
script/install-dev.sh
# 覆盖项：DSH_BIN=/path/to/dsh PROFILE=my-profile DSH_HOME=/custom/home script/install-dev.sh
```

脚本会构建整个 workspace，并把五个包 link 安装进 dsh profile。

## 手动安装（等价步骤）

```sh
pnpm install && pnpm run build   # lib/ 是每个包的运行时入口

# 一次性 profile 设置：
dsh plugin --profile blue add \
  link:/path/to/blue/packages/bundle/blue \
  link:/path/to/blue/packages/core \
  link:/path/to/blue/packages/interaction \
  link:/path/to/blue/packages/transcript \
  link:/path/to/blue/packages/app

dsh --profile blue [task]           # 执行任务，或进入交互模式
dsh --profile blue --resume <id>    # 恢复一个已持久化的会话
```

**为什么要 link 五个包**：四个库包是 bundle 的 `workspace:^` 依赖，在 workspace 之外无法解析。`dsh plugin` 原样转发给 pnpm，`link:` 协议把检出本身安装为符号链接；链入的 bundle 再经 profile 自己的 `node_modules` 链接解析它的兄弟包。四个非 bundle 链接是普通依赖——各会有一条 `declares no dsh.bundle` 警告，属预期行为（它们是库，不是装配层）。

::: tip 旧 profile 清理
若你的 profile 在包改名之前链过（当时包名为 `@dsh-blue/blue*`），那些链接已失效——删除 profile 目录（`~/.dsh/profiles/<name>`）或 `dsh plugin --profile <name> remove` 旧条目后重跑脚本。
:::

## 开跑前配一个 key

**配一个 `DEEPSEEK_API_KEY` 就可以开始使用了**——开箱默认连 DeepSeek 官方 API（`deepseek-official` 路由，默认模型 `deepseek-v4-flash`），除 key 外无需任何配置：

```sh
export DEEPSEEK_API_KEY=sk-...        # 或写入 ~/.dsh/.credentials.yaml，一劳永逸
```

换模型、接自建网关、自定义主题等，见[配置：模型、Provider 与主题](/guide/config)。

## 首次运行

```sh
dsh --profile blue            # 交互模式：欢迎横幅 + 输入编辑器
dsh --profile blue 修复登录页的空指针    # 直接执行任务
```

启动后可以先试这几件事：

- 输入 `/` 查看斜杠命令补全，`/help` 打开命令与键位总览；
- 随手问点什么，观察流式回复与工具卡片；
- `/theme light` 感受主题热切换（输入草稿不会丢）。

## 迭代开发

**改 src → `pnpm run build` → 重跑 `dsh --profile blue`**。链接指向包目录，重建后的 `lib/` 直接生效，无需重装；只有依赖图变化（新增包或改 `dependencies`）才需要再次 `dsh plugin --profile blue add`/`install`。

无头冒烟检查（经 `script(1)` 伪 TTY）：

```sh
(sleep 10; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue" /tmp/blue-smoke.typescript
# 断言：启动时 bracketed-paste 开（\x1b[?2004h）、退出时关（\x1b[?2004l）、退出码 0。
```
