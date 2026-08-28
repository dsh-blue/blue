# Blue × Harness 0.1.2-alpha.1 接口对齐预研

> **定位（2026-08-28）**：上游 [dsh-v0.1.2-alpha.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1)（2026-08-27 发布，tag 提交 `cd5ef81`）**只发了 GitHub release，npm 全家族未发布**——`@deepseek-ai/dsh` 的 `latest`/`next` dist-tags 仍指向 0.1.1-rc.2，Blue 的 harness-drift 监控当前为 SYNC。按 R1 裁决（跨 minor 只报不动）与 D53（跟发非义务、跨 rc 默认不动），0.1.1→0.1.2 属跨 minor 跳跃，届时 npm `next` 出现 0.1.2 线时 drift 只开 issue、由人工裁决。本文档是那次裁决的对齐预研：逐接口比对官方 0.1.2 面与 Blue 现状，给出 adopt / migrate / keep / verify 判定，作为跟发时的适配清单。

> **方法论与置信度**：官方侧证据取自 tag `dsh-v0.1.2-alpha.1` 的源码浅克隆（单提交，无 0.1.1-rc.2 对照 ref，树内也无 CHANGELOG）；"本版新增"由上游 `.agents/notes/implemented/` 决策记录（日期 2026-07-30 至 08-26）佐证，非 git diff。Blue 侧对照取自本仓钉版的 0.1.1-rc.2 npm 产物与本仓源码。上游文件引用一律为 tag 内仓库相对路径；行号以该 tag 为准。

## 0. 对齐速览

| # | 接口域 | 官方 0.1.2 接口（包） | Blue 现状 | 判定 | 时机 |
|---|---|---|---|---|---|
| 1 | 设置注册（Host 侧） | `ctx.settings.register` / `installSettingsSection`（`dsh-settings`） | `settings.ts` 唯一注册 `blue` namespace | **已对齐，keep** | — |
| 2 | 设置扩展位（浏览器 slots） | `settings.plugin.item`(keyed) / `settings.plugins.tab` / `settings.general.item`（`dsh-client-ui-*`） | Blue 是 TUI，无 browser client | **不适用**；若出 web renderer 再 adopt | 远期 |
| 3 | Provider 接入（API-key 流） | `llm-pi-ai` namespace 写入 + `credentials.set` | `provider-add.ts` 向导已走官方 seam | **已对齐，keep** | — |
| 4 | Provider 登录（OAuth 流） | `ctx.authorization.registerFlow`（`dsh-authorization`，新） | 无 | **机会项 adopt**：向导列出 flows | bump 后评估 |
| 5 | 子代理模型配置 | Task tool 增 `provider`/`model`/`reasoning_effort`；`AgentOptions`；`subagent-model-selection` 设置 | 仅渲染（`child-agent-model.ts`） | **渐进 adopt**：渲染字段已就位，配置面可选 | bump 后 |
| 6 | 第三方多语言 | `ctx.locale.addLanguage`（`dsh-client-locale`，**web-only**） | 无 i18n | **不适用**；可读 `locale.preference` 保持偏好一致 | 远期 |
| 7 | pi-ai 0.84.2 | `PiAiProviderProfile` 扩展、`defaultMaxTokens` 新语义 | 协议集/思考档已对齐 | **小幅跟进**：向导可选暴露新档位；注意 maxTokens 语义 | 随 bump |
| 8 | PTC 更名 | `ToolPresentationMode = 'native' \| 'ptc' \| 'both'`（无兼容层） | `presets/code` 写 `mode: code` | **必改**（bump 阻断项） | 随 bump |
| 9 | Remote 网关重写 | `typertGateway` / `@Remote`，ApiProxy 概念删除 | `packages/remote` 结构化适配 dsh-remote wire（bridge major:2） | **届时重验**，最大不确定项 | dsh-remote 发 0.1.2 对齐版后 |
| 10 | `dsh plugin` CLI 面 | 形状未变（verbatim pnpm forwarder） | `translate.ts`/`calibrate.ts` 依赖 | **verify-only** | 随 bump |
| 11 | Web 一次性 token 鉴权 | connection 层，**loopback 也不豁免** | Blue 不挂 web host；lark 走 `dsh-host-webserver` | **verify-only** | 随 bump |

---

## 1. 前提：通道与版本闸门

- **npm 缺位**：0.1.2-alpha.1 无 npm 产物（`@deepseek-ai/dsh` versions 止于 0.1.1-rc.2）。Blue 整套钉版（bundle runtime 精确 pin、`packages/cli/runtime/` seed、181 条 `minimumReleaseAgeExclude`）都从 npm 解析，**今天无包可装**；现实触发点是上游发布 0.1.2-rc.1（或补发 alpha）到 `next`。
- **钉版正则不认 alpha**：`packages/transcript/tests/version.spec.ts:103`（runtime）与 `:119`（devDeps）要求 dsh pin 匹配 `/^0\.1\.[0-9]+-rc\.[0-9]+$/`。若届时 pin `0.1.2-alpha.1` 需先放宽正则；等 `0.1.2-rc.1` 则无需改动。
- **drift 语义**：`script/harness-drift.mjs` 的 `classify()` 只在目标与钉版同 major.minor 且前进时判 `BUMP_READY`；0.1.2 线必然判 `MINOR_JUMP` → 只开 issue。跟发须人工走 R1 式钉版（参照 `script/harness-drift-task.mjs` 生成的 runbook 与 `AGENTS.md:158-173`）。
- **exclude 表修剪**：`pnpm-workspace.yaml:139` 的 `@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2`——0.1.2 树中 `packages/host/` 已无此包（ApiProxy 移除，见 §9），bump 时应 prune 该行，否则 drift 会因它停在旧线持续报 PARTIAL。

---

## 2. 设置注册（Host 侧）——已对齐

**官方接口**（0.1.2，`packages/settings/settings/src/index.ts`）：

```ts
register<T>(ns: SettingsNamespace, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>
// SettingsRegisterOptions: { base?, applies?: 'live'|'restart', validate? }
```

配套 `settingsNamespace(value)`（须匹配 `/^[a-z][a-z0-9-]*$/`）。0.1.2 的关键治理变化是「**Registering is exposing**」（决策记录 `2026-08-12-plugin-owned-settings-surface.md`）：api-proxy 侧的 `WEB_SETTINGS_NAMESPACES` 白名单与 `settings-not-exposed` 错误码已删除——Host 上 `ctx.settings.describe()` 返回的每个 namespace 都直接可写。插件自有设置不再需要任何仓内登记。

**Blue 现状**：`packages/interaction/src/settings.ts` 是全树唯一的 `installSettingsSection(settingsNamespace('blue'))` 注册（schemastery schema + 默认值即组合基线），写入走 `settings.update/mutate` + `SettingsConflictError` 重试（`settings-command.ts`）。这正是官方 plane-agnostic 的 Host 侧 seam。

**判定：keep**。Blue 已消费官方接口，且「Registering is exposing」降低了未来摩擦（blue 的 namespace 无需任何上游登记即可被 web 端配置——若用户混用 dsh web + blue profile，web 的 Plugins 页会自动看到 `blue` 卡片位）。

## 3. 设置扩展位（浏览器 slots）——不适用，留作记录

0.1.2 把 Web 设置页彻底插件化（`packages/client/ui-settings*/`）：

```ts
// slot 契约（declaration-merged SlotMap，dsh-client-ui-slots）
'settings.section'          // 整页；kind: list
'settings.general.item'     // 通用偏好行；kind: list
'settings.plugins.tab'      // Plugins 页内整 tab；kind: list
'settings.plugin.item'      // 按设置 namespace 键控的配置卡；kind: keyed（8-10 由 list 改 keyed，破坏性）
'settings.models.provider-card' / 'settings.models.footer'  // 模型页 provider 卡扩展位（新增）
```

注册走 `ctx.slots.register(...)` / `ctx.slots.inject(key, cb)`（`dsh-client-ui-renderer/client` 的 `SlotRegistry`），宿主包用 package.json 的 `"dsh": { "client": { "inject": [...], "platform": "web" } }` 声明。插件侧目录由 `pnpm run gen-client-catalog` 生成到 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`。

**Blue 现状**：Blue 的 bundle 明确「mounts no Host, HTTP server, Web runtime, or browser plugin」（`packages/bundle/blue/cordis.patch.yml` 头注），无 browser client 半边。

**判定：不适用（N/A）**。slots 体系只存在于浏览器 client 树；Blue 的 TUI 设置面板（`/settings`）继续走 Host 侧 settings 服务即可。若未来 Blue 提供 web renderer adapter（见 `docs/blue-plugin-ecosystem.md` 的跨 frontend 发布约定），`settings.plugin.item`（keyed by namespace）就是官方对齐的挂载点——届时 Blue 只需为 `blue` namespace 注册一张 web 卡片，无需改 Host 半边。

## 4. Provider 登录——API-key 流已对齐；OAuth 流是机会项

### 4a. API-key 流（现状）

**官方**：Web Models 页的提交流序——`settings.mutate` 先写 `llm-pi-ai` namespace 的 provider profile（由注册插件 schema 在写入时校验），`credentials.set` 后存 key（`credentialRef`）。

**Blue 现状**：`packages/interaction/src/provider-add.ts` 实现同一序（模块头注引用的就是「the harness Web Models page's sequence」）：`deriveKeyRef()` 产出 `<ROUTE>_API_KEY` 约定 ref，`settings.mutate` → `credentials.set` 两步提交。`models-dev.ts` 用 models.dev 目录补 contextWindow/maxTokens/efforts 元数据。

**判定：keep，已对齐官方 seam**。

### 4b. OAuth 流（0.1.2 新增，机会项）

**官方接口**：`@deepseek-ai/dsh-authorization`（`packages/credentials/authorization/src/index.ts`），Host 侧服务 `ctx.authorization`：

```ts
const dispose = ctx.authorization.registerFlow({
  key: credentialKey('llm-pi-ai', 'openai-codex'),
  label: 'ChatGPT (Codex)',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  async run(session) { ... },   // AuthorizationSession
})
```

背景：pi-ai 目录里 GitHub Copilot / OpenAI 账号级的 provider 登录被官方**移出产品**，由可选的树外插件 `llm-pi-ai-oauth` 承载（决策记录 `2026-08-26-models-page-extension-slots.md`），Web 侧通过模型页新 slots 渲染入口。Host 侧 authorization seam 本身是 headless-capable 的，但有明确限制（`index.ts:143-145`）：「启动授权的调用方必须能与人对话……headless 调用方提供的 interaction 只能拒绝」。**当前无 `remote.authorization` wire**。

**Blue 的机会**：Blue 是交互式 TUI，正是官方所述「能与人对话的调用方」。跟发 0.1.2 后，`provider-add` 向导可在检测到已注册的 `authorization` flows 时列出其 `methods`，把 `run(session)` 的交互面接到 Blue 的 overlay/表单栈上（`FormPanel`/`mountEditorReplacement`），从而让终端用户完成 OAuth 类 provider 登录——这是官方在 Web 之外没有覆盖的面。**动作**：bump 后在 `provider-add.ts` 增加 flows 分支（读 `ctx.authorization` 的注册表，若服务不存在则静默降级，符合 Blue 的 capability 降级纪律）。

## 5. 子代理模型配置——渲染侧已就位，配置侧可选

**官方 0.1.2 接口**：

- Task 工具（`@deepseek-ai/dsh-tool-subagent`，`packages/subagent/tool-subagent/src/index.ts:383-421`）schema 受门控新增模型参数：

```ts
...modelSelectionEnabled ? {
  provider:        { type: 'string' },   // 与 model 成对提供
  model:           { type: 'string' },
  reasoning_effort:{ type: 'string' },
} : {},
```

门控 = 插件 config `modelSelectionSettings: true` + Host 侧 `subagentModelSelection` 服务；授权面是用户设置 namespace **`subagent-model-selection`**（`{ enabled: boolean, allowedModels: {provider, model}[] }`，默认关），子代理创建时 `assertAllowedModelSelection` 强校验。配套发现工具 `list_subagent_models`（`list-models.ts`，数据来自 `llm.listProviders()/listModels()/resolveModelInfo()`）。

- 代理 API（`@deepseek-ai/dsh-agent`，`packages/core/agent/src/runtime-types.ts:25-34`）：

```ts
export interface AgentOptions {
  provider?: string
  model?: string
  reasoningEffort?: ReasoningEffortId
  maxTokens?: number
}
```

`SubagentStartRequest.agentOptions?`（`packages/subagent/subagent/src/types.ts:119-127`）受 `SubagentCapabilities.agentOptions` 门控；in-process provider 合并到父 Agent options 上。**模型面向的字段没有 `max_output`**——maxTokens 只在调用方/部署侧 `AgentOptions`，不暴露给模型。

**Blue 现状**：`packages/transcript/src/child-agent-model.ts` 的 `childLiveSnapshot()` 已经渲染 `model`/`effort` 字段（投影 facts 里带上就显示）；Blue 无任何 spawn 配置 UI，也不需要——allowedModels 门控由 Host 承担。

**判定：渐进 adopt，零成本收益 + 可选配置面**。

1. **零成本**：0.1.2 落地后，会话里子代理卡的 model/effort 展示自动受益（facts 由 dsh-session-projection 提供）。
2. **可选**：`/settings` 或提问面板未来可暴露「子代理模型选择」开关——官方的 web 卡片是 `SubagentModelSelectionCard`（编辑 `subagent-model-selection` namespace）；Blue 若做，同 namespace、同 `allowedModels` 形状，直接 `installSettingsSection` 一张 TUI 卡即可，与官方配置互认。
3. **对齐注意**：Claude Code / Codex 子代理的模型是部署侧 `Config.model`（`subagent-claude-code`/`subagent-codex`），不支持运行时 `agentOptions`——Blue 若做配置面，这两类只读展示。

## 6. 第三方多语言——web-only，不适用

**官方接口**：`@deepseek-ai/dsh-client-locale`（`packages/client/locale/src/client/index.ts`）：

```ts
ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }): () => void
ctx.locale.register('common', 'ja', { cancel: 'キャンセル' }): () => void   // 单语种未typed形式
```

语言 id 须为 BCP 47 风格（`/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/`），fallback 链必须终止于 `en`；偏好持久化为 `$DSH_HOME/settings.yaml` 的 `locale.preference`。

**关键事实**：locale 服务是**浏览器 client 插件层**（README：「None, as the locale service is a browser-side UI plugin layer」）；Node 侧半边只注册 `locale` 设置 namespace。非浏览器运行解析 `FALLBACK_LOCALE`（`en`）。

**判定：不适用（远期）**。Blue 的 TUI 文案不在该体系内。唯一对齐点是**偏好一致**：若用户在 web 选了 `zh`，Blue 可读 `locale` namespace 的 `preference` 字段决定自身文案语言（当 Blue 未来做 i18n 时）——不要另立偏好键。

## 7. pi-ai 0.82.1 → 0.84.2——小幅跟进

**官方 0.1.2 现状**（`packages/llm/llm-pi-ai/src/config.ts:314-337`）：`PiAiProviderProfile` 的 profile 字段面为 `apiKeyEnv` / `displayName` / `api`（wire 协议）/ `baseURL` / `models` / `modelOverrides` / `compat` / `defaultContextWindow`(262_144) / `defaultMaxTokens`(32_768) / `defaultInput` / `headers` / `reasoning` / `thinkingBudgets` / `cacheRetention` / `transport`(`sse|websocket|websocket-cached|auto`) / 超时三件套 / 图像预算三件套 / `retryPolicy`。历史字段 `provider`（移到 dict key）与 `maxRetries`/`maxRetryDelayMs`（移交 dsh-llm-retry）会被拒绝。

**Blue 现状对照**：

| 项 | Blue（`provider-add.ts` / `models-dev.ts`） | 官方 0.1.2 | 判定 |
|---|---|---|---|
| 自定义端点协议集 | `ENDPOINT_PROTOCOLS = ['anthropic-messages','openai-completions','openai-responses']` | 手声明协议同三值（`provider.ts:47-63`） | ✅ 一致 |
| 思考档位 | `THINKING_LEVELS = ['off','minimal','low','medium','high','xhigh','max']` | `THINKING_LEVEL_GATE` 同七值（`catalog.ts:74-85`） | ✅ 一致 |
| profile 写入 | 直接写 `llm-pi-ai` namespace，官方 schema 在写入时校验 | 同 | ✅ 已受官方 schema 保护（写错字段名会被拒） |
| `maxTokens` 语义 | models-dev 填 `maxTokens` 当模型上限 | **新语义二分**：`models[].maxTokens` 命中即成为**请求默认值**（`catalog.ts:772-787`「capability vs request cap」），模型尺寸归 `contextWindow` 侧 | ⚠️ 注意 |
| 新档位 | 未暴露 | `thinkingBudgets`（vLLM `thinking_token_budget`，开关 `supportsThinkingTokenBudget`）、`transport`、`retryPolicy`、图像预算 | 可选暴露 |

**判定：小幅跟进**。(a) pi-ai 升到 0.84.2 与 Blue 的 `@earendil-works/pi-tui@0.84.2`（仅 `packages/core` 依赖）**版本对齐**，消除当前 0.82/0.84 混树；(b) 向导的手动默认表单可选增 `thinkingBudgets`/`transport` 高级档（非必需，schema 校验兜底）；(c) **必须复核** models-dev 映射写 `maxTokens` 的语义——0.1.2 下它从「模型能力上限」变为「每请求默认输出上限」，向导的表单文案与默认值要跟着改。

## 8. Code Mode → PTC 更名——bump 阻断项，无兼容层

**官方**：0.1.2 的 mode union 全面更名且**无 `'code'` 成员、无迁移层**：

```ts
// packages/core/tools/src/index.ts:651-652（0.1.2）
export type ToolPresentationMode = 'native' | 'ptc' | 'both'
```

Blue 钉版 0.1.1-rc.2 的同类型是：

```ts
// @deepseek-ai/dsh-tools 0.1.1-rc.2 lib/types/index.d.ts:447
export type ToolPresentationMode = 'native' | 'code' | 'both'
```

presentation row 插件 `dsh-agent-tool-presentation` 的 `Config.mode` 为 required union（0.1.2 是 `z.union(['native','ptc','both']).required()`）——**`mode: code` 会被 schema 拒绝**。会话记录不受影响（presentation mode 是 composition/scope 状态，不入 session record），所以只是配置面硬断。

**Blue 现状**：`packages/bundle/blue/presets/code/`——`preset.yml` 的 `name` 已是「PTC 模式」风格文案，但 `agent.cordis.yml` 的 presentation row 仍是 `mode: code`，描述文案也残留 "Code Mode"；`packages/bundle/blue/README.md:7`「Standard, PTC, and minimal modes track the pinned harness line」。

**跟发动作（必改）**：
1. `presets/code/agent.cordis.yml`：`mode: code` → `mode: ptc`；preset id 与文案统一到 `ptc`（上游 shipped preset ids 已是 `['cordis','minimal','ptc','standard']`，见 `packages/preset/agent-presets/tests/shipped-root.spec.ts:59`）。
2. 全树文案清扫："Code Mode" → "PTC mode"（presets 描述、README、e2e 断言）。
3. 注意上游的进程级环境缝 `DSH_TOOLS_MODE`（web-app patch 内 TEMPORARY workaround）不是稳定接口，Blue 不依赖。

## 9. Remote 网关重写——最大不确定项，届时重验

**官方 0.1.2 事实**（这是本版最大的结构性变化）：

- 树内**不存在** `apiProxy`/`remoteBackend`/`connection` 任何符号；`packages/host/` 无 `dsh-host-apiproxy` 包。
- 新面：`@deepseek-ai/dsh-api-gateway`（`TypertGateway` 服务，unary `POST /api/<ns>/<method>` + WebSocket mux `/api/remote.mux`）+ `@deepseek-ai/dsh-api-remotes`（`apply(ctx)` 仅 `inject: ['typertGateway']` 并注册转发事件源）。业务方法用 `@Remote`/`@RemoteScope` 装饰器（`dsh-typert-protocol`）声明。
- 旧 ApiProxy 操作按归属拆分到 `dsh-api-session-controller` / `settings-controller` / `workspace-controller`（迁移表见决策记录 `2026-08-10-unary-apiproxy-remote-migration.md`：「Connection owns the transport envelope and exact Fetch route registry, and no API Proxy service remains」）。
- **无 `system.describe`/`system.negotiate`、无 bridge 版本常量**——与 Blue remote 包实现的握手协议无对应物。

**Blue 现状**：`packages/remote`（validation-only，非发布集）**结构化**适配独立产品 dsh-remote 的 wire（不 import 其包）：`wire-transport.ts` 走 HTTP `host.fetch`（如 `POST /api/respond`）+ SSE `host.subscribe('mux')`，握手 `system.describe`/`system.negotiate` 报 `bridge {major:2}` + `acceptedAbis`；配对码 + 服务器指纹鉴权；写租约/围栏 token。集成门禁 `pnpm fixture:remote-upstream` 从本地 dsh-remote-core checkout（`--upstream`/`DSH_REMOTE_DIR`）加载真实 daemon，其 `daemonModule.apply({ remoteBackend, apiProxy, connection })` 正是 0.1.2 中被删除的接线形状。ABI 记录：`packages/remote/AGENTS.md`（rc.6 期）。

**判定：届时重验，暂不动**。关键认知：Blue 的 remote 耦合对象是**独立的 dsh-remote 产品**（sibling 仓库），不是 harness npm 包；harness 0.1.2 删除 ApiProxy 意味着 dsh-remote 的 0.1.2 对齐版大概率要换宿主接线（改基于 `typertGateway` 注册 remoteBackend，或直接消费 `@Remote` 装饰器面），届时其对外 wire ABI 可能升 major。**触发点**：dsh-remote 发布 harness-0.1.2 对齐版 → 跑 `fixture:remote-upstream`（换新 checkout）→ 按差异更新 `wire-transport.ts` 与 `packages/remote/AGENTS.md` 的 ABI 记录。SSE→WS-mux 的传输迁移是潜在最大工作量，本文档不预写方案。

**附带（一次性 token）**：0.1.2 的 Web 鉴权在 client connection 层（`packages/client/connection/src/browser-auth.ts`），URL `?token=` 换 HMAC cookie，**loopback 也不豁免**（README：「Every Host RPC method and WebSocket stream requires one browser session; there is no method-specific loopback tier」）。Blue 不挂 web host，不受直接影响；`blue-lark` 打的是 `dsh-host-webserver`（另一服务）的 loopback `127.0.0.1:<port>/dsh-lark/settings`——**bump 时验证点**：确认该 webserver 未并入 connection 鉴权层。

## 10. `dsh plugin` CLI 面与 profile 收敛——verify-only

0.1.2 的 CLI（`apps/cli/src/args.ts`）：**没有 `dsh profile` 子命令**；「应用统一通过 Profile 启动」指 Python SDK（默认 `--profile sdk`，须显式 `DSH_HOME`）、TS SDK（spawn `dsh --profile sdk`）、ACP（`dsh --profile acp`）都以 profile 模板运行；模板键扩为 `acp/web/headless/sdk/sdk-minimal`（`packages/boot/app-boot/src/profile.ts:137-158`）。`dsh plugin --profile <name> add <pkg>` **形状未变**（仍是 profile 目录下 pnpm verbatim forwarder）。

**Blue 依赖面**：`packages/cli/src/translate.ts`（强制 `--profile blue`）、`calibrate.ts`（`dsh plugin --profile blue add @dsh-blue/blue@<v>`）、`packages/interaction/src/plugin-command.ts`（nested host 路由）、drift workflow 的 `--profile headless`——全部踩在未变形状上。**判定：verify-only**（bump 后 smoke 全套即覆盖）。

## 11. 隐私与文档面（跟发时的用户可见说明）

0.1.2 起（`dsh-llm-pi-ai` 请求头）：DeepSeek 官方适配器**默认随请求附带已启用插件包名与版本**（部署可配置关闭）——`@dsh-blue/blue@<version>` 会被上报；另有**默认关闭**的 session 日志增量上传；公网 WebFetch 默认开启（内置 SSRF 防护，不再逐次审批）。跟发时在 README/website 与 `docs/blue-compatibility-and-rollout.md` 补：说明 + 关闭路径。

---

## 附录 A：跟发执行核对单

前置：0.1.2 线出现在 npm `next` → drift 开 MINOR_JUMP issue → 人工裁决本文档 → 按 R1 式钉版执行（runbook：`script/harness-drift-task.mjs` 生成的 prompt + `AGENTS.md`「Bumping the line」节 + `docs/blue-roadmap.md` R1 行追加记录）。

钉版之外的本版特定动作（按本文档章节）：

1. [ ] §1 放宽 version.spec 正则（仅当 pin alpha）；prune `dsh-host-apiproxy` exclude 行（`pnpm-workspace.yaml:139`）
2. [ ] §8 `presets/code` → `ptc`：mode 值、preset id、文案、e2e 断言（**阻断项**）
3. [ ] §7 models-dev 的 `maxTokens` 语义复核与表单文案；（可选）向导新增 `thinkingBudgets`/`transport` 档
4. [ ] §9 换 dsh-remote 0.1.2 对齐 checkout 重跑 `fixture:remote-upstream`；更新 `packages/remote/AGENTS.md` ABI 记录
5. [ ] §9 验证 blue-lark 的 loopback webserver 不在 token 鉴权层内
6. [ ] §10 smoke 全套（`translate`/`calibrate`/`plugin-command` 路径即被覆盖）
7. [ ] §11 README/website/compat 文档的隐私说明
8. [ ] 全套 gates：`typecheck / lint / diagrams:check / build / check:lib / test:coverage / smoke:happy`（对新高线）+ `fixture:context-upstream` + registry-install 矩阵

## 附录 B：官方源码引点索引（tag `dsh-v0.1.2-alpha.1`，commit `cd5ef81`）

| 主题 | 路径 |
|---|---|
| 设置注册 / wire 视图 | `packages/settings/settings/src/index.ts`、`src/types.ts` |
| 浏览器 slots 体系 | `packages/client/ui-slots/src/index.ts`、`packages/client/ui-renderer/src/client/registry.ts`、`docs/subsystems/slots.md` |
| 设置页 slots 契约 | `packages/client/ui-settings/src/client/contract/slots.ts`、`packages/client/ui-settings-plugins/src/client/slot-contract.ts`、`packages/client/ui-settings-models/src/client/slot-contract.ts` |
| 插件面 slot 目录（生成物） | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
| Authorization flows | `packages/credentials/authorization/src/index.ts` |
| 子代理模型选择 | `packages/subagent/tool-subagent/src/{index,model-selection,model-selection-settings,list-models}.ts`、`packages/subagent/subagent/src/{types,child-agent}.ts`、`packages/core/agent/src/runtime-types.ts` |
| locale | `packages/client/locale/src/client/index.ts`、`src/locale-settings.ts`、`README.md` |
| pi-ai 适配器 schema | `packages/llm/llm-pi-ai/src/{config,catalog,provider,adapter}.ts` |
| PTC presentation | `packages/core/tools/src/{index,ptc}.ts`、`packages/core/agent-tool-presentation/src/index.ts`、`packages/preset/agent-presets/presets/ptc/` |
| 网关 / remotes | `packages/api/gateway/src/{index,types,stream-protocol}.ts`、`packages/api/remotes/src/index.ts`、`docs/api-gateway.md` |
| Web 一次性 token | `packages/client/connection/src/{browser-auth,rpc-host,api-request-trust}.ts` |
| profile 模板 / CLI | `packages/boot/app-boot/src/profile.ts`、`apps/cli/src/args.ts` |
