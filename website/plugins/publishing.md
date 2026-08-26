# 发布插件

Blue 插件就是普通 npm 包，没有专属仓库或签名流程。

## 发布

```sh
npm publish
# 预览期建议用 dist-tag 与 Blue 线对齐：
npm publish --tag rc
```

发布前确认：

- `exports` 指向构建产物，`files` 白名单覆盖所有导出目标（validate 脚本的 `package` 组会查）；
- `@dsh-blue/blue-api` 在 `dependencies`，`@deepseek-ai/cordis` 在 `peerDependencies`——后者由宿主 dsh 安装提供，打进 `dependencies` 会出现第二份服务实例；
- manifest 的 `api` 范围对准宿主的 API 线（当前 `^1.0.0`）。宿主 major 升级时，`open()` 会以 `BLUE_API_INCOMPATIBLE` 明确失败——用户升级 Blue 后插件是"拒绝挂载"而不是"行为漂移"。

## 用户安装路径

```sh
dsh plugin --profile blue add my-scope/blue-clock
```

然后在 profile 的 `cordis.patch.yml` 加上插件行：

```yaml
- id: my-plugin-clock
  name: 'my-scope/blue-clock'
```

没有 `dsh.bundle` 声明的包只会作为普通依赖安装——patch 行是插件真正被装载的开关。README 里记得把这两步都写给用户。

## 版本策略建议

- **跟随 Blue 的预览节奏**：Blue 处于 rc 线时，插件也用 `@rc` dist-tag 发布，与宿主同步升级；
- **`api` 范围写宽，验证写严**：manifest 里 `^1.0.0` 接受 1.x 的全部 minor；每条新 Harness/Blue 线出来时用 [fixture 的 `--harness-line`](/plugins/testing#fixture：打包安装契约) 验证后再宣布兼容；
- **能力变更即 minor**：往 manifest 加 capability 是会改变 `open()` 结果的兼容面变化，按 semver minor 处理并在 changelog 里写明要求的最低 Blue 版本。

## 插件市场

[插件市场](/marketplace/)已上线：发布后往 [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace) 提交收录，用户即可在市场一行安装（GitHub 可安装的插件就能收录，npm 不是门槛）。收录流程与字段说明见[收录指南](/marketplace/submit)。分发机制依旧是 npm/GitHub 源 + patch 行——保持包的独立可安装性（fixture 验证的意义就在这里），收录不需要对包做任何改造。
