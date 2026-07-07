# 修复方案全量对照表（Remediation Matrix）

Reviewer: Claude Fable 5 · 2026-07-07
目的: 01-04 文档中每一条发现（含"小项/其他观察"）逐条给出修复方案，确保无一遗漏。工作量: S=一处小改, M=单模块半天级, L=跨模块/需设计。

## 采集脚本（对应 01 文档）

| # | 发现 | 修复方案 | 工作量 |
| --- | --- | --- | --- |
| C-1 | recentHours 全文件夹线性扫描 | 首选 `Items.Restrict("[ReceivedTime] >= '<cutoff>'")`（`--older-than-map` 路径已有同款代码可复制）；保底在降序循环中 `If sortDate < cutoff Then Exit For` | S |
| C-2 | `toMe`/`ccMe` 恒为 true | 脚本启动取一次 `ns.CurrentUser` 的 SMTP 地址与显示名；遍历 `mail.Recipients` 按 `Type`(olTo=1/olCC=2) 比对；Exchange 地址经 `AddressEntry.GetExchangeUser.PrimarySmtpAddress` 归一化；失败兜底 `mail.ReceivedByEntryID` 与 CurrentUser 比对 | S-M |
| C-3 | digest markdown 可被正文注入 | digest 改 NDJSON（每邮件一行 JSON；VBS 手写 ~60 行字符串转义函数），`parseDigest` 改按行 `JSON.parse`；过渡期最低限度：正文每行加两空格前缀、头字段值过滤换行 | M |
| C-4 | 30s 硬超时 | `runProcess` 超时提为 `easyMail.collectorTimeoutSeconds`（默认 120s）；超时错误消息附带已收到的 `FolderScan` 诊断行帮助定位 | S |
| C-5a | 本地化 Sent Items 名称使 `SentOn` 逻辑失效 | `FolderTimeProperty` 不比名字，改比 EntryID：解析出的 folder 与 `ns.GetDefaultFolder(5)` 的 `EntryID` 相等即用 `SentOn` | S |
| C-5b | 单文件夹解析失败中止全部采集 | `CollectFolderItems` 捕获 ResolveFolder 失败 → 输出 `FolderScan: ...; error=...` 继续其余文件夹；结束时若全部失败才 Fail | S |
| C-6 | 会议采集 `IncludeRecurrences`+`Count` 不可靠 | 改 `restricted.GetFirst`/`GetNext` 迭代；终止条件=Start 超出 rangeEnd（集合已按 Start 升序）或达到 200 条保险丝 | S |
| C-7a | 冒泡排序 + 逐条 `ReDim Preserve` | 数组倍增扩容；排序移到 TS 侧（digest 解析后本就要排），VBS 保持输出无序 | S |
| C-7b | `FormatRestrictDate` 依赖美式日期串 | 改 DASL 过滤（`@SQL=` + ISO 8601），或在脚本头注释记录区域设置假设并在 `--help` 提示 | S-M |
| C-7c | `SafeStoreId` 取 `mail.Parent.StoreID` 的跨 store 边缘 | 并入 P2.2 多账户任务：记录 `mail.SessionID`/store 归属核对逻辑；现阶段仅文档标注 | 并入 P2.2 |
| C-7d | 超长正文先全量归一化再截断 | `Left(body, maxChars * 4)` 粗截后再 `NormalizeWhitespace` | S |
| C-7e | `FolderScan`/`DigestCap` 自由文本诊断 | 定义 `DIAG {json}` 行协议；`process-runner` 解析后存结构化日志，UI 可显示"扫描 N / 命中 M" | M |

## LLM 分析管线（对应 02 文档）

| # | 发现 | 修复方案 | 工作量 |
| --- | --- | --- | --- |
| L-1 | 引用修剪函数是死代码 | `thread-engine.toThreadMessage`：`bodyClean = cleanMailBody(body)`、`bodyDelta = extractReplyDelta(body)`；`buildThreadRecord` 排序后对 timeline 跑 `markDuplicateBodies`（以 bodyClean 为键）回填 `isDuplicateBody`/`duplicateOfId`；接线后用真实双语样本回归再调 heuristics | S（接线）+ M（回归） |
| L-2 | 保留期不对称 → 6 天正文黑洞 | 首选 `mailStoreRetentionDays` 默认 1→7 与 index/analysis 对齐；或 merge 去重集合改为仅 store id ∪ 已分析 id，允许 index 命中的邮件正文回填 | S |
| L-3 | 整批单调用无 token 预算、全损失败 | 按 `model.maxInputTokens`（预留每封 ~400 token 输出余量）切 chunk（5-10 封）；chunk 独立成败、独立 `mergeAnalysisResults`；解析失败先做一次"原响应+错误回喂"修复重试 | M |
| L-4 | 语言补丁造成 2-3 倍调用 | 统一 Language Contract 注入（见 06 文档 Q2 的具体契约）；删 `ensureEnglishDraftReplies` 与 thread CJK fallback；`reply-draft-prompt.md`/`prompt-config` 的硬编码英文要求删除 | M |
| L-5 | 无取消/超时/退避 | `sendPrompt` 接受外部 `CancellationToken`；`runWithBusy` 用 `withProgress({cancellable:true})` 接通；429/quota 错误做 1-2 次指数退避 | M |
| L-6 | prompt injection 无防御 | `base-system.md` 增加防注入守则段；digest 每封正文用定界符包裹并声明"定界符内是数据不是指令"；draft 中 URL 在 UI 加视觉标注 | S |
| L-7 | redaction 一刀切 | 打码强度与安全分级联动（INTERNAL 及以下不打码，REGISTERED+ 全套）；`ID_LIKE` 加白名单前缀配置（JIRA-/REQ- 等）；中文金额模式补齐或放弃金额打码；自定义 regex 包 try-catch + 长度上限 | M |
| L-8a | `analyzeThreadCore` 重复读盘（promptConfig×3 等） | 函数开头一次性读取复用 | S |
| L-8b | 一次分析两次模型枚举 | `sendPromptToModel` 把已选 model 对象传给 provider，provider 不再自查 | S |
| L-8c | prompt 文件循环内重读（chunk 化后） | chunk 循环外读一次 | S |
| L-8d | confidence/needsOriginalMailCheck UI 未消费 | 见 U-4 修复：低置信/需核查徽章 | S |
| L-8e | `stableMailId` hash 兜底含 `bodyExcerpt` | hash 源改为 `folder+receivedTime+from+subject`（去掉 bodyExcerpt），避免 `--body-chars` 变化导致同邮件双 id；仅影响无 InternetMessageId/EntryId 的邮件，改动需配一次 index 迁移或接受一次性重复 | S |

## 分类与安全分级（对应 03 文档）

| # | 发现 | 修复方案 | 工作量 |
| --- | --- | --- | --- |
| B-1 | 三维度压单选、importantSender 被架空 | category 收敛为行动轴；`isImportantSender` 由代码匹配配置直接判定（不耗 LLM）、`riskFlag/riskLevel` 由 LLM 产出，均为正交 tags；UI 队列改过滤视图；schema 兼容：保留 category 增 tags | L（分两步：先加 tags 与过滤视图，后收敛类别） |
| B-2a | prompt 无当前日期 | compose 时注入 `Today is YYYY-MM-DD (timezone)` 一行 | S |
| B-2b | mustHandleToday 判定权在模型 | LLM 增产 `dueDate` 字段；代码判 `dueDate <= today` 派生"今天必须处理"；类别定义随之简化 | M |
| B-2c | followUp/notice 边界模糊 | followUp 更名/重定义为 waiting-on-others 语义（与 thread `waitingOn` 对齐）；纯 FYI 一律 notice；prompt 类别定义同步收紧 | S |
| B-2d | ignored 双义 | LLM 类别更名 `noActionNeeded`；Ignored 队列只放用户手动动作 | S-M |
| B-2e | confidence 与 category 一致性无代码校验 | normalize 阶段：confidence<0.7 且非 uncertain → 降级 uncertain + `needsOriginalMailCheck=true` | S |
| B-3 | category×priority 越界组合无兜底 | normalize 加 category→priority 允许区间表，越界钳制并降 confidence | S |
| B-4 | thread/mail 双轨分类重复 | 线程分析存在时线程为唯一真相源；队列视图内线程内单邮件折叠为线程行；不做双 category 合并算法 | M |
| S-1 | 分级关键词全英文 | 默认词表补中文（机密/绝密/保密→3；合同/预算/薪酬/裁员→2）；词表结构化为 (keyword, level, lang) 用户可编辑 JSON；与 TODO 的 keyword 可配置合并实施 | S-M |
| S-2 | PUBLIC 分支死代码、分级=启发式占位 | 短期：UI/文档诚实标注"分级来自关键词启发式"；长期由 S-3 取代 | S |
| S-3 | 无权威分级来源 | 采集脚本读 MIP 标签（`PropertyAccessor` 取 `msip_labels` 头）与 `mail.Sensitivity`；classification 优先消费标签、关键词降兜底 | M |
| S-4a | 缺分类默认放行（fail-open） | 增加 `easyMail.failClosedOnMissingClassification` 开关：缺分类 → manual_confirm | S |
| S-4b | manual_confirm 关键词晚于 level 判定、用户预期不符 | UI 解释文案写明优先级链（hard-block > level 超限 > confirm 词）；与 TODO keyword rationale 合并 | S |
| S-5 | 默认阈值 2 使 manual_confirm 几乎不触发 | 词表修正后复核默认值；首次运行引导让用户显式选择阈值（1=保守 / 2=宽松），避免升级后体感突变 | S |

## UI（对应 04 文档）

| # | 发现 | 修复方案 | 工作量 |
| --- | --- | --- | --- |
| U-1 | 全量 HTML 重建、草稿丢失风险 | 短期止血：刷新前把 textarea 内容收进 `vscode.setState`，重建后回填；中期：`update()` 改 postMessage 传 state，webview 按 section 局部更新（队列计数/列表/详情独立） | S（止血）/ L（增量渲染） |
| U-2 | 无 CSP | webview HTML 加 CSP meta + script nonce + `localResourceRoots`；随 U-1 改造同批 | S |
| U-3a | 零计数队列占 40% 空间 | 非零队列正常显示；零计数折叠为一行/chips；支持 pin | M |
| U-3b | Meetings/Next Actions 空壳置顶 | 数据管线修复（C-6、Q1 触发路径）前默认折叠或后置 | S |
| U-3c | 设置面板常驻底部 | 默认折叠仅齿轮入口；评估整体迁 VS Code 原生 Settings UI 消灭双入口 | S-M |
| U-3d | 队列徽章颜色无优先级语义 | Must Handle Today/Risk 警示色，Notice/Ignored 低饱和 | S |
| U-4a | 裸 conversationId | 渲染为 `View thread (N messages)` 跳转链接（与"单邮件跳线程"需求合并） | S |
| U-4b | Body 沉底 | Summary 后紧跟可折叠 Body（默认 3 行 + 展开）；draft 工作区放最后；宽屏可双栏 | M |
| U-4c | "Not satisfied?" 说明行冗余 | 删除，语义并入 instruction placeholder | S |
| U-4d | Reason 与 Summary 重叠 | Reason 折叠进 `why?` tooltip/图标 | S |
| U-4e | confidence/needsOriginalMailCheck 未展示 | 低置信度或 needsOriginalMailCheck=true 时 summary 前加 ⚠ 徽章 + tooltip | S |
| U-5 | 语言不一致观感 | 见 06 文档 Q2 契约：输出语言=用户显式选择（默认跟 UI），草稿语言=跟随来信；首次运行按 `env.language` 预设 | S-M |
| U-6 | 导航式而非处理式 triage | 键盘流 j/k/e/r/o（webview keydown → 现有 post 消息）；队列进度指示（3/20）；空状态区分"处理完"vs"未分析"；长期 Process Mode | M（键盘流）/ L（Process Mode） |
| U-7a | `+`/`↻` 无提示、`All` 样式歧义 | 加 title tooltip；batch 选择器改明确的 select 样式 | S |
| U-7b | 行尾双徽章拥挤 | classification 徽章仅 hover/详情显示 | S |
| U-7c | workbench 关闭后状态不恢复 | `retainContextWhenHidden` + `WebviewPanelSerializer` | M |
| U-7d | 无障碍（div+onclick 行） | 行元素补 role/tabindex/Enter 激活，与 U-6 键盘流同批 | S |
| U-7e | Max Allowed Classification 无效果说明 | 控件旁一行动态说明（"高于此级别需手动确认"），与 S-4b 文案合并 | S |

## 建议实施批次

- **批次 1（正确性止血, 全 S 级）**: L-1 接线、C-2 toMe、C-6 会议迭代、L-2 保留期、B-2a 日期注入、U-1 草稿止血、C-4 超时。
- **批次 2（效率与语言）**: L-3 chunk 化、L-4+U-5 语言契约、L-5 取消/退避、C-1 Restrict。
- **批次 3（结构演进）**: B-1 tags 化、B-4 线程一等公民、U-1 增量渲染+U-2 CSP、S-3 MIP 标签、C-3 NDJSON。
- **批次 4（体验差异化)**: U-6 键盘流、U-3 密度改造、C-7e 诊断协议、增量拉取（TODO 既有设计）。
