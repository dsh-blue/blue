# 认识 dsh

Blue 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（**dsh**）的终端界面——理解 dsh 的几个核心概念，能让你把 Blue 用得更明白。本手册面向 Blue 用户提炼 dsh 的相关知识；完整工程文档见[官方参考站](https://deepseek-harness.github.io/deepseek-harness/reference/)。

::: info 版本基准
本手册以 npm 上的 `0.1.1-rc.2` Harness 发布线为准（`npm i -g @deepseek-ai/dsh`）。官方参考站部分内容领先于已发布版本，遇到出入以你安装的 `dsh --version` 与 `--dump-config` 为准。
:::

## dsh 是什么

dsh 是一个**插件化的 agent 宿主**（harness）：模型适配、工具执行、会话持久化、审批与沙箱策略、设置与凭据这些能力，全部以 [Cordis](https://www.npmjs.com/package/@deepseek-ai/cordis) 插件的形式组装。你在终端里看到的每个界面——Blue 的 TUI、浏览器里的 web 应用、一次性执行任务的无头 runner——都只是同一棵插件树上的不同"装配"。

三个关键词：

- **Bundle（捆）** —— 一组自带挂载代码的插件集合，通过包内 `cordis.patch.yml` 声明自己的插件行；`dsh-base` 是一切 profile 的第一层。
- **Profile（装配）** —— 具名的组装方案：列出叠放的 bundle、自己的 patch 覆盖、以及独立安装的插件。详见 [Profile 与目录](/dsh/profiles)。
- **Blue** —— 就是一个 bundle：在 `dsh-base` 之上插入 30 条 Blue 自有行，把终端交互界面接管过来（见[功能总览](/features/)）。

## CLI 速查

```sh
dsh --profile <name> [task]      # 启动一个 profile；带任务参数则进入对应应用
dsh --profile <name> --resume <id>  # 恢复一个会话
dsh web                          # --profile web 的别名（浏览器应用）
dsh --profile <name> --patch ./x.yml  # 追加一层 patch 覆盖（可重复）
dsh --profile <name> --dump-config   # 打印组装后的完整插件树
dsh --profile <name> --dump-default-config  # 不含用户层与 --patch 的默认树
dsh plugin --profile <name> add <pkg>   # 向 profile 安装插件（转发给 pnpm）
```

## 本手册章节

- [Profile 与目录](/dsh/profiles) —— profile 的分层机制、`DSH_HOME` 的目录结构
- [权限与模式](/dsh/modes) —— Agent 预设、审批策略、沙箱模式、权限预设
- [内置工具](/dsh/tools) —— dsh 自带的全部工具目录
- [Skills](/dsh/skills) —— 技能的发现目录、格式与加载机制
