# 发布插件

Blue 插件按普通 npm Cordis package 发布。发布前：

- `package.json` 的 `exports` 指向实际存在的 JS/type；
- `files` 包含 build output 与 `cordis.patch.yml`；
- dsh 与 Blue 包放在合理的 peer dependency；
- tarball 在空目录独立安装并通过测试；
- README 写清安装命令、`inject` service、unload 行为和 profile 验收流程；
- npm 包名、版本、tag、access、provenance 与 2FA 已明确。

```sh
npm pack
npm publish --access public
```

只有用户明确授权 exact package/version/tag 后才执行 publish。GitHub repository
创建与 npm 发布是两个独立动作。市场收录见[提交指南](/marketplace/submit)。
