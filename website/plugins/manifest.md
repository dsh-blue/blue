# 插件包规范

Blue 插件发布时必须在包根目录提供 `blue.plugin.json`，并在 `package.json` 中声明：

```json
{ "blue": { "manifest": "./blue.plugin.json" } }
```

manifest 至少包含 `schemaVersion`、`id`、`entry`、`api` 和 `capabilities`，并应声明 `blue`、`harness`、`node` 兼容范围。`id` 必须同时匹配 npm 包名、入口导出的 `name` 和 `cordis.patch.yml` 的 loader 名称。

安装器会在下载后执行 manifest、exports/files、静态边界、packed fixture、生命周期和宽度检查。验证失败的包默认拒绝；显式 `--force` 也只会进入 quarantine，不会自动加载。验证不是安全沙箱，第三方 npm/GitHub 代码仍需用户信任。

## 安装与检索

```sh
blue plugin search 斗地主
blue plugin info @dsh-blue/blue-doudizhu
blue plugin install @dsh-blue/blue-doudizhu
```

运行中的 Blue 使用 `/plugin search`、`/plugin info` 和 `/plugin install`，安装完成后重启才会激活。GitHub 来源必须固定到 commit，例如 `github:dsh-blue/blue-doudizhu@<sha>`。

## 创造模式

使用创造模式生成插件时，先用 `cordis-plugin-development` 验证原型，再用 `blue-plugin-development` 生成持久化包，最后运行 `blue-plugin-validate` 和 packed fixture。完整示例见[创造模式实战](/plugins/creative-mode)。
