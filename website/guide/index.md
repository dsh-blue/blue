# 快速上手

::: info 预览阶段说明
`v0.1.0-rc.8` 已发布在 npm 的 **`rc` dist-tag** 下（`latest` 留给稳定线，安装 spec 需带 `@rc` 后缀）。本页是用户安装路径；贡献者的本地开发安装（源码检出、link 安装、迭代环）在开发手册的[贡献本仓库](/plugins/contributing)页。
:::

## 前置条件

| 依赖 | 版本 |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11 |
| dsh CLI | `>=0.1.1-rc.2`（`npm i -g @deepseek-ai/dsh`） |

## npm 安装（预览版）

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
```

安装完成后，按下方「开跑前配一个 key」与「首次运行」两节启动；模型、Provider、主题与密钥的详细配置见[配置：模型、Provider 与主题](/guide/config)。

- `@rc` 后缀是必须的：预览版只打 `rc` dist-tag，裸 spec 解析 `latest`、什么都找不到。
- 升级到更新的预览版：重跑同一条 `plugin add`——`@rc` spec 会重新解析到最新版。

## 开跑前配一个 key

**配一个 `DEEPSEEK_API_KEY` 就可以开始使用了**——开箱默认连 DeepSeek 官方 API（`deepseek-official` 路由，默认模型 `deepseek-v4-flash`），除 key 外无需任何配置：

```sh
export DEEPSEEK_API_KEY=sk-...        # 或写入 ~/.dsh/.credentials.yaml，一劳永逸
```

换模型、接自建网关、自定义主题等，见[配置：模型、Provider 与主题](/guide/config)。

## 首次运行

```sh
dsh --profile blue            # 交互模式：欢迎横幅 + 输入编辑器
dsh --profile blue 修复登录页的空指针    # 直接执行任务
```

启动后可以先试这几件事：

- 输入 `/` 查看斜杠命令补全，`/help` 打开命令与键位总览；
- 随手问点什么，观察流式回复与工具卡片；
- `/theme light` 感受主题热切换（输入草稿不会丢）。
