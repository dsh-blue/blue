# 常见问题

## 为什么不直接 `npm install @dsh-blue/blue`？

Blue 是装进 dsh profile 的插件包，不是独立应用——裸装只把包放进 node_modules，没有宿主与 profile 装配，跑不起来。正确路径：装 `blue` 壳包 `npm i -g @dsh-blue/blue-cli@rc`，或用 `dsh plugin --profile blue add @dsh-blue/blue@rc`，见[快速上手](/guide/)。预览版只按 **`rc` dist-tag** 发布（`latest` 为稳定线保留；npm 在首个稳定版前不允许删除 `latest`，它目前只是占位地同样指向最新 rc）。当前预览版为 `v0.1.0-rc.9-test.3`；`0.1.0-rc.1` 因打包缺失文件不可用，装到请升级。贡献者的本地开发安装见开发手册的[贡献本仓库](/plugins/contributing)页。

## `@rc` 装到的不是最新预览版？

pnpm 11 默认开启 `minimumReleaseAge` 冷却期：dist-tag 解析会静默跳过冷却窗口内刚发布的版本、回退到旧版。若 `dsh plugin --profile blue add @dsh-blue/blue@rc` 装到的版本偏旧，两个办法：

- 立即装到新版：改用精确版本号——`dsh plugin --profile blue add @dsh-blue/blue@0.1.0-rc.9-test.3`（版本号以仓库最新 tag 为准）；
- 或等冷却窗口过去后重跑同一条 `@rc` 命令（升级 = 重跑同一条 `plugin add`）。

用 `/update` 升级的用户不受此坑影响：它按 registry 元数据解析目标、始终精确钉版，冷却窗口内会直接给出可重试的时间（ETA）而不是装到旧版。

## 如何升级 Blue？

两条路：

- **壳包用户**：重跑 `npm i -g @dsh-blue/blue-cli@rc`——重装即升级（壳按自身版本把 profile 里的 Blue 校准到同一版，宿主线随之固定），之后照常 `blue` 启动。
- **dsh 直装用户**：
  - **应用内（推荐）**：会话里输入 `/update`——先做安全预检（profile 健康度、全局 dsh 版本是否满足目标版本的 harness 线、冷却期窗口），打字 `y` 确认后自动执行：快照当前安装 → 精确版本单事务安装 → 装后整套包的版本校验 → 装机冒烟（模块导入扫描 + 真实启动）→ 任一失败**自动回滚**到原版本，全程有进度面板与日志路径。`/update <版本号>` 可显式指定目标版本；不带参数的 `/update` 兼作只读检查。升级完成后当前会话继续运行旧版，重启后生效。
  - **手工**：重跑同一条 `dsh plugin --profile blue add @dsh-blue/blue@rc`（或上一条 FAQ 的精确版本号形式）。

此外 Blue 启动后会后台检查一次新版（每 24h 至多一次、失败静默、只读 registry 元数据、不做任何上报），有新版时在会话流中（横幅下方）追加两行提示。不想要启动检查，在 `~/.dsh/settings.yaml` 写入：

```yaml
blue:
  updateCheck: false
```

## 粘贴图片没有反应？

Ctrl-V 粘贴依赖两个条件：

1. **终端环境**：按平台探测各自的剪贴板通道——Linux 依次探测 `wl-paste`、`xclip`（3 秒超时），Windows 单次 PowerShell 调用（10 秒），macOS 走 osascript（5 秒）；
2. **模型能力**：粘贴的图片以图片内容块进入消息。如果当前模型路由不支持图片输入，包含图片块的消息会被拒绝——这是上游 harness 的能力协商行为，换用具备视觉输入的模型即可。

图片落入附件存储（默认 `~/.dsh/attachments`，可用 `DSH_BLUE_ATTACHMENT_DIR` 或 `DSH_HOME` 改址），单图上限 10MB、每条消息至多 8 张 / 30MB / 16M 像素。

既可以复制应用中的图片内容，也可以在文件管理器（Ubuntu 文件、Windows 资源管理器、macOS Finder）中复制一个或多个本地 PNG/JPEG/WebP/GIF 文件——三平台都按原顺序整批粘贴。文件管理器路径只接受本地普通文件；远程 URI、目录、符号链接和特殊文件会显示拒绝原因。

## 为什么 AGENTS.md 等注入的上下文不显示在会话流里？

harness 会把工作区指令（AGENTS.md 等）、运行时上下文快照等以合成 user 消息注入会话。Blue 按消息来源分拣：人类输入照常呈现为 `»` 消息块；**合成消息零呈现**（不产条目、不留占位行）——对齐"模型侧内容模型侧消化"的呈现哲学，保持会话流干净。这些内容仍然完整发送给模型，只是不渲染。

## 能自定义键位吗？

暂缓。键位经 `blueKeymap` 注册、重复绑定会被拒绝，但面向用户的自定义配置属于后续阶段（alt-screen 全屏表面同理）。当前全部键位见[键位参考](/reference/keys)。

## `/quit` 按了没反应？

在 agent 尚未 attach 时（会话建立前的极短窗口）输入 `/quit`，会显示 `no active session` 而不是退出——命令分发前会检查当前 agent。稍候重试即可。另外交互模式里 **1 秒内连按两次 Ctrl-C** 也可以退出。

## 状态栏的 git 分支什么时候刷新？

git 徽章经 TTL 缓存惰性探测（branch 5 秒、status 15 秒），在任意一次重绘时顺手刷新（输入、流式输出都会触发）——同一目录下切换分支，几秒内就会反映。缓存按工作目录建立：会话切换（`/new`、`/resume` 或重启）带到新的 cwd 时会为它重建缓存。

## 状态栏条目放不下会怎样？

状态栏至多两行，每行分左簇与右簇（条目经 `band`/`row` 归位）。行宽不够时，超宽条目截断到剩余预算（声明了 `overflow: hide` 的条目宁缺不截、整项隐藏），簇排满后靠后的条目不再显示。排布顺序是注册顺序（即 bundle 行序）；内置条目声明的优先级档（0 / 5 / 10 / 20 / 30）是元数据，状态栏当前不消费它（dock 面板的排序才按优先级）。

## bash 模式的输出会进入会话历史吗？

不会。`!` bash 模式的命令经 Blue 自己的执行器运行，输出以 shell 回显卡呈现进滚动区，**刻意不进 session transcript**——模型看不到这些输出。需要模型知晓的结果请贴回输入框或让模型自己跑工具。
