# DeepSeek Harness / Cordis 与 Blue 架构审计

> 审计基线：Blue `master` at `5db6b6b`，2026-08-22。本文评估当前代码，而不是历史设计稿中的目标状态。
>
> 结论先行：Blue 不需要推倒重来。它的宏观方向正确，L0/L1 边界尤其扎实；下一阶段真正需要治理的是**公共契约所有权、模块级状态生命周期、软依赖类型和第三方渲染隔离**。当前内部 seam 适合 Blue 自己快速演进，但还不适合作为长期稳定的第三方 API 直接发布。

## 1. 审计范围与依据

本次审计回答五个问题：

1. DeepSeek Harness 和 Cordis 的架构如何工作；
2. Blue 的包、层和运行时组合是否合理；
3. 这套设计在持续加入功能时提供了什么能力；
4. 当前实现的代码质量、复用性和可维护性如何；
5. 如何开放长期稳定、且不易破坏 Blue 的插件接缝。

依据分三层：

- 官方语义：[Harness Architecture](https://deepseek-harness.github.io/deepseek-harness/en/reference/)、[Cordis Primer](https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-primer)、[Plugins and lifecycle](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/)、[Services and dependencies](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service)；
- Cordis 4.0.1 源码：`Context`、`Fiber`、`Service`、`RegistryService`；
- Blue 当前源码、package exports、bundle patch、103 个 spec 文件和现有设计/ADR。

本次只做架构与代码静态审计，并运行了 `pnpm run typecheck` 和 `pnpm run test`。typecheck 通过；完整 test 为 1842 通过、1 失败。失败是 `clipboard-write.spec.ts` 中依赖不可执行文件产生 `EACCES` 的用例在当前环境超时 5 秒；单独重跑该文件时同一用例没有得到预期的两个 `EACCES`，而是落到了环境中的真实 `xclip` 并产生 display 错误。它不推翻整体质量判断，但说明这个外部进程测试存在 PATH/权限环境敏感性，不能只引用仓库的历史全绿记录。

## 2. Harness 与 Cordis 的真实架构

### 2.1 Harness 是能力图，不是传统分层框架

Harness 将 agent runtime 拆成一组挂在 Cordis `Context` 上的 capability service，例如 `agents`、`sessions`、`tools`、`llm`、`commands`、`userQuestions` 和 approval。插件不通过中央 application object 获取全部能力，而是声明和消费它实际需要的服务。

这带来三个重要性质：

- **能力与呈现分离**：工具、模型、会话和权限是宿主能力，TUI/Web 只是消费者或 provider；
- **组合优先**：bundle/profile 决定哪些实现被挂载，不需要在中心模块中写死产品形态；
- **作用域可变**：Context 可以隔离服务，Agent 能挂到自己的 composition，而不必继承全局的全部工具和 persona。

因此 Blue 选择“同进程 renderer plugin tree”是正确的。UI 需要即时接收 session events、回答 approval/userQuestions、取消当前 turn，并操作同一个 Agent；把它做成进程外 RPC 客户端会重新发明这些时序和回传协议。

### 2.2 Cordis 的核心不是 DI，而是 Fiber 生命周期

每次 `ctx.plugin()` 都创建一个 Fiber。Cordis 4.0.1 的状态是：

```text
PENDING -> LOADING -> ACTIVE
              \----> FAILED
ACTIVE  -> UNLOADING -> DISPOSED
```

`inject` 声明的是**运行条件**。所需服务不存在时 Fiber 留在 `PENDING`；provider 被卸载时消费者先 unload，provider 恢复后消费者再 reload。这比只在启动时解析一次的依赖注入更强，因为依赖关系同时控制运行期生命周期。

`ctx.effect()` 将资源注册到当前 Fiber：listener、registry entry、timer、组件和终端资源都应返回 disposer。Fiber 按注册逆序清理，并等待异步 disposer。`Service` 构造时提供能力，也由所属 Fiber 自动撤销。

所以 Cordis 给 Blue 的真正能力是：

```text
插件声明依赖
    -> 服务齐备后加载
    -> 注册行为绑定当前 Fiber
    -> provider 更换时自动拆除消费者
    -> 新 provider 就绪后重建消费者
```

HMR、主题切换和功能行启停只是这条机制的不同用途，而不是三套独立实现。

### 2.3 Cordis 不自动提供的能力

Cordis 管理“谁何时活着”，但不保证：

- UI 回调不会阻塞；
- 一行文本不超过终端宽度；
- overlay 不破坏焦点；
- 多个 key handler 语义兼容；
- 模块级变量随 Fiber 卸载；
- 第三方插件遵守 Blue 的布局和主题纪律；
- `ctx.get('optionalService') as LocalShape` 与宿主升级后仍兼容。

这些必须由 Blue 的契约、adapter、registry 和测试来保证。开放插件 API 时尤其不能把“运行在 Cordis Fiber 中”等同于“插件已经被隔离”。

## 3. Blue 当前结构是否合理

### 3.1 总体评价

| 维度 | 判断 | 说明 |
|---|---|---|
| 宏观架构 | 合理 | TUI 被组织为 Cordis 插件树，而不是单体 controller |
| L0/L1 边界 | 优秀 | pi-tui 和终端状态被限制在 core，外层使用 Blue 自有接口 |
| L2/L3 职责 | 基本合理 | interaction 负责输入/provider，transcript 负责事件投影和展示 |
| L4 组合 | 有效但昂贵 | patch 可表达完整产品，但 thin-host disable roster 需要持续跟随上游 |
| 包依赖 | 与文档有偏差 | app-owned contract 导致下层包反向依赖 app；interaction 还依赖 transcript |
| 扩展 seam | 内部可用 | registry/disposer 设计好，但部分 seam 暴露组件和可变对象，不宜直接公开 |
| 多实例/HMR | 部分成立 | Fiber 内状态可靠；模块级 singleton/cache 不属于 Fiber，需额外纪律 |

### 3.2 L0/L1 是设计最成功的部分

`packages/core` 是运行时代码中唯一导入 `@earendil-works/pi-tui` 的包。`BlueComponent`、`BlueScreen`、`BlueComponents`、`BlueTheme` 和 `BlueKeymap` 都是 Blue 自有结构类型，不把 `TUI`、`Editor` 等实现类型泄漏给上层。

这层隔离产生了直接收益：

- pi-tui 升级的破坏主要收敛在 core adapter；
- transcript 和 interaction 的测试可用自有 fake，而不必启动真实 terminal；
- 可见宽度、折行、截断和 Markdown 创建都通过统一入口；
- terminal suspend/resume、raw mode、OSC、focus 和 overlay 栈有唯一所有者；
- D48 width contract 能在组件边界扫描，而不是等真实终端崩溃。

`blueScreen` 的职责总体正交，但它已经同时承担 screen tree、focus、overlay、terminal title、suspend 和尺寸事实。对内部 L1 仍可接受；对第三方公开则权限过大，不能直接作为公共 API。

### 3.3 L2/L3 的拆分总体有效

Transcript 采用：

```text
SessionEvent[] / session event
        -> pure fold / incremental folder
        -> TranscriptItem
        -> intent or plain component
        -> blueScreen
```

Fold 与 UI 分开，使 replay、streaming、session export 和窗口淘汰可以围绕同一事件模型测试。工具呈现通过 `blueIntents` 注册表扩展，状态栏通过 `blueStatus` 注册表扩展，都是符合 Cordis 思路的 contribution seam。

Interaction 将输入、commands、questions、approval、title 等作为内嵌子插件挂载，注册与 Fiber 绑定。大量命令最终复用 Harness 的 `commands`、permission preset、agent preset、tools 和 session 服务，而不是在 Blue 内复制业务状态。这没有破坏 Harness 的设计理念，反而是 capability layering 的正确用法。

问题在于 interaction 已增长到约 12k 行、52 个源文件，是最大的变更热点；其中 `input-plugin.ts`、`model-commands.ts`、`provider-add.ts`、`editor-plus.ts` 都是较大的流程模块。包级边界尚可，但包内的“输入编排层”和“具体功能族”需要继续保持分离，避免所有新功能都汇入 command/input 两个入口。

### 3.4 声称的严格依赖方向并不完全成立

设计文档写的是 `core ← transcript / interaction ← app ← bundle`，实际发布依赖为：

```text
core
  ^
  |\
  | +-- transcript ----> app (blueSession contract)
  |          ^
  |          |
  +-- interaction -----> app
         |
         +-------------> transcript

bundle -> all four packages
```

具体表现：

- transcript 的 peerDependencies 包含 app，并通过空 type import 获得 `blueSession`/events declaration merge；
- interaction 同时依赖 app、core 和 transcript；
- `session-export.ts` 直接复用 transcript 的 `foldSessionEvents` 和 item 类型；
- `session-commands.ts` 从 transcript 的 `banner-content` 读取版本常量；
- `mode-status.ts` 从 transcript 读取 `BlueStatusEntry`。

这些依赖目前没有形成循环，且多数复用本身合理；问题是**契约被实现包拥有**。app 位于组合/驱动层，却成为渲染和交互的类型基础；transcript 同时是实现包和共享 fold/API 包。长期来看，这会使包不能独立演进，也使“删除某层仍能启动”的主张依赖 type/package 安装而非纯 runtime composition。

建议不是拆掉现有功能，而是把共享契约上移到独立、无运行时依赖的 API 包，随后让 app/transcript/interaction 都依赖该契约。

### 3.5 Bundle 组合正确，但升级风险集中

`cordis.patch.yml` 的 baseline/enhancement 分段清晰，plain-first 是有效约束：增强行可独立删除、基线仍可工作。插件行顺序还自然表达了 dock 顺序，这是组合层的合理职责。

风险来自 thin-host：Blue 禁用了 `dsh-base` 中二十余个 agent-plane row，再通过 agent preset 给每个 Agent 重新组合工具/persona。这实现了真实的 `/preset` 语义，但形成一份必须与上游 web-app/base 同步的 disable roster。上游新增或更名 agent-plane row 时，Blue 可能静默退化为“全局能力重新漏进来”。

这不是违反 Cordis 理念，而是充分使用 composition 后产生的配置耦合。应以自动化契约测试治理：解析上游 base/web-app patch，检查 roster 差异，并在真实 Agent scope 中断言各 preset 的最终工具集合，而不能只检查 YAML 文本。

## 4. 这套设计支撑了哪些能力

### 4.1 功能增长没有腐蚀唯一核心

主题、状态条目、intent renderer、pane、attachments、paste image、editor-plus 都以独立插件或注册项加入。新增功能通常只需要：

1. 声明所需 service；
2. 创建本功能的状态/组件；
3. 通过 registry 或 screen seam 注册；
4. 将 disposer 交给 `ctx.effect`。

因此功能数量的增长主要表现为模块和 plugin row 增多，而不是 `blue-core` 不断吸收 Harness 业务分支。core 约 3.7k 行，在全树功能大幅增长后仍没有 Agent/Session/Tool 业务类型进入 L1，这是架构约束确实生效的证据。

### 4.2 Provider replacement 被用于真实产品能力

Theme 不是可变全局 palette，而是 replaceable provider。切换 provider 会让 `blueTheme` 消费者重建，避免每个组件订阅自定义 theme event。这是 Cordis 语义被正确利用的代表。

代价是组件重建会丢失 editor draft/history，因此 Blue 引入模块级 stash 跨 reload 保存状态。该折衷在单 UI 进程中工作，但表明 provider reload 并非完全“免费”：有身份或暂存状态的组件必须明确迁移策略。

### 4.3 Plain-first 提供了可验证的退化能力

Blue 自己的增强功能与潜在下游插件走相同 registry，baseline 不依赖增强存在。这比在主插件中增加配置开关更可组合，也让：

- 缺少 attachments 时 transcript 降级为 placeholder；
- 缺少 optional Harness service 时命令可返回能力不可用；
- intent 未知时回退 generic renderer；
- 增强插件卸载后 baseline 行为恢复。

这种“provider/entry 缺席即退化”的设计与 Harness 的 capability model 一致。

### 4.4 测试架构具有真实防线

当前测试不是只有快照：

- source-plane unit tests 检查纯 fold、registry、panel 和 component；
- whole-tree e2e 通过真实 Cordis Loader 和 Agent loop 启动整树；
- width-scan 使用 CJK、ANSI 和窄宽度对组件逐一施压；
- frame clamp 记录越界而非悄悄掩盖；
- real-process smoke 通过真实 `dsh` 和 mock LLM 验证构建产物；
- invariant companion 检查 session switch 的 commit point。

这使代码质量整体显著高于一般 TUI 项目。尤其宽度契约已经从零散修补提升为架构级不变量。

## 5. 代码质量、复用与维护性评价

### 5.1 做得好的部分

- strict TypeScript、`exactOptionalPropertyTypes` 和 `noUncheckedIndexedAccess` 把大量边界错误前移；
- exported symbol 和 module header 说明职责、时序与设计理由；
- registry 普遍具有重复 id 检查和幂等 disposer；
- session switch 有串行队列和明确 commit point，失败不破坏当前 session；
- fold、view resolution、terminal adapter、external process launcher 等边界可单测；
- chrome/width/select/panel 等几何能力已有复用，而不是每个 feature 自己计算；
- package-level `AGENTS.md`、ADR 和 dogfood 记录保留了复杂决策的原因。

### 5.2 需要警惕的部分

#### 模块级状态绕过 Fiber 所有权

当前存在 shared editor、draft/history、skills cache、approval allowance WeakMap、timer replacements、window policy、theme registry reference、exit epitaph 等模块级状态。

其中一部分是测试注入点，一部分刻意用于跨 provider reload 保存状态，并非天然错误。但它们具有共同问题：生命周期是 Node module instance，不是 Cordis Context/Fiber。

影响包括：

- 同一进程挂两棵 Blue tree 时状态可能串联；
- HMR 是否保留状态取决于模块 reload 边界；
- 测试必须手工 reset，遗漏会形成顺序依赖；
- 插件卸载不自动清理，除非每个调用点严格注册 effect。

处理原则应是：测试替换器保留但集中管理；产品状态迁移到 tree-scoped service；真正需要跨 provider reload 的状态由稳定 provider 持有，而不是依赖 module cache。

#### 软依赖牺牲了静态契约

大量 `ctx.get()` 是有意的：optional service 不应让整个插件 Fiber 等待或随 provider reload。但是部分代码再用局部 `as SomeServiceShape` 描述服务，这形成“编译器相信、运行时未验证”的契约。

建议区分：

- 官方、已导出类型的 Harness service：直接 import type；
- 可选但稳定的 Blue capability：API 包声明正式类型，仍可 `ctx.get()`；
- 未承诺的宿主内部能力：放在 adapter 中做 runtime capability check，不让局部 shape 散落在 feature 文件。

#### 内部复用与公共 API 混在同一 export 面

每个 package 都导出了 `./src/*`。这对 source-linked 开发方便，但从 npm `exports` 角度等于允许消费者绕过受控 subpath，依赖任何内部文件。只要发布，就会形成事实上的生态依赖，后续无法判断哪些路径可以重构。

此外现有 `blueIntents` 让贡献者返回 `BlueIntentComponent`，`blueStatus` 让条目返回任意 ANSI string。Blue 自家插件受测试纪律约束，第三方插件则可以：

- 返回超宽行；
- 发出未闭合 ANSI；
- 阻塞 render callback；
- 在 component 中持有未释放 timer；
- 绕过主题和统一布局。

因此内部 seam 的实现质量可以高，但**安全边界不足以直接公共化**。

### 5.3 是否破坏了原本设计理念

没有系统性破坏。以下核心理念仍然成立：

- TUI 是插件树；
- 注册与卸载绑定；
- Harness 业务能力不下沉到 core；
- 渲染和交互分离；
- enhancement 可组合；
- provider replacement 用于实现替换。

已经出现的局部偏离是：

1. 契约归属与层次方向不一致；
2. 模块级 singleton 形成 Cordis 之外的第二套生命周期；
3. 一些跨插件协调靠内部事件/共享引用，而不是明确服务；
4. `./src/*` 使私有实现事实上可导入；
5. 当前 renderer seam 信任贡献者遵守内部不变量。

这些是规模增长后的治理问题，不是架构根基失败。正确策略是收紧公共边界，而不是把插件树重写成单体。

## 6. 公共插件 API 的目标设计

### 6.1 核心原则

公共 API 必须同时满足：

1. **长期稳定**：只包含 Blue 自有、最窄、不可变的领域类型；
2. **最小权限**：插件只拿到它声明的 capability，不能拿到底层 screen；
3. **声明式渲染**：第三方返回数据模型，Blue 决定组件、主题、折行和焦点；
4. **生命周期闭合**：每项贡献都归属于一个 Fiber，并能自动回收；
5. **失败隔离**：单个插件失败不能中断 terminal frame、输入链或 Agent；
6. **渐进开放**：先开放风险低的贡献面，不因“未来可能需要”暴露内部对象。

### 6.2 新增独立包 `@dsh-blue/blue-api`

新增一个零运行时或极小运行时包，成为第三方唯一允许依赖的 Blue 契约包：

```text
@dsh-blue/blue-api
  - public types
  - API version constants
  - declarative view schema
  - stable error codes
  - Cordis Context declaration merges for public services only

core / transcript / interaction / app
  -> blue-api

third-party plugin
  -> blue-api + @deepseek-ai/cordis
```

它不能依赖 core、transcript、interaction、app、pi-tui 或具体 Harness service package。Harness 的 `Agent`、mutable `SessionEvent`、Tool runtime object 不能出现在公共签名中；它们必须投影为 Blue-owned readonly snapshot。

第一阶段完成迁移后，移除各发布包的 `./src/*` export。内部测试继续使用相对源码路径，不受影响。现有明确 subpath 暂不自动承诺稳定，文档中标为 `internal` 或 `experimental`，直至迁移到 blue-api。

### 6.3 单一宿主入口与 consumer-scoped API

不为每个小功能无限增加 Context service。Blue 在 Context 上提供一个宿主入口，SDK 的 `defineBluePlugin()` 用当前插件的 Context 打开 consumer scope，再把受限 façade 交给插件：

```ts
interface BluePluginHost {
  readonly version: '1.0.0'
  open(context: Context, manifest: BluePluginManifest): BluePluginApi
}

interface BluePluginApi {
  readonly commands: BlueCommandRegistry
  readonly status: BlueStatusRegistry
  readonly tools: BlueToolViewRegistry
  readonly editor: BlueEditorExtensionRegistry
  readonly panels: BluePanelService
  readonly notifications: BlueNotificationService
  readonly session: BlueSessionReader
}
```

第三方通常不直接调用 `open()`，而是：

```ts
export default defineBluePlugin({
  manifest: {
    api: '^1.0.0',
    id: 'acme.example',
    capabilities: ['commands', 'status'],
  },
  apply(api) {
    api.commands.register(/* ... */)
    api.status.register(/* ... */)
  },
})
```

`defineBluePlugin()` 生成一个标准 Cordis plugin，声明 `inject = ['bluePlugins']`，在自己的 `apply(ctx)` 内检查 manifest，并把该 scope 的全部 registration disposer 交给**第三方插件自己的** `ctx.effect`。这一点不能由 provider service 猜测：普通 service method 不知道调用者属于哪个 Fiber，如果把 disposer 注册到 `bluePlugins` provider 的 Context，第三方卸载时资源不会回收。

每个子接口只暴露其领域能力；实现层可以继续桥接现有 `commands`、`blueStatus`、`blueIntents` 和 editor seam。高级 Cordis 插件仍可在 `defineBluePlugin` 外注册自己的非 Blue effect，但 Blue contribution 必须通过 consumer-scoped `api`。

选择 façade 而不是直接公开 `blueScreen` 的原因：服务入口可以长期稳定，而内部可以从 pi-tui 迁移、重构 dock 或更换 component tree，不影响第三方。

### 6.4 插件元数据与兼容性

第三方插件继续是标准 Cordis plugin，manifest 由 `defineBluePlugin()` 暴露为静态元数据，loader 和诊断工具无需执行插件即可读取：

```ts
export const manifest = {
  api: '^1.0.0',
  id: 'acme.example',
  capabilities: ['commands', 'status'],
} as const
```

规则：

- `id` 使用反向域名或 npm scope 派生 namespace；
- contribution id 必须以 plugin id 为前缀；
- loader 可在 activation 前预检 API range；即使宿主 loader 不识别元数据，`defineBluePlugin` 也会在注册任何 contribution 前检查；
- 不兼容时该 Fiber 进入失败状态并输出结构化诊断，主 UI 继续运行；
- capability 列表用于诊断和未来权限策略，不替代 Cordis `inject`；
- API major 只在破坏签名或既有语义时增加；minor 只能增加 optional 字段或新 capability。

不要使用 `min/max` 数字范围，因为它不能表达 prerelease、兼容 minor 和多个 major。使用标准 semver range，并在 SDK 中提供解析/检查实现，避免每个 loader 自己解释。

### 6.5 通用 contribution 契约

所有 registry 使用相同纪律，但不强迫所有 entry 继承一个无意义的基类：

```ts
interface BlueContributionMeta {
  readonly id: `${string}.${string}`
  readonly priority?: number
}

interface BlueRegistration {
  readonly dispose: () => void
}
```

`register()` 返回幂等 registration，但 consumer-scoped API 立即把它收进当前第三方 Fiber 的 effect；返回给插件的 handle 只允许提前撤销，不能转移 contribution 的所有权。scope dispose 时，未提前撤销的 registration 统一逆序清理。

固定规则：

- duplicate id 原子失败；
- priority 数值越小越先，默认 0，同值按注册顺序；
- 对象在注册时做 defensive copy/freeze；
- callback 收到 readonly snapshot；
- callback 抛错只停用该 contribution，并记录 plugin id/contribution id；
- 卸载插件时清除其全部 contribution、panel、notification 和订阅。

### 6.6 命令：复用 Harness registry，Blue 只加安全上下文

命令的权威 registry 已是 Harness `ctx.commands`，不应再创建第二个命令命名空间。`bluePlugins.commands.register()` 是受控 adapter：将公共 `BlueCommand` 转成 Harness command，并自动进入 Blue 的 completion/help。

```ts
interface BlueCommand {
  readonly id: string
  readonly name: string
  readonly aliases?: readonly string[]
  readonly description: string
  execute(context: BlueCommandContext, args: readonly string[]):
    BlueCommandResult | Promise<BlueCommandResult>
}

interface BlueCommandContext {
  readonly session: BlueSessionSnapshot | null
  notify(message: BlueNotification): void
  openPanel(panel: BluePanelModel): Promise<BluePanelResult>
  request(action: BlueSessionAction): Promise<BlueActionResult>
}
```

安全规则：

- 不能覆盖内置 command/canonical name/alias；
- parser、history、completion 和错误呈现由 Blue/Harness 统一处理；
- 不暴露 `process.exit`、AgentHandle、screen 或 editor component；
- session 行为通过有限的 `request()` action，例如 followup、steer、interrupt；
- callback rejection 转为命令错误，不穿透 input event loop；
- 长任务必须尊重 `AbortSignal`，Blue 在插件卸载或 session switch 时 abort。

### 6.7 状态栏：只接受结构化 inline view

现有 `BlueStatusEntry.render(): string` 适合作为内部 seam，但公共插件不能返回任意 ANSI。

```ts
type BlueInline = readonly BlueInlineSpan[]

interface BlueInlineSpan {
  readonly text: string
  readonly tone?: BlueTone
  readonly emphasis?: 'normal' | 'strong'
}

interface BluePublicStatusEntry extends BlueContributionMeta {
  readonly band: 'primary' | 'secondary'
  readonly align: 'start' | 'end'
  render(context: BlueStatusContext): BlueInline | null
}
```

Blue 负责：

- 清除控制字符；
- 只允许语义 tone，不接收 ANSI；
- 按 pi-tui width truth 计算、截断和 first-fit；
- 捕获 callback 错误；
- 对同一 entry 做变更节流；
- 在窄终端中丢弃低优先级项。

插件不能自行 requestRender 高频刷新。注册时可声明最低刷新间隔，Blue scheduler 合并刷新请求并设置下限。

### 6.8 工具卡片：声明式 `BlueView`，不开放组件工厂

现有 `blueIntents.create()` 返回 `BlueIntentComponent`，会把 width、ANSI、timer 和 dispose 责任交给贡献者。公共 API 改为：

```ts
interface BlueToolViewProvider extends BlueContributionMeta {
  readonly cards: readonly string[]
  present(snapshot: BlueToolSnapshot): BlueView | null
}

type BlueView =
  | { readonly kind: 'text', readonly content: string, readonly tone?: BlueTone }
  | { readonly kind: 'fields', readonly rows: readonly BlueField[] }
  | { readonly kind: 'code', readonly code: string, readonly language?: string }
  | { readonly kind: 'diff', readonly before: string, readonly after: string }
  | { readonly kind: 'sections', readonly sections: readonly BlueSection[] }
```

`BlueToolSnapshot` 只含 call id、name、readonly JSON value、状态、时间和已限制大小的结果摘要。原始 Harness object、mutable transcript item 和 service 不进入 API。

Blue 将 `BlueView` 编译为内部组件，统一控制：

- 折叠/展开；
- 最大行数和内容大小；
- width/wrap/truncate；
- theme 和 code highlighting；
- render cache；
- 错误占位；
- 卸载和 session eviction。

首版 DSL 有意能力有限。真正需要自绘组件的插件只能使用 `blue.experimental.unsafeComponent`，必须显式启用，并且不纳入稳定兼容承诺。

### 6.9 Editor：开放数据增强，不开放实例替换

Stable v1 只开放三类：completion provider、submit validation/transform 和命名 action。它们不能获得 `BlueEditor` 实例。

```ts
interface BlueEditorExtension extends BlueContributionMeta {
  readonly completions?: readonly BlueCompletionProvider[]
  readonly submitHooks?: readonly BlueSubmitHook[]
  readonly actions?: readonly BlueEditorAction[]
}
```

规则：

- completion 接收 text/cursor readonly snapshot，返回候选数据；
- submit hook 返回 accept/reject 或结构化 content block，不直接改 buffer；
- action 通过 Blue 分配/验证 key binding，不能监听原始 terminal bytes；
- handler 明确返回 `handled`/`pass`，同一按键冲突在注册期报错；
- 每个 async provider 有 AbortSignal、超时和最大结果数；
- focus、history、draft stash、prompt symbol 和 editor replacement 保持 internal；
- 完整 vim/editor replacement 先留在 Experimental，等出现真实第三方消费者再冻结。

这会逐步替代 `editor-instance.ts` 的模块级 shared singleton，但不要求第一阶段立即重写现有 Blue 内部插件。

### 6.10 Panel 与通知：Blue 拥有布局和焦点

公开 panel 是状态机/数据模型，不是 `BlueFocusable`：

```ts
type BluePanelModel =
  | BlueSelectPanel
  | BlueFormPanel
  | BlueInfoPanel

interface BluePanelHandle<Result> {
  readonly result: Promise<Result>
  close(reason?: 'plugin-unload' | 'session-switch'): void
  update(model: BluePanelModel): void
}
```

Blue 统一负责 overlay/editor-slot 选择、焦点栈、Escape、终端尺寸、键位提示和卸载清理。第三方不能调用 `blueScreen.showOverlay`、`setFocus` 或 `mountEditorReplacement`。

通知只接受结构化 severity、message 和可选 duration；Blue 决定显示在 hint、toast 还是 transcript。这样未来 UI 布局变化不会破坏插件契约。

### 6.11 Session API：只读快照加受控 action

当前 `blueSession.current` 直接暴露 Agent，适合内部协作，不适合作为稳定公共面。公共 API 提供：

```ts
interface BlueSessionSnapshot {
  readonly id: string
  readonly cwd: string
  readonly status: 'idle' | 'running' | 'waiting' | 'failed'
  readonly model?: BlueModelSnapshot
  readonly mode: 'normal' | 'plan' | 'yolo'
}

interface BlueSessionReader {
  current(): BlueSessionSnapshot | null
  subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void): BlueRegistration
  request(action: BlueSessionAction, options?: { signal?: AbortSignal }): Promise<BlueActionResult>
}
```

不开放 session event log、Agent、AgentHandle、modelRef mutable setter。需要读事件的导出/分析插件应走后续专门的 paged read API，并设置内容和权限边界。

## 7. 插件不能破坏 Blue 的防线

### 7.1 同进程插件的隔离上限

必须明确：Cordis 插件与 Blue 运行在同一 Node 进程，无法构成安全沙箱。恶意插件仍可以 import `node:process`、写 stdout 或阻塞 event loop。这里的目标是防止**正常插件因为 API 设计不当而意外破坏 UI**，不是防御恶意 npm 包。

如果未来需要运行不受信任插件，必须使用 worker/child process 和序列化协议；那是另一套产品与权限模型，不应伪装成普通 Cordis API。

### 7.2 Runtime guard

`bluePlugins` adapter 对所有第三方 callback 加统一 guard：

- sync throw/async reject 捕获并关联 plugin id；
- render/present/status callback 禁止返回 Promise；
- async command/completion/panel action 接收 AbortSignal；
- 对 completion、view、status 设置数量/字节/深度上限；
- 文本剥离 C0/C1 和未授权 escape sequence；
- callback 连续失败达到阈值后停用该 contribution，而不是每帧重复失败；
- 诊断写独立日志，并通过内置通知给出一次摘要。

JS 无法可靠抢占同步死循环，因此同步 view callback 必须保持纯和短；开发期可以记录耗时并警告，不能声称 timeout 能中断它。

### 7.3 渲染出口

所有第三方内容经过唯一管线：

```text
plugin data
 -> schema/size validation
 -> control-character sanitation
 -> BlueView compiler
 -> semantic theme
 -> pi-tui width/wrap/truncate
 -> component width assertion
 -> frame clamp backstop
 -> terminal
```

公共 API 不接受预着色 ANSI。确需展示 terminal output 的内容以 `code`/`terminal` view 传入普通字符串，由 Blue 自己做 escape visualization 或安全着色。

### 7.4 生命周期出口

Blue 为每个 plugin id 建立 contribution scope。Fiber dispose 时：

1. abort 所有在途 async callback；
2. 关闭插件打开的 panel；
3. 取消 subscription/timer/scheduled render；
4. 删除 registry entries；
5. 请求一次合并后的重绘。

API 不允许 contribution 返回自定义 disposer 来替 Blue 管理内部资源；插件自己的外部资源仍应使用标准 `ctx.effect`。

## 8. 版本演进与兼容政策

### 8.1 稳定等级

| 等级 | 导入路径 | 承诺 |
|---|---|---|
| Stable | `@dsh-blue/blue-api` | 同一 major 内源码和行为向后兼容 |
| Experimental | `@dsh-blue/blue-api/experimental` | minor 可变，必须显式 opt-in |
| Internal | 其他 package subpath | 仅 Blue 自用，无第三方兼容承诺 |

主题 token、错误 code、action kind、view kind 使用开放 union 时要谨慎。为保证第三方编译期穷举不被 minor 新增破坏，稳定 API 的结果类型优先使用对象加 `kind: string` 和 documented fallback，或只在 major 中增加 union member。

### 8.2 兼容规则

同一 major 内允许：

- 新增可选字段；
- 新增独立 capability；
- 放宽输入；
- 增加不改变旧输入结果的新方法。

同一 major 内禁止：

- 改字段含义、排序、priority 或 fallback 语义；
- 新增必填字段；
- 把同步回调改成异步或反之；
- 将 readonly snapshot 替换为 live object；
- 改 error code；
- 让曾经被接受的 view/command 注册失败。

每个 stable API 行为都要有 contract spec，而不只是 TypeScript 类型。发布前用上一版 example plugin 的已构建 JS tarball 启动当前 Blue，验证二进制/运行时兼容。

### 8.3 废弃流程

1. minor 版本增加替代 API，并在开发诊断中提示 deprecated；
2. 至少保留一个完整 minor line；
3. 文档提供机械迁移映射；
4. 仅在下一个 major 删除；
5. 对能自动适配的旧 view shape，在 façade 内保留 adapter，而不是要求 renderer 识别多个历史形态。

## 9. 分阶段实施路线

### Phase A：先界定公共面

- 创建 `@dsh-blue/blue-api`，只放类型、版本检查和 view schema；
- 把 `blueSession`、status/intent 公共投影和共享版本常量迁入 API 包；
- 在文档中把现有 subpath 分为 stable/experimental/internal；
- 移除发布包的 `./src/*` exports；
- 增加 API extractor/类型快照或等价的 public surface diff gate。

验收：实现包之间不再为了 declaration merge 反向依赖 app；第三方示例插件只依赖 blue-api 和 Cordis。

### Phase B：安全 façade 与低风险接缝

- 实现 `bluePlugins` host service、`defineBluePlugin()` 和 consumer-scoped API；
- 先开放 commands、notifications、readonly session、结构化 status；
- adapter 内桥接 Harness commands 和当前 Blue status；
- 加入 id namespace、版本检查、callback guard、abort 和诊断；
- 提供一个官方 example plugin 作为兼容 fixture。

验收：卸载 example plugin 后无 command/status/panel/subscription 残留；异常和超宽文本不影响主 UI。

### Phase C：声明式工具视图和 panel

- 定稿最小 `BlueView` union；
- 将内置 generic/diff/terminal renderer 先改为消费同一 DSL，证明 plain-first；
- 开放 tool view provider；
- 开放 select/form/info panel model；
- 保留旧 `blueIntents` 为内部 adapter，不直接向第三方导出。

验收：内置与第三方 view 经过同一个 width-scan 和错误隔离管线。

### Phase D：Editor 扩展与状态收敛

- 开放 completion/submit/action 三类受限扩展；
- 将 shared editor、draft/history 和 extension registry 移入 tree-scoped service；
- 对完整 editor replacement 保持 Experimental；
- 审计并迁移其他产品级 module singleton。

验收：同进程两棵测试 Blue tree 的 draft、completion、allowance 和 panel 状态互不串联。

### Phase E：组合升级保障

- 自动比较 Blue thin-host roster 与上游 base/web-app 的 agent-plane row；
- 对每个 preset 启动真实 Agent scope 并断言最终工具/plan/persona surface；
- 将检查加入 harness line 升级门禁。

验收：上游新增 agent-plane row 时 CI 必须要求 Blue 明确裁决，而不是静默继承。

## 10. 测试与发布门禁

公共 API 除现有全量 gate 外，增加：

- public type/API snapshot；
- 禁止 blue-api 的 `.d.ts` 引用 pi-tui、实现包或 mutable Harness 对象；
- stable example plugin 源码编译测试；
- 上一已发布 API 构建出的 JS 插件在当前 Blue 上运行；
- duplicate id、非法 namespace、API range 不兼容测试；
- callback throw/reject、反复失败后停用测试；
- unload/session switch/theme reload 的资源清理测试；
- CJK、ANSI、超长单词、零宽字符和窄终端的第三方 view width-scan；
- panel focus/Escape/stack 恢复测试；
- async completion/command 的 abort 与 late result 丢弃测试；
- 双 Blue tree 的状态隔离测试；
- bundle real-process smoke 加载至少一个外部 fixture plugin。

第三方 API 是发布面，必须同时遵守 package export、`files` 和 tsdown entry 三角校验；example plugin 必须从打包后的 `lib`/tarball 导入，不能只做 source-plane 测试。

## 11. 最终判断与优先级

Blue 当前设计的价值已经被大量功能验证：插件树、service seam、provider replacement、plain-first 和唯一 pi-tui adapter 都不是纸面抽象。实现质量整体高，特别是 lifecycle、session replay、terminal restore 和 width contract 的测试深度。

后续最危险的选择，是把当前所有内部 seam 直接宣布为公共 API。那会把 `BlueComponent`、mutable transcript item、shared editor、`blueScreen` 和源码路径一起冻结，使任何 renderer 重构都成为生态破坏。

推荐优先级：

1. 先建立 `blue-api` 并修正契约所有权；
2. 关闭 `./src/*` 公共逃生口；
3. 以 `bluePlugins` façade 开放 command/status/notification/session；
4. 用声明式 `BlueView` 开放工具卡片和 panel；
5. 最后才开放 editor，并且只开放数据增强；
6. 同步把产品级模块状态迁到 tree-scoped service；
7. 用真实 composition 测试守住 thin-host。

这样既保留 Cordis 带来的组合能力，也让 Blue 对第三方插件拥有最终渲染权和生命周期控制权。长期稳定的关键不是冻结更多内部类型，而是冻结一层更小、更声明式、更难误用的协议。
