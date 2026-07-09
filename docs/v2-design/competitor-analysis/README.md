# Easy Mail 竞品分析与 v2 Feature 参考

调研日期：2026-07-01  
对象：Microsoft 365 Copilot in Outlook / Mailbutler / MailMaestro  
本地项目：`F:\agent-workspace\claude\projects\easy-mail`

## 产物索引

- [01-product-research.md](./01-product-research.md)  
  三个参考产品的资料来源、定位、亮点功能、隐私/部署侧重点。

- [02-easy-mail-current-state.md](./02-easy-mail-current-state.md)  
  基于当前 easy-mail 代码与项目文档梳理现有功能、边界、已实现能力和关键缺口。

- [03-gap-and-feature-plan.md](./03-gap-and-feature-plan.md)  
  竞品对比、异同点、高价值可吸收能力、推荐 feature 优先级和分阶段计划。

## 结论摘要

Easy Mail 当前不应该追求“大而全”的邮件客户端或营销邮件平台。它最有价值的方向，是继续保持：

1. **本地优先 / classic Outlook / Windows / VS Code POC**；
2. **只读、安全门控、可追溯证据**；
3. **面向真实工作 triage 的线程理解、行动项、回复辅助**。

三个竞品中真正值得吸收的不是“邮件追踪、CRM、自动发送、全渠道营销”这类能力，而是下面 5 个高价值点：

| 优先级 | 建议吸收点 | 来源启发 | 适配 Easy Mail 的方式 |
| --- | --- | --- | --- |
| P0 | 用户短 prompt 驱动的回复草稿重写/再生成 | Copilot / Mailbutler / MailMaestro | 在现有 draftReply 基础上增加“Refine Draft”能力，仍然只复制、不写回 Outlook |
| P0 | Thread 决策、任务、负责人、开放问题高亮 | Copilot / MailMaestro | 现有 schema 已有 keyDecisions/openQuestions/actionItems/waitingOn/evidence，优先补 UI/报告展示 |
| P1 | 本地 Follow-up / Action Queue | Mailbutler Task Finder / MailMaestro action item detection | 从 threadAnalysis.actionItems + suggestedAction 生成本地待办卡片，不做 Outlook 写回 |
| P1 | 多个回复选项，而不是单一草稿 | MailMaestro response options / Copilot drafting | 对复杂邮件提供 2-3 个 response intents：确认、追问、拒绝/延期 |
| P1 | 语气、长度、风格配置与即时调整 | Copilot tone/length / Mailbutler Smart Improve | 用配置 + prompt 参数实现，不引入复杂个性化系统 |

## 明确不建议近期吸收

- 邮件打开追踪、链接追踪、阅读回执增强。
- 自动发送、定时发送、mail merge、营销序列、CRM 同步。
- 自动清理 inbox、自动移动/归档/标记 Outlook 邮件。
- 大而全的跨 Gmail/Apple Mail/Teams 产品化。

原因：这些功能要么偏销售/营销，要么违背当前项目“只读 POC + classic Outlook + 安全门控”的边界，要么实现成本和风险远高于对当前用户价值。
