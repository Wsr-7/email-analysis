# UI / 布局评价与建议

Reviewer: Claude Fable 5 · 2026-07-06
依据: `docs/v2-design/UI_NOW_2026-07-06-latest.png`（现状截图）、`sidebar-render.ts` / `workbench-render.ts` / `dashboard-provider.ts` 代码。

## 总体评价

两面板架构（sidebar triage + workbench 阅读区）是正确的骨架，queue-first 的方向也对；P0/P1 系列修复后动作布局、主题适配、草稿状态机都已达到可用水准。剩余问题集中在四件事：**信息密度分配失衡、语言不一致、全量重渲染的技术债、triage 流程还是"导航式"而非"处理式"**。

---

## U-1 全量 HTML 重建（技术债，优先级最高的 UI 底层问题）

`dashboard-provider.ts:27`：每次 `update()` 直接 `webview.html = renderHtml()`，workbench 同理（`extension.ts:662`）。后果：

- 任何后台刷新（拉取完成、分析完成、忽略操作）都重建整个 DOM：**滚动位置丢失、展开状态丢失、可见闪烁**。
- 草稿 textarea 的内容只活在 webview DOM 里（P1.1 有意不做持久化）。用户正在手写草稿时，任何一次异步刷新到达 → **未保存草稿灰飞烟灭**。这是数据丢失级的 UX 风险，不是美观问题。
- 已计划的 P2.1 timeline 滚动锚点（scroll-linked rail）在全量重建模式下无法稳定工作——每次刷新锚点状态归零。**建议 P2.1 之前先还这笔债。**

**建议**：postMessage 通道已存在（`focusItem`/`updateDraft`/`focusQueue` 都在用），沿这条路走增量更新：`update()` 改为 postMessage 传 state JSON，webview 内 JS 按 section 局部更新（队列计数、列表行、详情区各自独立）。不需要引前端框架，现有 vanilla JS 模式可承载；退一步的短期止血方案：刷新前把 textarea 草稿收进 `vscode.setState`，重建后回填（`getState` 恢复路径已有先例）。

## U-2 webview 无 CSP（安全加固）

全仓无 `Content-Security-Policy`，webview `enableScripts: true`，HTML 中嵌入大量邮件派生内容。escapeHtml/escapeAttr 是唯一防线，一处遗漏即 XSS（webview 里的 XSS 可 postMessage 驱动扩展侧命令，如 composeMail）。VS Code webview 官方基线：CSP meta + script nonce + `localResourceRoots`。属于一次性加固，建议随 U-1 改造同批做。

## U-3 侧栏：密度分配失衡（截图直接可见）

现状自上而下：Refresh 行 / Fetch New + Analyze 工具行 / **13 行队列**（Meetings 0, Next Actions 0, Pending 1, Manual Confirmation 0, Must Handle Today 2, Risk 0, Waiting For Me 0, Follow-up 0, Important Sender 0, Notice 18, Threads 1, Ignored 3, Uncertain 0）/ 邮件列表（仅剩约 2 行可见）/ 底部常驻设置面板。

问题：

1. **9 个零计数队列占掉 ~40% 纵向空间**，真正的工作对象（邮件行）只剩两行。triage 工具的黄金区域应该给"下一封要处理的邮件"。建议：非零队列正常显示，零计数队列折叠成一行小字（或 chips 换行流式排布）；用户可 pin 常用队列。
2. **Meetings / Next Actions 排最前且为 0**：这两个功能当前数据管线本身有 bug（TODO 已录，会议采集根因假设见 01 文档 C-6），空壳队列置顶放大了"坏了"的观感。修好前建议后置或折叠。
3. **底部设置面板**（Range/Recent Hours/Analysis Model/Max Allowed Classification/Prompt Config）在截图中处于展开态且占掉底部 ~25%。这些是"设一次再也不动"的配置，不该与高频 triage 争空间。建议默认折叠（仅齿轮图标），甚至整体迁去 VS Code 原生 Settings UI——`easyMail.*` 本来就是注册的 settings，双入口还有一致性成本（本轮多个 bug 即来自 settings 双写）。
4. 队列徽章统一蓝色系：Must Handle Today (2) 与 Notice (18) 视觉权重相同。建议按行动轴着色：Must Handle Today/Risk 用警示色，Notice/Ignored 低饱和。数字大小与重要性倒挂（18 比 2 显眼）是 triage UI 的经典反模式。

## U-4 工作台：阅读顺序与信息噪声

现状纵向顺序：标题 / 元数据(From/To/Received/Classification) / 分隔线 / Open in Outlook + Ignore / Summary / Reason / Suggested Action / **Thread: conversation:CAB573711260F16B1909A1302AC41DEA** / Draft Reply(编辑器) / "Not satisfied?..." 说明行 / instruction 输入框 / Polish·Refine·Outlook Actions / Body(底部滚动)。

1. **裸 conversationId 是纯噪声**：内部 ID 对用户零价值。应渲染为可点击的 `View thread (N messages)` 跳转（handover 里"单邮件跳转线程"的新需求与此正好合并解决）。
2. **Body 沉底**：用户核实 summary 是否可信（本产品信任建立期的高频动作）需要滚过 draft 区。建议 Summary 之后紧跟可折叠的 Body（默认折叠头 3 行 + 展开），draft 工作区放最后；或宽屏双栏（左 Body、右分析+draft）。TODO 里"body box flex 到底部"是同一诉求的另一个症状。
3. **"Not satisfied? Draft your own reply..." 说明行**与 instruction 输入框的 placeholder 语义重复，每封邮件都占一行。删说明行，语义并进 placeholder。
4. **Reason 与 Suggested Action 与 Summary 三段有内容重叠**（截图中 Reason 基本是 Summary 的换说法）。建议 Reason 折叠进一个 `why?` 小图标/tooltip，默认不占行——它的受众是"不信任分类时"的用户，不是每次阅读的必经内容。
5. confidence / needsOriginalMailCheck 两个高价值字段**未见展示**：低置信度分析应有可视警示（如 summary 前加 ⚠ needs check），这是让用户校准信任的最廉价手段，schema 里数据现成。

## U-5 语言不一致是第一观感问题

截图中同屏出现三种语言状态：英文 UI 标签 + 中文邮件原文 + 英文 summary/draft。对中文用户：读英文 summary 的认知成本可能高于直接读中文原文——**产品的核心价值（省时间）被输出语言直接抵消**。`outputLanguage` 配置存在，但默认 `en-US` 且草稿硬编码英文（见 02 文档 L-4）。建议：首次运行按 VS Code `env.language` 预设 outputLanguage；草稿语言跟随来信。这是 UI 层感知最强、修复成本最低的改进之一（改默认值 + prompt 契约）。

## U-6 从"导航式"到"处理式" triage（中期方向）

现状交互模型是三层导航：选队列 → 选邮件 → 读详情 → 手动回列表。高效 triage 工具（Superhuman、Gmail 键盘流）的模型是**处理流**：一封处理完自动推进下一封，全程手不离键盘。项目已有正确的种子——ignore 后 focus 自动 advance（follow-up 中已实现）。建议沿此延伸：

- 键盘导航：j/k 上下封、e 忽略、r 聚焦草稿、o 打开 Outlook（webview 内 keydown 分发到现有 post 消息即可，成本低收益高）。
- 队列头部显示进度（3/20 processed），处理完显示明确的"清空"状态——空状态文案区分"你处理完了 🎉"与"尚未分析"，前者是奖励信号，后者是行动引导。
- 长期可考虑"Process Mode"按钮：进入后 workbench 只显示当前一封 + 大动作按钮，处理即推进。

## U-7 小项

- 顶部工具行 `Analyze | All | + | ↻` 中 `+` 与 `↻` 无文字提示（截图观感），至少加 title tooltip；`All` 作为 batch size 选择器的当前值样式像个独立按钮，易误点。
- 邮件行两行布局（主题 / 发件人·时间 + 徽章）信息密度合适；但 P1 徽章与 classification 徽章并列时行尾拥挤，classification 可仅在 hover/详情展示（安全分级对"读哪封"决策贡献低）。
- Workbench 是 WebviewPanel，用户关掉后需从侧栏重新打开——考虑 `retainContextWhenHidden` 与 panel 序列化（`WebviewPanelSerializer`），VS Code 重启后恢复工作现场。
- 无障碍：按钮基本是原生 `<button>`（好），但队列行/邮件行若是 div+onclick 需补 role/tabindex/键盘激活（与 U-6 键盘导航一并做）。
- 设置项 "Max Allowed Classification: INTERNAL" 这类安全语义控件，建议旁挂一行解释当前效果（"高于此级别需手动确认"），与 TODO 的 keyword rationale 解释诉求一致。

## 优先级建议

| 顺序 | 事项 | 理由 |
| --- | --- | --- |
| 1 | U-1 草稿保护（短期 setState 止血） | 数据丢失级风险，止血改动小 |
| 2 | U-5 语言默认值 | 感知最强、成本最低 |
| 3 | U-3 零队列折叠 + 设置面板默认收起 | 密度问题一次解决 |
| 4 | U-4 Body 前置折叠 + 去 conversationId 噪声 | 高频阅读路径 |
| 5 | U-1 完整增量渲染 + U-2 CSP | 为 P2.1 timeline rail 铺路 |
| 6 | U-6 键盘流 | 中期差异化能力 |
