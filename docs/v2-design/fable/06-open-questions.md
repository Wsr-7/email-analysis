# 三个开放问题的解答

Reviewer: Claude Fable 5 · 2026-07-07
来源: 用户对首轮审查的追问。

---

## Q1: "0 计数队列"是数据原因还是分类逻辑原因？

**结论：两者都有，而且能逐个队列区分开。** 截图中 9 个零队列不是同一个原因，混在一起看会误判。逐个归因（按确定性排序）：

| 队列 | 归因 | 性质 |
| --- | --- | --- |
| Meetings (0) | 采集脚本 `IncludeRecurrences + Count` 迭代不可靠（01 文档 C-6），会议大概率根本没进 meeting-store | **代码 bug**（第一验证假设） |
| Manual Confirmation (0) | 分级关键词全英文，中文邮件全部 INTERNAL(1) ≤ 默认阈值 2，manual_confirm 永不触发（03 文档 S-1） | **逻辑失效**，与数据无关 |
| Next Actions (0) | 已核实代码：它**只**在手动点"Analyze full thread"后从线程分析的 `actionItems` 同步产生（`extension.ts:606-618`），批量邮件分析不产生。样本只有 1 个线程；若未跑过线程分析或该线程 actionItems 为空 → 必然 0 | **触发路径太窄**（设计问题），大概率不是坏 |
| Important Sender (0) | `importantSenders` 配置默认空 `[]`（没配自然没有）；即使配了，规则顺序也会把急件/风险件截走（03 文档 B-1） | **配置为空 + 结构性架空** |
| Risk / Waiting For Me / Follow-up / Uncertain (0) | 样本约 21 封且 18 封是 Notice——测试数据以通知类为主，这四类没有对应样本属正常统计结果。但注意两个抖动源会让它们即使有样本也判不稳：LLM 不知道今天日期（B-2a）、toMe 恒真（C-2） | **主要是数据**，叠加已知抖动源 |

**所以你的直觉一半对**：Risk/Waiting/Follow-up/Uncertain 的零主要是测试邮件不覆盖；但 Meetings、Manual Confirmation、Important Sender、Next Actions 四个零是结构性的，**再多测试数据也不会变**。

### 怎么系统性验证"分类设定是否合理、判定是否正确"

不要靠再改 prompt 后肉眼看，建一个最小评测集（golden set），让数据回答：

1. **构造评测 digest**：24-32 封邮件，覆盖 8 类 × 中/英 × 若干边界样例（如"上周的请求但我已回复"应为 noActionNeeded 而非 followUp；"周五截止"在周一/周五两个基准日应得不同结果）。可以扩展现有 `--sample` 通道（`WriteSampleDigest` 目前只有 4 封）或直接手工放一个 `data/eval-digest.md`。
2. **期望标签**：旁边放 `eval-expected.json`（mailId → {category, priority 区间}）。
3. **跑真实 Copilot 分析**（评测的是 prompt+模型组合，MockProvider 测不了这个），小脚本比对 `analysis-result.json` 输出混淆矩阵。
4. **每次动 prompt / 类别定义 / 词表都重跑一遍**。历史上多轮"category prompt boundary 收紧"（follow-up 2 等）都没有回归基线，等于盲调。

这一步做完，"9 个队列是否合理"就从观点问题变成测量问题；也顺带回答 B-1（tags 化）改造前后的收益对比。

---

## Q2: 主语言英文 + 全中文邮件，summary/draft 语言怎么定？

先把纠缠在一起的**三个语言维度**拆开，各自答案其实是清晰的：

| 维度 | 应跟随谁 | 理由 |
| --- | --- | --- |
| UI 界面语言 | 用户偏好（你=英文） | 无争议 |
| **分析输出语言**（summary/reason/suggestedAction） | **用户显式选择，默认跟 UI** | 这是"写给你看的关于邮件的话"。你的工作语言是英文，那么英文 summary 是 feature 不是 bug——等于**自带翻译的摘要**，中文邮件不用逐字读就知道说什么。我在 04 文档 U-5 的批评前提是"用户想要中文"，对你的场景应修正为：语言不一致本身不是问题，**不可选择/不可预期才是问题** |
| **草稿语言** | **跟随来信/收件人语言**（auto），与 UI 语言无关 | 草稿是"写给对方看的话"。给中文发件人回英文邮件，草稿拿到手就要重写，价值为负。这是三个维度里唯一有硬性正确答案的 |

**推荐契约（一句话）**：*阅读用你的语言，回复用对方的语言。*

落地设计：

1. 配置拆成两项：`outputLanguage`（现有，默认跟 `env.language`）+ `draftLanguage`（新增，默认 `auto` = 检测来信主体语言；可固定为 en/zh）。
2. `auto` 的检测规则：取线程中**最近一封非本人邮件**的主体语言（CJK 字符占比阈值即可，不需要语言检测库）；混合语言邮件取正文首段。
3. 草稿框旁加一个轻量切换（EN | 中），点击即用另一语言重新生成——你偶尔想用英文回中文邮件（跨国团队常见），这个开关比任何默认值都重要。instruction 输入框天然支持覆盖（"write it in English"）。
4. 该契约一次性写进主 prompt 的 Language Contract 段（02 文档 L-4），同时删除 `reply-draft-prompt.md` 硬编码英文、`prompt-config` 的 `replyDraftInstruction` 英文要求、`ensureEnglishDraftReplies` 与 thread CJK fallback 两个补丁调用——**你现在遇到的"没想好"，一半是因为现状有四处互相矛盾的语言指令，行为不可预期，导致无从形成偏好**。契约收敛后再体验一周，偏好自然浮现。

边界情况：你读中文无障碍但打字慢/公司要求英文留痕 → 把 `draftLanguage` 固定 `en` 即可，这属于个人设定而非产品默认；产品默认必须是 `auto`，因为"回对方语言"对绝大多数场景是礼貌与沟通效率的下界。

---

## Q3: vscode Copilot 多邮件并行分析是否可行？

**API 层面：可行。** `vscode.lm` 的 `sendRequest` 没有并发限制的 API 约束，可以同时发起多个请求各自流式返回；扩展进程侧没有全局锁。真正的约束在三处：

1. **服务端限流**：Copilot 后端对单用户有速率限制，并发过高会收到 429/`LanguageModelError`。经验安全值是**并发 2-3**，且必须配指数退避重试（当前代码连单请求的重试都没有，02 文档 L-5）。
2. **计费模型按"请求次数"而非 token**：Copilot 的 premium requests 按请求计数。把 1 个 50 封的大批拆成 10 个 chunk = 10 次请求配额。所以 chunk 化（L-3）的正确姿势是**chunk 尽量大**（贴着 `model.maxInputTokens` 与输出预算的上限切，而不是固定 5 封一切），并行只是让多个大 chunk 同时跑。可靠性收益（截断不再全损）值这个成本，但要在文档里向用户说清配额影响。
3. **失败隔离与合并**：现有 `mergeAnalysisResults` 天然支持乱序增量合并，这是并行的良好基础。每个 chunk 独立成败、独立 merge、失败独立重试，一个 chunk 挂掉不影响其余。

**推荐实现形态**（在 L-3 chunk 化之上加一层）：

```
chunks = splitByTokenBudget(batch, model.maxInputTokens, perMailOutputReserve)
pool   = 并发上限 2（设置项 easyMail.analysisConcurrency，默认 1=串行）
每 chunk: sendPrompt → parse → merge → 失败则退避重试 1 次 → 再失败记录并跳过
进度: withProgress 显示 "chunk 2/5 (23 mails done)"，cancellable
```

- **默认串行（并发=1）**：对默认 5 封批次并行毫无意义；只有 Analyze All（几十封、多 chunk）才有收益，让用户显式打开。
- **收益量化**：延迟从 Σ(chunk) 变 ~max(chunk)。50 封 ≈ 4 个 chunk × 30s：串行 2 分钟 → 并发 3 约 40-60 秒。
- **两个次生收益**：chunk 化后单 prompt 变小，注入邮件的影响半径从"全批"缩到"本 chunk"（L-6）；单 chunk 输出 JSON 变小，截断概率大幅下降。
- **注意不要并行的地方**：同一线程的"分析+翻译 fallback"是有依赖的串行链（语言契约收敛后该链会被删掉）；批分析与线程分析共用 `runWithBusy` 全局忙锁，放开并行时忙锁语义要改为计数/队列，否则 UI 状态会互相踩。

一句话结论：**可行且值得做，但顺序是 L-3 chunk 化 → L-5 取消/退避 → 再开并发**；跳过前两步直接并发，只会把现在的"偶发整批失败"放大成"并发地整批失败"。
