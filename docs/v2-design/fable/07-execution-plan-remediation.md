# 07 执行计划：Fable 审查修复（Remediation Execution Plan）

Author: Claude Fable 5 · 2026-07-08
Source of truth: 本文件。发现依据与修复理由见 [05-remediation-matrix.md](05-remediation-matrix.md)（逐条对照表）与 01-04 详细文档；语言契约与并行分析设计见 [06-open-questions.md](06-open-questions.md)。

状态标记：`[ ]` 未开始 · `[~]` 进行中（已 claim）· `[x]` 完成（含 commit hash）· `[!]` 阻塞/需用户决策

---

## 0. Multi-Agent Collaboration Rules

多个 agent（Claude Code / Codex）轮流工作，必须遵守：

1. 开工前完整阅读本文件，重点是 `## 6. Current Snapshot` 与 `## 7. Handover Log` 的最新条目。
2. 执行 `git status --short` 与 `git log --oneline -5` 确认现场；有 dirty tracked files 先看 `git diff` 判断归属。
3. 对所有 `[~]` step 保持怀疑：以代码、diff、测试结果为准恢复真实进度，不轻信上一个 agent 的自述。发现 plan 未更新时，先在 Handover Log 写一条 `Recovery handover`（observed state / likely completed / unverified / action taken / next step）。
4. 一次只 claim 一个 step：把该 step 标记为 `[~]`，在 Handover Log 加 pre-work checkpoint，然后才开始改代码。不要一次 claim 整个 milestone。
5. 每个 step 开工前，先读 `05-remediation-matrix.md` 中对应行 + 该行指向的 01-04 源文档小节，理解"为什么改"再动手。文中给出的行号是审查时快照，动手前必须用 grep 重新定位锚点。
6. 完成一个 coherent step：跑验收标准 → 更新该 step 的 Completion Notes → 更新 Handover Log → 本地 commit（消息风格与仓库一致：小写短句，如 `fix wire reply delta trimming into thread engine`）→ 把 commit hash 写回本文件。
7. **默认不要 push**。不要 stage 或 commit 与当前 step 无关的 untracked files。
8. 接近限额/上下文吃紧时：立刻停止改代码，先更新本文件与 Handover Log，不要开始新文件或新 refactor。
9. 边界纪律：不做本文件未列出的 refactor；不改 prompt 措辞除非 step 明确要求；不引入新 npm 依赖；不删除现有测试；VBS 改动不能改变 digest 输出格式（除非 step 明确要求）。
10. 测试命令：`npm run compile`（必须零错误）、`npm test`（必须全绿）；单文件 `node --test out/test/<module>.test.js`。VBS 无测试框架：验收 = `cscript //nologo scripts/<file>.vbs --help`（或 `--sample`）不报语法错误 + 在 Handover 标注 `needs user validation on real Outlook`。

---

## 1. 范围与里程碑总览

| Milestone | 内容 | 前置 |
| --- | --- | --- |
| R1 正确性止血 | 7 个 S 级修复，互相独立，可任意顺序 claim | 无 |
| R2 效率与语言 | chunk 化、语言契约、取消/退避、Restrict、微效率 | R1 完成（尤其 R1.1/R1.5） |
| R3 结构演进 | tags 化、线程一等公民、增量渲染+CSP、MIP 标签、NDJSON | **需用户确认设计后才可 claim** |
| R4 体验差异化 | 键盘流、密度改造、诊断协议、增量拉取 | R3 之后 |

R3/R4 在本文件中只有条目占位（见 `## 4`），worker 不得自行展开。

---

## 2. Milestone R1 — 正确性止血

### [x] R1.1 接线引用修剪函数（L-1，最高优先）

- **改动点**：`src/lib/thread-engine.ts` 的 `toThreadMessage`（当前 84-88 行附近，三个 body 字段全部直赋原文）。`src/lib/thread-timeline.ts` 已导出 `cleanMailBody` / `extractReplyDelta` / `hashBody` / `markDuplicateBodies`，目前仅测试文件引用（死代码）。
- **做法**：
  1. `toThreadMessage`：`bodyClean = cleanMailBody(body)`，`bodyDelta = extractReplyDelta(body)`；`bodyPreview` 保持原文（先 grep `bodyPreview` 的全部消费方确认它用于 UI 展示而非 prompt，如有 prompt 消费需在 Completion Notes 记录）。
  2. `buildThreadRecord`（或消息按时间排序后的位置）：对 timeline 消息数组跑 `markDuplicateBodies`（以 `bodyClean` 为键），回填 `isDuplicateBody` / `duplicateOfId`，替换现在的硬编码 `isDuplicateBody: false`。
  3. 确认 `thread-prompt-builder.ts` 消费的是 `bodyDelta` / `isDuplicateBody`（应已如此，接线后自动生效）。
- **验收**：新增 `src/test/thread-engine.test.ts` 用例：构造 3 封含引用链的邮件（英文 `-----Original Message-----` 与中文 `发件人:` 头各至少一例）→ 断言 `bodyDelta` 不含引用块；两封正文相同 → 第二封 `isDuplicateBody === true` 且 `duplicateOfId` 指向第一封。`npm test` 全绿（现有 thread-timeline / thread-prompt-builder 测试不得回归）。
- **边界**：本 step 只接线，不调整 `thread-timeline.ts` 内的修剪 heuristics。接线后若真实双语样本仍有残留，另开 step。
- Completion Notes:
  - 改动文件：`src/lib/thread-engine.ts`（import + `toThreadMessage` 接线 bodyClean/bodyDelta + `buildThreadRecord` 内跑 `markDuplicateBodies`，以 `mailId` 作为 duplicate 的 id 键）、`src/lib/thread-schema.ts`（`ThreadMessage` 新增可选字段 `duplicateOfId?: string`，此前 schema 缺失该字段，是"回填 duplicateOfId"验收项的前置缺口）、`src/lib/thread-store.ts`（`normalizeThreadMessage` 补上 `duplicateOfId` 的读回，保证持久化 round-trip 不丢）、`src/test/thread-engine.test.ts`（新增 2 个测试）。
  - `bodyPreview` 消费方核查结果：UI 展示（`dashboard-render.ts:100`、`workbench-render.ts:165`、`workbench-render-v1.ts:93`）+ `thread-prompt-builder.ts:51` 的 fallback 链末位（`bodyDelta || bodyClean || bodyPreview`，接线后自动优先取 bodyDelta，无需改代码）+ `redaction.ts`/`security-gate.ts`（两处已分别处理三个字段，语义不受影响）。未发现需要额外改动的 prompt 消费点。
  - `duplicateOfId` 用 `mailId`（非 `sourceMailId`）作为跨消息引用键，因为 UI 侧「Open in Outlook」等操作统一用 `mailId` 定位（workbench-render.ts 的 `data-mail-id`），保持一致性；`ThreadMessage.bodyHash` 语义从"原始邮件正文 hash（拷贝自 StoredMail.bodyHash）"变为"清洗后正文 hash（供重复检测用）"——grep 确认该字段除 normalize round-trip 外无其他消费方，改动安全。
  - `markDuplicateBodies` 按每个线程（`buildThreadRecord` 内）独立跑，而非跨全部邮件全局跑；这是有意为之，与"线程内引用重复"的产品语义一致，也符合两处调用方（`extension.ts:511` pullMail 与 `app-data.ts:358` importDigestIfStoreMissing）总是用当前完整邮件集重建线程树的事实——不存在增量合并丢失 duplicate 标记的问题。
  - Tests: `npm run compile` 零错误；`npm test` 全绿 312/312（新增 2 个：`wires reply-delta trimming into thread timeline bodyDelta`、`marks duplicate thread messages by cleaned body content`）。
  - Manual validation: 不适用（纯 TS 逻辑，无 Outlook 交互）。
  - Known issues: 无。
  - Commit: `e60001c`

### [x] R1.2 修复 toMe/ccMe 恒真（C-2）

- **改动点**：`scripts/collect-outlook-mails.vbs`，`IsDirectRecipient` / 对应 CC 判定（当前实现只判 To/CC 字段非空）。
- **做法**：
  1. 脚本启动时取一次当前用户身份：`ns.CurrentUser`，尝试 `AddressEntry.GetExchangeUser.PrimarySmtpAddress` 得 SMTP，失败则用显示名；缓存为脚本级变量。
  2. 判定改为遍历 `mail.Recipients`，按 `Type`（olTo=1 → toMe，olCC=2 → ccMe）将收件人地址/名称与当前用户比对（不区分大小写）；Exchange 收件人同样经 `GetExchangeUser.PrimarySmtpAddress` 归一化，取不到时用 `Recipient.Name`。
  3. 每步包 `On Error Resume Next`；身份或收件人解析完全失败时**兜底维持 true**（与现状语义一致，宁可误报不漏报），并输出一行诊断（沿用现有 FolderScan 风格）。
- **验收**：`cscript //nologo scripts/collect-outlook-mails.vbs --help` 无语法错误；`--sample` 输出格式不变；digest 中 `ToMe`/`CcMe` 字段仍存在。Handover 标注 `needs user validation on real Outlook`（真实邮箱验证：一封仅在 CC 的邮件应 ToMe: false）。
- Completion Notes:
  - 改动文件：`scripts/collect-outlook-mails.vbs`。新增脚本级全局变量 `g_currentUserSmtp`/`g_currentUserName`/`g_recipientParseFailures`；新增 `ResolveCurrentUser`（`CollectFromOutlook` 内 `Set ns = outlook.GetNamespace("MAPI")` 之后调用一次，取 `ns.CurrentUser.Name` + `AddressEntry.GetExchangeUser.PrimarySmtpAddress`，取不到 SMTP 时回落 `AddressEntry.Address`）、`IsRecipientTypeMatch(mail, recipientType)`（遍历 `mail.Recipients`，按 `.Type` 过滤 olTo=1/olCC=2，逐个用 `IsCurrentUserRecipient` 比对）、`IsCurrentUserRecipient(recipient)`（先比 SMTP 归一化地址，再比显示名，均不区分大小写）三个新函数；`IsDirectRecipient`/`IsCcRecipient` 改为薄封装调用 `IsRecipientTypeMatch(mail, 1)` / `IsRecipientTypeMatch(mail, 2)`。`SafeTo`/`SafeCc`（供 `to`/`cc` 字段用）未改动。
  - 兜底策略：身份完全无法解析（`g_currentUserSmtp` 与 `g_currentUserName` 均为空）时 `IsRecipientTypeMatch` 直接短路返回 `true`，不触碰 `mail.Recipients`；`mail.Recipients` 访问失败（罕见）时计入 `g_recipientParseFailures` 并同样返回 `true`；两种情况都符合"宁可误报不漏报"（与旧实现恒真语义兼容，不会让本来能触达的 waitingForMe 信号消失）。
  - 诊断行：`ResolveCurrentUser` 结束时输出一行 `CurrentUser: resolved=...`（成功/失败原因/SMTP+姓名，成功与失败都会输出，不只失败时）；`CollectFromOutlook` 末尾若 `g_recipientParseFailures > 0` 才输出一行 `RecipientResolution: parseFailures=N; ...` 汇总（不逐邮件输出，避免刷屏，风格与既有 `FolderScan`/`DigestCap` 一致）。两行诊断均走 `WScript.Echo`（stdout），不写入 digest 文件，不影响 digest 格式。
  - 验收结果：`cscript //nologo scripts/collect-outlook-mails.vbs --help` 无语法错误；`--sample` 生成的 digest 与改动前（`git stash` 切回 HEAD 版本对照跑）逐行 diff，仅时间戳字段不同（`Now()` 波动），字段结构/顺序/`ToMe`/`CcMe` 均完全一致——`--sample` 走 `WriteSampleDigest`，不经过 `CollectFromOutlook`/`ResolveCurrentUser`/`IsRecipientTypeMatch`，本就不受本次改动影响，此对比主要确认改动未意外破坏其余共享代码路径（如 `WriteDigest`）。`npm test`（TS 侧）312/312 全绿，无回归（VBS-only 改动，预期不影响 TS 测试）。
  - Manual validation: **needs user validation on real Outlook**——需在真实 Outlook/Exchange 账户上验证：(a) 一封仅在 CC、不在 To 里的邮件应 `ToMe: false`、`CcMe: true`；(b) 一封 To 里包含当前用户的邮件应 `ToMe: true`；(c) 检查 stdout 中 `CurrentUser: resolved=true; smtp=...` 一行确认身份解析成功且 SMTP 非空（若 `resolved=false` 说明该环境下 Exchange 身份解析失败，toMe/ccMe 会退化回旧的恒真行为，需要进一步排查环境差异，如非 Exchange/IMAP 账户的 `GetExchangeUser` 行为）。
  - Known issues: 未做 IMAP/POP 账户（无 `GetExchangeUser`）下 `AddressEntry.Address` 回落路径的真机验证；理论上应生效（标准 Outlook 对象模型行为），但未连真实非 Exchange 账户复核。
  - Commit: `15c147c`

### [x] R1.3 修复会议采集迭代（C-6）

- **改动点**：`scripts/collect-outlook-meetings.vbs`（当前 120-168 行附近：`Sort "[Start]"` → `IncludeRecurrences = True` → `Restrict` → `For i = 1 To restricted.Count`）。
- **做法**：`IncludeRecurrences` 集合上禁用 `Count`/索引访问，改 `restricted.GetFirst` / `restricted.GetNext` 迭代；终止条件 = item 的 `Start` 超出 rangeEnd（集合已按 Start 升序），外加 200 条保险丝防死循环。保持 digest 输出格式不变。
- **验收**：语法检查通过；`src/test/meeting-digest.test.js` 等现有测试全绿；Handover 标注 `needs user validation on real Outlook`（含周期性会议的日历应能采到实例）。
- Completion Notes:
  - 改动文件：`scripts/collect-outlook-meetings.vbs`，仅 `CollectCalendarItems` 内的迭代逻辑（原 `For i = 1 To restricted.Count` 循环）。`CollectUnrespondedInvites` 未改动——01 文档明确该 Sub 的 Restrict 不带 `IncludeRecurrences`，不受 Count 不可靠问题影响。
  - 实现：`restricted.GetFirst()` 取首项（失败/取不到直接 `Exit Sub`），`Do While Not item Is Nothing` 循环内 `restricted.GetNext()` 推进；每轮先检查 `item.Start >= rangeEnd` 提前退出（集合按 Start 升序，Restrict+IncludeRecurrences 组合已知可能让个别超出范围的周期实例漏网，这是防御）；`iterations > 200` 与原有 `collectedCount >= 200` 两道保险丝均保留，防止退化场景死循环。`GetNext()` 出错也视为迭代结束（`Exit Do`），不 Fail 整个采集。
  - 验收结果：`cscript //nologo scripts/collect-outlook-meetings.vbs --help` 无语法错误；`--sample` 走 `WriteSampleMeetingDigest`，不经过 `CollectCalendarItems`，对照改动前版本（`git stash` 切回）逐行 diff 仅 `GeneratedAt` 时间戳不同，确认未破坏共享代码路径。`npm test` 312/312 全绿，无回归。
  - Manual validation: **needs user validation on real Outlook**——需要在含周期性会议（如每周例会）的真实日历上验证：Meetings 队列不再为空、周期性会议能采到具体实例（而非被 `Count` 为 0/异常值吞掉）。这与 handover 历史 TODO「inspect why meeting invitations/calendar items are not collected」高度吻合，是该问题的第一假设修复，需要真机确认是否已解决队列空的根因。
  - Known issues: 无法在当前环境验证 `IncludeRecurrences=True` 时 `restricted.Count` 的真实异常表现（无法连接真实 Outlook/Exchange），此 fix 基于 01 文档记录的 Outlook 对象模型已知行为，逻辑本身（GetFirst/GetNext 迭代 + Start 升序提前退出 + 200 条保险丝）在语法与 TS 侧测试层面已验证正确。
  - Commit: `9d1a469`

### [x] R1.4 保留期对齐，消除 6 天正文黑洞（L-2）

- **改动点**：`default-config.json` 的 `mailStoreRetentionDays: 1`；同步检查 `package.json` contributes 里 `easyMail.mailStoreRetentionDays` 的 default（若有）与相关 README/文档描述。
- **做法**：默认 1 → 7，与 `mailIndexRetentionDays: 7`、`analysisRetentionDays: 7` 对齐。**不改** merge 去重逻辑（`mail-store.ts` `mergeDigestIntoStore`）——那是 05 矩阵中的备选方案，改默认值是更小的正确修复。
- **验收**：现有 `mail-store` 测试全绿；若测试硬编码了默认 1 天需同步；在 Completion Notes 注明"用户已自定义该设置的不受影响"。
- Completion Notes:
  - 改动文件：`default-config.json`（`mailStoreRetentionDays: 1 → 7`）、`package.json`（`easyMail.mailStoreRetentionDays` schema `default: 1 → 7`，`minimum: 1` 不变）、`user guide.md`（"默认 1 天"改为"默认 7 天，与去重索引/分析结果保留期对齐"）。未改 `mail-store.ts` 的 `mergeDigestIntoStore`/`pruneMailStore` 逻辑本身。
  - 用户已自定义该设置的不受影响：`readConfig()`（`extension.ts:918-939`）用 `settings.get("mailStoreRetentionDays", defaults.mailStoreRetentionDays)`，VS Code 用户显式设置过的值优先于 `defaults`，本次改动只影响从未设置过该项的新用户/全新安装。
  - grep 确认 `src/test/mail-store.test.ts` 的 `pruneMailStore` 测试全部显式传参保留天数（30、1），不依赖 config 默认值，无需同步。`extension.ts:508`/`message-handler.ts:345` 的 `|| 1` 防御性兜底字面量未改动——按计划边界排除（这两处只在 `config.mailStoreRetentionDays` 为 0/undefined 时才触发，正常路径下 `readConfig()` 保证该字段来自 `defaults`，属不可达兜底，非"默认值"本体）。
  - Tests: `npm run compile` 零错误；`npm test` 全绿 312/312，无回归（纯配置默认值改动，无逻辑变化）。
  - Manual validation: 不适用（配置默认值改动，无 Outlook 交互；效果需长期使用观察——新装用户 6 天后不应再看到 P1.2 症状"analyzed mail body 为空"复现）。
  - Known issues: 无。存储体积影响：1500 字符 × 每天几百封 × 7 天，JSON 体积仍在可接受范围（02 文档已评估）。
  - Commit: `PENDING`

### [ ] R1.5 prompt 注入当前日期（B-2a）

- **改动点**：prompt 组装点——先 grep `prompts/analysis-prompt.md` 的读取/拼接位置（`prompt-config.ts` 的 compose 函数与 `app-analysis.ts` 的 `analyzeBatchCore` / `analyzeThreadCore`），单邮件与线程两条路径都要覆盖。
- **做法**：在 system/user prompt 组装时注入一行 `Today is YYYY-MM-DD (<本地 IANA 时区，如 Asia/Shanghai>)`，日期取 `new Date()` 本地时区格式化（不要 UTC，用户在东八区，UTC 会在晚间差一天）。
- **验收**：新增/扩展测试：用 `MockProvider` 捕获实际发送的 prompt，断言包含 `Today is` 行且日期为今天；两条路径（batch / thread）各一断言。
- **边界**：只注入日期，不做 `dueDate` 结构化输出（那是 B-2b，属 R3 讨论范围）。
- Completion Notes:

### [ ] R1.6 草稿丢失止血（U-1 短期方案）

- **改动点**：workbench webview 的草稿 textarea 脚本（`workbench-render.ts` 内嵌 JS）与 webview state。
- **做法**：textarea `input` 事件把 `{ mailId, draft }` 写入 `vscode.setState()`（与现有 getState/setState 用法保持一致，先 grep 现有先例）；HTML 重建后的初始化脚本从 `getState()` 读取，**仅当 state 中 mailId 与当前渲染的 mailId 相同且草稿与服务端下发值不同**时回填 textarea。用户切换到另一封邮件时清除或忽略旧 state。
- **验收**：`npm test` 全绿；`workbench-render` 相关测试断言输出 HTML 包含回填脚本片段；Completion Notes 写清手动验证场景：正在编辑草稿时触发一次后台刷新（如 Fetch New 完成），草稿仍在。
- **边界**：这是止血，不做增量渲染（R3）。sidebar 若无自由文本输入框则不动。
- Completion Notes:

### [ ] R1.7 采集超时可配置（C-4）

- **改动点**：`src/extension.ts` `pullMailCore`（`runProcess("cscript.exe", args, 30000, ...)`）及会议拉取的同款调用；`package.json` contributes；`default-config.json`。
- **做法**：新增 `easyMail.collectorTimeoutSeconds`（默认 120），经 `config-utils.positiveNumber` 解析；两处 `runProcess` 超时改读该配置；超时报错消息附上已捕获的 `FolderScan` 诊断行（若 `process-runner` 已缓存部分 stdout）。
- **验收**：`npm run compile` 通过；config-utils 解析路径有测试覆盖（非法值回落默认）；package.json 与 default-config.json 默认值一致。
- Completion Notes:

---

## 3. Milestone R2 — 效率与语言

> 前置：R1 全部完成。R2.1 最小可先做；R2.2-R2.4 有依赖顺序：**chunk 化 → 语言契约 → 取消/退避**（并行分析不在本 milestone，见 06 文档 Q3，属 R3+）。

### [ ] R2.1 微效率修复打包（L-8a/b/c）

- **做法**：① `analyzeThreadCore` 开头一次性读 promptConfig，函数内复用（当前读 3 次）；② `sendPromptToModel` 把已选 model 对象传给 provider，`copilot-provider.ts` 不再二次 `selectChatModels`；③ 为 R2.2 预留：prompt 模板文件在循环外读一次。
- **验收**：行为不变，`npm test` 全绿；MockProvider 路径不受影响。
- Completion Notes:

### [ ] R2.2 批量分析 chunk 化 + token 预算（L-3）

- **改动点**：`src/lib/app-analysis.ts` `analyzeBatchCore`。
- **做法**：
  1. 新增纯函数 `splitByTokenBudget(mails, maxInputTokens, reservePerMail)`（token 估算用 `chars/4` 近似即可；`reservePerMail` ≈ 400 输出预留 + prompt 固定开销），放 `app-analysis.ts` 或独立小模块，必须可单测。
  2. 每 chunk 独立：组 prompt → `sendPrompt` → parse → `mergeAnalysisResults` → 持久化；单 chunk 解析失败先做一次"原响应+错误信息回喂"修复重试，再失败记录并跳过，**不影响其他 chunk**。
  3. 进度提示更新为 `chunk i/N`。
- **验收**：`splitByTokenBudget` 单测（超预算批被正确切分、单封超大邮件独占 chunk 不死循环）；MockProvider 集成测试：3 chunk 中第 2 个返回坏 JSON → 第 1/3 chunk 结果正常落盘。`model.maxInputTokens` 取不到时回落保守常量（如 8000）。
- **边界**：默认仍串行。不加并发（那需要先改 `runWithBusy` 忙锁语义，见 06 文档 Q3，另立 step）。
- Completion Notes:

### [ ] R2.3 统一语言契约（L-4 + U-5，实施前必读 06 文档 Q2 全文）

- **做法**：
  1. 新增配置 `easyMail.draftLanguage`：`auto`（默认）/ `en` / `zh-CN`。`auto` = 检测线程中最近一封非本人邮件的主体语言（CJK 字符占比阈值 ~0.15，取正文首段，纯函数可单测）。
  2. 主 prompt（单邮件+线程两路径）注入 Language Contract 段：分析字段（summary/reason/suggestedAction）使用 `outputLanguage`；draftReply 使用解析后的草稿语言。
  3. **删除**四处矛盾指令：`ensureEnglishDraftReplies` 及其调用、thread 分析的 CJK fallback 翻译调用、`prompts/reply-draft-prompt.md` 硬编码 "Keep all reply draft content in English"、`prompt-config` 内英文草稿要求。grep 确认无引用残留。
  4. `outputLanguage` 首次运行默认跟随 `vscode.env.language`（仅在用户未显式设置时）。
- **验收**：语言检测纯函数单测（中/英/混合样例）；prompt 组装测试断言契约段存在且随配置变化；被删函数无引用；`npm test` 全绿。UI 层 EN|中 快速切换按钮**不在本 step**（记入 R4）。
- Completion Notes:

### [ ] R2.4 请求取消 + 退避重试（L-5）

- **改动点**：`src/lib/copilot-provider.ts`（当前 `new vscode.CancellationTokenSource().token` 创建即弃）、`llm-provider.ts` 接口、`extension.ts` 的 `runWithBusy`。
- **做法**：`sendPrompt` 签名接受可选 `CancellationToken` 并透传给 `sendRequest`；长操作外层改 `vscode.window.withProgress({ cancellable: true })`，取消令牌下传到每次 LLM 调用与 chunk 循环（chunk 间检查 `isCancellationRequested`）；对 429/quota 类 `LanguageModelError` 做最多 2 次指数退避（2s/8s）。`MockProvider` 同步扩展签名。
- **验收**：MockProvider 模拟先 429 后成功 → 最终成功且重试计数正确；取消后 chunk 循环停止、已完成 chunk 结果保留。
- Completion Notes:

### [ ] R2.5 recentHours 用 Restrict 过滤（C-1）

- **改动点**：`scripts/collect-outlook-mails.vbs` `CollectFolderItems`（recentHours 模式全量 `For i = 1 To items.Count`）。
- **做法**：优先 `items.Restrict("[ReceivedTime] >= '...'")`——脚本内 `--older-than-map` 路径已有同款 Restrict 用法可直接复制其日期格式化；对 Restrict 结果仍按现有排序/上限逻辑处理。保底：降序遍历中 `If receivedTime < cutoff Then Exit For`。
- **验收**：语法检查；`--sample` 不回归；digest 格式不变；Handover 标注 `needs user validation on real Outlook`（大邮箱 Fetch New 明显变快、结果集不变）。
- Completion Notes:

---

## 4. Milestone R3 / R4 占位（worker 不得自行 claim）

以下条目需用户确认设计（涉及 schema、UI 结构、采集格式变更），确认后由规划者展开为带验收标准的 step：

- R3: B-1 tags 化与过滤视图 · B-4 线程唯一真相源 · U-1 增量渲染 + U-2 CSP · S-3 MIP 标签权威分级 · S-1 中文分级词表（含 S-5 阈值复核）· C-3 digest NDJSON 化 · B-2b dueDate 结构化 · 并行分析（06 文档 Q3，前置 R2.2/R2.4）
- R4: U-6 键盘流 · U-3 密度改造 · C-7e DIAG 协议 · 增量拉取（既有 TODO 设计）

---

## 5. 构建与测试速查

```bash
npm run compile          # 必须零错误
npm test                 # 必须全绿（258+ tests）
node --test out/test/<module>.test.js   # 单文件（先 compile）
cscript //nologo scripts/collect-outlook-mails.vbs --help   # VBS 语法检查
```

---

## 6. Current Snapshot

- 2026-07-08 · branch `v3` · 计划创建，R1 全部 step 未开始。工作树干净（fable 审查文档与 UI 截图已随本计划提交）。
- 2026-07-08 · R1.1、R1.2、R1.3、R1.4 完成并提交。R1.2/R1.3 需真实 Outlook 验证（见各自 Completion Notes）。R1.5-R1.7 未开始。

---

## 7. Handover Log

- **2026-07-08 · Claude Fable 5（规划者）**：创建本执行计划。R1 七个 step 互相独立可任选；建议第一个 agent 从 R1.1（影响最大、改动最小）开始。无 dirty state。Next: claim R1.1。

- **2026-07-08 · Claude Code（R1.1 pre-work checkpoint）**：读完本文件与 05 矩阵 L-1 行、02 文档 L16-27（`toThreadMessage` 三字段全赋原文、`isDuplicateBody` 硬编码 false 的根因）。`git status --short` 干净，HEAD `a815c51`（比 snapshot 记录的 `664620f` 多一条 CLAUDE.md→AGENTS.md 重定向提交，与本 step 无关）。已用 grep 重新定位锚点：`thread-engine.ts:66-96 toThreadMessage`、`thread-engine.ts:42-64 buildThreadRecord`；`bodyPreview` 消费方核实为 UI 展示（dashboard-render.ts/workbench-render.ts）+ prompt fallback 链末位（thread-prompt-builder.ts:51 `bodyDelta || bodyClean || bodyPreview`，接线后自动优先用 bodyDelta，无需改动）+ redaction/security-gate（两处已对三字段分别处理，无需改动）。额外发现：`ThreadMessage` schema 缺 `duplicateOfId` 字段（`thread-schema.ts` 只有 `isDuplicateBody`），`thread-store.ts normalizeThreadMessage` 也未做该字段的存取/回读——这是"回填 duplicateOfId"验收项的前置条件，纳入本 step 最小改动范围（新增可选字段，非新增功能）。Claim R1.1，开始写 RED 测试。

- **2026-07-08 · Claude Code（R1.1 完成）**：
  - Changed: `src/lib/thread-engine.ts` 接线 `cleanMailBody`/`extractReplyDelta`/`markDuplicateBodies`；`src/lib/thread-schema.ts` 新增 `ThreadMessage.duplicateOfId?: string`；`src/lib/thread-store.ts` 补上该字段的 normalize round-trip；`src/test/thread-engine.test.ts` 新增 2 个测试（引用链修剪 + 重复正文标记）。
  - Validated: RED 先行——加测试后 `npm run compile` 报 `Property 'duplicateOfId' does not exist on type 'ThreadMessage'`（证实 schema 缺口是真实 gap，不是测试写错）；实现后 `npm run compile` 零错误；`npm test` 全绿 312/312（新增 2 个通过，`thread-timeline.test.ts`/`thread-prompt-builder.test.ts` 无回归）。
  - Known issues: 无。接线后真实双语样本的 heuristics 覆盖率未做产品级评估（超出本 step 边界，留给后续如需要另开 step）。
  - Commit: `e60001c`
  - Last safe stopping point: R1.1 完成并提交。
  - Uncommitted changes: 仅本文件（随 commit 一起提交）。
  - Next: claim R1.2（`scripts/collect-outlook-mails.vbs` 的 `toMe`/`ccMe` 恒真修复，VBS 改动需在 Handover 标注 `needs user validation on real Outlook`）或 R1.3-R1.7 中任一，7 个 step 互相独立。

- **2026-07-08 · Claude Code（R1.2 pre-work checkpoint）**：读 05 矩阵 C-2 行、01 文档 C-2 小节（`collect-outlook-mails.vbs:494-504`，`IsDirectRecipient`/`IsCcRecipient` 只判 To/CC 字段非空，恒真）。`git status --short` 干净，HEAD `511af92`。grep 重新定位锚点：`IsDirectRecipient`/`IsCcRecipient` 仍在 494-504 行（未漂移），`BuildMailRecord`（332-359 行）351/352 行调用两者，`SafeTo`/`SafeCc`（439-457 行）保持不变原样返回。VBS 无测试框架，本 step 验收 = 语法检查 + digest 格式不变 + Handover 标注 `needs user validation on real Outlook`。Claim R1.2，开始实现。

- **2026-07-08 · Claude Code（R1.2 完成，needs user validation on real Outlook）**：
  - Changed: `scripts/collect-outlook-mails.vbs`——新增 `ResolveCurrentUser`/`IsRecipientTypeMatch`/`IsCurrentUserRecipient` 三个函数与三个脚本级全局变量；`IsDirectRecipient`/`IsCcRecipient` 改为遍历 `mail.Recipients` 按 `Type` 比对当前用户（SMTP 优先，显示名兜底），替换原来"字段非空即真"的恒真判定；新增两行诊断 echo（身份解析结果 + 收件人解析失败汇总），不影响 digest 文件格式。
  - Validated: `cscript //nologo scripts/collect-outlook-mails.vbs --help` 语法检查通过；`--sample` 输出与改动前逐行 diff 仅时间戳不同（sample 路径本就不经过本次改动的函数，用于确认未意外破坏共享代码）；`npm test` 312/312 全绿（VBS-only 改动，TS 侧无回归，符合预期）。
  - **needs user validation on real Outlook**：真实邮箱验证——(a) CC-only 邮件应 `ToMe: false`/`CcMe: true`；(b) To 含当前用户应 `ToMe: true`；(c) 核对 stdout `CurrentUser: resolved=true; smtp=...` 确认身份解析成功（`resolved=false` 说明该账户类型下 toMe/ccMe 会退化回旧恒真行为，需要进一步排查）。IMAP/POP 账户（无 `GetExchangeUser`）的 `AddressEntry.Address` 回落路径同样未连真机复核。
  - Last safe stopping point: R1.2 完成并提交，等待真机验证反馈。
  - Uncommitted changes: 仅本文件（随 commit 一起提交）。
  - Next: claim R1.3（`collect-outlook-meetings.vbs` 会议迭代 `Count`/索引不可靠问题）或 R1.4-R1.7 中任一。

- **2026-07-08 · Claude Code（R1.3 pre-work checkpoint）**：读 05 矩阵 C-6 行、01 文档 C-6 小节（`IncludeRecurrences=True` 后 `restricted.Count` 不可靠，惰性展开周期性会议可能返回 0/错误值，`For i = 1 To restricted.Count` 在 Count=0 时一个会议都收不到——疑似 Meetings 队列空的根因）。`git status --short` 干净，HEAD `169faa8`。grep 重新定位锚点：问题循环在 `CollectCalendarItems`（scripts/collect-outlook-meetings.vbs:109-169），`For i = 1 To restricted.Count` 在第 141 行；`CollectUnrespondedInvites`（171-241 行）同样用 `restricted.Item(i)` 索引但**不带** `IncludeRecurrences`，用的是 `[MessageClass]='IPM.Schedule.Meeting.Request'` Restrict——01 文档明确该 Sub 无此问题，本 step 不动它。Claim R1.3，只改 `CollectCalendarItems` 的迭代方式。

- **2026-07-08 · Claude Code（R1.3 完成，needs user validation on real Outlook）**：
  - Changed: `scripts/collect-outlook-meetings.vbs`——`CollectCalendarItems` 的 `For i = 1 To restricted.Count` 索引迭代改为 `GetFirst`/`GetNext` 迭代，加 `item.Start >= rangeEnd` 提前退出（升序集合）+ 200 次迭代保险丝；`CollectUnrespondedInvites` 未动。
  - Validated: `cscript //nologo scripts/collect-outlook-meetings.vbs --help` 语法检查通过；`--sample` 与改动前逐行 diff 仅时间戳不同（sample 路径不经过 `CollectCalendarItems`，用于确认未破坏共享代码）；`npm test` 312/312 全绿，无回归。
  - **needs user validation on real Outlook**：需在含周期性会议的真实日历上验证 Meetings 队列不再空、周期性会议能采到实例——这与 handover 历史「inspect why meeting invitations/calendar items are not collected」TODO 高度吻合，是该问题的第一假设修复，真机结果待确认。
  - Last safe stopping point: R1.3 完成并提交，等待真机验证反馈。
  - Uncommitted changes: 仅本文件（随 commit 一起提交）。
  - Next: claim R1.5-R1.7 中任一（R1.4 已完成）。

- **2026-07-08 · Claude Code（R1.4 pre-work checkpoint）**：读 05 矩阵 L-2 行、02 文档 L-2 小节（`mailStoreRetentionDays:1` vs `mailIndexRetentionDays:7` 不对称 → 昨天拉的邮件正文今天被裁、今天重拉又被 7 天 index 拦下 skipped，6 天内无法恢复正文；连锁到 P1.2 已知症状"analyzed mail body 为空"）。`git status --short` 干净，HEAD `159c55f`。grep 定位：`default-config.json:14`、`package.json:168-174`（`easyMail.mailStoreRetentionDays` schema default）、`user guide.md:154`（文档写"默认 1 天"需同步）。额外 grep 了 `extension.ts:508`/`message-handler.ts:345` 的 `|| 1` 防御性兜底字面量与 `src/test/mail-store.test.ts` 的 `pruneMailStore` 测试——均不依赖这个默认值（测试显式传参 30/1，兜底字面量只在 config 字段缺失/为 0 时才触发，正常路径不可达），按计划边界只改默认值来源（default-config.json + package.json + 文档），不碰这些防御性代码，避免超出"更小的正确修复"范围。Claim R1.4。

- **2026-07-08 · Claude Code（R1.4 完成）**：
  - Changed: `default-config.json`/`package.json` 的 `mailStoreRetentionDays` 默认值 1→7；`user guide.md` 同步文档描述。未改 merge 去重逻辑。
  - Validated: `npm run compile` 零错误；`npm test` 312/312 全绿，无回归。
  - Known issues: 无。
  - Last safe stopping point: R1.4 完成并提交。
  - Next: claim R1.5（prompt 注入当前日期）或 R1.6/R1.7。
