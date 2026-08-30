# 发布插件

Blue 插件是带 `blue.plugin.json` 的普通 npm 包。Blue 官方包由 CI 发布；本地不执行 `npm publish`。

## 发布

```sh
# 由 CI 在受保护的发布工作流中执行 npm publish
```

发布前确认：

- `exports` 指向构建产物，`files` 白名单覆盖所有导出目标（validate 脚本的 `package` 组会查）；
- `@dsh-blue/blue-api@0.1.1-rc.2`（用到 builder 时再加 `@dsh-blue/blue-ui@0.1.1-rc.2`）在 `dependencies`，`@deepseek-ai/cordis` 在 `peerDependencies`——后者由宿主 dsh 提供，打进 `dependencies` 会出现第二份服务实例；
- canonical manifest 的 `api` 对准 `^1.0.0-beta.1`，`compatibility.blue` / `harness` 对准已用 packed fixture 证明的产品线。这是预览兼容声明，不是对未来 Stable `1.x` 的承诺。

## 用户安装路径

```sh
blue plugin add @my-scope/blue-clock@0.1.0
```

包含 `package.json.dsh.bundle.patch` 的包会由 dsh 装配自带的 patch。如果包没有 bundle 声明，它只会作为普通依赖安装，此时才需要手工向 profile patch 加行：

```yaml
- id: my-plugin-clock
  name: 'my-scope/blue-clock'
```

运行中的 Blue 保留 `/plugin install` 命令，但 rc.2 市场迁移期间不要从旧 registry
安装条目。对已经证明 rc.2 兼容的明确 package spec 使用上面的
`blue plugin add`；安装后重启 Blue 才会激活新行。

## 版本策略建议

- **跟随 Blue 的预览节奏**：Blue 处于 rc 线时，插件也用 `@rc` dist-tag 发布，与宿主同步升级；
- **Beta 范围不预支 Stable 兼容性**：当前 manifest 使用 `^1.0.0-beta.1` 以匹配这条 Beta host；不要据此宣称兼容所有未来 Stable `1.x`。每条新 Harness/Blue/API 线都用 [fixture 的 `--harness-line`](/plugins/testing#fixture：打包安装契约) 重新验证后再更新兼容声明；
- **能力变更即 minor**：往 manifest 加 capability 是会改变 `open()` 结果的兼容面变化，按 semver minor 处理并在 changelog 里写明要求的最低 Blue 版本。

## 插件市场

市场 registry 和现有 verified 条目仍使用 rc.2 之前的 legacy `dock`/`notifications`
metadata，尚未完成 canonical P1–P4 迁移。因此 Website 构建会清理市场数据与详情
路由，并暂停收录；旧 `verified` 不是 rc.2 兼容性或 conformance 证据。待 registry
validator 和至少一个插件完成迁移后再恢复卡片、提交与一行安装承诺。
