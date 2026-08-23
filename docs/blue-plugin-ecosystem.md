# Blue Plugin Ecosystem

## 安装与激活

Harness 的用户路径分三步：安装 npm 包、profile 记录 bundle、Cordis patch 挂载 rows。

```sh
dsh plugin --profile blue add <package>
```

没有 `dsh.bundle` 的包只会作为普通依赖安装，不会自动激活。bundle 的 `cordis.patch.yml` 才声明 plugin rows、`name`、`inject` 和 config。

```text
bundles -> profile cordis.patch.yml -> home patch -> --patch
```

上层按 row id 覆盖、禁用或插入新实现；这是启动期 composition。运行时 provider 切换由 Blue provider host 和 command 完成，不要求用户修改 patch 后重启。

## 跨 frontend 发布

一个功能优先拆成：

```text
@scope/feature        Domain bundle，headless/Web/TUI 共用
@scope/feature-blue   Blue TUI adapter bundle，可选
@scope/feature-web    其他 renderer adapter，可选
```

Domain bundle 不注入 Blue 服务；Blue adapter bundle 才注入 `blue-frontend`/TUI services，避免 headless profile 因缺少 renderer 服务而 pending。

## Cordis 纪律

每个插件导出稳定 `name`、最窄 `inject` 和 `apply(ctx)`；所有 registry、event、timer、subscription、mounted model 都用 `ctx.effect` 绑定 Fiber。插件不得 import pi-tui 或 Blue 内部文件。卸载必须回收贡献、异步任务、panel、focus 和 cache。

## Capability 与降级

能力不存在是正常状态：没有 projection 则不显示对应 surface，没有 renderer 则提供 plain fallback，没有 action 则禁用提交。插件错误只影响自身 contribution；provider 激活失败回退 plain provider。

