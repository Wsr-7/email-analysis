# 分类体系与判定逻辑审查（LLM 业务分类 & 安全分级）

Reviewer: Claude Fable 5 · 2026-07-06
对象: `prompts/analysis-prompt.md`, `prompts/prompt-config.default.json`, `src/lib/classification.ts`, `security-gate.ts`, `config-utils.ts`（阈值解析）。

本项目有两套彼此独立的"分类"，审查也分两层：

- **业务分类**（LLM 产出）：importantSender / mustHandleToday / risk / waitingForMe / followUp / notice / ignored / uncertain + P0-P3。
- **安全分级**（本地关键词）：PUBLIC(0) / INTERNAL(1) / REGISTERED(2) / HIGH REGISTERED(3)，驱动 allow / manual_confirm / block 安全门。

---

## 第一部分：业务分类体系

### B-1 三个正交维度被压进单选分类（结构性问题）

现有 8 类实际上混合了不同性质的维度：

| 维度 | 类别 |
| --- | --- |
| **我需要做什么/多急**（行动轴） | mustHandleToday, waitingForMe, followUp, notice, ignored |
| **谁发来的**（来源轴） | importantSender |
| **有什么后果**（性质轴） | risk |
| **判不准**（元状态） | uncertain |

单选 + first-match 顺序（mustHandleToday > risk > importantSender > ...）的必然推论：

1. **importantSender 队列被架空**：重要发件人发来的邮件只要"今天要处理"或"有风险"就被前两条规则截走，留在 importantSender 队列里的只剩"重要的人发的不重要的事"。用户配置重要发件人的心智是"这个人的**所有**邮件我都要看见"，队列语义与心智直接冲突。截图佐证：importantSender 计数 0。
2. **risk 与行动轴互斥**：一封"今天必须处理的风险邮件"只能进 mustHandleToday，风险属性丢失，risk 队列漏报。
3. 这也是 thread/mail 重复分类问题（TODO 已录 dedupe）之外，另一个"同一封邮件用户找不到"的来源。

**建议**：category 收敛为纯行动轴（下述 B-2），importantSender 与 risk 改为**正交布尔标签**（`isImportantSender` 由代码直接匹配配置即可判定，根本不需要消耗 LLM；`riskFlag` + `riskLevel` 由 LLM 产出）。UI 队列变为"按标签过滤的视图"，一封邮件可同时出现在 Must Handle Today 与 Important Sender 视图——计数语义从"分桶"变"过滤"，用户心智自然。schema 兼容策略：保留 category 字段不变，新增 tags 字段，UI 先消费 tags，一个版本后再考虑收敛类别。

### B-2 行动轴本身的边界问题

- **waitingForMe vs mustHandleToday**：区别仅是"是否今天到期"。但 prompt **没有告诉模型今天是几号**——`analysis-prompt.md` 全文无日期注入，模型只能从 digest 头的 `GeneratedAt` 推断（藏在数据里，非指令）。"reply by Friday" 是否今天到期完全靠猜。**建议：compose 时注入 `Today is 2026-07-06 (Asia/Shanghai)` 一行**，并让 LLM 额外输出结构化 `dueDate` 字段，由代码判定"是否今天"——日期比较是代码的强项、模型的弱项，判定权应该在代码侧。这样 mustHandleToday 甚至可以退化为 `waitingForMe && dueDate <= today` 的派生视图，边界从"模型措辞理解"变成"确定性规则"。
- **followUp vs notice**：「useful information that may need tracking later」和「informational only」的分界主观性强，是 uncertain 之外最容易抖动的边界。followUp 的真实语义更接近"waiting on others / 我在等别人"——建议直接更名为该语义（这也与 thread 分析的 `waitingOn` 字段对齐），纯 FYI 一律 notice。
- **ignored 双义**（用户已反馈过困惑）：LLM 判定的 ignored 与用户手动 ignore 落在同一个队列语义里。"我没忽略它，它为什么在 Ignored？"。建议 LLM 类别更名 `noActionNeeded`（或并入 notice + P3），Ignored 队列只放用户手动动作的结果。
- **uncertain + needsOriginalMailCheck 是好设计**，保留；但注意 `confidence < 0.7 → uncertain` 的约定目前只在 prompt 里，代码不校验一致性（模型给了 0.5 + mustHandleToday 也照收）。可在 normalize 阶段做一次降级规则。

### B-3 priority 与 category 半冗余

`priorityHint` 已自证相关性（mustHandleToday→P0/P1, notice→P3）。保留双字段没问题（priority 用于队列内排序），但 UI 不必双徽章同显（见 04 文档）；且 prompt 中 P0 定义「act within hours」与 mustHandleToday「action today」高度重叠，模型偶发给出 notice+P0 之类组合时无代码兜底。建议 normalize 时加一张 category→允许 priority 区间表，越界即钳制并降 confidence。

### B-4 thread 与 mail 双轨分类的去重策略（TODO 已录，给出建议）

同一线程的多封入站邮件各自带 category，线程分析又给出线程级 category。建议原则：**线程分析存在时，线程为唯一真相源**——线程内单邮件在队列视图折叠为线程行（badge 显示"3 封"），单邮件 category 仅在无线程分析时兜底。避免设计"两个 category 的合并算法"，那是把复杂度花在错误的层。

---

## 第二部分：安全分级与安全门

### S-1 关键词全英文 → 中文环境分级失效（高）

`classification.ts:60-74`：

- HIGH REGISTERED 触发词：`high registered / highly restricted / secret`
- REGISTERED 触发词：`registered / restricted / confidential / contract / budget`
- 全部英文。中文邮件（机密、绝密、保密、合同、预算、内部资料）**零命中**。

后果：中文邮件几乎全部落入 INTERNAL(1) 兜底（`from` 含 `@` 恒真），而默认放行阈值 `autoAnalyzeMaxClassificationLevel: 2` ⇒ **中文环境下所有邮件无条件自动送 Copilot**，manual_confirm 永不触发。截图佐证：涉及采购预算审批的邮件 = INTERNAL(1) 直接分析。对一个把「安全分级 + 安全门」作为核心卖点的工具，这不是词表不全，是该功能对主要用户群不存在。

反向不对称：英文邮件提到 "budget"/"contract"（日常高频词）反而升 REGISTERED(2)——若用户把阈值调到 1，英文日常邮件大面积误拦、中文敏感邮件全放行，行为完全不可解释。

**建议**：① 默认词表补中文（机密/绝密/保密→3；合同/预算/薪酬/裁员→2 等），与 TODO 中「configurable keywords + 用户可见解释」合并实施；② 词表按 (keyword, level, lang) 结构化进 prompt-config 同级的用户可编辑 JSON，而非散在代码常量。

### S-2 兜底逻辑名存实亡（中）

`classifyMail` 的 INTERNAL 条件 `mail.from.includes("@") || folder.includes("inbox")` 几乎恒真，PUBLIC 分支是死分支。整个函数的真实行为 = "命中关键词给 2/3，否则一律 1"。这本身作为占位实现可接受，但应在用户文档/UI 中诚实呈现"分级 = 关键词启发式"，避免用户высок估其保障强度（UI 已显示 reason，好）。

### S-3 权威分级来源：读 MIP/AIP 敏感度标签（高价值方向）

企业 Outlook 的真实分级不在正文关键词里，而在 **Microsoft Information Protection 敏感度标签**（邮件头 `msip_labels`，可经 `PropertyAccessor.GetProperty` 读取），以及 `mail.Sensitivity` 属性（Normal/Personal/Private/Confidential）。采集脚本增加两个字段、classification 优先消费标签、关键词降级为无标签时的兜底——分级从"猜"变"读"，这是安全门从 demo 走向可信的关键一步，建议排入 backlog 并在 P2.2 多账户之前(两者都动采集脚本，可同批)。

### S-4 安全门判定链本身（评价：结构正确）

`security-gate.ts` 的 hard-block keyword > level>maxManual → block > level>maxAuto → manual_confirm > manual-confirm keyword 的优先级清晰，thread 级取消息最高级、blocked 消息从 timeline 剔除并标记 partialContext 的设计正确；`canAnalyzeMail` 的 explicitSelection 放行 manual_confirm 且永不放行 block，与 P0.2 的 UI 行为一致。两个小点：

- `defaultClassification` 缺省 INTERNAL(1)：缺分类时**默认放行**（1 ≤ maxAuto 2）。fail-open 对本地工具可辩护，但与"安全门"的直觉相反，建议在设置里给一个 fail-closed 开关（缺分类 → manual_confirm）。
- manual_confirm 关键词在 level 判定**之后**才检查（`:104`），即"低密级但命中确认词"才会走到；顺序合理但与用户对"关键词必拦"的预期可能不符，UI 解释文案值得写明（TODO 中 keyword rationale 一项相合）。

### S-5 阈值语义提醒

`autoAnalyzeMaxClassificationLevel` 默认 2（REGISTERED 可自动分析）。结合 S-1（英文 budget/contract → 2），默认配置下连英文敏感词命中的邮件也自动放行，manual_confirm 实际只对 HIGH REGISTERED(3) 生效。若产品意图是"REGISTERED 需人工确认"，默认值应为 1；若意图就是宽松默认，建议在首次运行引导里让用户显式选择。词表修正（S-1）后必须连带复核该默认值，否则中文词表上线瞬间大量邮件转 manual_confirm，用户体感是"升级后全卡住"。

---

## 汇总：判定逻辑的目标形态

```
采集(读 MIP 标签/Sensitivity) ──► 分级 = 标签优先, 关键词(双语,可配)兜底
                                        │
                            安全门(allow / confirm / block, 可选 fail-closed)
                                        │
LLM 只判行动轴 category + dueDate + riskFlag/level + confidence
                                        │
代码侧: isImportantSender 匹配、dueDate→今天判定、category×priority 一致性钳制
                                        │
UI: 队列 = 标签/状态过滤视图, 线程为一等公民, 单邮件折叠
```

LLM 做擅长的（语义理解、摘要、风险识别），代码做擅长的（日期比较、名单匹配、一致性约束）——当前多处让 LLM 承担代码级判定（today、important sender），是分类质量抖动的深层原因。
