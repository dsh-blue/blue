# 审批与问卷浮层

agent 需要用户裁决时，Blue 以全宽上拉面板应答。面板采用 **editor 槽位替换**挂载：面板真实占据编辑器的 dock 槽位，编辑器整体退场（离树但状态存活），面板之下只有两行 footer——不是"盖在上面"，编辑器框不会从面板边缘露出来。关闭面板即恢复编辑器并还焦，草稿无损。

## 审批面板

工具调用需要授权时弹出四选项面板：琥珀横线 + `▶ Approve {tool}?` 标题 + 编号选项：

```
1. Allow once
2. Allow {tool} for this session
3. Reject
4. Reject with feedback
```

（数字键直选，↑↓ + Enter 导航（到头回绕），选中行带 `▶` 指针。）

- **会话级记住** —— 选项 2 把工具记入会话级许可表，同一 agent 同一工具的后续请求完全跳过弹窗、直接放行。
- **拒绝带反馈** —— 选项 4 把菜单换成内联理由编辑器；提交后以用户消息形式 steer 给 agent（`User rejected …: <理由>`），agent 能看到拒绝原因。空理由等价于普通 Reject（不 steer）。
- **Escape 拒绝**、请求中止时定案取消。
- **FIFO 串行** —— 并发到达的多个审批请求排队，一次只显示一个。

其它 agent（非当前挂载到 UI 的）的请求不弹窗，顺延给 waterfall 的下一应答方。

## 问卷面板

`ctx.userQuestions` 请求（如澄清式提问）以 tab 化问卷面板打开，每个问题一个 tab：

- tab 行显示问题标题（无标题则 `Q{i+1}`），当前 tab 高亮，已答 `(✓)`、未答 `(○)`；
- **Tab / Shift-Tab** 切题；单选题 ↑↓ + Enter，多选题 Space 切换 + Enter 确认；
- 每题固定的末尾 **Other** 伪项打开内联编辑器，自由文本作为答案；
- 无选项的题直接给编辑器；
- 全部答完自动提交；Escape 拒绝整个请求，请求中止时同样关闭并拒绝。

问卷答案作为用户可见内容进入会话，模型可见。

## plan 评审面板

plan 模式下 agent 调 `exit_plan_mode` 收尾时，评审请求以专用问询形态打开（经 `ctx.userQuestions` 的 `plan-review` intent）：**边框盒里的 plan 全文滚动窗**（Markdown 渲染）+ 编号三选：

```
1. Approve
2. Reject
3. Revise（行内联反馈编辑器）
```

- **Revise** 打开内联反馈编辑器，提交后作为用户反馈 steer 给 agent——agent 拿到修改意见继续迭代 plan；
- Approve/Reject 直接定案；请求中止时面板随取消码关闭（`ASK_CANCELLED`）。

plan 模式的进入/退出走 `Shift+Tab` 三态循环（见[会话模式](/features/modes)），footer 的模式徽标实时反映。

## 权限预设切换面板

`/permission` 打开权限预设选择器（与 `/sessions` `/preset` 同款单选列表面板）：每行一个预设名（sandbox 模式 + 审批策略的命名束），当前预设打勾；Enter 切换走宿主同一写路径，**danger 级预设需打字 `y` 确认**（防误触）。命令经输入层拦截开面，不在 `/help` 注册表。
