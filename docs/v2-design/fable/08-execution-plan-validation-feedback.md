# 08 · 人工验证反馈修复执行计划（F 批次）

> 来源：用户 2026-07-11 完成 `07-execution-plan-remediation.md` 计划 §8 人工验证清单后的详细反馈，原文见 `easymail-verification-notes.md`（同目录，逐条对应）。规划者已对全部反馈做代码级根因核实，本文件是 worker 的唯一执行依据。
> **协议**：完全沿用 `07-execution-plan-remediation.md` §1 的全部规则（claim 单个 step、pre-work checkpoint、Completion Notes、Handover Log 写回本文件 §5、本地提交不 push、`npm run compile` 零错误 + `npm test` 全绿）。
> **R3/R4 仍然锁定**：F1/F2 全部完成并通过用户复验之前，不进入 R3/R4。

状态标记：`[ ]` 未开始 · `[~]` 进行中（已 claim）· `[x]` 完成（含 commit hash）· `[!]` 阻塞/需用户决策

---

## 0. 反馈 → step 对照总表

| 反馈项 | 判定 | 归属 |
|---|---|---|
| 清单#4 recentHours 拉不到邮件 | **P0 bug，根因已定位** | F1.1 |
| 清单#2 Meetings 队列空 | **P0 bug，根因链已定位（同源）** | F1.1 |
| 清单#8 注入邮件消失、无日志 | **P0 bug，需真机复现 + 对账兜底** | F1.2 |
| 清单#3 草稿丢失（手写与生成的都丢） | **P0 bug，根治方向已定** | F1.3 |
| 清单#5 乱写 folder 无任何提示 | **P0 缺陷，诊断从未接到 UI** | F1.4 |
| 清单#6 selectFolders 无进度/超时/重复勾选疑问 | P1 UX + 语义修正 | F1.5 |
| 其他#5 发件人显示 Exchange DN | P1（影响 importantSenders 命中） | F1.6 |
| 清单#9 取消要等 30-40s | P1 | F1.7 |
| 清单#4 附带：两种 range mode 显示互串 | P2 显示问题（逻辑已核实独立） | F1.1 内附带修 |
| 其他#2 sidebar 设置栏宽度 / 其他#9 设置栏整理 | P2 | F2.1 |
| 其他#10 列表时间戳/分类改名/排序 | P2 | F2.2 |
| 其他#3 conversation id 展示 / #4 原文容器高度 / #11 timeline 截断 | P2 | F2.3 |
| 其他#12 单封邮件 Analyze 按钮 | P2 | F2.4 |
| 其他#8 Activity Bar 标题 "Dashboard" | P2 | F2.5 |
| 其他#6 重装不弹帮助 | P2 | F2.6 |
| 其他#7 丰富示例数据 | P2 | F2.7 |
| 清单#7-3 可删除 Inbox/Sent Items | **接受不修**（合法操作，空选已防；见 §3） | — |
| 其他#1 分类逻辑是否被改动 | **核实：未改动**（见 §3） | — |
| 其他#13 chunk/12000 疑问 | **回答 + 小改进**（见 §3；skipped chunk 提示并入 F1.2） | — |
| 清单#6-Q1 Settings 页为何仍是 Add Item | **回答**：VS Code 不支持运行时动态 enum（07 §3.9 已记录） | — |
| 清单#1/#10/#11/#12 | 通过 | — |

---

## 1. Milestone F1 — P0/P1 正确性修复

### [x] F1.1 修复 Restrict 日期格式（mail + meetings 双脚本，recentHours 与 Meetings 队列空的共同根因，commit `040713d`）

- **根因（已核实）**：
  1. `scripts/collect-outlook-mails.vbs` `FormatRestrictDate`（~L529-543）用**反斜杠**拼日期：`Month & "\" & Day & "\" & Year`，且带秒。Outlook `Items.Restrict` 无法解析 `7\10\2026 1:23:45 AM`，静默返回 0 条——用户实测 `candidateItems=0`、`added=0`。Outlook Restrict 的已知限制还包括**不支持秒**。maxItems 模式不走 Restrict，故正常。
  2. `scripts/collect-outlook-meetings.vbs` `FormatRestrictDate`（~L444-458）同样是 `\` 分隔。`CollectCalendarItems`（~L109-198）的循环只有上界守卫（`itemStart >= rangeEnd Exit Do`，L169），**没有下界守卫**——Restrict 失效时收进来的可以全是历史实例。TS 端 `pruneMeetingStore`（`src/lib/meeting-store.ts:71-80`）把 start < 今天且已响应的会议全部剪掉 → **digest/store 有数据、队列为空**，与用户症状完全吻合。
  3. 用户日志中 Inbox 显示 `timeProperty=SentOn` 异常：`IsSentFolder`（mails vbs ~L444-475）以 EntryID 逐级上溯比对，理论上 Inbox 不应命中——需在真机加诊断确认（怀疑 `sentEntryId` 读取失败为空串时与某级空 EntryID 相等误判）。
- **做法**：
  1. 两个脚本的 `FormatRestrictDate` 统一改为 `M/D/YYYY H:MM AM|PM`（正斜杠、**去掉秒**）；两处保持同一实现。
  2. meetings 循环补下界守卫：`itemStart < rangeStart` 的实例跳过不收（Restrict 再失效也不会收历史会议）。mail 侧已有代码级 cutoff 兜底（降序 + `sortDate < cutoff Exit Do`），不用动。
  3. 两个脚本在 Restrict 前 echo 一行诊断（如 `RestrictFilter: [ReceivedTime] >= '7/10/2026 1:23 AM'`），真机可核对。
  4. `IsSentFolder` 加保护：`sentEntryId` 为空串时直接返回 False；并在 FolderScan 行已有 timeProperty 字段，足够观察。
  5. 附带修显示互串（用户点名）：digest 头部与 `FolderScan` 行只输出**当前 mode 生效的参数**（recentHours 模式不打 `maxItems=50`，反之亦然），或明确标注 `inactive`。逻辑本身已核实独立（`capEnabled`/`cutoffEnabled` 各自只看自己 mode），是纯显示误导。
- **验收**：`--help` 语法检查；`--sample` 双脚本不回归；`npm test` 全绿。**needs user validation**：recentHours=168 能拉到自发测试邮件、`candidateItems` 不再为 0；Meetings 队列出现今天及未来的会议实例；Inbox 的 timeProperty 显示 ReceivedTime。

- **Completion Notes**：
  - 改动文件：`scripts/collect-outlook-mails.vbs`、`scripts/collect-outlook-meetings.vbs`。
  - 实现边界：mail formatter 去秒并与 meetings 保持完全相同的 `M/D/YYYY H:MM AM|PM` 实现；所有现有 Restrict 调用前输出实际 `RestrictFilter`；Calendar 跳过可读取开始时间但早于范围下界的实例；空 `sentEntryId` 不再误判 Sent；mail digest 头和 `FolderScan` 只显示当前 range mode 的参数。meetings formatter 在 claim 前已符合目标，未重复修改。
  - 验收结果：两个 VBS 的 `--help`、`--sample` 通过；recentHours/maxItems sample 头部仅含各自生效参数；`npm run compile` 零错误；`npm test` 367/367 通过；`git diff --check` 通过；task review 已复审通过。
  - Manual validation：**needs user validation on real Outlook**。设 `recentHours=168` 后 Fetch New，确认自发测试邮件出现且日志 `candidateItems` 非 0、`RestrictFilter` 可读；打开 Meetings，确认今天/未来实例出现；查看 Inbox 的 `FolderScan` 为 `timeProperty=ReceivedTime`。
  - Known issues：无真实 Outlook/Exchange 邮箱，无法在本机确认 Outlook COM 对 RestrictFilter 与 Sent folder EntryID 的实际行为。
  - Commit：`040713d`。

### [x] F1.2 分析结果 id 对账：送析邮件不得凭空消失（清单#8，commit `bd56b6e`）

- **现状（已核实）**：`src/lib/classification.ts:84-96`——`pending` = 不在 analysis items 里的邮件，模型漏返理论上应留在 Pending。但用户实测注入邮件"不存在于任何分类"且日志无踪。可能路径：(a) 所在 chunk 解析失败被 R2.6c 静默跳过（`analyze:chunkSkipped` 只进日志文件不提示用户）；(b) 模型被注入改写了返回的 mailId → 产生孤儿分析项；(c) UI 某处过滤。需真机复现定位。
- **做法**：
  1. **对账兜底（无论根因是什么都要做）**：`mergeAnalysisResults` 调用侧，对比本 batch 送析 mailIds 与返回 items 的 mailIds；缺失者强制生成 `uncertain` 分类项（summary 固定为 "analysis incomplete: model omitted this mail"，confidence 0），保证邮件永远可见、可重析。孤儿 id（返回但不在送析集合中）丢弃并记日志。
  2. skippedChunks > 0 或对账有缺失时，`vscode.window.showWarningMessage` 明确提示（含数量），不再只写日志。
  3. 用注入邮件真机复现，Completion Notes 写明实际根因路径。
  4. 单测：模型漏返一封 / 返回篡改 id → 缺失邮件落 uncertain、孤儿被丢弃。
- **验收**：单测 + `npm test` 全绿。**needs user validation**：重发注入测试邮件，分析后该邮件出现在 Uncertain（或正常分类），绝不消失；若 chunk 失败有 toast。

- **Completion Notes**：
  - 改动文件：`src/lib/app-analysis.ts`、`src/extension.ts`、`src/test/app-analysis.test.ts`。
  - 实现边界：成功与 skipped chunk 均按送析 id 对账；漏返/篡改 id 生成 `uncertain` 兜底，孤儿丢弃并记日志；全部失败亦先持久化兜底，扩展侧三类入口统一显示数量 warning。
  - 验收结果：定向对账、transport skip、repair skip、全失败持久化测试通过；`npm run compile` 零错误；`npm test` 370/370 通过；task review 的 P0 已修复并复审通过。
  - Manual validation：**needs user validation on real Outlook**。重发注入邮件并分析，确认正常分类或 Uncertain；人为触发 chunk 失败时确认出现含数量 warning。
  - Known issues：未在真实 Copilot/Outlook 环境复现原始注入路径。
  - Commit：`bd56b6e`。

### [x] F1.3 草稿改为扩展侧持久化（清单#3，手写与生成草稿刷新即丢，commit `2ab0299`）

- **现状（已核实）**：草稿保留完全依赖 webview 客户端 `vscode.setState/getState` 回填（`src/lib/workbench-render.ts:404-487`）。真机实测 Fetch New 重设 `webview.html` 后草稿丢失（手写与 Generate Draft 的都丢），R1.6+R2.6a 的客户端方案在真实环境不成立。用户另指出："不提交"表述无意义——草稿框本就没有提交动作。
- **做法（根治，不再修补客户端回填）**：
  1. 草稿状态上移扩展侧：`EasyMailApp` 维护 `draftByItemId: Map<string, string>`（内存即可，进程存活期够用；若要跨窗口重启保留则落 app-data，worker 按最小可用取舍并在 Notes 说明）。
  2. webview `input` 事件 postMessage 节流上报草稿文本（如 500ms debounce）；Polish/Refine/Generate 完成时扩展侧同步写入该 Map。
  3. `getWorkbenchHtml` 渲染时把 Map 中的草稿直接注入对应 textarea 初值（escape 后），刷新天然带回；客户端 getState 回填逻辑降级为兜底或删除。
  4. 单测：render 注入草稿初值；message-handler 处理草稿上报。
- **验收**：`npm test` 全绿。**needs user validation**：手写草稿 → Fetch New → 草稿仍在；Generate Draft → 刷新 → 仍在；切换邮件互不串。

- **Completion Notes**：
  - 改动文件：`src/extension.ts`、`src/lib/message-handler.ts`、`src/lib/workbench-render.ts` 及对应测试。
  - 实现边界：复用内存 `workingDrafts`；手写草稿以 500ms debounce 上报，重建前先 flush 当前 textarea，扩展写入 Map 后才重设 HTML；生成/润色/改写同步 Map。客户端 getState 不再作为草稿恢复路径。
  - 验收结果：renderer/message-handler 回归测试覆盖初值、上报、flush；`npm run compile` 零错误；`npm test` 373/373 通过；task review 修复 debounce 丢失窗口后复审通过。
  - Manual validation：**needs user validation on real Outlook**。手写草稿后立即 Fetch New、Generate Draft 后 Fetch New、切换不同邮件，分别确认草稿保留且不串。
  - Known issues：跨扩展进程重启不保留（本 step 按计划只要求进程存活期）。
  - Commit：`2ab0299`。

### [x] F1.4 采集诊断接通 UI：坏文件夹/partial 必须让用户看见（清单#5，commit `7103500`）

- **现状（已核实）**：VBS 的 `FolderScan:`/`FolderScanSummary:` 只进 stdout，`runProcess` 不回传 stdout（只截 2000 字符进日志文件），`src/` 全库对 `FolderScanSummary` **零引用**——乱写 folder 时 VBS 确实会输出 `error=Outlook folder not found` 并继续采集其他文件夹（R2.7b 行为正确），但用户全程无感知。
- **做法**：
  1. VBS 把扫描汇总写进 digest 头部（机器可读行，如 `ScanSummary: failed=1; partial=0; folders=BadName`；全 ok 时写 `ScanSummary: ok`），复用现有 digest 文件通道，不动 `runProcess`。
  2. TS digest 解析器读取该行；Fetch 完成后 failed/partial 非零 → `showWarningMessage`（列出坏文件夹名，提示检查 `easyMail.folders` 或用 Select Outlook Folders 重选）。
  3. 单测：digest parser 解析 ScanSummary 行（含无该行的旧 digest 兼容）。
- **验收**：单测 + `npm test` 全绿。**needs user validation**：配置 `Inbox` + 乱写名 → Fetch 后弹 warning 点名坏文件夹，Inbox 正常采集。

- **Completion Notes**：
  - 改动文件：`scripts/collect-outlook-mails.vbs`、`src/lib/digest.ts`、`src/extension.ts`、`src/test/digest.test.ts`。
  - 实现边界：digest header 写 `ScanSummary`，解析兼容旧/两种 range header，Pull 完成后对 failed/partial 弹出含目录名的 warning；未改 runProcess、store/schema。
  - 验收结果：`npm run compile` 零错误，`npm test` 375/375 通过，VBS `--help`/`--sample` 通过，review 通过。
  - Manual validation：**needs user validation on real Outlook**。配置 `Inbox` 与一个错误目录，Fetch 后确认 warning 点名错误目录且 Inbox 仍采集。
  - Commit：`7103500`。

### [x] F1.5 selectFolders UX 与语义修正（清单#6/#7 衍生）（commit `1706a48`）

- **现状（已核实）**：`extension.ts` `selectFolders`（~L783-818）无进度提示、超时 30s（用户实测 Outlook 未启动时枚举需 20+s，冷启动会超时报 `timed out after 30000ms`）；list mode 会输出 store 根节点（`username@xxx.com`，是邮箱根目录不是 Inbox，用户已困惑）；本地化真实目录（`.../已发送邮件`）与规范名 `Sent Items` 指向同一物理文件夹，同时勾选会重复采集同一文件夹两遍（store 层按 stableMailId 去重、邮件不会重复，但浪费扫描且 folder 字段各记各的）；`normalizeMailFolders`（`config-utils.ts:21`）的 legacy 规则会把"只选 Inbox"扩展回 Inbox+Sent Items，与 picker 语义冲突。
- **做法**：
  1. `vscode.window.withProgress`（Notification）包裹枚举全程，文案如 "Loading Outlook folders…"；超时 30s → **90s**；失败提示追加 "Tip: start Outlook first for faster loading"。
  2. VBS list mode：**排除 store 根节点**（根目录 Items 无采集意义且误导）；对 `GetDefaultFolder(6)/(5)/(16)` 的 EntryID 命中的文件夹，额外输出映射行 `FolderListDefault: Inbox=<真实路径>`（Sent Items/Drafts 同理）。
  3. TS 侧：解析映射行；QuickPick 中该真实路径的条目 description 标注 `(Inbox)`/`(Sent Items)`；配置现值中的规范名 `Inbox`/`Sent Items` 与映射路径互认为同一项（预勾选去重）；确认写回时若同一物理文件夹被规范名与真实路径同时选中，只写规范名。
  4. 删除 `normalizeMailFolders` 的"单 Inbox 扩展为 Inbox+Sent Items" legacy 规则（picker 时代该规则反而篡改用户明确选择；默认值本身已含两者），同步修相关单测。
  5. 回答用户疑问随 Notes 记录：store 根 = 邮箱根目录（非 Inbox 聚合）；`已发送邮件` 即真实 Sent Items；规范名与真实路径重复勾选的问题由本 step 的互认去重解决。
- **验收**：单测（映射行解析、互认去重、legacy 规则删除）+ `npm test` 全绿。**needs user validation**：关 Outlook 运行命令有进度条且 90s 内完成或给出含提示的报错；列表不再出现邮箱根；`已发送邮件` 条目带 `(Sent Items)` 标注；同选两者只写回一个。

- **Completion Notes**：
  - 改动文件：`scripts/collect-outlook-mails.vbs`、`src/extension.ts`、`src/lib/config-utils.ts`、`src/test/config-utils.test.ts`、`src/test/message-handler.test.ts`。
  - 实现边界：list mode 以默认目录 EntryID 与递归枚举目录匹配后才输出 `FolderListDefault`，跳过邮箱 store 根；picker 枚举使用 90s Notification progress，解析映射、显示规范名标记并双向去重后写回规范名；删除单 Inbox 的 legacy 扩展。未改采集/store/schema，也未进入 F1.6。
  - 验收结果：`npm run compile` 零错误，`npm test` 378/378 通过，VBS `--help` 与 `--list-folders --sample` 通过，`git diff --check` 通过；首轮 review 发现漏用 EntryID 匹配，补齐并复审通过。
  - Manual validation：**needs user validation on real Outlook**。关闭 Outlook 后运行 Select Outlook Folders，确认全程进度提示、90s 内完成或错误含启动 Outlook 提示；确认邮箱根不出现，`已发送邮件` 标记为 `(Sent Items)`，同时选真实路径与规范名后设置只保存一个规范名。
  - Known issues：本机未连接真实 Outlook，尚无法验证本地化路径和冷启动耗时。
  - Commit：`1706a48`。

### [x] F1.6 发件人/收件人 SMTP 化（其他#5，兼保 importantSenders 命中率）（commit `8323826`）

- **现状（已核实）**：Exchange 账户下 `SenderEmailAddress`/收件人地址是 X.500 DN（`/O=.../CN=RECIPIENTS/...`），digest 与 UI 原样展示；`importantSenders` 是**注入 prompt 由模型判断**（`prompt-config.ts:164` `renderImportantSenders`，无代码级精确/包含匹配）——DN 会显著降低模型命中概率。R1.2 已有 `GetExchangeUser.PrimarySmtpAddress` 解析模式可复用（`ResolveCurrentUser`）。
- **做法**：
  1. VBS `BuildMailRecord`：from/to/cc 各地址若以 `/O=` 或 `/o=` 开头，经 `AddressEntry.GetExchangeUser.PrimarySmtpAddress` 解析为 SMTP（带 On Error 兜底，失败保留原值）；输出统一 `Display Name <smtp@domain>` 格式。
  2. UI 展示层（sidebar/workbench/dashboard）：发件人只显示 Display Name，完整 `Name <smtp>` 放 title tooltip——满足用户"全部只显示名称"的建议且不丢信息。
  3. 在 user guide 的 importantSenders 说明中写明匹配语义（prompt 级模型判断，建议同时填显示名与邮箱）。
- **验收**：`--sample` 不回归（sample 已是 SMTP）；`npm test` 全绿。**needs user validation**：Exchange 邮箱 Fetch 后不再出现 `/O=...` DN；importantSenders 按邮箱配置能命中。

- **Completion Notes**：
  - 改动文件：`scripts/collect-outlook-mails.vbs`、`src/lib/html-utils.ts`、`src/lib/sidebar-render.ts`、`src/lib/workbench-render.ts`、`src/lib/workbench-render-v1.ts`、`src/lib/dashboard-render.ts`、`src/lib/guide-webview.ts` 及对应渲染/guide 测试。
  - 实现边界：仅在 `/O=` Exchange DN 时通过 `AddressEntry.GetExchangeUser.PrimarySmtpAddress` 解析 SMTP，失败保留原值；From/To/Cc 使用 `Display Name <address>`；所有现有 mailbox 展示改为名称，完整地址置于 tooltip。未改 digest/store/schema。
  - 验收结果：`npm run compile` 零错误，`npm test` 379/379 通过，VBS `--help`/`--sample` 通过，`git diff --check` 通过。review 两轮发现并补齐 Workbench To/Cc 的名称化，以及无空格分号 fallback 的逐项处理，最终复审通过。
  - Manual validation：**needs user validation on real Outlook**。对 Exchange 邮箱执行 Fetch，确认 From/To/Cc 无 `/O=...` DN，界面只显示名称且悬停可见完整地址；在 importantSenders 配置邮箱后确认模型将对应邮件识别为重要发件人。
  - Known issues：本机无真实 Exchange/Outlook，COM 地址解析与模型 prompt 命中均未实机确认。
  - Commit：`8323826`。

### [x] F1.7 取消响应性（清单#9）（commit `30c66e5`）

- **现状**：点击取消后按钮 loading 卡 30-40s 才出现 `task canceled`。chunk 循环层已检查 token（R2.4），但正在飞行中的单次 LM 请求取消传播存疑。
- **做法**：核查 `sendPromptToModel` → provider 链路是否把 `CancellationToken` 真正传入 `model.sendRequest` 与流式读取循环；取消后 UI 立即切换为 "Cancelling…"（busy 态区分 cancel-pending），不等后台真正结束才反馈；后台任务结束后再复原。若 LM API 层无法中断当前请求，Notes 写明该上限（等模型返回当前 chunk 后停止即为可接受下限）。
- **验收**：`npm test` 全绿。**needs user validation**：点取消后 UI ≤1s 给出 "Cancelling…" 反馈，整体等待时间明显缩短或有明确状态。

- **Completion Notes**：
  - 改动文件：`src/extension.ts`、`src/lib/copilot-provider.ts`、`src/lib/llm-provider.ts`、`src/lib/sidebar-render.ts`、`src/lib/dashboard-labels.ts`、`package.json` 及取消路径测试。
  - 实现边界：复核并保留同一 token 到 `sendRequest`；流式读取逐片段与结束后检查取消。取消时只刷新 Sidebar 为 `正在取消…`/`Cancelling…`，不重建 Workbench；任务结束恢复 busy。未改分析/store/schema。
  - 验收结果：`npm run compile` 零错误，`npm test` 384/384 通过（显式包含新的取消测试），VBS `--help`/`--sample` 通过，`git diff --check` 通过。review 两轮发现并修正 Workbench 重建风险、状态转换覆盖、测试未纳入 npm test 与取消后成功竞态，最终复审通过。
  - Manual validation：**needs user validation on real Outlook/VS Code**。启动耗时分析后点取消，确认 Sidebar 与通知在 1 秒内显示 `正在取消…`/`Cancelling…`，不发生成功提示，任务结束后按钮恢复。
  - Known issues：token 已传到 VS Code LM API；若 API 无法中断正在飞行的 `sendRequest`，仍需等当前请求返回或下一流片段，UI 会先给出取消中反馈。
  - Commit：`30c66e5`。

---

## 2. Milestone F2 — P2 UI/UX 打磨批（改动小，可多个一起 claim，但 Completion Notes 分项写）

### [ ] F2.1 Sidebar 设置栏重构 + 宽度修复（其他#2/#9）

- 修宽度 bug：默认 sidebar 宽度下设置区左列（最多邮件数/允许分析最高密级等）不可见，右列（范围/分析模型）固定宽度异常——改为自适应两列或单列堆叠，窄宽度不丢字段。
- 只保留高频项（范围模式/值、分析模型、输出语言等，worker 按现有使用频率判断并在 Notes 列出取舍）；其余引导到 VS Code Settings；**sidebar 出现的每一项必须在 VS Code Settings 有对应注册项**（加载模型是动作不是配置，保留）。
- 删除无实际作用的 refresh 按钮（先核实其 handler 确实冗余再删，Notes 写明依据）。
- `package.json` 配置项 `order` 重排：同类相邻（范围/采集 → 分析/模型 → 语言 → 安全 → 保留期）。

### [ ] F2.2 Sidebar 列表时间与分类调整（其他#10）

- 邮件行时间显示 `yyyy-MM-dd HH:mm:ss`（当前仅 `HH:mm`）；行 title tooltip 含完整时间。
- 分类改名：`Important Sender Or Group` → `Important Senders`（中英文 label 同步）。
- 分类顺序：`Must Handle Today` > `Important Senders` > `Risk` > …；`Ignored` 移到 `Uncertain` 之下。注意 07 计划 R2.6/R2.7 涉及的 category id 不变，只动展示顺序与 label。

### [ ] F2.3 Workbench 展示修复（其他#3/#4/#11）

- 去掉 `conversation:xxx` 线程内部 id 的展示（阅读面板任何位置不出现裸 conversationId）。
- 原文内容容器高度自适应：flex 撑满阅读面板剩余空间，仅内容超出时内部滚动，不再固定高度留白。
- Timeline 原文截断调查：确认是渲染截断（CSS/字符截断）还是数据截断（`bodyDelta`/`bodyChars` 采集上限），修渲染问题；若是采集上限属预期，Notes 说明并在 UI 加 "content truncated" 标注。
- Timeline 排序切换按钮（从晚到早）：**可选**，复杂就不做，用户已授权降级。

### [ ] F2.4 单封邮件 Analyze 按钮（其他#12）

- Workbench 邮件详情按钮区，`Open in Outlook` 左侧加 `Analyze`，行为 = 现有 `Confirm and Analyze`（analyzeSelected 单封路径）但不需要确认文案；已分析邮件显示为 `Re-analyze`（同一路径，覆盖旧结果）。安全门控照常生效（超密级仍走 manual confirm）。

### [ ] F2.5 Activity Bar 标题（其他#8）

- `package.json` viewsContainers `title: "Dashboard"` → `"EasyMail"`（~L211）；`views` 内 view `name: "Dashboard"`（~L221）保留（容器已叫 EasyMail，视图叫 Dashboard 合理；若视觉重复 worker 可斟酌，Notes 说明）。

### [ ] F2.6 Guide 弹出策略（其他#6）

- **现状（已核实）**：`extension.ts:153` 以 `easyMail.guideShown.<version>` 存 globalState——globalState 在卸载重装后通常保留，同版本重装不再弹。
- 做法：key 改用 `context.extension.packageJSON.__metadata?.installedTimestamp`（每次安装变化）优先，回落 version；真机验证 `__metadata` 在正式安装场景可用（开发宿主无此字段，需兜底）。Notes 写明 VS Code 无显式 install 事件，此为最可靠近似。

### [ ] F2.7 丰富示例数据（其他#7）

- `WriteSampleDigest`/sample meetings：扩充到每个分类至少 1-2 封（mustHandleToday/risk/waitingForMe/notice/important sender/uncertain 素材）、含中英文、含一组 3+ 封的线程、含带附件标记与高密级样例，会议含未响应邀请与周期实例。分析用的分类由模型/规则产生，sample 只需给足能诱导各分类的素材。同步更新 `--list-folders --sample` 无需改动。

---

## 3. 核实后接受不修 / 直接回答的记录

- **清单#7-3（可删除 Inbox/Sent Items）**：合法操作，用户可能只想扫自定义目录；空选保护已在 R2.10a 落地。F1.5 删除 legacy 单 Inbox 扩展后，用户的显式选择将被完整尊重。不另立 step。
- **其他#1（分类逻辑是否被改过）**：核实 R1/R2 全程只动过 normalize 钳制（R2.7e：低 confidence 降 uncertain、category×priority 一致性），分类 prompt 与类别定义未改。周末凌晨拉 100 封没有 mustHandleToday/waitingForMe 属正常样本分布。F1.2 落地后如再有"该命中未命中"，将有对账数据可查。
- **其他#13（12000 与 100 封的区别）**：`ANALYSIS_CHUNK_TOKEN_BUDGET = 12000`（`app-analysis.ts:20`）是**单个 chunk** 的输入 token 预算（与模型 maxInputTokens 取小）。选 100 封 ≠ 一次塞给模型：R2.2 会按预算切成多个 chunk **串行**发送，每封邮件都会被完整分析（正文本身在采集时已按 `bodyExcerptChars`=1500 截断，这是既有设计）。5 封与 100 封的区别只是请求次数与耗时，不是单封质量。已知风险"某 chunk 解析失败被跳过导致部分邮件未析"由 F1.2 的对账 + toast 解决。
- **清单#6-Q1（Settings 页为何还是 Add Item）**：VS Code contribution 不支持运行时动态 enum，Settings 原生 UI 无法变成 Outlook 下拉；命令 + QuickPick 是官方推荐替代。已在 07 §3.9 记录，维持。

---

## 4. 建议执行顺序

F1.1（root cause 已给足，改动小收益最大）→ F1.4 / F1.2 / F1.3（互相独立可并行 claim）→ F1.5 / F1.6 / F1.7 → F2 批。F1 全部完成后用户做一轮复验（重点：recentHours、Meetings、草稿、注入邮件、坏文件夹 toast），F2 可与复验并行。

---

## 5. Current Snapshot

- 2026-07-11 · 计划创建。规划者已完成全部反馈的代码级核实：F1.1（Restrict `\` 日期格式，双脚本同病）与 Meetings 队列空为同源根因；F1.2-F1.7、F2.1-F2.7 已列明现状锚点与做法。全部 `[ ]` 待 claim。R3/R4 锁定不变。
- 2026-07-12 · F1.1 已完成，代码提交 `040713d`：统一无秒 Restrict 日期格式、补齐 RestrictFilter 诊断与 Calendar 下界防线、修正空 Sent EntryID 误判及 range mode 显示互串。自动验收通过；真实 Outlook 验证仍待用户完成。下一步按用户指定顺序 claim F1.2。
- 2026-07-12 · F1.2 已完成，代码提交 `bd56b6e`：批分析对账兜底覆盖漏返、篡改 id 与 skipped chunk，并向 UI 报告不完整结果。下一步 claim F1.3。
- 2026-07-12 · F1.3 已完成，代码提交 `2ab0299`：草稿恢复改为扩展侧内存 Map，含刷新前 flush，真实 VS Code 验证待用户执行。按用户指示暂停，F1.4 未 claim。
- 2026-07-12 · F1.4 已完成，代码提交 `7103500`：采集诊断经 digest 送达 UI。下一步 claim F1.5。
- 2026-07-12 · F1.5 已完成，代码提交 `1706a48`：目录 picker 增加进度与 90s 超时，list 协议以 EntryID 映射默认目录并排除邮箱根，规范名与真实路径互认去重；真实 Outlook 验证待用户执行。下一步 claim F1.6。
- 2026-07-12 · F1.6 已完成，代码提交 `8323826`：Exchange DN 在采集端 SMTP 化，界面仅显示名称并保留完整地址 tooltip，guide 明确 importantSenders 的 prompt 匹配语义；真实 Exchange 验证待用户执行。下一步 claim F1.7。
- 2026-07-12 · F1.7 已完成，代码提交 `30c66e5`：取消状态即时可见，token 覆盖模型请求与流读取；真实 Copilot 取消时延待用户执行。F1 已全部完成，下一步按计划进入 F2。

---

## 6. Handover Log

- **2026-07-11 · Claude Fable 5（规划者）**：创建本计划。核实过程要点：① `FormatRestrictDate` 在 `collect-outlook-mails.vbs:529` 与 `collect-outlook-meetings.vbs:444` 均以 `\` 拼日期（mail 版还带秒），Outlook Restrict 静默返回 0 → recentHours 空result；meetings 循环无下界守卫 + `pruneMeetingStore`（`meeting-store.ts:71`）剪掉过期已响应会议 → 队列空但 store 有数据。② `FolderScanSummary` 在 `src/` 零引用，采集诊断从未到达 UI。③ 草稿保留依赖 webview `getState` 客户端回填，真机失效，F1.3 改扩展侧持久化。④ `importantSenders` 为 prompt 级模型匹配，无代码匹配——Exchange DN 直接拉低命中，F1.6 从采集源 SMTP 化。⑤ `classification.ts:88` 语义下模型漏返邮件应留 Pending，用户实测消失——F1.2 要求真机复现 + 对账兜底双管齐下。无 dirty state。Next: worker 从 F1.1 开始 claim。

- **2026-07-12 · Codex（F1.1 pre-work checkpoint）**：恢复现场：`git status --short --branch` 干净，branch `v3...origin/v3`；HEAD `4ba7b90`。已通读 08 与 07 协作协议，并重新定位 F1.1 调用链：mail 的 `FormatRestrictDate` 仍含秒（`collect-outlook-mails.vbs:529-543`），recentHours Restrict 在 `315`，且 `FolderScan`/digest 同时展示 inactive 参数（`400`、`988-990`）；`IsSentFolder` 的空 `sentEntryId` 比较在 `444-475`。meetings 的 formatter 现已是目标 `M/D/YYYY H:MM AM|PM`（`444-458`），但 Restrict 前无诊断且 `CollectCalendarItems` 只有上界守卫（`132`、`169`）；将保持两个 formatter 完全一致，不重复改动已满足目标的一侧。边界：仅 F1.1 两个 VBS 与本计划记录；不改 digest/store/schema，不进入 F1.2。开始按 RED/GREEN 最小验证实现。

- **2026-07-12 · Codex（F1.1 completion）**：完成 `040713d`。mail formatter 去秒，与 meetings 的既有目标格式保持字面一致；四个 Restrict 调用均在实际调用前输出 `RestrictFilter`；Calendar 对早于 `rangeStart` 的可读取实例不收；空 `sentEntryId` 直接返回 False；mail digest 头与 `FolderScan` 不再展示 inactive range 参数。验收：双 VBS `--help`/`--sample` 通过，range mode sample 头部断言通过，`npm run compile` 零错误，`npm test` 367/367 通过，`git diff --check` 通过；实现后经 task reviewer 复审，发现的两处遗漏诊断已补齐并复审通过。Manual：**needs user validation on real Outlook**，按 Completion Notes 的三项操作确认 Restrict、Meetings 与 Inbox timeProperty。Known：无本机真实 Outlook/Exchange 可验证 COM 行为。Next：按用户指定顺序 claim F1.2；不进入 F1.3/F1.4 或 R3/R4。

- **2026-07-12 · Codex（F1.2 pre-work checkpoint）**：恢复现场：F1.1 的代码与记录已提交（`040713d`、`89129b0`），工作树干净，branch `v3...origin/v3 [ahead 2]`。重新定位根因链：`app-analysis.ts:188-355` 的每个成功 chunk 直接把模型 `normalized.items` 传给 `mergeAnalysisResults`（`334`），模型漏返或篡改 id 不会被对账；传输/修复失败仅累加 `skippedChunks`、记 `analyze:chunkSkipped` 后继续（`291-325`），返回值只含 `batchSize`（`371`）；`extension.ts:553-605` 的三个邮件分析入口均走该函数，现有 `runWithBusy` 只显示成功 toast。边界：仅在现有批分析结果合并点做送析 id 与返回 id 对账，扩展侧经既有 VS Code warning API 报告缺失/skip 数量，并补 app-analysis 单测；不改 digest/store/schema，不进入 F1.3。

- **2026-07-12 · Codex（F1.2 completion）**：完成 `bd56b6e`。review 首轮发现 skipped chunk 绕过对账的 P0；已在所有非取消 skipped 路径先持久化 exact uncertain fallback，再继续或抛原错误，复审通过。自动验收：`npm run compile` 零错误、`npm test` 370/370 通过、`git diff --check` 通过。Manual：**needs user validation on real Outlook**，重发注入邮件，确认该邮件不会消失且 chunk 失败有 warning。Next：claim F1.3；不进入 F1.4/R3/R4。

- **2026-07-12 · Codex（F1.3 pre-work checkpoint）**：恢复现场：F1.1/F1.2 已提交，工作树干净，branch `v3...origin/v3 [ahead 4]`。重新定位：扩展侧已有 `workingDrafts: Map<string, string>`，但仅由 Generate/Polish/Refine 写入；workbench HTML 的 textarea input 仍只写客户端 `vscode.setState`，`getWorkbenchHtml` 重建时不以 Map 渲染初值，故真机刷新仍丢手写草稿。边界：复用现有 Map，增加节流上报与扩展侧渲染回填；不落 app-data、不改 schema/store，不再修补客户端 getState。

- **2026-07-12 · Codex（F1.3 completion）**：完成 `2ab0299`。首轮 review 发现 500ms debounce 与立即刷新之间的丢失窗口；已加重建前 webview flush 协议，扩展收到全部草稿并写入 Map 后才重设 HTML，复审通过。验收：`npm run compile` 零错误、`npm test` 373/373 通过、`git diff --check` 通过。Manual：**needs user validation on real Outlook**，验证手写/生成草稿刷新和切换隔离。按用户指示暂停，F1.4 未 claim。

- **2026-07-12 · Codex（F1.4 pre-work checkpoint）**：恢复现场：F1.1-F1.3 已提交，工作树干净。重新定位：collector 仅在 failed/partial 时 stdout 输出 `FolderScanSummary`（`collect-outlook-mails.vbs:248`），digest 未写 scan 汇总；`parseDigest` 只解析固定头字段；`pullMailCore` 解析 digest 后即 merge，没有任何诊断 warning。边界：复用 digest 文件通道，新增可选 ScanSummary 解析和 pull 完成 warning；不动 runProcess、store/schema 或其他 step。

- **2026-07-12 · Codex（F1.4 completion）**：完成 `7103500`。collector 写入 ScanSummary，parser 兼容旧 digest 和仅含当前 range 参数的 header，UI warning 点名失败/partial 目录；review 通过。验收：`npm run compile` 零错误、`npm test` 375/375 通过、VBS `--help`/`--sample` 通过、`git diff --check` 通过。Manual：**needs user validation on real Outlook**。Next：claim F1.5。

- **2026-07-12 · Codex（F1.5 pre-work checkpoint）**：恢复现场：F1.1-F1.4 已提交，工作树干净。重新定位：`normalizeMailFolders` 仍将单 Inbox 扩成默认双目录；`selectFolders` 使用 30s runProcess、无 progress，parser 丢弃 default mapping；VBS list mode 当前枚举 store 根。边界：仅 F1.5 的 picker、list protocol、legacy 规则与测试，不改采集/store/schema，不进入 F1.6。

- **2026-07-12 · Codex（F1.5 completion）**：完成 `1706a48`。picker 枚举改 Notification progress + 90s，并在失败时提示先启动 Outlook；VBS 排除 store 根，默认目录仅在 EntryID 匹配的递归枚举项输出映射；TS 解析映射，真实路径与规范名预选互认、去重并规范名写回，单 Inbox 不再自动扩展。首轮 review 发现 mapping 漏用 EntryID，已补齐反向互认测试并复审通过。验收：`npm run compile` 零错误、`npm test` 378/378 通过、VBS `--help`/`--list-folders --sample` 通过、`git diff --check` 通过。Manual：**needs user validation on real Outlook**，验证冷启动进度、邮箱根隐藏、本地化 Sent Items 标记与重复选择去重。Known：无真实 Outlook 验证。Next：claim F1.6；不进入 F1.7/F2 或 R3/R4。

- **2026-07-12 · Codex（F1.6 pre-work checkpoint）**：恢复现场：F1.1-F1.5 已提交，工作树干净；HEAD `43fb809`。重新定位：`BuildMailRecord` 将 `SenderEmailAddress` 原样写入 senderEmail，`SafeTo`/`SafeCc` 直接读取 Outlook 字符串；`ResolveCurrentUser` 与 `IsCurrentUserRecipient` 已有 `AddressEntry.GetExchangeUser.PrimarySmtpAddress` 的安全兜底模式可复用。sidebar、workbench、legacy dashboard 和 thread timeline 仍直接输出完整邮箱值，guide 未说明 importantSenders 的 prompt 级匹配语义。边界：只做 F1.6 的地址 SMTP 化、展示名称/tooltip 与 guide 文案和测试；不改 digest/store/schema，不进入 F1.7/F2 或 R3/R4。

- **2026-07-12 · Codex（F1.6 completion）**：完成 `8323826`。采集端对 `/O=` DN 以 ExchangeUser PrimarySmtpAddress 解析，失败保留原值；To/Cc 由 Recipients 按类型格式化。sidebar/workbench（含 To/Cc、timeline、participants 与 legacy v1）/dashboard 仅显示名称，完整地址保留 tooltip；guide 中英文说明 importantSenders 是 prompt 级模型判断，建议名+邮箱。两轮 review 分别发现 Workbench To/Cc 漏改、无空格分号 fallback 会泄露首个邮箱，均已修复并复审通过。验收：`npm run compile` 零错误、`npm test` 379/379 通过、VBS `--help`/`--sample` 通过、`git diff --check` 通过。Manual：**needs user validation on real Outlook**，Exchange Fetch 后确认无 DN、tooltip 与 importantSenders 邮箱命中。Known：无真实 Exchange 验证。Next：claim F1.7；不进入 F2 或 R3/R4。

- **2026-07-12 · Codex（F1.7 pre-work checkpoint）**：恢复现场：F1.1-F1.6 已提交，工作树干净；HEAD `c536003`。重新定位：`sendPromptToModel` 已把 token 传至 provider，Copilot `sendRequest` 已接收该 token，但 `readResponseText` 的流式读取没有主动检查 token；`runWithBusy` 只在任务结束 finally 清 busy，取消请求期间 UI 继续显示原 kind。边界：仅补取消中的 busy 状态、流读取取消检查和对应测试；不改分析/store/schema，不进入 F2 或 R3/R4。

- **2026-07-12 · Codex（F1.7 completion）**：完成 `30c66e5`。同一 CancellationToken 传入 Copilot `sendRequest` 并在流读取中检查；取消时 busy 立即改为 cancelling，仅更新 Sidebar，不触发 Workbench 重建，任务 resolve 后再查 token 防止误报成功。新增可控 extension cancellation 测试与 provider token/stream 测试，并纳入 `npm test`。两轮 review 分别发现取消刷新会并发重建 Workbench、关键测试未纳入全量清单及取消竞态，均已修复并最终复审通过。验收：`npm run compile` 零错误、`npm test` 384/384 通过、VBS `--help`/`--sample` 通过、`git diff --check` 通过。Manual：**needs user validation on real Outlook/VS Code**，确认取消后 1 秒内显示取消中、无成功 toast、结束后复原。Known：LM API 是否中断飞行请求需真实 Copilot 验证。Next：F1 完成，按计划进入 F2 批；R3/R4 继续锁定。
