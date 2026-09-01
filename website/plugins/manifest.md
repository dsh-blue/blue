# 插件包规范

`0.1.2-alpha.1` 的 canonical 插件包在包根目录提供 `blue.plugin.json`；package
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
| `api` | Host API semver 范围；当前使用 `^1.0.0-beta.2` |
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

发布的 `@dsh-blue/blue-plugin-kit` 直接提供 machine catalog、canonical 生成器、共享
validator 与 packed-install conformance，不需要 Blue checkout。先读取 catalog，再生成或
修改包，最后关闭 catalog 声明的唯一 Harness 线：

```sh
blue-plugin catalog --json
blue-plugin create ./my-plugin --name @acme/my-plugin
blue-plugin validate ./my-plugin
blue-plugin conformance ./my-plugin
blue-plugin conformance ./my-plugin --harness-line 0.1.2-alpha.2
```

详细报告与验收条件见[调试与验证](/plugins/testing)。conformance 会导入待测插件；
script-disabled pack 不是安全沙箱，第三方 npm/GitHub 代码仍需要用户信任。

## 安装与创造模式

裸 `/plugin` 提供“已安装”和“插件目录”两个标签页。已安装只扫描当前 profile 中声明
`package.json.blue.manifest` 的包，显示 compatible/incompatible/invalid 状态并提供
验证/移除动作；插件目录先显示审核过的内置快照，再后台刷新显式 GitHub 索引。只有
canonical 且兼容的 manifest 才获得锁到解析后完整 commit 的安装动作；旧契约条目可
查看但禁装。本地 `list/search/info/verify` 与直接安装仍只接受已存在的本地路径/tarball、
精确 npm `package@version` 或 `github:owner/repo#<40位commit>` GitHub source；remove/install 都委托
给 dsh profile owner，重启后才激活，绝不替换 live tree。

创造模式保留 inspect/define/run/update/stop/rollback 临时原型。用户验收后，正式
`blue-plugin-development` skill 要求先明确 ephemeral/local/GitHub/npm 目的地；local
路径可执行 `catalog -> create -> validate -> dual conformance` 确定性闭环。原型验收
不自动授权 repository、commit、tag 或 npm 发布。TUI 插件目录不等于 Website 插件
市场；市场卡片、路由和提交流程仍暂停。
