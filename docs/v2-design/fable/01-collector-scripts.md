# 采集脚本审查（collect-outlook-mails.vbs / collect-outlook-meetings.vbs）

Reviewer: Claude Fable 5 · 2026-07-06
对象: `scripts/collect-outlook-mails.vbs` (759 行), `scripts/collect-outlook-meetings.vbs` (494 行), `src/extension.ts` 调用侧, `src/lib/digest.ts` 解析侧。

## 总体评价

脚本结构清晰，`Safe*` 系列防御性取值、`FolderScan`/`DigestCap` 诊断输出、UTF-8 `ADODB.Stream` 写文件都是正确决策。主要问题集中在：**扫描策略是 O(全文件夹) 而不是 O(命中窗口)**、**两个输入信号语义错误**、**digest 文本格式存在注入面**。

---

## C-1 recentHours 模式全文件夹线性扫描（高，性能）

`CollectFolderItems`（`collect-outlook-mails.vbs:105-177`）：

- `recentHours` 模式下 `capEnabled = False`，主循环 `For i = 1 To items.Count` **遍历文件夹全部条目**。
- 循环内先按时间属性降序排序（`items.Sort ..., True`），意味着一旦 `sortDate < cutoff`，其后所有条目必然也早于 cutoff——但循环没有 `Exit For`，仍然逐条走完 COM 调用（`items.Item(i)`、`TypeName`、日期取值）。
- 每次命中的条目还会触发 `mail.Body`（`BuildMailRecord`）——这是最贵的 COM 属性（可能触发存储层加载完整 MIME）。

**后果**：一个 5 万封的 Inbox，抓 24 小时窗口（可能只有 30 封）也要 5 万次 COM item 访问。叠加 C-4 的 30 秒硬超时，大邮箱用户 Fetch New 直接必败。这可能也是 handover 里"另一台电脑数量不一致"问题的背景噪声来源之一。

**建议**（按收益排序）：

1. 对 recentHours 用 `Items.Restrict("[ReceivedTime] >= '...'")`——`--older-than-map` 路径已经在用 Restrict（`:120-129`），代码模式现成，改动是对称的。
2. 保底修复：排序已降序，`sortDate < cutoff` 时 `Exit For`（一行）。注意 `IsAcceptableMailDate` 过滤掉的 4501 假日期会排在降序最前，不影响提前退出的正确性。
3. maxItems 模式同理：排序后取前 N，Restrict 不必要但 `Exit For` 已有（`:168`），OK。

这是 handover 里"Fetch New incremental fetch"候选设计（per-folder newest anchor）的**前置**：没有 Restrict，锚点只省下游合并、省不掉上游扫描，增量优化收益极小。

## C-2 `toMe`/`ccMe` 语义错误（高，正确性）

`collect-outlook-mails.vbs:494-504`:

```vbscript
Function IsDirectRecipient(byRef mail)
  IsDirectRecipient = (Len(LCase(SafeTo(mail))) > 0)   ' To 非空 ≠ 我在 To 里
End Function
```

任何有收件人的邮件 `toMe=true`，几乎恒真；`ccMe` 同理（CC 非空即 true）。这两个字段随 digest 进入 `buildBatchDigestMarkdown`，作为 LLM 判定 waitingForMe / mustHandleToday 的直接信号（"是否直接发给我"是 triage 的一级特征）。**当前 LLM 收到的是恒真噪声**——等于 prompt 里写了一个永远为真的字段还声称它有区分度。

**建议**：脚本启动时取一次 `ns.CurrentUser.AddressEntry`（SMTP 地址 + 显示名），对 `mail.Recipients` 按 `Type`（olTo=1 / olCC=2）遍历比对；Exchange 环境注意用 `AddressEntry.GetExchangeUser.PrimarySmtpAddress` 归一化。若成本敏感，退而求其次用 `mail.ReceivedByEntryID` 与 CurrentUser 比对判 toMe。

## C-3 digest markdown 注入面（中高，健壮性 + 安全边界）

- 写侧：`EscapeMarkdownInline` 只替换反引号；`EscapeMarkdownBlock` 只归一化换行（`:690-703`）。正文里若出现独立行 `## Mail: xxx`、`BodyExcerpt:`、`---`，原样落盘。
- 读侧：`parseDigest`（`digest.ts:39-66`）用 `\n## Mail:\s+` 分段、`\nBodyExcerpt:\n` 切正文。

**后果**：一封正文中包含上述标记的邮件（恶意构造，或仅仅是转发了一份别人的 digest / 讨论本项目的邮件）会让解析器把一封邮件拆成多封、伪造 `InternetMessageId` 等头字段，进而污染去重 index、thread 分组与 LLM 输入。这是典型的"不受信任输入 → 自制文本格式 → 解析器"边界问题。

**建议**：digest 换 NDJSON（每邮件一行 `JSON.stringify`），VBS 侧手写一个 60 行的 JSON 字符串转义函数即可（只需处理 `"` `\` 控制字符）；markdown 仅保留给人看的调试输出。若不想动格式，最低限度对正文做行前缀转义（每行前加两个空格，解析时剥离），并对头部字段值过滤换行。

## C-4 30 秒硬超时（高，可用性）

`extension.ts:504,533` — `runProcess("cscript.exe", args, 30000, ...)`。冷启动 Outlook（COM 唤起 outlook.exe）本身可吃掉 5-15 秒；叠加 C-1 的全扫描，30 秒对大邮箱毫无余量。且超时后 digest 文件可能是上一次的旧内容（`WriteTextFile` 是最后一步、原子性尚可），但用户看到的是无差别失败。

**建议**：超时提为配置项（默认 120s）；`FolderScan` 诊断已有，超时报错时把已输出的诊断行带进错误消息，让用户能分辨"Outlook 没起来"vs"文件夹太大"。

## C-5 本地化文件夹名的双重脆弱（中）

1. `ResolveFolder`（`:288-330`）对 `Inbox`/`Sent Items`/`Drafts` 用 `GetDefaultFolder`（语言无关，好），其余名字从 `ns.Folders(root)` 按显示名解析。中文 Outlook 用户配置自定义文件夹没问题，但如果用户按界面所见配了「已发送邮件」，`FolderTimeProperty`（`:187-193`）的 `= "sent items"` 英文比对不命中 → 用 `ReceivedTime` 排序过滤 Sent Items，自发邮件时间语义又错了（这正是 follow-up 5 修过的 bug 换个入口复发）。
2. 任何一个文件夹解析失败 → `Fail` 中止**整次采集**（`:108-110`）。一个改名/删除的文件夹拖死全部邮件拉取。

**建议**：`FolderTimeProperty` 不比对名字，改为比对解析后的 folder 对象是否等于 `ns.GetDefaultFolder(5)`（EntryID 比对）；单文件夹失败降级为 `FolderScan: ...; error=...` 诊断行 + 继续其余文件夹，最后在 stdout 汇总失败清单。

## C-6 会议采集：`IncludeRecurrences` + `Count` 迭代不可靠（中高，疑似 Meetings 队列空的根因）

`collect-outlook-meetings.vbs:120-168`：

```vbscript
items.Sort "[Start]"
items.IncludeRecurrences = True
Set restricted = items.Restrict("[Start] >= '...' AND [Start] < '...'")
For i = 1 To restricted.Count   ' ← 问题所在
```

Sort → IncludeRecurrences → Restrict 的顺序是对的，但 Outlook 对象模型明确：**`IncludeRecurrences = True` 时集合的 `Count` 不可靠**（周期性会议展开是惰性的，`Count` 可能返回 0、错误值甚至 2^31-1）。用 `For i = 1 To restricted.Count` 迭代，`Count` 返回 0 时一个会议都收不到——这与 handover TODO「inspect why meeting invitations/calendar items are not collected」高度吻合，建议作为第一假设去验证。

**建议**：改用 `GetFirst`/`GetNext` 迭代 + 显式终止条件（Start 超出 rangeEnd 即停，集合已按 Start 升序），保留现有 200 条保险丝。`CollectUnrespondedInvites` 用的 `[MessageClass] = 'IPM.Schedule.Meeting.Request'` Restrict 无此问题。

## C-7 小项（低）

- **O(n²) 冒泡排序 + 逐条 `ReDim Preserve`**（`:549-562`, `:680-688`）：50 条无感；一旦 C-1 修复后放开 recentHours 大窗口（如 7 天上千封），二者都会显形。ReDim 可按倍增扩容；排序可在 TS 侧做（digest 解析后本来就要排）。
- **`FormatRestrictDate` 依赖美式日期串**（`:247-261`）：`Month/Day/Year` 拼串在非美式系统区域设置下，JET Restrict 的日期解析行为依赖 Outlook 版本。更稳的做法是 DASL(`@SQL=`) + ISO 格式，或至少在文档中记录该假设。
- **`SafeStoreId` 取自 `mail.Parent.StoreID`**：对搜索文件夹/跨 store 移动过的邮件可能与 EntryID 所属 store 不一致，P2.2 多账户任务落地时建议直接读 `mail.Session` 相关属性核对（现阶段可接受）。
- **每邮件正文截断在 `NormalizeWhitespace` 之后**：先全文归一化再截断，超长正文（如 10MB 粘贴日志的邮件）会先在内存里做多轮 `Replace` 全量字符串拷贝。可先 `Left(body, maxChars * 4)` 粗截再归一化（VBScript 字符串不可变，这一刀对病态邮件收益明显）。
- **进程输出即诊断协议**：`FolderScan`/`DigestCap` 以自由文本回传，extension 侧只存日志不解析。既然已经形成事实协议，建议定义为 `DIAG {json}` 行，extension 解析后可在 UI 呈现"扫描了多少/命中多少"，也为增量拉取铺路。

## 与增量拉取（TODO 候选设计）的关系

Handover 记录的候选设计（per-folder newest anchor + `max(now-recentHours, anchor-overlap)` + 5-10 分钟 overlap + 异常回退全量）方向正确，本审查补充两点：

1. **先做 C-1 的 Restrict**，否则锚点只缩小时间窗、省不掉全文件夹遍历，增量收益不成立。
2. 锚点键必须含 storeId（P2.2 多账户），否则两账户同名 Inbox 的锚点互相污染——`folderAnchors` 现在正是按文件夹名归一化键控的（`mail-store.ts` `normalizeFolderName`），此坑已在。
