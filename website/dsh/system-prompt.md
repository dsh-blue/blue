# 系统提示词

每个模型 step 之前，dsh 把各插件贡献的部分**组装成发给模型的系统提示词**。本页讲它由什么组成、如何加载，以及怎样定制。

## 组成：四种注册贡献

| 贡献 | 说明 |
| --- | --- |
| **PromptSection（区段）** | 具名提示词区段：`name` + `order` + `text`（静态文本或每次组装时求值的提供方）；按 `order` 升序拼接。通行的顺序约定：`-100` harness 身份、`0` 部署 persona、`100–199` 工具指引 |
| **PromptContext（上下文）** | 动态模型上下文，物化为持久的 user 角色快照——缓存友好：仅当整份快照变化或压缩移除时才重录 |
| **工具 Schema** | 各工具提供方贡献的 schema，外加 `knownNames`（配置校验用的预限制名空间，能区分"打错工具名"与"被作用域刻意隐藏"） |
| **Prompt 变量** | 具名变量 `{{variable}}`，每次组装时求值；区段引用它，渲染期插值 |

一个特殊标记：某区段标记为 **`complete`** 后，组装结果会被恢复为"仅此区段"；多于一个有效 complete 区段会使组装失败。

## 加载与组装

- 注册服务是 `ctx.systemPrompt`，插件经 `section()` / `context()` / `tools()` / `variable()` 贡献，或 `suppressRuntimeContext()`（整体禁用 runtime-context 贡献，不改动持有那些事实的服务）；
- **作用域分层**：scoped 区段与变量遮蔽 global；同层重复与非法 order 在注册期抛错；
- 每个模型 step 调用 `assemble(context)`：合并全局与 scoped 提供方 → 剥离工具参数 → 规范排序 → 走组装 waterfall；
- 两个事件驱动：
  - **`system-prompt/assemble`**（waterfall）—— 对组装结果做专家级改写；返回值权威；complete 区段在事后恢复，监听者无法替换它；
  - **`system-prompt/change`**（emit）—— 任何提供方变化时触发（全局变更影响所有作用域，不过滤）。

## 配置与定制

`systemPrompt` 配置块（dsh-base 的 system-prompt 插件）用 `persona` 定义部署身份，文本可引用 `{{model}}`、`{{cwd}}` 等变量。**Blue 的 `cordis.patch.yml` 首行就是按 id 替换这个条目的配置、覆写 persona**——"上层永远改写下层"的活例子：

```yaml
# Blue bundle 的 patch（片段）
- id: system-prompt
  config:
    persona: >-
      You are a coding agent. Your working directory is {{cwd}}.
```

- 工具在提示词中的顺序经 `systemPrompt.toolOrder` 配置（完整键名与默认值见官方 [config catalog](https://deepseek-harness.github.io/deepseek-harness/reference/config-catalog)）；
- 想深度定制：注册 `system-prompt/assemble` 监听器改写组装结果（返回值权威，但注意 complete 区段仍会事后恢复）。

## 与 Blue 的关系

- **KV Cache 无影响**：Blue 各层不向模型请求前缀添加任何内容；
- **注入的上下文是互补面**：harness 把 runtime-context 快照、AGENTS.md 指令等以合成 user 消息注入会话（Blue 侧零呈现，见[常见问题](/guide/faq)）——系统提示词负责"你是谁、怎么干活"，注入上下文负责"当前会话的事实"，两者互补；
- **persona 一行可换**：如上面的 patch 所示，profile 的 patch 就能整体替换部署人格。

::: tip 来源与版本
事实以官方 [system-prompt 子系统文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/system-prompt)为基准；以你安装的 `dsh --version` 与 `--dump-config` 为准。
:::
