# 插件包规范

`0.1.1-rc.2` 的 canonical 插件包在包根目录提供 `blue.plugin.json`；package
discovery 只读取 `package.json.blue.manifest` 指针：

```json
{
  "name": "@acme/blue-clock",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./blue.plugin.json": "./blue.plugin.json"
  },
  "files": ["lib/**/*", "blue.plugin.json", "cordis.patch.yml"],
  "blue": { "manifest": "./blue.plugin.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

## Canonical manifest

完整可复制示例见[快速开始](/plugins/quickstart)，机器样例见公开 [corpus](/schema/blue.plugin.v1.corpus.json)。manifest 所有顶层字段都是必填项：

| 字段 | 契约 |
| --- | --- |
| `$schema` | 固定为 `https://dsh-blue.dev/schema/blue.plugin.v1.schema.json` |
| `schemaVersion` | 当前固定为 `1` |
| `id` | 必须等于 `package.json.name` |
| `entry` | 包公开 `exports` subpath，例如 `.` 或 `./blue`；不是 `lib/` 文件路径 |
| `api` | Host API semver 范围；当前使用 `^1.0.0-beta.1` |
| `compatibility` | 必填的 `blue`、`harness`、`node` semver 范围 |
| `capabilities` | `required` 和 `optional` 两组判别式 capability request，含 version 与适用的 exact resources |

npm package name、Cordis 入口导出的 `name` 和 `cordis.patch.yml` loader row `id` 是三个独立命名空间。只有 manifest `id === package.json.name` 是分发契约；其余名称可以为了排错保持一致，但校验器不强制它们相等。

## 机器契约

- [Draft 2020-12 schema](/schema/blue.plugin.v1.schema.json) 是 shape 真相，并且 `additionalProperties: false`；
- [positive/negative corpus](/schema/blue.plugin.v1.corpus.json) 锁定 schema、runtime parser 与 validator 的共同结论；
- `@dsh-blue/blue-api/protocol/v1` 导出 generated readonly type、schema、parser 与产品/协议映射；
- `@dsh-blue/blue-api/capabilities/v1` 导出七项 Public Beta capability 的 catalog 和协商器。

Canonical `open()` 对 required 请求原子准入，对 optional 请求返回 exact grants 和 `unavailableOptional`。任何带 `$schema` 的 manifest 都不会回退到旧 flat compatibility lane。

## 当前验证路径

`0.1.1-rc.2` 已提供共享 parser、repository validator 和 packed-install fixture，但它们仍从 Blue checkout 运行；P5 才会交付免克隆的作者命令。当前安装器不会自动运行 fixture，也没有 `--force` quarantine 安全边界。

```sh
node script/blue-plugin-validate.mjs /path/to/my-plugin
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install --harness-line 0.1.1-rc.1
```

详细报告与验收条件见[调试与验证](/plugins/testing)。这些检查不是安全沙箱；第三方 npm/GitHub 代码仍需要用户信任。

## 安装与创造模式

Launcher 的只读市场命令是 `blue plugin list|search|info`；安装 mutation 使用 `blue plugin add <spec>` 并由 dsh profile owner 执行。运行中的 TUI 另提供 `/plugin install`，安装后需要重启。

当前创造模式可以在会话内 inspect/define/run/update/stop/rollback 临时原型。“验收原型 -> 生成本地持久包 -> validator -> 双 Harness line fixture”的确定性闭环属于 P5，不是本 RC 的已交付功能。
