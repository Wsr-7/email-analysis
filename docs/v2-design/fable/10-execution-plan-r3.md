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

### [x] G1 分析提速：chunk 并行度 2 + draftGeneration 开关（D1，M 级，最高优先）— `f3dd065`

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

### [x] G2 会议队列重定位为"会议邀请"（D2，S-M 级）— `96723b8`

- **现状锚点**：`sidebar-render.ts` meetings 队列（未响应排前 + 倒序，F5.2/F6.3 已修好详情与按钮）；labels 在 `dashboard-labels.ts`（`meetings.title` 等）。
- **做法**：
  1. 队列改名：`会议邀请 / Meeting Invites`（labels 中英文，queue id `meetings` 不改）。
  2. 两级展示：`notResponded` 邀请为主体直接平铺（现排序规则保留）；其余（accepted/tentative/organizer 的未来会议）收进一个可折叠次级分组（组头如 `已接受的日程 (N) / Accepted schedule (N)`，默认收起，展开状态存 webview state——复用 F3.4 pending 分组的实现模式）。
  3. 队列计数徽标只计未响应数（次级分组数量在组头体现），避免"看着有 5 条其实只有 1 条要处理"的误导。
  4. **不做**插件内 Accept/Decline（09 §7 已定：违背"绝不自动发送"红线），响应动作保持 Open in Outlook。
- **验收**：渲染单测（两级分组、计数、折叠态）；`npm test` 全绿。**needs user validation**：邀请置顶平铺、已接受折叠、徽标计数只含未响应。
- **边界**：采集脚本与 meeting store 不动；详情/按钮不动。

### [x] G3 安全词表配置化一期（D3，S-M 级）— `789799b`

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

### [x] G4 dueDate 结构化（D4，S-M 级）— `b6a6ead`

- **现状锚点**：`analysis-schema.ts` `AnalysisItem`/normalize；`prompts/output-schema.md` 字段清单；**分类内条目顺序来自 `dashboard-state.ts`（`compareItems` 全局排序后分桶），不是 sidebar-render**；行渲染在 `sidebar-render.ts` `renderCompactAnalysisRow`；workbench 详情 `renderAnalysisDetail`。
- **做法**：
  1. output schema 增加可选 `dueDate`（格式 `YYYY-MM-DD` 或空串；prompt 指示：仅当邮件明确含期限时输出，不确定就留空）。同步补 `AnalysisItem` 类型与 F1.2 的 `omittedAnalysisItems` 兜底构造（编译器会强制）。
  2. normalize：校验 `^\d{4}-\d{2}-\d{2}$` 且为合法日期，否则置空串；merge/prune 路径自然透传。
  3. 排序：在 `buildDashboardState` 分桶后，仅对 `mustHandleToday` 与 `waitingForMe` 两个桶做桶内重排——dueDate 非空者升序在前（期限近的最前），无期限者保持原顺序垫后；其他分类桶与全局 `compareItems` 不动。sidebar 行尾显示期限徽标，过期或今天到期标红（本地日期判定）。
  4. workbench 详情 metadata 区显示 `期限/Due:` 字段（无则不显示）。
  5. 翻译路径（analysis-translation）把 dueDate 列入"不翻译"字段。
- **验收**：单测——normalize 校验、排序规则、过期标红判定、翻译不动 dueDate；`npm test` 全绿。**needs user validation**：含明确期限的邮件分析后有期限徽标且排序靠前。
- **边界**：不做提醒/通知；overview 计数不加新维度；digest 格式不动。

### [x] G5 Webview CSP 加固（D5，S-M 级）— `4c8cce3`

- **现状锚点**：`sidebar-render.ts` / `workbench-render.ts` / `guide-webview.ts` 三个 HTML 模板均无 CSP meta，脚本为裸 inline `<script>`；**且模板中存在 `onclick="..."` 等内联事件属性**（如 pending 分组头 `onclick="togglePendingFolder(this)"`、meeting 行 `onclick="openItem(...)"`、dashboard 的 `onclick="post(...)"` 等）。
- **前置认知（本 step 最大的坑）**：`script-src 'nonce-...'` 的 CSP **不放行内联事件属性**——只加 CSP meta 不迁移 onclick，三个页面的按钮会全部失效。因此本 step 分两步走，顺序不可颠倒：
  1. **先迁移内联事件**：grep 三个模板中全部 `onclick=`（及其他 `on*=` 内联属性），迁移为统一事件委托——workbench 已有 `data-action` + document 级 click 委托模式，扩展该模式覆盖 sidebar/guide；迁移一批跑一遍相关单测，确认行为等价。
  2. **再加 CSP**：每次渲染生成随机 nonce（render 是纯函数，nonce 由调用方传入保持可测）；head 加 `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-...'; img-src data:;">`（按各页面实际资源微调，能收紧就收紧，禁用 'unsafe-hashes' 这类妥协方案）；所有 `<script>` 挂 nonce。
- **验收**：单测——三个页面输出含 CSP meta、script 带 nonce、两次渲染 nonce 不同、**输出 HTML 中不再含任何 `onclick=` 内联属性**；`npm test` 全绿。**needs user validation**：三个页面全功能回归（每个按钮/输入/折叠/QuickPick 入口点一遍）——CSP 配错或迁移遗漏的典型症状是局部按钮点了没反应。
- **边界**：不引入外部资源；不改页面功能与视觉；改动量因 onclick 迁移比原估大（S-M → M），如单人完成压力大可拆两个 commit（迁移 / CSP）但同一 step 内完成。

### [x] G6 Sidebar 上下方向键导航（D6 裁剪版，S 级）— `5d48d65`

- **做法**：sidebar 列表获得焦点时，↑/↓ 在**当前可见队列**的条目间移动选中（跳过折叠分组内隐藏项与组头），选中行高亮 + 滚动入视野 + 触发与点击相同的 `openItem`（workbench 自动跟随——现有行为，点击即打开）。仅此一个动作，不做 Enter/其他快捷键。注意与 F3.4 pending 折叠分组、G2 会议折叠分组的可见性判定兼容。
- **验收**：webview 脚本单测（断言键盘 handler 与可见性过滤逻辑存在于输出 HTML）；`npm test` 全绿。**needs user validation**：↑/↓ 切换流畅、workbench 跟随、折叠组内隐藏项被跳过。
- **边界**：不做 workbench 侧键盘导航；不做其他快捷键。
- **顺序约束**：建议在 G2 完成后再做（G2 会新增会议折叠分组，先做 G6 会漏测该场景；若确要并行，后完成的一方负责联测两个折叠分组的跳过逻辑并在 Notes 写明）。

### [~] G7 附件可见性（09 §7 C 组核实产出，S 级）

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
- 2026-07-14 · G1 已完成（`f3dd065`）：单封分析 chunk 以并发度 2 补位执行，合并落盘串行化；新增 `draftGeneration=auto|onDemand`，全量测试 437 pass。Next: claim G2。
- 2026-07-14 · G2 已完成（`96723b8`）：会议队列更名为会议邀请，未响应邀请平铺，未来已接受/暂定/组织者日程默认折叠，徽标仅计未响应。全量测试 438 pass。Next: claim G3。
- 2026-07-14 · G3 已完成（`789799b`）：hard-block/manual-confirm 与 3/2 级分类词表均可在 Settings 编辑，空数组关闭，非法值回落，分级词表 hash 变化触发全量重算。全量测试 443 pass。Next: claim G4。
- 2026-07-14 · G4 已完成（`b6a6ead`）：分析输出新增合法 `YYYY-MM-DD` dueDate，两个行动桶按期限优先排序，Sidebar/Workbench 显示期限且过期或今日到期标红，翻译保持日期不变。全量测试 447 pass。Next: claim G5。
- 2026-07-14 · G5 已完成（`4c8cce3`）：Sidebar 23 处内联 click handler 迁入统一事件委托，三个 Webview 由 extension caller 传入独立随机 nonce，全部启用严格 CSP 且 script 带 nonce。全量测试 450 pass。Next: claim G6。
- 2026-07-14 · G6 已完成（`5d48d65`）：Sidebar 列表可聚焦，ArrowUp/ArrowDown 仅遍历当前真实可见 `.sb-row`，跳过两类折叠组隐藏项与组头，复用 openItem 并滚动入视野。全量测试 451 pass。Next: claim G7。

---

## 4. Handover Log

- **2026-07-14 · Claude Fable 5（规划者）**：依据 09 拍板展开 R3 执行计划。要点：G1 并发池注意 mergeAndPersist 串行化（共享 merged 状态不可并发写）；G2 复用 F3.4 折叠分组模式；G3 默认值必须等于现硬编码值（行为零变化起步）；G4 只做字段+排序+标注不做提醒；G5 nonce 由调用方传入保持 render 纯函数；G6 只做上下键一个动作；G7 的 batch prompt 附件行是模型感知附件的关键补齐。无 dirty state。Next: worker claim G1（或并行从 G2-G7 任选）。

- **2026-07-14 · Claude Fable 5（规划者开工前自审，修订 5 处）**：① **G5 补最大的坑**——三个模板存在大量 `onclick=` 内联事件属性，nonce 型 CSP 不放行内联 handler，必须先迁移事件委托再加 CSP（两步顺序不可颠倒，级别 S-M 上调为 M）；② **G3 补分类缓存失效机制**——classification cache 持久化导致词表变更后已分类邮件不重算，需词表 hash 变更触发全量重算，否则验收必失败；③ **G4 修正排序锚点**——分类内顺序来自 `dashboard-state.ts` 分桶（非 sidebar-render），改法明确为分桶后仅对两个目标桶做桶内重排；④ G1 补单 chunk 失败隔离与 `applyReplyTemplateToAnalysis` 空 parts no-op 确认项、G7 补 `redactStoredMails` 是否覆盖附件名的确认项；⑤ §0.1 补"新增设置三件套模式"、G6 补与 G2 的顺序约束。自审后判定：任务/做法/验收/边界达到可开工标准。

- **2026-07-14 · Codex（G1 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `fc062db`；重新定位确认 `src/lib/app-analysis.ts:213-408` 仍是串行 chunk 循环，`mergeAndPersist`/`persistSkippedChunk`/取消检查/进度回调锚点均成立，`src/lib/prompt-config.ts:118` 为单封 prompt 组装入口，`src/lib/reply-template.ts:36` 为模板应用入口，设置三件套仍落在 `package.json`、`default-config.json`、`src/extension.ts readConfig`。边界：仅实现并发度 2、串行合并落盘、失败/取消/进度语义与 `draftGeneration`；不改 chunk 划分/token 预算，不做并发度设置，不动线程分析。基线 `npm test`：432 pass / 0 fail。Action: claim G1。

- **2026-07-14 · Codex（G1 completion）**：Action: 完成并发度 2 的补位式 chunk worker、按完成顺序串行合并落盘、失败隔离、取消后停止补位、完成计数进度，以及 `draftGeneration` 三件套与 on-demand prompt；未改线程分析、chunk 划分和 token 预算。Validated: `npm run compile` 通过；`node --test out/test/app-analysis.test.js` 31 pass；`npm test` 437 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——用约 20 封邮件分别在 `auto` 与 `onDemand` 下分析，核对总耗时、完成计数进度、空草稿的 Generate Draft 与生成后操作。Next: G2。

  **Completion Notes**
  - 改动文件：`src/lib/app-analysis.ts`、`src/lib/prompt-config.ts`、`src/extension.ts`、`package.json`、`default-config.json`、`src/test/app-analysis.test.ts`、`src/test/prompt-config.test.ts`、`src/test/reply-template.test.ts`、本计划。
  - 实现边界：只覆盖 G1 明定的单封批量分析并发与草稿开关；未新增依赖或设置化并发度。
  - 验收结果：并发上限/乱序完成串行合并/失败隔离/取消不补位/onDemand prompt/空草稿 no-op 均有自动化覆盖；全量 437 pass。
  - Manual validation：**needs user validation**，真实 Copilot 的 20 封耗时、进度文案及 Generate Draft 链路仍需实机确认。
  - Known issues：本机测试无法证明真实模型吞吐约减半；未发现新的代码级已知问题。
  - Commit：`f3dd065`（本地，未 push）。

- **2026-07-14 · Codex（G2 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `1172c11`；重新定位确认 `src/lib/sidebar-render.ts:189-234` 仍将全部会议统一排序/计数/平铺，`renderPendingFolderGroups` 与 `restorePendingFolders`/`togglePendingFolder` 仍提供可复用折叠状态模式，`src/lib/dashboard-labels.ts:195/386` 的 `meetings.title` 仍为“会议/Meetings”，对应渲染测试在 `src/test/sidebar-render.test.ts:447-485`。边界：只改 meetings 队列名称、未响应主体、未来已接受/暂定/组织者次级折叠组及未响应徽标计数；不改 queue id、采集/store、详情按钮或 Outlook 响应动作。Action: claim G2。

- **2026-07-14 · Codex（G2 completion）**：Action: 完成 Meeting Invites 命名、两级会议展示、未响应专用徽标计数与折叠状态持久化；保留 `meetings` queue id 与 Open in Outlook 动作。Validated: `npm run compile` 通过；`node --test out/test/sidebar-render.test.js out/test/dashboard-labels.test.js` 49 pass；`npm test` 438 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——在 Sidebar 打开会议邀请，核对未响应邀请平铺置顶、已接受日程默认收起且展开态在刷新后保留、导航徽标只显示未响应数。Next: G3。

  **Completion Notes**
  - 改动文件：`src/lib/sidebar-render.ts`、`src/lib/dashboard-labels.ts`、`src/test/sidebar-render.test.ts`、`src/test/dashboard-labels.test.ts`、本计划。
  - 实现边界：仅改变 Sidebar 会议队列的信息架构；未改 meeting store、采集脚本、Workbench 详情或 Outlook 响应能力。
  - 验收结果：两级分组、未来日程过滤、组内倒序、未响应计数及折叠状态脚本均有自动化覆盖；全量 438 pass。
  - Manual validation：**needs user validation**，真实会议邀请/已接受日程的视觉分层与展开态需在 VS Code webview 确认。
  - Known issues：插件内仍不提供 Accept/Decline，按计划继续只在 Outlook 响应。
  - Commit：`96723b8`（本地，未 push）。

- **2026-07-14 · Codex（G3 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `6290211`；重新定位确认 `src/lib/config-utils.ts:167-183` 仍硬编码 17 个 hard-block 词且 manual-confirm 为空，`src/lib/classification.ts:37-76` 仍硬编码 3/2 级词表并只补缺失缓存，classification cache 在 `src/lib/app-data.ts:320-332` 持久化，所有 `ensureClassifications` caller 已枚举。设置形态选择两个平级 array（`classificationLevel3Keywords` / `classificationLevel2Keywords`），因为 VS Code Settings UI 可直接增删条目，优于 object 只能手改 JSON；其余两个 setting 为 `hardBlockKeywords` / `manualConfirmKeywords`。边界：仅做子串/大小写不敏感词表配置、非法回落、空数组关闭与分级 hash 失效；不做正则、MIP 或级别变更。Action: claim G3。

- **2026-07-14 · Codex（G3 completion）**：Action: 注册并读取四个平级 array settings，将 security gate 与 classification 词表改为配置驱动，并在 classification cache 保存 SHA-256 词表 hash、变更时全量重算。Validated: `npm run compile` 通过；`node --test out/test/config-utils.test.js out/test/classification.test.js out/test/security-gate.test.js` 61 pass；`npm test` 443 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——在 Settings 改 hard-block 与 3/2 级词表后刷新 Sidebar，核对已拉取邮件无需重新 Fetch 即更新分级/阻断；再用空数组确认对应层关闭。Next: G4。

  **Completion Notes**
  - 改动文件：`src/lib/config-utils.ts`、`src/lib/classification.ts`、`src/lib/app-analysis.ts`、`src/extension.ts`、`package.json`、`default-config.json`、`src/test/config-utils.test.ts`、`src/test/classification.test.ts`、本计划。
  - 实现边界：采用两个平级分类数组以获得更好的 Settings UI 编辑体验；保持原子串、大小写不敏感语义及 0-3 级结构。
  - 验收结果：自定义、空数组、非法回落及 hash 触发全量重算均有自动化覆盖；默认词表与原硬编码一致；全量 443 pass。
  - Manual validation：**needs user validation**，真实 Settings 修改后的 Sidebar 分级与 hard block 实时变化需在扩展宿主确认。
  - Known issues：空 `hardBlockKeywords` 会显式关闭该安全层，风险已在 setting description 说明；未实现正则或 MIP。
  - Commit：`789799b`（本地，未 push）。

- **2026-07-14 · Codex（G4 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `18cff8d`；重新定位确认 `src/lib/analysis-schema.ts:54-70/123-176` 为 AnalysisItem 与 normalize，`src/lib/app-analysis.ts:184` 为 omitted fallback，`src/lib/dashboard-state.ts` 的 `compareItems` 后分桶决定分类内顺序，Sidebar/Workbench 渲染锚点分别仍在 `src/lib/sidebar-render.ts:105` 与 `src/lib/workbench-render.ts:63`，翻译入口在 `src/lib/analysis-translation.ts`。边界：仅新增可选 dueDate、合法日期 normalize、两个目标桶内排序、期限标识/详情与翻译保护；不改 digest、不做提醒或新计数。Action: claim G4。

- **2026-07-14 · Codex（G4 completion）**：Action: 完成 dueDate schema/prompt、真实日历日期 normalize、两个行动桶期限优先排序、Sidebar 期限徽标与本地日期紧急态、Workbench metadata 及翻译保护。Validated: `npm run compile` 通过；`node --test out/test/app-analysis.test.js` 31 pass；`npm test` 447 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——分析一封正文明确写出期限的真实邮件，核对期限徽标、两个行动桶排序、今日/过期红色样式与 Workbench 期限字段。Next: G5。

  **Completion Notes**
  - 改动文件：`prompts/analysis-prompt.md`、`prompts/output-schema.md`、`src/lib/analysis-schema.ts`、`src/lib/app-analysis.ts`、`src/lib/dashboard-state.ts`、`src/lib/dashboard-labels.ts`、`src/lib/sidebar-render.ts`、`src/lib/workbench-render.ts`、`src/lib/analysis-translation.ts`、对应测试、本计划。
  - 实现边界：只结构化单封分析期限、目标桶排序与可见标识；未改 digest 格式、overview 计数，也未实现提醒/通知。
  - 验收结果：合法日期（含闰年）、非法日期清空、目标桶排序、其他桶稳定、紧急态与翻译保护均有自动化覆盖；全量 447 pass。
  - Manual validation：**needs user validation**，真实 Copilot 是否只为明确期限输出日期，以及真实 webview 的排序与红色状态仍需确认。
  - Known issues：模型输出质量依赖 prompt 遵从；不确定期限按设计为空，不会推断或提醒。
  - Commit：`b6a6ead`（本地，未 push）。

- **2026-07-14 · Codex（G5 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `105c0db`；重新定位确认三个模板的 `<script>` 仍无 nonce/CSP，Sidebar 有 23 处 `onclick=`（邮件/线程/会议/Next Action 行、两个折叠组、queue nav、语言/设置/toolbar 按钮），Workbench 与 Guide 已使用 `data-action` document click 委托且无内联 handler；真实 render caller 均在 `src/extension.ts` 的 `getDashboardHtml` / `getWorkbenchHtml` / `getGuideHtml`。边界：先把 Sidebar 全部内联 handler 等价迁到统一委托，再由 extension caller 为三个纯 render 函数传随机 nonce 并添加严格 CSP；不引入资源/依赖，不改功能或视觉，不进入 G6 键盘导航。Action: claim G5。

- **2026-07-14 · Codex（G5 completion）**：Action: 将 Sidebar 所有内联 click handler 迁为 `data-action` + document 级委托；Workbench/Guide 复用既有委托；三个纯 render 函数接收 caller nonce，extension 每次渲染用 `randomBytes(16)` 生成，CSP 仅放行 nonce script、inline style 与 data image。Validated: `npm run compile` 通过；三个 render 测试 90 pass；`npm test` 450 pass / 0 fail；输出断言无内联 `on*=`；`git diff --check` 通过。Manual: **needs user validation**——逐一点击 Sidebar 的 Fetch/Analyze/Load More/队列/邮件/线程/会议/Next Action/折叠/语言/设置/报表/清空入口，Workbench 的所有详情与草稿动作，以及 Guide 的全部动作（含会打开 QuickPick 的文件夹选择）。Next: G6。

  **Completion Notes**
  - 改动文件：`src/extension.ts`、`src/lib/sidebar-render.ts`、`src/lib/workbench-render.ts`、`src/lib/guide-webview.ts`、三个对应 render 测试、本计划。
  - 实现边界：仅迁移事件绑定并加 nonce CSP；未引入外部资源/依赖，未改变页面视觉或消息协议，也未加入 G6 键盘行为。
  - 验收结果：三个页面均有 CSP meta、全部 script 带 caller nonce、两次不同 nonce 渲染结果不同、输出无内联事件属性；全量 450 pass。
  - Manual validation：**needs user validation**，CSP 与事件委托只能通过真实 VS Code Webview 完整点击回归确认。
  - Known issues：`style-src 'unsafe-inline'` 仍保留以支持现有内嵌样式；script 已收紧为单次随机 nonce，未使用 `unsafe-inline`/`unsafe-hashes`。
  - Commit：`4c8cce3`（本地，未 push）。

- **2026-07-14 · Codex（G6 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `1f4bb9c`；重新定位确认 Sidebar `#itemList` 尚不可聚焦，所有可导航实体均为 `.sb-row[data-action="openItem"]`，`applyQueue` 用 row/group `hidden` 切换队列，pending 与 accepted schedule 的子容器另以 `hidden` 控制折叠，`openItem`/`setActiveRow` 已统一点击与高亮路径。边界：只让 Sidebar 列表可聚焦并处理 ArrowUp/ArrowDown，按真实可见性过滤 `.sb-row`、滚动入视野并复用 `openItem`；不做 Enter/循环导航/Workbench 快捷键或其他按键。Action: claim G6。

- **2026-07-14 · Codex（G6 completion）**：Action: 为 `#itemList` 增加焦点入口，点击行后保持列表焦点，并在 ArrowUp/ArrowDown 时从 `offsetParent !== null` 的可见 `.sb-row` 中选择相邻项，复用 `openItem` 高亮/打开且 `scrollIntoView`。Validated: `npm run compile` 通过；`node --test out/test/sidebar-render.test.js` 46 pass；`npm test` 451 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——分别在普通队列、pending folder 折叠组与 accepted schedule 折叠组中用上下键切换，确认 Workbench 跟随、滚动平滑且隐藏项/组头被跳过。Next: G7。

  **Completion Notes**
  - 改动文件：`src/lib/sidebar-render.ts`、`src/test/sidebar-render.test.ts`、本计划。
  - 实现边界：只处理 Sidebar 列表焦点与 ArrowUp/ArrowDown；未加入 Enter、循环、其他快捷键或 Workbench 键盘导航。
  - 验收结果：输出脚本覆盖按键门控、真实可见性过滤、统一 openItem 与滚动入视野；G2 两级会议折叠与既有 pending 折叠共用祖先可见性判定；全量 451 pass。
  - Manual validation：**needs user validation**，真实 Webview 的焦点获得、折叠跳过、滚动与 Workbench 联动需手动确认。
  - Known issues：到达队列首尾时保持当前项，不循环；这是本轮裁剪边界内的 no-op 行为。
  - Commit：`5d48d65`（本地，未 push）。

- **2026-07-14 · Codex（G7 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `ff4f82a`；重新定位确认 store 已规范化 `attachmentCount`/`attachmentNames`，线程 prompt 已带附件元数据，但 `buildBatchDigestMarkdown` 无附件行；Sidebar 的 stored/analyzed mail row 与 Workbench 的 pending/analyzed metadata 均未渲染附件。确认 `redactStoredMails` 目前只处理 `bodyExcerpt`，明确保留 `attachmentNames`，因此附件名尚未脱敏。边界：只补单封邮件列表/详情附件可见性、batch prompt 元数据、附件名脱敏与防幻觉指令；不改 digest 文件格式，不下载/预览/读取附件内容，不改线程附件展示。Action: claim G7。
