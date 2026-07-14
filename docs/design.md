# Easy Mail 设计方案

## 1. 背景

公司内部使用 Outlook 管理日常邮件，但重要邮件容易被大量 notice emails 淹没。当前验证结果显示：

- Microsoft Graph Mail API 不可用，可能因为邮箱仍托管在 on-prem Exchange 或不是 Exchange Online primary mailbox。
- classic Outlook 的 COM 通路可用。
- PowerShell 处于 Constrained Language Mode，不能作为正式采集实现。
- VBScript 已经验证能通过 Outlook COM 读取邮件标题。
- 团队可用模型主要来自 Copilot。对于研发用户，可以通过 VS Code Language Model API 使用 GitHub Copilot 模型。

因此第一版目标是做一个本地 POC：用 VBScript 采集邮件，用 VS Code 插件调用 Copilot 做分析，并在插件自己的 dashboard 中展示结果。

## 2. 核心结论

推荐链路：

```text
VBScript -> mail-digest.md -> VS Code extension -> Copilot -> analysis-result.json -> dashboard + mail-summary.md
```

不要全程使用 Markdown。原因：

- Markdown 适合人读、调试、作为模型输入。
- JSON 适合机器渲染、分类计数、排序过滤、点击详情和按钮交互。
- Markdown summary 适合最终阅读、归档和分享。

最终数据形态：

```text
data/mail-digest.md        原始邮件摘要，VBScript 生成
data/analysis-result.json  AI 结构化结果，Copilot 生成
data/mail-summary.md       人类可读报告，插件从 JSON 生成
```

## 3. 组件设计

### 3.1 VBScript 邮件采集器

职责：

- 连接本机 classic Outlook。
- 读取用户配置的一个或多个 Outlook 文件夹。
- 支持最近 N 封和最近 N 小时两种范围。
- 读取邮件基础字段和正文截断片段。
- 输出 `mail-digest.md`。

不负责：

- 不调用 AI。
- 不做复杂分类。
- 不发送、删除、移动邮件。
- 不上传邮件内容。

建议字段：

```text
mailId
subject
senderName
senderEmail
receivedTime
folderPath
unread
importance
toMe
ccMe
bodyExcerpt
```

第一版的 `mailId` 可以使用顺序 ID，例如 `mail-001`。后续如果需要定位原邮件，再评估保存 Outlook `EntryID`。`EntryID` 可能涉及跨 profile 稳定性问题，第一版不依赖它。

### 3.2 Markdown Digest

示例：

```md
# Outlook Mail Digest

GeneratedAt: 2026-06-16 10:30
RangeMode: RecentHours
RecentHours: 24
MaxItems: 100
Folders:
- Inbox
- Inbox/Customer
- Inbox/Project A

---

## Mail: mail-001

Subject: Contract approval needed
From: Alice <alice@example.com>
ReceivedTime: 2026-06-16 09:12
Folder: Inbox/Customer
Unread: true
Importance: high
ToMe: true
CcMe: false

BodyExcerpt:
Please review and approve the contract before EOD today.
```

### 3.3 VS Code 插件

职责：

- 提供 Activity Bar / Sidebar。
- 调用 VBScript 采集邮件。
- 读取 `mail-digest.md`。
- 调用 VS Code Language Model API，选择 `vendor: "copilot"`。
- 要求 Copilot 返回严格 JSON。
- 解析 JSON 并渲染 dashboard。
- 生成 `mail-summary.md`。

核心命令：

```text
Easy Mail: Pull Mail
Easy Mail: Analyze with Copilot
Easy Mail: Open Digest
Easy Mail: Open Summary
Easy Mail: Export Report
Easy Mail: Open Settings
```

### 3.4 AI 输出 JSON

建议 schema：

```json
{
  "generatedAt": "2026-06-16T10:35:00+08:00",
  "overview": {
    "totalMails": 50,
    "mustHandleToday": 3,
    "risks": 2,
    "waitingForMe": 4,
    "notices": 41
  },
  "items": [
    {
      "mailId": "mail-001",
      "category": "mustHandleToday",
      "priority": "P0",
      "subject": "Contract approval needed",
      "sender": "Alice",
      "receivedTime": "2026-06-16 09:12",
      "summary": "Alice asks for contract approval before end of day.",
      "reason": "Directly sent to the user, high importance, and contains a deadline.",
      "suggestedAction": "Review the contract and reply today.",
      "draftReply": "Hi Alice, I will review the contract today and get back to you before EOD.",
      "confidence": 0.86,
      "needsOriginalMailCheck": false
    }
  ]
}
```

分类枚举：

```text
mustHandleToday
risk
waitingForMe
followUp
notice
ignored
uncertain
```

优先级枚举：

```text
P0: 今天必须处理
P1: 高风险或需要尽快确认
P2: 普通跟进
P3: 通知或低优先级
```

## 4. VS Code 看板设计

```text
┌──────────────────────────────┬───────────────────────────────────────────────┐
│ Sidebar: Easy Mail      │ Main Panel: Mail Intelligence Dashboard       │
├──────────────────────────────┼───────────────────────────────────────────────┤
│ [Pull Mail]                  │ Today Mail Summary                           │
│ [Analyze]                    │                                               │
│ [More Settings]              │ Range: Last 24 hours                         │
│ [Settings]                   │ More settings: VS Code Settings               │
│                              │ Last analyzed: 2026-06-16 10:30              │
│ Scope                        │                                               │
│ ○ Last 50 mails              │ ┌─────────────┬─────────────┬─────────────┐   │
│ ● Last 24 hours              │ │ P0 Must Do  │ P1 Risk     │ Waiting     │   │
│ ○ Custom                     │ │ 5           │ 3           │ 4           │   │
│                              │ └─────────────┴─────────────┴─────────────┘   │
│ Folders                      │                                               │
│ ☑ Inbox                      │ P0 Must Handle Today                         │
│ ☑ Customer                   │ ┌─────────────────────────────────────────┐   │
│ ☑ Project A                  │ │ Contract approval needed                 │   │
│ ☐ Notice                     │ │ From: Alice                              │   │
│                              │ │ Reason: approval before EOD              │   │
│ Categories                   │ │ Action: reply today                      │   │
│ ▸ P0 Must Handle Today       │ │ [Open Detail] [Copy Draft] [Ignore]      │   │
│ ▸ P1 Risk                    │ └─────────────────────────────────────────┘   │
│ ▸ Waiting For Me             │                                               │
│ ▸ Follow-up                  │                                               │
│ ▸ Notice                     │                                               │
└──────────────────────────────┴───────────────────────────────────────────────┘
```

按钮行为：

```text
Pull Mail:
  调用 VBScript，按当前配置生成 mail-digest.md。

Analyze:
  调用 Copilot 分析 mail-digest.md，生成 analysis-result.json。

Settings:
  在侧栏展开常用的扫描范围和分析模型。

More Settings:
  打开 VS Code Settings；文件夹、正文截断、密级和保留期在此管理。Prompt 配置通过 `EasyMail: Open Prompt Config` 命令打开。

Open Digest:
  打开原始 mail-digest.md。

Open Summary:
  打开 mail-summary.md。

Copy Draft:
  复制选中邮件的 draftReply。

Ignore:
  本地记录 ignored mailId，下次 dashboard 隐藏或降权。

Re-analyze Selected:
  只把选中邮件片段重新发给 Copilot。
```

## 5. 配置设计

配置文件建议放在用户目录或 VS Code globalState。POC 阶段可以先放项目目录：

```json
{
  "rangeMode": "recentHours",
  "recentHours": 24,
  "maxItems": 100,
  "folders": [
    "Inbox",
    "Inbox/Customer",
    "Inbox/Project A"
  ],
  "includeBodyExcerpt": true,
  "bodyExcerptChars": 2000,
  "importantSenders": [],
  "noticeSenders": [],
  "importantKeywords": [
    "urgent",
    "asap",
    "deadline",
    "approve",
    "review"
  ]
}
```

## 6. 关键约束

- 只支持 Windows + classic Outlook。
- 不支持 new Outlook 后台本地扫描。
- VS Code 插件使用的是 GitHub Copilot，不是 Microsoft 365 Copilot。
- 用户必须在 VS Code 中登录 GitHub Copilot。
- Language Model API 调用会触发用户授权，并受到用户 Copilot quota / rate limit 限制。
- VBScript 是 POC 技术，不作为长期产品底座。长期应迁移到签名 C# agent。

