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

`ctx.userQuestions` 请求（如澄清式提问）以逐题问卷面板打开，一次聚焦一题：

- 面板标题 `Question {i} of {N}`；首行进度 `{i}/{N}` 后逐题列出标题（无标题则 `Q{i+1}`）——当前题 `●`、已答 `✓`、未答 `○`；
- **Tab / Shift-Tab** 切题；未提交的编辑内容按题存草稿，切回即恢复；Enter 记录当前题答案并跳到下一未答题；
- 单选题 ↑↓ + Enter，多选题 Space 切换 + Enter 确认；光标行整行高亮（含 Other 行）；
- 每题末尾固定的 **Other** 伪项进入紧凑单行输入：`> Answer` 反显行，多行文本拍平为单行；
- 无选项的题直接进入同样的单行输入；
- 底部键位随状态分化：编辑中为 `↵ save · tab next · esc back`（无选项题 `esc cancel`），列表态多选含 `space toggle`、单选不含；
- 全部答完自动提交。Escape 拒绝整个请求——但 Other 编辑器内 Escape 先存草稿、返回选项列表；请求中止时同样关闭并拒绝。

问卷答案作为用户可见内容进入会话，模型可见。

## 多字段表单

自定义 provider 接入引导与 danger 权限预设的打字确认（`y`）走多字段表单面板：

- 每个字段从紧凑的「标签 · 提示：值」单行开始；选中行显示 `→`，过长的值在下方续行；
- **↑ / ↓** 只在导航态切换字段，编辑态仍用于字段内光标移动；直接输入开始编辑，未编辑字段第一次 **Enter** 进入编辑，编辑态 Enter 前进并在末字段提交；**Tab** 留给语义控件组切换；**Escape** 第一次返回导航态，第二次取消；
- 校验失败时错误行显示在出错字段正下方，面板不关闭，任意编辑清除错误；
- 输入值按面板宽度截断，长值（如粘贴的 API key）不会撑破边框。

## plan 评审面板

plan 模式下 agent 调 `exit_plan_mode` 收尾时，评审请求以专用问询形态打开（经 `ctx.userQuestions` 的 `plan-review` intent）：**边框盒里的 plan 全文滚动窗**（Markdown 渲染）+ 编号三选：

```
1. Approve
2. Reject
3. Revise（行内联反馈编辑器）
```

- **Revise** 行自带反馈输入框；提交后作为「带反馈的拒绝」答回（harness 侧折叠为 "their feedback: …"），agent 拿到修改意见继续迭代 plan；空提交等价于普通 Reject；
- Approve/Reject 直接定案；请求中止时面板随取消码关闭（`ASK_CANCELLED`）。

plan 模式的进入/退出走 `Shift+Tab` 三态循环（normal → plan → yolo，见[会话模式](/features/modes)），footer 的模式徽标实时反映。

## 权限预设切换面板

`/permission` 打开权限预设选择器（与 `/sessions` `/preset` 同款单选列表面板）：每行一个预设名（sandbox 模式 + 审批策略的命名束），当前预设带 `← current` 标记；Enter 切换走宿主同一写路径，**danger 级预设需打字 `y` 确认**（防误触）。裸调用由输入层拦截开面；命令本身由上游 `dsh-permission-presets` 注册，带参调用透传。
