# Fable 架构审查总览（First-Principles Review）

Reviewer: Claude Fable 5
Date: 2026-07-06
Scope: 全仓库现状代码（branch `v3`, HEAD `ae8de10`），以代码为准；`CLAUDE.md` 与部分 handover 描述已过时之处以本文为准。
参照材料: `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`（Handover 2026-07-06）、`docs/v2-design/UI_NOW_2026-07-06-latest.png`。

## 文档索引

| 文件 | 主题 |
| --- | --- |
| [01-collector-scripts.md](01-collector-scripts.md) | VBS 采集脚本逻辑与性能 |
| [02-llm-analysis-pipeline.md](02-llm-analysis-pipeline.md) | Copilot 分析管线的性能、效率与健壮性 |
| [03-category-and-classification.md](03-category-and-classification.md) | 邮件分类体系合理性 + 判定逻辑（LLM 分类 & 安全分级两层） |
| [04-ui-review.md](04-ui-review.md) | 插件 UI/布局评价与建议 |
| [05-remediation-matrix.md](05-remediation-matrix.md) | 全部发现的修复方案对照表（逐条、含工作量与实施批次） |
| [06-open-questions.md](06-open-questions.md) | 三个开放问题解答：零计数队列归因 / 语言契约 / Copilot 并行分析 |
| [07-execution-plan-remediation.md](07-execution-plan-remediation.md) | **执行计划**（worker source of truth）：R1-R4 里程碑、逐 step 验收标准、协作规则、Handover Log |

## 第一性原理：这个产品的本质约束

Easy Mail 的价值主张 = **用最少的用户时间完成邮件 triage**。一切设计应回答三个问题：

1. **输入是否可信且完整？** —— 采集层决定 LLM 看到什么。输入信号错了，再好的 prompt 也白搭。
2. **每个 LLM token 是否花在刀刃上？** —— Copilot 有配额与上下文上限，重复内容、二次翻译、整批重试都是纯浪费。
3. **用户每次交互是否比打开 Outlook 更快？** —— UI 的唯一评判标准。

本次审查发现的最大共性问题是：**多个已修复的 bug 其实是同一批根因的症状**（引用链未修剪、toMe 信号错误、语言契约缺失），而修补都发生在下游（prompt 打补丁、二次翻译、UI 兜底），根因在上游未动。

## Top 风险与优化点汇总（按 影响×确定性 排序）

| # | 发现 | 严重度 | 状态 | 详见 |
| --- | --- | --- | --- | --- |
| 1 | **`extractReplyDelta`/`markDuplicateBodies` 是死代码**：生产路径从未调用，thread prompt 的 `bodyDelta` 就是完整原文。这是"线程引用修剪失败"和 thread token 爆炸的直接根因——历次对 `thread-timeline.ts` 的修剪规则修复全部无效，因为函数根本没被接线 | 高 | **新发现（根因）** | 02 |
| 2 | **`toMe`/`ccMe` 信号恒为 true**：VBS 里只判断 To/CC 字段非空，不判断"是否包含我"。LLM 每封邮件都收到 `ToMe: true`，直接污染 waitingForMe/mustHandleToday 判定 | 高 | **新发现** | 01 |
| 3 | **安全分级关键词全英文**：中文邮件（机密/保密/合同/预算）永远不命中，一律 INTERNAL(1)，低于默认放行阈值(2)全部自动送 LLM。对中文用户，安全门形同虚设 | 高 | 部分已知（keyword 可配置在 TODO），中文失效是新结论 | 03 |
| 4 | **保留期不对称造成 6 天数据黑洞**：mail store 保留 1 天、去重 index 保留 7 天，且 merge 用 index 去重。拉过的邮件 1 天后正文被裁掉，之后 6 天内重新 Fetch 会被 index 拦截、无法恢复正文 | 高 | **新发现**（"body 丢失"症状已知，机制未被指出） | 02 |
| 5 | **整批单次 LLM 调用无 token 预算**：Analyze All 把全部邮件塞进一个 prompt、要求一个大 JSON 输出；无 `maxInputTokens` 检查、输出截断即整批作废 | 高 | **新发现** | 02 |
| 6 | **recentHours 模式全文件夹线性扫描 + 30s 硬超时**：不用 `Items.Restrict`、排序后也不提前退出，5 万封的收件箱每次 Fetch New 全量遍历，撞 30s 超时即整次失败 | 高 | 部分已知（增量拉取在 TODO），全扫描+超时组合是新结论 | 01 |
| 7 | **digest markdown 可被邮件正文注入**：正文只转义反引号，含 `\n## Mail:` / `\nBodyExcerpt:` 的邮件会让 `parseDigest` 错乱、可伪造邮件记录；同时邮件正文直接进 prompt 且无 injection 防御声明 | 中高 | **新发现** | 01/02 |
| 8 | **会议采集用 `IncludeRecurrences + Count` 迭代**：Outlook 官方文档明确此组合下 `Count` 不可靠，极可能就是"Meetings 队列收不到会议"的根因 | 中高 | TODO 待查项，本文给出根因假设 | 01 |
| 9 | **webview 全量 HTML 重建**：任何后台刷新都替换整个 `webview.html`，丢滚动位置；用户正在手写草稿时若触发刷新，草稿有丢失风险 | 中 | **新发现** | 04 |
| 10 | **语言契约缺失是产品级问题**：中文来信 + 强制英文草稿 + 英文 summary；且靠"检测到 CJK 再追加一次翻译调用"打补丁，每批最多 2-3 倍 LLM 调用 | 中 | 已知（TODO），本文给出统一契约方案 | 02/03 |
| 11 | **LLM 不知道"今天"是几号**：prompt 未注入当前日期，mustHandleToday("今天必须处理")的判定基准日靠模型从 digest 的 GeneratedAt 猜 | 中 | **新发现** | 03 |
| 12 | 分类体系把"紧急度/来源/性质"三个正交维度压进单选分类，importantSender 队列被规则顺序架空 | 中 | 新分析（dedupe 症状已知） | 03 |
| 13 | LLM 请求无取消、无超时、无 429 退避重试；`CancellationTokenSource` 创建即弃 | 中 | **新发现** | 02 |
| 14 | webview 无 CSP，仅靠 escapeHtml 单层防御 | 中 | **新发现** | 04 |
| 15 | Redaction 一刀切：工单号（`JIRA-1234` 命中 ID 模式）被打码伤分析质量；中文金额（45万元）却不打码——保护与可用性两头不占 | 低中 | **新发现** | 02 |

## 修复优先级建议（如果只做五件事）

1. **接线 `extractReplyDelta` + `markDuplicateBodies`**（#1）：一处改动（`thread-engine.toThreadMessage`），立刻解决 thread token 爆炸与引用重复，历史上所有修剪规则投入立即生效。
2. **修 `toMe`/`ccMe`**（#2）：VBS 里用 `ns.CurrentUser` / `mail.ReceivedByEntryID` 比对，采集侧一处改动，全链路分类质量受益。
3. **`Items.Restrict` 按时间过滤 + 超时可配**（#6）：大邮箱从"不可用"变"可用"，也是增量拉取（TODO 已录）的前置。
4. **统一语言契约**（#10）：一条规则——分析字段跟随 `outputLanguage`，草稿跟随来信语言（或显式配置），写死进主 prompt，删掉全部 CJK 检测补丁调用。
5. **分批 + token 预算**（#5）：按 `model.maxInputTokens` 切 chunk，每 chunk 独立成败，Analyze All 不再有整批全损模式。

## 与现有 TODO（Handover 2026-07-06）的映射

- 本审查**佐证并给出根因**的已知项：thread body trimming（→死代码 #1）、Meetings 不采集（→#8）、语言一致性（→#10）、增量拉取（→#6 是前置）、category dedupe（→#12）。
- 本审查**新增**且现有 TODO 未覆盖的项：#2、#4、#5、#7、#9、#11、#13、#14、#15。
- 现有 TODO 中本审查认为**可降级**的项：folder picker（有价值但收益低于上表任何一项）；advanced timeline rail（P2 定位正确，建议在 #9 增量渲染改造之后做，否则滚动锚点会被全量重建反复摧毁）。
