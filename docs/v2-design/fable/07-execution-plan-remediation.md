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

### [ ] R1.1 接线引用修剪函数（L-1，最高优先）

- **改动点**：`src/lib/thread-engine.ts` 的 `toThreadMessage`（当前 84-88 行附近，三个 body 字段全部直赋原文）。`src/lib/thread-timeline.ts` 已导出 `cleanMailBody` / `extractReplyDelta` / `hashBody` / `markDuplicateBodies`，目前仅测试文件引用（死代码）。
- **做法**：
  1. `toThreadMessage`：`bodyClean = cleanMailBody(body)`，`bodyDelta = extractReplyDelta(body)`；`bodyPreview` 保持原文（先 grep `bodyPreview` 的全部消费方确认它用于 UI 展示而非 prompt，如有 prompt 消费需在 Completion Notes 记录）。
  2. `buildThreadRecord`（或消息按时间排序后的位置）：对 timeline 消息数组跑 `markDuplicateBodies`（以 `bodyClean` 为键），回填 `isDuplicateBody` / `duplicateOfId`，替换现在的硬编码 `isDuplicateBody: false`。
  3. 确认 `thread-prompt-builder.ts` 消费的是 `bodyDelta` / `isDuplicateBody`（应已如此，接线后自动生效）。
- **验收**：新增 `src/test/thread-engine.test.ts` 用例：构造 3 封含引用链的邮件（英文 `-----Original Message-----` 与中文 `发件人:` 头各至少一例）→ 断言 `bodyDelta` 不含引用块；两封正文相同 → 第二封 `isDuplicateBody === true` 且 `duplicateOfId` 指向第一封。`npm test` 全绿（现有 thread-timeline / thread-prompt-builder 测试不得回归）。
- **边界**：本 step 只接线，不调整 `thread-timeline.ts` 内的修剪 heuristics。接线后若真实双语样本仍有残留，另开 step。
- Completion Notes:

### [ ] R1.2 修复 toMe/ccMe 恒真（C-2）

- **改动点**：`scripts/collect-outlook-mails.vbs`，`IsDirectRecipient` / 对应 CC 判定（当前实现只判 To/CC 字段非空）。
- **做法**：
  1. 脚本启动时取一次当前用户身份：`ns.CurrentUser`，尝试 `AddressEntry.GetExchangeUser.PrimarySmtpAddress` 得 SMTP，失败则用显示名；缓存为脚本级变量。
  2. 判定改为遍历 `mail.Recipients`，按 `Type`（olTo=1 → toMe，olCC=2 → ccMe）将收件人地址/名称与当前用户比对（不区分大小写）；Exchange 收件人同样经 `GetExchangeUser.PrimarySmtpAddress` 归一化，取不到时用 `Recipient.Name`。
  3. 每步包 `On Error Resume Next`；身份或收件人解析完全失败时**兜底维持 true**（与现状语义一致，宁可误报不漏报），并输出一行诊断（沿用现有 FolderScan 风格）。
- **验收**：`cscript //nologo scripts/collect-outlook-mails.vbs --help` 无语法错误；`--sample` 输出格式不变；digest 中 `ToMe`/`CcMe` 字段仍存在。Handover 标注 `needs user validation on real Outlook`（真实邮箱验证：一封仅在 CC 的邮件应 ToMe: false）。
- Completion Notes:

### [ ] R1.3 修复会议采集迭代（C-6）

- **改动点**：`scripts/collect-outlook-meetings.vbs`（当前 120-168 行附近：`Sort "[Start]"` → `IncludeRecurrences = True` → `Restrict` → `For i = 1 To restricted.Count`）。
- **做法**：`IncludeRecurrences` 集合上禁用 `Count`/索引访问，改 `restricted.GetFirst` / `restricted.GetNext` 迭代；终止条件 = item 的 `Start` 超出 rangeEnd（集合已按 Start 升序），外加 200 条保险丝防死循环。保持 digest 输出格式不变。
- **验收**：语法检查通过；`src/test/meeting-digest.test.js` 等现有测试全绿；Handover 标注 `needs user validation on real Outlook`（含周期性会议的日历应能采到实例）。
- Completion Notes:

### [ ] R1.4 保留期对齐，消除 6 天正文黑洞（L-2）

- **改动点**：`default-config.json` 的 `mailStoreRetentionDays: 1`；同步检查 `package.json` contributes 里 `easyMail.mailStoreRetentionDays` 的 default（若有）与相关 README/文档描述。
- **做法**：默认 1 → 7，与 `mailIndexRetentionDays: 7`、`analysisRetentionDays: 7` 对齐。**不改** merge 去重逻辑（`mail-store.ts` `mergeDigestIntoStore`）——那是 05 矩阵中的备选方案，改默认值是更小的正确修复。
- **验收**：现有 `mail-store` 测试全绿；若测试硬编码了默认 1 天需同步；在 Completion Notes 注明"用户已自定义该设置的不受影响"。
- Completion Notes:

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

---

## 7. Handover Log

- **2026-07-08 · Claude Fable 5（规划者）**：创建本执行计划。R1 七个 step 互相独立可任选；建议第一个 agent 从 R1.1（影响最大、改动最小）开始。无 dirty state。Next: claim R1.1。
