# 10 · R3 执行计划（G 批次，2026-07-14）

> 来源：`09-r3-design-decisions.md` §7 用户拍板结果（M0 + D1-D6 + G7）。**本文件自包含，是 worker 的唯一执行依据，无需阅读 07/08/09 等历史文档。**

状态标记：`[ ]` 未开始 · `[~]` 进行中（已 claim）· `[x]` 完成（含 commit hash）· `[!]` 阻塞/需用户决策

## 0. Worker 协议（自包含，完整规则）

1. **一次只 claim 一个 step**（S 级小项允许多个合并 claim，但 Completion Notes 必须分项写）。claim 时把该 step 标记为 `[~]` 并在 §4 Handover Log 写 pre-work checkpoint。
2. **Pre-work checkpoint 内容**：`git status --short --branch` 必须干净并记录 HEAD；用 grep 重新定位 step 中的文件/行号锚点（可能已漂移）并确认"现状锚点"描述仍成立；写明本 step 边界（做什么、不做什么、不进入哪些 step）。
3. **实现纪律**：严格按 step 的"做法"执行，不越界顺手修别的问题——发现新问题写进 Handover 的风险上报，由规划者决定；不改 digest 文件格式（G4 的 schema 变更仅限分析输出 JSON）；不引入新 npm 依赖；不做 09 §4 C 组已否决项；R4 保持锁定。
4. **验收硬门槛**：`npm run compile` 零错误；`npm test` 全绿；涉及 VBS 时 `cscript //nologo scripts/<file>.vbs --help` 与 `--sample` 不回归；`git diff --check` 通过。UI/真机行为无法本地验证的，在 Completion Notes 标注 **needs user validation** 并写清用户操作步骤。
5. **完成记录**：step 改 `[x]`（附 commit hash）；Completion Notes 按固定结构写：改动文件 / 实现边界 / 验收结果 / Manual validation / Known issues / Commit；更新 §3 Current Snapshot 一行摘要；在 §4 Handover Log 追加完成条目（Action / Validated / Manual / Next）。
6. **Git 纪律**：本地 commit 不 push（push 由规划者统一执行）；commit message 末尾加 `Generated with AI`；不用 `--no-verify`；结束前工作树必须干净、文档与代码状态一致。
7. **语言**：文档记录与对话用中文（代码/技术术语除外）。

## 0.1 通用背景速查（避免翻历史文档）

- 构建与测试：`npm run compile`（清 out/ 后 tsc）、`npm test`（compile + node --test 全量）、单文件 `node --test out/test/<module>.test.js`。
- 关键既有机制：分析按 chunk 切分且每 chunk 独立合并落盘（含漏返/孤儿对账兜底）；chunk 完成后有 sidebar 刷新回调；取消走 CancellationToken + cancelling 状态反馈；草稿状态由扩展侧 `workingDrafts` Map 持久化（空文本仅在已有条目时写入）；sidebar Pending 队列已有按 folder 折叠分组的实现可参考（`sidebar-render.ts` 的 `renderPendingFolderGroups` + webview state 记忆展开态）。
- 打包：`npm run package:vsix`（Details 用 `docs/marketplace-details.md`，与 README 解耦）。
- **新增 VS Code 设置的三件套模式**（G1/G3 都会用到，参照既有 `ignoredSenders` 的实现）：① `package.json` contributes.configuration 注册（带 default 与 description）；② `default-config.json` 加同名默认值；③ `extension.ts` `readConfig` 里 `settings.get("<key>", defaults.<key>)` 读取。三处缺一不可。

---

## 1. Milestone G — R3 批次（按建议顺序排列，互相独立可并行 claim；G1 最大，建议单独一人做）

### [ ] G1 分析提速：chunk 并行度 2 + draftGeneration 开关（D1，M 级，最高优先）

- **现状锚点**：`app-analysis.ts` `analyzeBatchCore` 的 chunk for 循环串行 await（~L300-410）；每 chunk `mergeAndPersist` 独立落盘 + F1.2 对账 + F5.4 chunk 完成后 sidebar 刷新回调；取消检查在循环头；进度回调 `ctx.progress`。
- **做法**：
  1. **并行度 2 的受控并发**：实现简单的并发池（同时最多 2 个 chunk 在飞，完成一个补位一个——不是分批 barrier）。`mergeAndPersist` 与 `merged` 累积变量存在共享写：用一个串行化点（如 async 队列/互斥 promise 链）保证合并与写盘按完成顺序逐个执行，不并发写文件。对账、omitted 兜底、orphan 丢弃逻辑不变（本就按 chunk 独立）。
  2. **取消语义**：取消后不再启动新 chunk，已在飞的等它们返回（沿用 F1.7 的 cancelling 反馈）；退避重试沿用现有 `isRetryableLlmError` 路径，不做全局限流器。
  3. **进度文案适配并发**：改为"已完成 x/N chunk（约剩 X 分钟）"（完成计数制，替代"正在分析第 i 个"的串行叙事）；预估 = 平均耗时 × 剩余 / 并行度。
  4. **并行度常量** `ANALYSIS_CHUNK_CONCURRENCY = 2`（常量即可，不做设置项——用户只拍板了 2）。
  5. **单 chunk 失败隔离在并发下保持**：现串行版单 chunk 失败走 `persistSkippedChunk` 后 continue——并发版每个 chunk 任务自带 catch 走同一路径，一个 chunk 失败/重试不得中断或拖垮其他在飞 chunk。
  6. **draftGeneration 设置**（按 §0.1 三件套注册）：`easyMail.draftGeneration`（enum `"auto"|"onDemand"`，默认 `"auto"`，description 说明 onDemand 显著提速但草稿需手动点 Generate）。`onDemand` 时：分析 prompt 中的 reply-draft 指令替换为"所有 draftReply 输出空串、省略 draftReplyParts"（改 prompt 组装层，不改 output schema），workbench 对空草稿已有 Generate Draft 按钮路径无需改动。**确认项**：`applyReplyTemplateToAnalysis` 对空 draftReply/缺失 draftReplyParts 是 no-op（应当已是，写单测锁定）。
- **验收**：单测——并发池按序合并（模拟乱序完成）、单 chunk 失败不影响其他 chunk、取消不启新 chunk、onDemand 时 prompt 含空草稿指令且 auto 不含、空 parts 模板 no-op；`npm test` 全绿。**needs user validation**：20 封分析耗时明显下降（预期约减半）；onDemand 模式再快且 Generate Draft 可用；进度文案正常。
- **边界**：不改 chunk 划分逻辑与 token 预算；不做并行度设置项；不动线程分析（单请求无并发需求）。

### [ ] G2 会议队列重定位为"会议邀请"（D2，S-M 级）

- **现状锚点**：`sidebar-render.ts` meetings 队列（未响应排前 + 倒序，F5.2/F6.3 已修好详情与按钮）；labels 在 `dashboard-labels.ts`（`meetings.title` 等）。
- **做法**：
  1. 队列改名：`会议邀请 / Meeting Invites`（labels 中英文，queue id `meetings` 不改）。
  2. 两级展示：`notResponded` 邀请为主体直接平铺（现排序规则保留）；其余（accepted/tentative/organizer 的未来会议）收进一个可折叠次级分组（组头如 `已接受的日程 (N) / Accepted schedule (N)`，默认收起，展开状态存 webview state——复用 F3.4 pending 分组的实现模式）。
  3. 队列计数徽标只计未响应数（次级分组数量在组头体现），避免"看着有 5 条其实只有 1 条要处理"的误导。
  4. **不做**插件内 Accept/Decline（09 §7 已定：违背"绝不自动发送"红线），响应动作保持 Open in Outlook。
- **验收**：渲染单测（两级分组、计数、折叠态）；`npm test` 全绿。**needs user validation**：邀请置顶平铺、已接受折叠、徽标计数只含未响应。
- **边界**：采集脚本与 meeting store 不动；详情/按钮不动。

### [ ] G3 安全词表配置化一期（D3，S-M 级）

- **现状锚点**：`config-utils.ts` `buildSecuritySettings`（~L167-176）硬编码 `hardBlockKeywords`（F6.5 已扩为中英文 17 词）与 `manualConfirmKeywords: []`；`classification.ts` `ensureClassifications` 的分级关键词硬编码（~L62-68：3 级词表与 2 级词表）。
- **做法**：
  1. 注册三个 settings（默认值 = 当前硬编码值，语义不变：子串匹配、大小写不敏感）：
     - `easyMail.hardBlockKeywords`（string array，默认 = F6.5 的 17 词）；
     - `easyMail.manualConfirmKeywords`（string array，默认 `[]`）；
     - `easyMail.classificationKeywords`（object：`{"3": [...], "2": [...]}` 或两个平级 array 设置——worker 取 VS Code Settings UI 可编辑性更好的形态，Notes 说明取舍），默认 = 现 3 级/2 级词表。
  2. `buildSecuritySettings` 与 `ensureClassifications` 改从 config 读取（按 §0.1 三件套注册），缺失/非法回落默认值；空数组 = 用户显式关闭该层（允许，description 写明后果）。
  3. **分类缓存失效（关键，漏做则验收必失败）**：classification cache 是持久化的（`readClassificationCache`/`writeClassificationCache`），`ensureClassifications` 只为缺失的 mailId 生成分类——**词表变更后已分类邮件不会重算**。做法：cache 元数据存一份当前分级词表的 hash，`ensureClassifications` 发现 hash 与本次词表不一致时**全量重算**（分类是纯本地关键词匹配，重算成本可忽略）并更新 hash。注意 security gate 的 hardBlock/manualConfirm 是每次实时计算不走缓存，只有分级词表需要此机制。
  4. Settings description 写清匹配语义与默认值含义；`package.json` order 放入安全组。
- **验收**：单测——自定义词表生效、空数组关闭、非法值回落、**词表变更触发缓存全量重算**；`npm test` 全绿。**needs user validation**：Settings 改词表后，已拉取邮件的分级与 hard block 行为都随之变化（无需重新 Fetch）。
- **边界**：不做正则模式、不做 MIP（二期已搁置）；分级级别名与数量（0-3 四级）不动。

### [ ] G4 dueDate 结构化（D4，S-M 级）

- **现状锚点**：`analysis-schema.ts` `AnalysisItem`/normalize；`prompts/output-schema.md` 字段清单；**分类内条目顺序来自 `dashboard-state.ts`（`compareItems` 全局排序后分桶），不是 sidebar-render**；行渲染在 `sidebar-render.ts` `renderCompactAnalysisRow`；workbench 详情 `renderAnalysisDetail`。
- **做法**：
  1. output schema 增加可选 `dueDate`（格式 `YYYY-MM-DD` 或空串；prompt 指示：仅当邮件明确含期限时输出，不确定就留空）。同步补 `AnalysisItem` 类型与 F1.2 的 `omittedAnalysisItems` 兜底构造（编译器会强制）。
  2. normalize：校验 `^\d{4}-\d{2}-\d{2}$` 且为合法日期，否则置空串；merge/prune 路径自然透传。
  3. 排序：在 `buildDashboardState` 分桶后，仅对 `mustHandleToday` 与 `waitingForMe` 两个桶做桶内重排——dueDate 非空者升序在前（期限近的最前），无期限者保持原顺序垫后；其他分类桶与全局 `compareItems` 不动。sidebar 行尾显示期限徽标，过期或今天到期标红（本地日期判定）。
  4. workbench 详情 metadata 区显示 `期限/Due:` 字段（无则不显示）。
  5. 翻译路径（analysis-translation）把 dueDate 列入"不翻译"字段。
- **验收**：单测——normalize 校验、排序规则、过期标红判定、翻译不动 dueDate；`npm test` 全绿。**needs user validation**：含明确期限的邮件分析后有期限徽标且排序靠前。
- **边界**：不做提醒/通知；overview 计数不加新维度；digest 格式不动。

### [ ] G5 Webview CSP 加固（D5，S-M 级）

- **现状锚点**：`sidebar-render.ts` / `workbench-render.ts` / `guide-webview.ts` 三个 HTML 模板均无 CSP meta，脚本为裸 inline `<script>`；**且模板中存在 `onclick="..."` 等内联事件属性**（如 pending 分组头 `onclick="togglePendingFolder(this)"`、meeting 行 `onclick="openItem(...)"`、dashboard 的 `onclick="post(...)"` 等）。
- **前置认知（本 step 最大的坑）**：`script-src 'nonce-...'` 的 CSP **不放行内联事件属性**——只加 CSP meta 不迁移 onclick，三个页面的按钮会全部失效。因此本 step 分两步走，顺序不可颠倒：
  1. **先迁移内联事件**：grep 三个模板中全部 `onclick=`（及其他 `on*=` 内联属性），迁移为统一事件委托——workbench 已有 `data-action` + document 级 click 委托模式，扩展该模式覆盖 sidebar/guide；迁移一批跑一遍相关单测，确认行为等价。
  2. **再加 CSP**：每次渲染生成随机 nonce（render 是纯函数，nonce 由调用方传入保持可测）；head 加 `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-...'; img-src data:;">`（按各页面实际资源微调，能收紧就收紧，禁用 'unsafe-hashes' 这类妥协方案）；所有 `<script>` 挂 nonce。
- **验收**：单测——三个页面输出含 CSP meta、script 带 nonce、两次渲染 nonce 不同、**输出 HTML 中不再含任何 `onclick=` 内联属性**；`npm test` 全绿。**needs user validation**：三个页面全功能回归（每个按钮/输入/折叠/QuickPick 入口点一遍）——CSP 配错或迁移遗漏的典型症状是局部按钮点了没反应。
- **边界**：不引入外部资源；不改页面功能与视觉；改动量因 onclick 迁移比原估大（S-M → M），如单人完成压力大可拆两个 commit（迁移 / CSP）但同一 step 内完成。

### [ ] G6 Sidebar 上下方向键导航（D6 裁剪版，S 级）

- **做法**：sidebar 列表获得焦点时，↑/↓ 在**当前可见队列**的条目间移动选中（跳过折叠分组内隐藏项与组头），选中行高亮 + 滚动入视野 + 触发与点击相同的 `openItem`（workbench 自动跟随——现有行为，点击即打开）。仅此一个动作，不做 Enter/其他快捷键。注意与 F3.4 pending 折叠分组、G2 会议折叠分组的可见性判定兼容。
- **验收**：webview 脚本单测（断言键盘 handler 与可见性过滤逻辑存在于输出 HTML）；`npm test` 全绿。**needs user validation**：↑/↓ 切换流畅、workbench 跟随、折叠组内隐藏项被跳过。
- **边界**：不做 workbench 侧键盘导航；不做其他快捷键。
- **顺序约束**：建议在 G2 完成后再做（G2 会新增会议折叠分组，先做 G6 会漏测该场景；若确要并行，后完成的一方负责联测两个折叠分组的跳过逻辑并在 Notes 写明）。

### [ ] G7 附件可见性（09 §7 C 组核实产出，S 级）

- **现状锚点（已核实）**：attachmentCount/attachmentNames 已采集入 store（`mail-store.ts:196-197`）；但 ① sidebar 邮件行不显示；② workbench 单封详情（pending 与 analyzed 两个模板）不显示；③ **单封批量分析 prompt 不含附件字段**（`mail-store.ts` `buildBatchDigestMarkdown` ~L283-299 无 Attachment 行；线程 prompt 已含，`thread-prompt-builder.ts:60-61`）。
- **做法**：
  1. sidebar 邮件行：有附件时行尾加 `📎`（tooltip 显示数量与文件名）。
  2. workbench 单封详情（pending + analyzed 两处模板）metadata 区显示 `附件/Attachments: N（文件名列表）`，无附件不显示。
  3. **确认项**：`redactStoredMails` 是否覆盖 `attachmentNames` 字段——若现有 redaction 只处理 subject/body，需把附件名纳入同一脱敏路径后再入 prompt（附件名可能含人名/项目名）。确认结果写进 Notes。
  4. `buildBatchDigestMarkdown` 每封邮件补两行（即"附件元数据行"，格式与 digest 文件中已有字段一致）：
     ```text
     AttachmentCount: 2
     AttachmentNames: contract.pdf; budget.xlsx
     ```
     作用：模型分析单封时可核对"正文提及附件"与附件实际存在性（正文写"详见附件"但 `AttachmentCount: 0` → 可在 summary/risk 中提示发件人漏附；反之附件存在时结论可引用文件名）。附件名经现有 redaction 路径处理后入 prompt。
  5. analysis prompt 指南补一句（防模型幻觉）：`Attachment fields provide only the count and file names; attachment contents are not available — never claim to have read an attachment.`（即只告诉模型"有几个附件、叫什么名字"，并明确禁止它假装读过附件内容。）
- **验收**：单测——渲染含 📎 与 metadata 行、batch digest 含附件行、无附件邮件不出现空字段；`npm test` 全绿。**needs user validation**：带附件的真实邮件在列表与详情可见附件标识；分析结果能正确反映附件存在。
- **边界**：不做附件下载/预览/内容读取；digest 文件格式不动（附件字段本就存在）。

---

## 2. 建议执行顺序与完成后流程

G1（收益最大、改动最大，单独一人）∥ 其余 G2-G7 互相独立可并行。全部完成后：规划者全量复审 → 重打 vsix → 用户按规划者汇总的验证清单做 R3 验证轮。R4 候选池（09 §4 延后项）待 R3 落地后按需重启。

---

## 3. Current Snapshot

- 2026-07-14 · 计划创建（依据 09 §7 拍板）。G1-G7 全部 `[ ]` 待 claim。

---

## 4. Handover Log

- **2026-07-14 · Claude Fable 5（规划者）**：依据 09 拍板展开 R3 执行计划。要点：G1 并发池注意 mergeAndPersist 串行化（共享 merged 状态不可并发写）；G2 复用 F3.4 折叠分组模式；G3 默认值必须等于现硬编码值（行为零变化起步）；G4 只做字段+排序+标注不做提醒；G5 nonce 由调用方传入保持 render 纯函数；G6 只做上下键一个动作；G7 的 batch prompt 附件行是模型感知附件的关键补齐。无 dirty state。Next: worker claim G1（或并行从 G2-G7 任选）。

- **2026-07-14 · Claude Fable 5（规划者开工前自审，修订 5 处）**：① **G5 补最大的坑**——三个模板存在大量 `onclick=` 内联事件属性，nonce 型 CSP 不放行内联 handler，必须先迁移事件委托再加 CSP（两步顺序不可颠倒，级别 S-M 上调为 M）；② **G3 补分类缓存失效机制**——classification cache 持久化导致词表变更后已分类邮件不重算，需词表 hash 变更触发全量重算，否则验收必失败；③ **G4 修正排序锚点**——分类内顺序来自 `dashboard-state.ts` 分桶（非 sidebar-render），改法明确为分桶后仅对两个目标桶做桶内重排；④ G1 补单 chunk 失败隔离与 `applyReplyTemplateToAnalysis` 空 parts no-op 确认项、G7 补 `redactStoredMails` 是否覆盖附件名的确认项；⑤ §0.1 补"新增设置三件套模式"、G6 补与 G2 的顺序约束。自审后判定：任务/做法/验收/边界达到可开工标准。
