# 发布插件

Blue 插件是带 `blue.plugin.json` 的普通 npm 包。Blue 官方包由 CI 发布；本地不执行 `npm publish`。

## 发布

```sh
# 由 CI 在受保护的发布工作流中执行 npm publish
```

发布前确认：

- `exports` 指向构建产物，`files` 白名单覆盖所有导出目标（validate 脚本的 `package` 组会查）；
- `@dsh-blue/blue-api` 在 `dependencies`，`@deepseek-ai/cordis` 在 `peerDependencies`——后者由宿主 dsh 安装提供，打进 `dependencies` 会出现第二份服务实例；
- manifest 的 `api` 范围对准当前可执行的 Beta 契约（`^1.0.0-beta.1`）。这是预览兼容声明，不是对未来 Stable `1.x` 的承诺；每次宿主/API 变化都要用 packed fixture 重新验证，`open()` 对不兼容范围返回 `BLUE_API_INCOMPATIBLE`。

## 用户安装路径

```sh
blue plugin install my-scope/blue-clock
```

然后在 profile 的 `cordis.patch.yml` 加上插件行：

```yaml
- id: my-plugin-clock
  name: 'my-scope/blue-clock'
```

没有 `dsh.bundle` 声明的包只会作为普通依赖安装——patch 行是插件真正被装载的开关。README 里记得把这两步都写给用户。

## 版本策略建议

- **跟随 Blue 的预览节奏**：Blue 处于 rc 线时，插件也用 `@rc` dist-tag 发布，与宿主同步升级；
- **Beta 范围不预支 Stable 兼容性**：当前 manifest 使用 `^1.0.0-beta.1` 以匹配这条 Beta host；不要据此宣称兼容所有未来 Stable `1.x`。每条新 Harness/Blue/API 线都用 [fixture 的 `--harness-line`](/plugins/testing#fixture：打包安装契约) 重新验证后再更新兼容声明；
- **能力变更即 minor**：往 manifest 加 capability 是会改变 `open()` 结果的兼容面变化，按 semver minor 处理并在 changelog 里写明要求的最低 Blue 版本。

## 插件市场

[插件市场](/marketplace/)已上线：发布后往 [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace) 提交收录，用户即可在市场一行安装（GitHub 可安装的插件就能收录，npm 不是门槛）。收录流程与字段说明见[收录指南](/marketplace/submit)。分发机制依旧是 npm/GitHub 源 + patch 行——保持包的独立可安装性（fixture 验证的意义就在这里），收录不需要对包做任何改造。
## Plugin protocol and marketplace

Published plugins must include `blue.plugin.json` and pass the static validator
and packed fixture before marketplace submission. Use `blue plugin install` or
`/plugin install`; GitHub sources must be pinned to a commit. See the [plugin
package specification](/plugins/manifest) and the marketplace submission guide.
