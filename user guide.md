# User Guide

## 适用环境

- Windows
- classic Outlook
- VS Code
- GitHub Copilot 已登录

## 主要命令

- `EasyMail: Fetch New Mail`
- `EasyMail: More History`
- `EasyMail: Generate Sample Digest`
- `EasyMail: Analyze Next Batch with Copilot`
- `EasyMail: Analyze All Allowed with Copilot`
- `EasyMail: Open Digest`
- `EasyMail: Open Summary`
- `EasyMail: Open Settings`
- `EasyMail: Open Prompt Config`

侧栏提供以下常用入口：

- `Fetch New`
- `More History`
- `Analyze`（可选批量大小）
- `Workbench`
- `Generate Reports`
- `Sample`
- `Settings`（范围和模型）
- `More Settings (VS Code Settings)`（其余配置）

执行 `Fetch New`、`More History`、`Sample` 或 `Analyze` 时，看板会显示进行中的 loading 条，VS Code 也会显示任务进度提示。

## 渐进式分析

`Fetch New` 负责按当前范围拉取最新邮件并导入本地 `mail-store.json`。插件优先使用 Outlook 的 `InternetMessageId`，其次使用 `EntryId` 去重；只有两者都拿不到时，才根据邮件的文件夹、时间、发件人、标题和正文摘要生成兜底 ID。已经拉过的邮件会跳过。

`mail-store.json` 是本地 JSON 文件，不是 SQLite。它只作为短期待分析原文队列；邮件分析完成后，插件会从 `mail-store.json` 移除本批邮件原文。

`mail-index.json` 只保存去重锚点，比如 `InternetMessageId`、`EntryId`、收件时间和文件夹，不保存正文。默认保留 7 天，用于继续拉取更多历史邮件时去重。

`More History` 用来继续向历史邮件加载更多。插件会在 `mail-index.json` 中按 folder 分别记录已拉取邮件的最早 `ReceivedTime`，然后让 Outlook COM 在对应 folder 内使用 `ReceivedTime < oldestReceivedTime` 过滤，再倒序取下一批。多文件夹场景下，每个 folder 使用自己的锚点，避免 Inbox 和子文件夹互相影响。边界重复仍会通过 `InternetMessageId` / `EntryId` 去重。首次拉取前没有 folder 锚点，Dashboard 中的 `More History` 会禁用。

Outlook COM 的 `MailItem.ReceivedTime` 在 VBS 中按 Outlook/Windows 本地时间读取和过滤，插件不会把它再转换成 UTC。`mail-index.json` 保存的锚点也使用同一套本地时间字符串，传回 VBS 后再构造 `Restrict` 条件，避免因为二次时区转换导致时间偏移。只有在用户改了系统时区或 Outlook 配置后，同一批历史锚点才可能需要重新拉取/清缓存校准。

拉取后，邮件会先进入 `未分析邮件` 面板。分析入口有三种：

- `Analyze Next Batch`：只分析当前允许自动分析的下一批邮件。
- `Analyze Selected`：分析用户在未分析/需确认面板中勾选的邮件。
- `Analyze All Allowed`：分析当前所有允许自动分析的邮件。

## 设置同步

VS Code Settings 是唯一生效源。Dashboard 顶部的 Settings panel 只是常用设置的快捷编辑器，保存后会写回 VS Code Settings。

如果你直接在 VS Code Settings 页面修改 `EasyMail` 配置，Dashboard 会监听配置变化并自动刷新。模型选择也是同一套规则：Dashboard 中的 `Analysis Model` 会保存到 VS Code Settings，VS Code Settings 中修改后也会反映回 Dashboard。

Dashboard 的模型下拉来自当前 VS Code session 实际暴露的 Copilot 模型列表，显示格式为 `vendor / family / id / name`。VS Code Settings 的模型字段可直接填写模型标识；当前可用模型仍以 Dashboard 列表为准。

看板顶部会显示：

- 已拉取
- 未分析
- 已分析
- 需确认

## 推荐测试路径

### 无 Outlook / 无 Copilot 的本地演示

1. 安装扩展。
2. 执行 `EasyMail: Generate Sample Digest`。
3. 执行 `EasyMail: Open Digest`。
4. 检查 `mail-digest.md` 是否生成。

### 有 Copilot 的完整演示

1. 执行 `EasyMail: Fetch New Mail` 或 `Generate Sample Digest`。
2. 执行 `EasyMail: Analyze Next Batch with Copilot`（或 `Analyze All Allowed with Copilot`）。
3. 打开 sidebar 中的分诊队列，点开一封邮件进入 workbench。
4. 检查分类统计、卡片内容、草稿生成和 `Ignore`。

## 配置

插件首次运行会创建本地配置文件：

```text
easy-mail.config.json
```

关键字段：

- `rangeMode`
- `recentHours`
- `maxItems`
- `folders`
- `bodyExcerptChars`
- `sampleMode`
- `modelFamily`
- `outputLanguage`
- `draftLanguage`
- `autoAnalyzeMaxClassificationLevel`
- `mailStoreRetentionDays`
- `mailIndexRetentionDays`
- `analysisRetentionDays`
- `meetingDaysAhead`
- `collectorTimeoutSeconds`
- `importantSenders`

`rangeMode` 可选值：

- `recentHours`
- `maxItems`

AI 分析默认优先请求 `gpt-5.4`。如果当前 VS Code / Copilot 运行时没有暴露这个模型族，插件会使用当前可用的 Copilot 模型。

如果需要改默认模型，可以在配置文件中调整：

```json
"modelFamily": "gpt-5.4"
```

`outputLanguage` 可选值：

- `en-US`：默认值。插件界面、分类名、字段名、摘要、原因、建议动作使用英文；邮件原文和回复草稿保持英文
- `zh-CN`：插件界面、分类名、字段名、摘要、原因、建议动作使用中文；邮件原文和回复草稿保持英文

这里有两层语言控制：

- 插件界面语言：看板按钮、设置项、统计字段、分类标题。
- Copilot 分析输出语言：`summary`、`reason`、`suggestedAction`。

两层当前共用 `outputLanguage`，所以在 Dashboard 里点击 `中文` / `English` 语言按钮即可同时切换。邮件主题、发件人、原文摘录和 `draftReply` 不会被插件强行翻译。

`bodyExcerptChars` 表示每封邮件最多截取多少个正文字符送给 Copilot，默认 `1500`。它不是摘要长度，而是输入裁剪上限；数值越大，模型看到的上下文越多，但分析可能更慢，也更容易超过上下文预算。这个配置只在 VS Code Settings 中调整，Dashboard 不再常驻展示。

`draftLanguage` 控制草稿回复语言，`auto` 跟随原邮件/会话语言，也可强制 `en` 或 `zh-CN`。

`meetingDaysAhead` 表示从 Outlook 日历采集未来多少天内的会议，默认 `2` 天。

`collectorTimeoutSeconds` 表示 Outlook 采集脚本（邮件/会议）的超时时间，默认 `120` 秒；邮箱较大或 Outlook 冷启动较慢时可以调大。

`autoAnalyzeMaxClassificationLevel` 控制自动分析允许的最高密级。默认密级：

- `0` Public
- `1` Internal
- `2` Registered
- `3` High Registered

高于这个值的邮件不会自动送给 Copilot，只能由用户手动勾选确认后分析。

`mailStoreRetentionDays` 表示本地 `mail-store.json` 原文缓存保留多少天，默认 7 天，与去重索引/分析结果保留期对齐。

`mailIndexRetentionDays` 表示 `mail-index.json` 去重锚点保留多少天，默认 7 天。

`analysisRetentionDays` 表示分析摘要保留多少天，默认 7 天。

看板中的 `Clear Local Cache` 会清空本地原文缓存、去重索引、classification cache 和 analysis result，但不会删除 Outlook 里的原始邮件。

`importantSenders` 可配置重点发件人、邮件组或关键字，用 `;` 分隔。分析时如果发件人、收件组、标题或正文包含这些值，Copilot 会优先考虑 `importantSender` 分类。关键字不会成为独立分类，只作为 `importantSender` 卡片上的命中原因。

设置面板默认折叠，点击 `设置` / `Settings` 后才会展开。分类面板也默认可折叠，`今天必须处理` / `Must Handle Today` 默认展开，其它分类可以按需展开。

## 自定义分类 Prompt

首次运行后，插件会在全局存储目录创建：

```text
prompt-config.json
```

执行 `EasyMail: Open Prompt Config` 可以打开它。用户可以在这里增加或修改分类：

```json
{
  "id": "vipCustomer",
  "labelZh": "VIP 客户",
  "labelEn": "VIP Customer",
  "description": "Important customer mail that needs extra attention.",
  "priorityHint": "Usually P0 or P1"
}
```

默认已经包含一个 `importantSender` 分类：

```json
{
  "id": "importantSender",
  "labelZh": "重点发件人",
  "labelEn": "Important Senders",
  "description": "Mail from or containing configured important senders, mail groups, or keywords.",
  "priorityHint": "Usually P0 or P1 unless it is clearly a notice"
}
```

分析时插件会组合：

- `prompts/base-system.md`
- `prompt-config.json`
- `prompts/output-schema.md`
- 语言指令
- 当前批次邮件内容

然后再发送给 Copilot。
