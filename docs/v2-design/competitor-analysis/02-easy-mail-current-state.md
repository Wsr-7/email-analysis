# 02. Easy Mail 当前能力与边界分析

调研日期：2026-07-01  
分析对象：`F:\agent-workspace\claude\projects\easy-mail`

## 1. 项目定位

根据 `AGENTS.md` 与 `CLAUDE.md`，Easy Mail 当前定位是：

- 邮件分析 POC，不是生产级邮件管理系统。
- 仅支持 classic Outlook。
- 仅支持 Windows。
- 默认只读，不写回 Outlook。
- 默认通过 GitHub Copilot / VS Code Language Model API 做 AI 分析。
- AI 输出语言影响摘要、原因、建议动作；邮件原文和回复草稿保持英文。

当前 pipeline：

```text
cscript.exe collect-outlook-mails.vbs
  -> mail-digest.md
  -> VS Code extension parses into mail-store.json
  -> Copilot analyzes
  -> analysis-result.json
  -> Dashboard webview + reports
```

## 2. 已有核心能力

### 2.1 邮件采集与本地存储

相关文件：

- `scripts/collect-outlook-mails.vbs`
- `src/lib/digest.ts`
- `src/lib/mail-store.ts`
- `src/lib/app-data.ts`
- `src/extension.ts`

能力：

- 通过 classic Outlook COM/VBScript 采集邮件。
- 支持 recentHours / maxItems 两种采集范围。
- 支持配置 folders。
- 支持 sample mode。
- 通过 InternetMessageId / EntryId / hash 做去重。
- 使用 `globalStorageUri/data/` 存储 JSON 数据。
- 邮件被分析后从 raw mail store 中移除，分析结果按 retention 保存。

### 2.2 单封邮件分析

相关文件：

- `src/lib/app-analysis.ts`
- `src/lib/analysis-schema.ts`
- `src/lib/summary.ts`
- `prompts/base-system.md`
- `prompts/analysis-prompt.md`
- `prompts/output-schema.md`
- `prompts/reply-draft-prompt.md`
- `prompts/reply-template.md`

输出字段：

- `category`
- `priority`
- `summary`
- `reason`
- `suggestedAction`
- `draftReply`
- `draftReplyParts`
- `confidence`
- `needsOriginalMailCheck`
- `source`
- `evidence`

当前价值：

- 已经能把邮件从 raw text 变成结构化 triage 结果。
- 已经支持回复草稿和模板化拼接。
- 已经支持证据字段，便于回溯判断依据。

当前缺口：

- `draftReply` 是一次性输出，用户不能基于短 prompt 调整。
- 不能生成多个可选回复方向。
- 回复草稿没有独立的 draft state / variant state。
- UI 只有 copy draft，没有 refine / regenerate / tone / length 操作。

### 2.3 Thread timeline 与 Thread AI

相关文件：

- `src/lib/thread-engine.ts`
- `src/lib/thread-store.ts`
- `src/lib/thread-timeline.ts`
- `src/lib/thread-analysis-schema.ts`
- `src/lib/thread-prompt-builder.ts`
- `prompts/thread-base-system.md`
- `prompts/thread-analysis-prompt.md`
- `prompts/thread-output-schema.md`
- `src/lib/dashboard-render.ts`
- `src/lib/workbench-render.ts`

Thread 分析字段：

- `oneLineSummary`
- `currentStatus`
- `keyDecisions`
- `openQuestions`
- `actionItems`
- `waitingOn`
- `risks`
- `needMyReply`
- `suggestedAction`
- `draftReply`
- `evidence`
- `partialContext`

当前价值：

- 已经具备 thread timeline 的数据层。
- 已经能按 conversationId 或 normalized subject 建 thread。
- 已经能提取 body delta，减少重复 quoted history。
- 已经有 thread-level AI schema，且字段比 UI 当前展示更丰富。
- 已经有 Thread Report。

当前缺口：

- Dashboard/Workbench 主要展示 `currentStatus`、`actionItems`、`risks`、`draftReply`。
- `keyDecisions`、`openQuestions`、`waitingOn`、`evidence` 没有突出展示。
- action item 没有成为一等本地对象，只是 thread analysis 的列表字段。
- action item 与 timeline source mail 的视觉连接弱。
- partial context/security gate 对用户判断的影响还不够醒目。

### 2.4 安全门控与脱敏

相关文件：

- `src/lib/classification.ts`
- `src/lib/security-gate.ts`
- `src/lib/security-types.ts`
- `src/lib/redaction.ts`
- `src/lib/config-utils.ts`

能力：

- 根据 classification level 决定 allow / block / manual_confirm。
- 自动分析只允许阈值以内的邮件。
- 高级别邮件不会自动发送给 Copilot。
- 分析前做 redaction。
- Dashboard 显示 mail/thread security 状态。

当前价值：

- 这是 Easy Mail 与大多数泛用 AI 邮件插件相比的重要差异点。
- 适合继续强化，而不是弱化。

当前缺口：

- 用户还不能非常清晰地看到“本次 prompt 实际发送了什么 / redacted 了什么”。
- Blocked/partial thread 的解释可以更靠近分析结果展示。
- 报告里可以更明确显示 security/partial context 提醒。

### 2.5 Reports

相关文件：

- `src/lib/report-daily.ts`
- `src/lib/report-single-mail.ts`
- `src/lib/report-thread.ts`
- `src/extension.ts`

能力：

- Daily Brief。
- Thread Report。
- Single Mail Report。
- Dashboard 有生成和打开入口。

当前价值：

- 适合承载“AI 分析结果的可审计落地”。
- 对 POC 很有价值，因为不需要写回 Outlook。

当前缺口：

- Daily Brief 还可以更像“今天需要处理的工作队列”。
- Thread Report 可以突出 key decisions / open questions / waitingOn / source evidence。
- 缺少 Follow-up Queue 报告。

### 2.6 Meeting 支持

相关文件：

- `scripts/collect-outlook-meetings.vbs`
- `src/lib/meeting-digest.ts`
- `src/lib/meeting-store.ts`
- `src/lib/workbench-render.ts`
- `src/lib/sidebar-render.ts`

能力：

- 采集未来 N 天 meeting。
- 支持 calendar 和 invite 来源。
- 显示 organizer、时间、地点、attendees、responseStatus、bodyExcerpt。
- 支持 open meeting in Outlook。

当前价值：

- 为未来的邮件-会议联动提供了数据基础。

当前缺口：

- meeting store 目前主要是展示，不参与 AI 邮件分析。
- 无 meeting prep / meeting follow-up / meeting-related draft。

### 2.7 Provider abstraction

相关文件：

- `src/lib/llm-provider.ts`
- `src/lib/copilot-provider.ts`
- `src/lib/mock-provider.ts`

能力：

- 已有 LLM provider interface。
- 当前实际实现为 Copilot provider。
- Mock provider 支持测试。

当前价值：

- 为后续新增 draft refinement / thread spotlight / follow-up queue 的模型调用复用提供基础。

当前缺口：

- 还没有为不同任务拆分模型调用策略。
- 还没有单独的 draft generation/refinement provider path。

---

## 3. 当前 UI/交互观察

### 3.1 Dashboard

Dashboard 适合概览和批量操作：

- Fetch New。
- More History。
- Analyze Next Batch。
- Analyze Selected。
- Analyze All Allowed。
- Load Models。
- Generate/Open Reports。
- Settings / Prompt Config / Reply Template。

当前问题：

- Draft 主要是展示 + copy。
- Thread analysis 展示不够完整。
- Action items 不够“可操作”。

### 3.2 Workbench

Workbench 更适合阅读细节：

- 邮件正文 excerpt。
- 单封邮件 summary/reason/suggestedAction/draft。
- Thread timeline。
- Thread analysis。
- Meeting detail。

当前问题：

- Thread analysis 部分没有把最关键的决策、开放问题、等待对象、证据 source 做成 spotlight。
- Timeline 与 AI evidence 没有强连接。
- 没有 draft refine 输入框。

---

## 4. 与竞品相比的优势

### 4.1 本地优先和安全门控

Easy Mail 的核心优势不是“功能比 Copilot/Mailbutler/MailMaestro 多”，而是：

- 本地采集。
- 本地 JSON store。
- 明确 redaction。
- 明确 security gate。
- 默认只读。
- 分析结果可生成 Markdown 报告。

这让 Easy Mail 更适合敏感工作邮件的“辅助阅读与决策”，而不是销售自动化或邮件营销。

### 4.2 Thread schema 已经很接近高价值方向

竞品强调的关键能力中，Easy Mail 已经具备很多底层字段：

| 竞品亮点 | Easy Mail 当前基础 |
| --- | --- |
| 线程摘要 | `currentStatus` / `oneLineSummary` |
| 决策识别 | `keyDecisions` |
| 开放问题 | `openQuestions` |
| 行动项 | `actionItems` |
| 负责人/等待对象 | `owner` / `waitingOn` |
| 风险 | `risks` |
| 回复草稿 | `draftReply` |
| 证据回溯 | `sourceMailId` / `evidence` |

这意味着第一阶段最值得做的不是重写 AI，而是把已有字段展示好、用好。

---

## 5. 主要缺口清单

| 缺口 | 当前状态 | 影响 | 推荐优先级 |
| --- | --- | --- | --- |
| 回复草稿不能二次调整 | 只有一次性 `draftReply` + copy | 用户需要手工改，AI 价值断在最后一步 | P0 |
| Thread 决策/开放问题/等待对象不突出 | schema 有，UI 弱 | 长 thread 的真正价值没有释放 | P0 |
| Action item 不是本地对象 | 只在 thread analysis/report 中出现 | 无法形成可操作工作队列 | P1 |
| 没有多个回复意图 | 单一 draft | 复杂语境下方向可能不符合用户意图 | P1 |
| 语气/长度/风格只能隐含在 prompt | 无快捷交互 | 用户调整成本高 | P1 |
| meeting 与 email 没联动 | meeting 只展示 | 错过会前/会后邮件辅助场景 | P2 |
| intent tags 不足 | category/priority 为主 | 筛选和行动维度不够细 | P2 |

---

## 6. 当前实现约束对 feature 的影响

| 约束 | 对设计的影响 |
| --- | --- |
| classic Outlook + Windows | 不做新 Outlook/Web 专属能力 |
| VS Code extension | UI 优先放 Dashboard/Workbench，不做 Outlook 内嵌体验 |
| 只读 | 不做自动发送、自动归档、自动创建 Outlook task |
| GitHub Copilot | 新功能应复用 `LlmProvider` 与现有模型选择 |
| Security gate | 新增任何模型调用都必须走 gate/redaction |
| Draft replies stay English | refine draft 也要保持英文，除非未来明确改规则 |
| POC | 功能应小切片、可验证、少依赖 |
