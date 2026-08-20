# Skills

Skill（技能）是**可选的指令包**：一段带元数据的 Markdown，告诉模型"某类任务该怎么做"。dsh 在会话首个 agent 步骤注入一份技能目录（名称 + 描述），模型需要时自己调用 `skill({ name })` 工具加载完整内容——技能不是事件，不占会话流。

## 发现目录

按优先级排序（同名技能，排在前面的胜出）：

| 优先级 | 来源 | 路径 |
| --- | --- | --- |
| 100 | 项目 `.dsh` | `<项目根>/.dsh/skills` |
| 200 | 项目 `.agents` | `<项目根>/.agents/skills` |
| 300 | 自定义 | 配置的 `customSkillDirs` |
| 400 | 用户 dsh | `<dshHome>/skills`（默认 `~/.dsh/skills`） |
| 500 | 用户 agents | `<agentsHome>/skills`（如 `~/.agents/skills`） |
| 600 | 内置 | 配置的 `bundledSkillDir`（或环境变量 `DSH_BUNDLED_SKILL_DIR`） |

项目根取**最近的含 `.git` 的祖先目录**（回退到当前工作目录）；用户 dsh 根下的 `.system` 子目录会被跳过；插件也可以在运行时贡献技能（排在项目之后、用户之前）。

## 文件格式

- 名称必须 **kebab-case**（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）；
- 两种形态：**目录包** `<name>/SKILL.md`，或**扁平文件** `<name>.md`（不支持嵌套的 `**/SKILL.md` 发现）；
- Frontmatter 字段（kebab-case 键）：

```yaml
---
disable-model-invocation: false   # 禁止模型自行调用（默认 false）
user-invocable: true              # 出现在用户命令目录（默认 true）
---
```

正文就是给模型的指令；`description`（以及可选的 `whenToUse`）进入会话开头的目录注入，是模型"会不会想起这个技能"的关键——写清楚适用场景。

## 加载机制

1. 会话首个 agent 步骤注入**目录提醒**（全部技能的 name + description，超长截断，默认上限 500 字符/条）；
2. 模型按需调用 `skill({ name })`——加载前后都会检查调用权限（两个开关都为 false 的技能仅限受信代码访问）；
3. 技能内容以 `<skill_content>` 包裹返回给模型；目录变化会发布替换提醒，编辑技能文件即时生效（默认启用文件监视）。

## 给 Blue 用户的建议

- 项目专属工作流 → 放 `<项目根>/.dsh/skills/`，随仓库走；
- 个人通用技能 → `~/.dsh/skills/`，所有 profile 共享；
- `user-invocable` 的技能会出现在宿主的命令目录里，配合 [斜杠命令](/reference/commands) 的补全体验使用。
