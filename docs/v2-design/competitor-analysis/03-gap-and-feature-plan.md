# 03. Gap Analysis 与 Feature Plan

调研日期：2026-07-01  
输入：竞品调研 + easy-mail 当前代码/文档分析

## 1. 设计原则

Easy Mail 后续 feature 不应以“大而全”为目标，而应遵守下面原则：

1. **只吸收高价值点**：优先解决真实邮件处理中的高频痛点。
2. **不破坏只读边界**：先 copy、展示、本地记录，不写回 Outlook。
3. **复用已有基础**：优先用已有 schema、store、prompt、provider、Workbench。
4. **安全门控必须前置**：任何新模型调用都走 redaction + security gate。
5. **可追溯**：关键结论都能回到 source mail / evidence。
6. **少而精**：少做泛化平台能力，多做“读懂邮件后帮我做下一步”的能力。

---

## 2. 竞品能力到 Easy Mail 的映射

| 竞品能力 | Microsoft 365 Copilot | Mailbutler | MailMaestro | Easy Mail 现状 | 建议 |
| --- | --- | --- | --- | --- | --- |
| Thread summary | 强 | 中 | 强 | 已有 Thread AI + timeline | 强化 UI spotlight，不先重写模型 |
| Draft reply | 强 | 强 | 强 | 一次性 draft + copy | 做 refine/regenerate |
| Tone/length/style | 强 | 强 | 有 | 只有 prompt 隐含规则 | 做快捷调整 |
| Response options | 有类似能力 | 弱 | 强 | 无 | 做 2-3 个回复意图 |
| Action items | 有 call to action | Task Finder | Action/deadline/reminder | schema 已有 actionItems | 做本地 Follow-up Queue |
| Smart labels | 有生态能力 | 弱 | 强 | category/priority | 加 intent tags，不替换 category |
| Meeting/email bridge | 强生态优势 | 弱 | Teams/meeting 相关能力 | meeting store 已有 | 做轻量 meeting prep/follow-up |
| 写回/发送/自动化 | 强 | 强 | 中 | 默认只读 | 暂不做 |
| 销售/营销能力 | 弱 | 中强 | 弱 | 无 | 暂不做 |

---

## 3. 高价值 Feature 候选

### Feature A：Prompt-based Draft Refinement

优先级：P0  
参考产品：Microsoft 365 Copilot / Mailbutler / MailMaestro  
适配方式：只生成/复制，不发送、不写回 Outlook

#### 用户问题

当前 Easy Mail 分析时会给出 `draftReply`，但用户实际回复时经常需要微调：

- 更短；
- 更正式；
- 更礼貌；
- 更强硬；
- 加一个问题；
- 拒绝但给替代方案；
- 根据我的一句 prompt 重写。

现在用户只能手工改，AI 辅助停在“给一个初稿”。

#### 推荐方案

在 single mail 和 thread draft box 增加一个轻量 refine UI：

- 输入框：`Tell Easy Mail how to adjust this draft...`
- 快捷按钮：
  - Shorter
  - More formal
  - Friendlier
  - Ask for clarification
  - Decline politely
  - Add next step
- 输出 draft variants：
  - Original
  - Refined v1
  - Refined v2
- 每个 variant 支持 copy。

#### 模型输入

- 原始 mail/thread 的 redacted context。
- 当前 `draftReply`。
- 用户 refinement prompt。
- 可选 style preset。
- 输出仍然 English plain text。

#### 数据设计建议

新增本地 draft variant 类型：

```ts
interface DraftVariant {
  id: string;
  sourceType: "mail" | "thread";
  sourceId: string;
  createdAt: string;
  instruction: string;
  tone?: string;
  length?: "short" | "medium" | "detailed";
  draftReply: string;
  modelInfo?: {
    requestedFamily: string;
    actualFamily?: string;
  };
}
```

可以先不落复杂 store，第一版只在当前 session UI 里显示；第二版再存 `draft-variants.json`。

#### 验收标准

- 对已有 analyzed mail 能输入 prompt 生成 refined draft。
- 对已有 analyzed thread 能输入 prompt 生成 refined draft。
- 生成前走 security gate 和 redaction。
- 结果只显示和 copy，不发送、不写 Outlook draft。
- 用户 prompt 为空时给清晰错误提示。
- 新增 prompt builder 和 parser 有单测。

#### 为什么是 P0

这是三个竞品共同强调的高频能力，且 Easy Mail 已有 `draftReply`、`reply-template.md`、`LlmProvider`、redaction/gate 基础，投入小、收益大。

---

### Feature B：Thread Decision / Action Spotlight

优先级：P0  
参考产品：Microsoft 365 Copilot / MailMaestro  
适配方式：先 UI/报告增强，尽量不改模型

#### 用户问题

用户真正读长邮件 thread 时，需要的不是完整摘要，而是：

- 当前状态；
- 已定事项；
- 未决问题；
- 谁欠谁动作；
- 我是否需要回复；
- 风险在哪里；
- 证据来自哪封邮件。

Easy Mail schema 已有这些字段，但当前 Workbench/Dashboard 只突出展示了部分字段。

#### 推荐方案

在 Workbench thread detail 顶部增加 `Thread Spotlight`：

1. **Current status**
2. **Decisions made**
3. **Open questions**
4. **Action items**
5. **Waiting on**
6. **Risks**
7. **Need my reply / Suggested action**
8. **Evidence / source links**

每条 action/decision/open question 都展示：

- source mail id；
- source time；
- 点击跳到 timeline 对应邮件；
- 如果有 evidence quote，显示短 quote。

#### 低成本第一版

不改模型，不改 schema，只改：

- `renderThreadAnalysisSummary`；
- `renderThreadDetail`；
- `report-thread.ts`；
- 对应 tests。

#### 验收标准

- Thread analysis 结果存在时，Workbench 能显示 key decisions/open questions/waitingOn/evidence。
- Action item 中 source mail 可跳转 timeline/mail。
- Partial context/security warning 在 spotlight 顶部明显展示。
- Thread Report 同步展示这些字段。

#### 为什么是 P0

它直接释放现有 Thread AI schema 的价值，几乎不需要新增模型调用，是最低成本的高价值改进。

---

### Feature C：Local Follow-up / Action Queue

优先级：P1  
参考产品：Mailbutler Task Finder / MailMaestro action item detection  
适配方式：本地队列，不写回 Outlook task

#### 用户问题

Thread analysis 中 actionItems 很有价值，但如果只存在于 thread card/report，用户不能把它作为工作队列管理。

#### 推荐方案

新增本地 Follow-up Queue：

- 来源：
  - `ThreadAnalysisItem.actionItems`
  - `AnalysisItem.suggestedAction`
  - `ThreadAnalysisItem.suggestedAction`
- 字段：
  - owner
  - task
  - deadline
  - sourceType
  - sourceId
  - sourceMailId
  - sourceTime
  - status: open/done/snoozed/ignored
  - createdAt/updatedAt
- UI：
  - Dashboard 增加 Follow-up 队列统计。
  - Workbench 增加 Follow-up panel。
  - 每个 item 支持 open source / copy draft / mark done / snooze / ignore。

#### 第一版边界

- 不创建 Outlook task。
- 不创建系统级 reminder。
- 不做自动发送。
- 不做多设备同步。

#### 验收标准

- Analyze Thread 后能生成本地 follow-up items。
- 同一个 sourceMailId/task 不重复创建。
- 可以 mark done / ignore，并持久化。
- Daily Brief 可以列出 open follow-ups。

#### 为什么是 P1

这是把“AI 看懂了”转成“用户可以执行”的关键一步，但需要新增 store/UI，因此排在 P0 UI 和 draft refinement 之后。

---

### Feature D：Response Options

优先级：P1  
参考产品：MailMaestro response options / Copilot drafting  
适配方式：复杂邮件才提供，不强制每封都有

#### 用户问题

复杂邮件里，用户往往不是想要“一封完整回复”，而是想先决定回复策略：

- 同意；
- 追问；
- 拒绝；
- 延期；
- 升级给别人；
- 要求对方补充信息。

单一 draft 可能方向不对，用户会失去信任。

#### 推荐方案

在 analysis schema 中新增可选 `responseOptions`：

```ts
interface ResponseOption {
  id: string;
  label: string;
  intent: "confirm" | "clarify" | "decline" | "defer" | "escalate" | "custom";
  rationale: string;
  draftReply: string;
}
```

UI 中显示 2-3 个选项，用户选择后 copy 或 refine。

#### 验收标准

- 对 `needMyReply=true` 的 thread 可生成 response options。
- 每个 option 有 label/rationale/draft。
- 用户能基于 option 继续 refine。
- 没有明确回复需求时不生成噪音选项。

---

### Feature E：Tone / Length / Style Presets

优先级：P1  
参考产品：Microsoft 365 Copilot / Mailbutler  
适配方式：配置 + prompt 参数，不做复杂个性化模型

#### 推荐方案

新增轻量配置：

```json
{
  "replyStylePresets": [
    {
      "id": "internal-short",
      "label": "Internal / Short",
      "tone": "concise, direct, friendly",
      "length": "short"
    },
    {
      "id": "external-formal",
      "label": "External / Formal",
      "tone": "polite, professional, clear",
      "length": "medium"
    }
  ],
  "defaultReplyStylePreset": "internal-short"
}
```

UI：

- Draft box 显示 style selector。
- Refine draft 时带入 style preset。
- 默认仍遵守“draft replies stay English”。

#### 验收标准

- 用户可以选择 preset 生成/refine draft。
- preset 不影响 summary/reason 的语言规则。
- preset 保存在 VS Code settings 或 prompt config 中。

---

### Feature F：Meeting-email Bridge

优先级：P2  
参考产品：Microsoft 365 Copilot / MailMaestro Teams 相关能力  
适配方式：利用已有 meeting store，保持只读

#### 推荐方案

基于当前 `meeting-store` 做轻量 AI 辅助：

1. Meeting prep card：
   - 会议目的；
   - 需要准备什么；
   - 是否需要回复邀请；
   - 相关邮件 thread。
2. Meeting reply draft：
   - 接受/暂定/改期/询问 agenda 的英文草稿。
3. Post-meeting follow-up draft：
   - 仅在用户选择 meeting + prompt 后生成。

#### 第一版边界

- 不读 Teams transcript。
- 不自动创建 calendar event。
- 不写 Outlook meeting response。
- 只用 meeting invite body 和本地邮件数据。

---

### Feature G：Intent Tags

优先级：P2  
参考产品：MailMaestro smart labels  
适配方式：增加非互斥标签，不替换当前 category

#### 推荐 tags

- `decision-needed`
- `approval`
- `deadline`
- `scheduling`
- `customer-risk`
- `waiting-me`
- `waiting-other`
- `FYI`
- `blocked`

#### 推荐方案

- 在 single mail 和 thread analysis schema 中新增 optional `intentTags: string[]`。
- Dashboard/Workbench 提供 tag filter。
- Daily Brief 按 tag 聚合。

---

## 4. 不建议近期做的能力

| 功能 | 不建议原因 |
| --- | --- |
| 自动发送/自动回复 | 违背只读边界，风险高 |
| 自动归档/移动/标记 Outlook 邮件 | 需要写回 Outlook，误操作成本高 |
| 批量营销邮件/mail merge | 偏销售场景，不是 Easy Mail 当前目标 |
| CRM 同步 | 引入外部系统与隐私复杂度 |
| 多邮箱客户端支持 | 当前明确只支持 classic Outlook/Windows |
| 企业团队后台 | POC 阶段过重 |
| 复杂个性化学习用户语气 | 可先用 preset + prompt，不做长期画像 |

---

## 5. 推荐 Roadmap

### v0.7：Thread Spotlight UI / Report Enhancement

目标：释放现有 Thread AI schema 价值。

范围：

- Workbench thread detail 展示：
  - keyDecisions
  - openQuestions
  - waitingOn
  - evidence
  - partialContext warning
- Dashboard thread card 展示更紧凑的 open loops。
- Thread Report 同步增强。

验收：

- 不新增模型调用。
- 不改 Outlook 行为。
- Tests 覆盖 render/report。

### v0.8：Draft Refinement MVP

目标：用户可以用一句话调整草稿。

范围：

- Single mail refine draft。
- Thread refine draft。
- 快捷按钮：shorter / formal / friendly / clarify / decline。
- 输出 variant + copy。

验收：

- 新模型调用走 redaction/security gate。
- Draft replies 保持英文。
- 不写回 Outlook。

### v0.9：Local Follow-up Queue

目标：把 action items 变成本地可执行队列。

范围：

- follow-up-store。
- 从 thread actionItems 生成 queue。
- mark done / snooze / ignore。
- source mail/thread 跳转。
- Daily Brief 展示 open follow-ups。

验收：

- 去重。
- 持久化。
- Dashboard/Workbench 可操作。

### v1.0：Response Options + Style Presets

目标：让回复辅助从“给一个草稿”升级到“帮我选择回复策略”。

范围：

- responseOptions schema。
- 2-3 个回复选项。
- style preset 配置。
- option -> refine -> copy 流程。

### v1.x：Meeting-email Bridge

目标：把 meeting store 接入邮件工作流。

范围：

- meeting prep summary。
- meeting reply draft。
- post-meeting follow-up draft。
- 与 thread/follow-up queue 关联。

---

## 6. 首个实施切片建议

如果马上进入实现，建议从 v0.7 开始，因为：

- 不需要新增模型调用；
- 不需要新增 store；
- 风险低；
- 能马上提升用户对 Thread AI 的感知价值；
- 与竞品最核心的 thread summary / decision catch-up 能力直接对齐。

### v0.7 具体任务拆分

1. 修改 `src/lib/dashboard-labels.ts`
   - 增加 labels：decisions/openQuestions/waitingOn/evidence/partialContext。

2. 修改 `src/lib/dashboard-render.ts`
   - `renderThreadAnalysisSummary` 展示完整 spotlight。
   - evidence/source mail 生成 anchor。

3. 修改 `src/lib/workbench-render.ts`
   - `renderThreadDetail` 增加 Thread Spotlight 区块。
   - Action item / decision / open question 支持跳转 source。

4. 修改 `src/lib/report-thread.ts`
   - 报告中展示 decisions/openQuestions/waitingOn/evidence/partialContext。

5. 增加/更新测试
   - `dashboard-render.test.ts`
   - `workbench-render.test.ts`
   - `report-thread.test.ts`

6. 验证
   - `npm test`

---

## 7. 风险与防护

| 风险 | 防护 |
| --- | --- |
| AI 误判行动项/负责人 | 每条 action/decision 必须展示 source/evidence |
| 用户误以为已发送邮件 | UI 文案明确：Copy only / Not sent |
| 高敏邮件被发送给模型 | 所有新模型调用复用 security gate/redaction |
| UI 变复杂 | Dashboard 只给 summary，Workbench 承载 detail |
| scope creep | 先不做写回、提醒、CRM、跨客户端 |

---

## 8. 最终建议

Easy Mail 下一阶段最应吸收的是：

1. Copilot 的 **thread catch-up + contextual drafting**；
2. Mailbutler 的 **draft adjustment + task extraction**；
3. MailMaestro 的 **thread response options + action/deadline/intention triage**。

但吸收方式必须 Easy Mail 化：

- 不做邮件客户端；
- 不做销售工具；
- 不做自动发送；
- 不做复杂平台集成；
- 只做本地、安全、可追溯的邮件工作辅助。
