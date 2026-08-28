# Blue Compatibility And Rollout

## Harness 兼容策略

Blue 主线按当前钉版开发，并保留上一条 Harness 线的 contract fixture。新功能只消费官方 API；缺能力时增加独立窄 adapter，不修改 Blue 核心以适配某个版本。

能力探测优先于版本号分支。版本信息集中在 adapter；frontend feature 只看到 capability present/absent。

每个 adapter 文档必须写出删除条件，例如“上游 session projection 覆盖 resume watermark 后删除 session bridge”。adapter 不维护第二套业务状态，不暴露 Agent/Session 原对象，不使用 package-internal import。

## 新旧实现共存

旧实现保留为 golden/e2e 行为基线。迁移按 vertical slice 进行：domain/adapter、projection/action、interaction model、TUI renderer、headless fixture、unload/width 测试齐全后，才切换 bundle row。

provider host 永存；旧 provider 可以卸载，新 provider 立即挂载，失败回退 plain provider。旧代码不得通过非公开 shortcut 绕过新 host。

## 主分支演进

重构分支定期从 master 更新，避免长期 fork。Harness 新增官方能力时按 additive 路径接入：新增 adapter、feature plugin、bundle row 和 fixture，不修改已有 kernel contract。每次 harness line 升级都运行当前线与上一线 contract fixture、全量 Blue gate、真实 profile smoke。

## 阶段门禁

1. 文档与现状索引同步；
2. 独立外部 fixture 能加载并卸载；
3. projection replay/resume、action abort/stale rejection 通过；
4. provider swap/fallback 通过；
5. headless/TUI composition 和 width-scan 通过；
6. 真实安装、PTY smoke 和用户 dogfood 通过后才替换官方 surface。


## 0.1.2 跟发后的用户可见行为（D58 前向说明）

Blue 随 dsh 0.1.2 线（钉版 bump 后）生效的三项上游默认行为，提前向用户说明：

1. **插件元数据上报**：DeepSeek 官方适配器默认随请求附带已启用插件的包名与版本——`@dsh-blue/blue@<version>` 在内；部署可配置关闭（上游 `dsh-llm-pi-ai` 配置项）。
2. **Session 日志增量上传**：官方适配器新增的可选行为，**默认关闭**；开启时对话日志增量上传至 DeepSeek。
3. **公网 WebFetch 默认开启**：内置 SSRF 防护，公网请求不再逐次审批（preset 已随之将 `tool-web` 的 `fetch` 置 `true`）；内网目标仍受审批与防护约束。

另：preset `code` 已随上游更名为 `ptc`（能力不变）；旧会话记录里引用 `code` 的地方将显示为未解析预设名。
