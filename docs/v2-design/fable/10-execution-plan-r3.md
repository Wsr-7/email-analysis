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

### [x] G7 附件可见性（09 §7 C 组核实产出，S 级）— `e323af6`

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

### 2.1 人工验证环境记录

| 项目 | 填写值 |
|---|---|
| 验证日期 |  |
| VSIX 文件 / SHA-256 |  |
| VS Code 版本 |  |
| EasyMail 版本 |  |
| classic Outlook / Windows 版本 |  |
| 邮箱类型与测试 folder |  |
| Copilot 模型 |  |

结果栏统一填写：`通过`、`失败`、`部分通过` 或 `不适用`。失败或部分通过时，在“实际结果 / 证据”中写明现象、复现步骤、截图或日志位置；不要只填 issue 编号。

### 2.2 G1-G7 人工验证表

| 编号 | 对应 step | 人工验证点 | 验证步骤 | 预期结果 | 验证结果 | 实际结果 / 证据 |
|---|---|---|---|---|---|---|
| R3-M01 | G1 | `auto` 模式批量分析与并发进度 | 1. 在 Settings 设置 `easyMail.draftGeneration=auto`。<br>2. Fetch 约 20 封允许分析的真实邮件。<br>3. Load Copilot Models 并选择模型。<br>4. 执行 Analyze Next Batch 或 Analyze All Allowed，记录开始/结束时间并观察进度。 | 分析完成且无邮件因并发丢失；进度使用“已完成 x/N chunk（约剩 X 分钟）”；界面不会长期卡在 busy/cancelling；记录本次耗时供 M02 比较。 | 待验证 |  |
| R3-M02 | G1 | `onDemand` 提速与手动草稿 | 1. 设置 `easyMail.draftGeneration=onDemand`。<br>2. 用数量和正文规模相近的另一批邮件重复分析并记录耗时。<br>3. 打开一个分析结果，确认初始草稿为空。<br>4. 点击 Generate Draft，再执行编辑、Polish 或 Compose in Outlook 中至少一个后续动作。 | 分析结果正常且初始不生成草稿；耗时记录可与 M01 对比；Generate Draft 能补生成草稿，后续草稿操作可用。 | 待验证 |  |
| R3-M03 | G2 | 会议邀请主队列、折叠组与计数 | 1. 确保 Outlook 中同时存在未响应邀请和未来已接受/暂定/自己组织的日程。<br>2. Fetch New 后打开 Sidebar 的“会议邀请 / Meeting Invites”。<br>3. 记录导航徽标数量。<br>4. 展开“已接受的日程 / Accepted schedule”，触发一次 Sidebar 刷新后再次查看。 | 未响应邀请直接平铺并排在主体区域；未来非待响应日程默认收起；导航徽标只等于未响应数量；组头显示次级数量；展开状态在刷新后保留。 | 待验证 |  |
| R3-M04 | G3 | 分类词表变更触发已有邮件重算 | 1. 选择一封已 Fetch 且未删除的邮件，记录当前 classification。<br>2. 把该邮件标题或正文中的独特词加入 `easyMail.classificationLevel3Keywords`。<br>3. 保存 Settings 并刷新/重新打开 Sidebar，不重新 Fetch。<br>4. 验证后恢复原设置。 | 已有邮件无需重新 Fetch 即按新词表重算为 3 级；移除测试词并恢复设置后可再次按当前词表重算。 | 待验证 |  |
| R3-M05 | G3 | hard-block、manual-confirm 与空数组语义 | 1. 分别把测试邮件中的独特词加入 `easyMail.hardBlockKeywords`、`easyMail.manualConfirmKeywords` 并尝试分析。<br>2. 分别临时设置为空数组并再次查看 gate 行为。<br>3. 测试完成后恢复原值。 | hard-block 命中时不可送模；manual-confirm 命中时要求人工确认；空数组明确关闭对应层；所有变化无需重新 Fetch。 | 待验证 |  |
| R3-M06 | G4 | 明确期限的提取、排序与展示 | 1. 准备正文明确写出 `YYYY-MM-DD` 期限的真实邮件，至少覆盖未来日期；条件允许时再覆盖今天或已过期日期。<br>2. 分析邮件。<br>3. 查看 Sidebar 的 Must Handle Today / Waiting for Me 队列和 Workbench 详情。 | 模型只为明确期限输出 dueDate；有期限项在两个目标桶内按日期升序排在无期限项前；Sidebar 有期限徽标；今天/过期为紧急红色；Workbench 显示 Due/期限字段。 | 待验证 |  |
| R3-M07 | G5 | Sidebar CSP 后的完整点击回归 | 1. 逐一点击 Fetch、Analyze、Load More、所有 queue、邮件/线程/会议/Next Action 行。<br>2. 测试 pending folder 与 accepted schedule 折叠。<br>3. 测试语言、Settings、Reports；Clear 只打开确认并取消即可。 | 每个入口都有响应，无“点击无反应”；队列、折叠、语言和设置状态正常；没有因 CSP 阻止脚本导致的局部失效。 | 待验证 |  |
| R3-M08 | G5 | Workbench CSP 后的完整点击回归 | 1. 分别打开 pending、analyzed、manual-confirm、ignored 邮件，以及 thread 和 meeting。<br>2. 测试 Analyze/Re-analyze、Open in Outlook、Ignore/Restore。<br>3. 测试 Generate、Copy、Polish、Refine、Reply/Reply All/Forward。 | 所有详情与草稿按钮正常；Webview 与 extension 消息往返正常；Outlook 动作只打开对应窗口，不自动发送。 | 待验证 |  |
| R3-M09 | G5 | Guide CSP 与 QuickPick 回归 | 1. 打开 EasyMail Guide。<br>2. 逐一执行 Guide 中的命令入口。<br>3. 执行 Select Outlook Folders，完成一次 QuickPick 打开、选择和取消/确认。 | Guide 所有按钮可用；folder QuickPick 正常打开并显示真实 folder；无 CSP 导致的无响应。 | 待验证 |  |
| R3-M10 | G6 | 普通队列上下键导航 | 1. 在 Sidebar 点击一封可见邮件，使列表获得焦点。<br>2. 连续使用 `ArrowUp` / `ArrowDown`。<br>3. 观察选中态、滚动和 Workbench。 | 只在当前真实可见的 `.sb-row` 间移动；Workbench 跟随打开对应项；长列表会滚动入视野；到首尾不循环且不报错。 | 待验证 |  |
| R3-M11 | G6 | 折叠内容的键盘跳过 | 1. 收起一个 pending folder。<br>2. 收起 Accepted schedule。<br>3. 在相邻可见行间使用上下键跨过两个折叠区域。 | 隐藏子项和组头不会被选中；只遍历当前可见邮件/会议行；展开后其子项重新进入导航序列。 | 待验证 |  |
| R3-M12 | G7 | 真实附件在 pending/analyzed UI 可见 | 1. 向测试邮箱发送一封带多个附件、文件名可辨识的邮件。<br>2. Fetch 后在 pending Sidebar 与 Workbench 查看。<br>3. 分析后再次查看 analyzed Sidebar 与 Workbench。 | Sidebar 显示 📎、数量和文件名 tooltip；Workbench 显示附件数量与文件名；pending 和 analyzed 两条路径一致；无附件邮件不出现空附件字段。 | 待验证 |  |
| R3-M13 | G7 | 模型只使用附件元数据且不声称读过内容 | 1. 分析一封正文写“详见附件”且确实有附件的邮件。<br>2. 条件允许时再分析一封正文声称有附件但实际未附的邮件。<br>3. 检查 summary、risk、reason 和建议动作。 | 模型可以依据附件数量/文件名判断附件是否存在或疑似漏附，但不得概括、引用或声称读取附件内容；附件名中的敏感信息不应原样进入模型提示。 | 待验证 |  |
| R3-M14 | G1-G7 | 安装包端到端 smoke test | 1. 安装本轮 VSIX 并 reload VS Code。<br>2. 执行 Fetch New、Load Models、一次分析。<br>3. 打开邮件、线程、会议详情。<br>4. 执行一次 Open in Outlook 和一次 Compose in Outlook，但不要发送。 | 扩展正常激活；Sidebar/Workbench/Guide 可加载；真实 Outlook 与 Copilot 主链路无回归；Compose 仅打开草稿窗口。 | 待验证 |  |

---

## 3. Current Snapshot

- 2026-07-14 · 计划创建（依据 09 §7 拍板）。G1-G7 全部 `[ ]` 待 claim。
- 2026-07-14 · G1 已完成（`f3dd065`）：单封分析 chunk 以并发度 2 补位执行，合并落盘串行化；新增 `draftGeneration=auto|onDemand`，全量测试 437 pass。Next: claim G2。
- 2026-07-14 · G2 已完成（`96723b8`）：会议队列更名为会议邀请，未响应邀请平铺，未来已接受/暂定/组织者日程默认折叠，徽标仅计未响应。全量测试 438 pass。Next: claim G3。
- 2026-07-14 · G3 已完成（`789799b`）：hard-block/manual-confirm 与 3/2 级分类词表均可在 Settings 编辑，空数组关闭，非法值回落，分级词表 hash 变化触发全量重算。全量测试 443 pass。Next: claim G4。
- 2026-07-14 · G4 已完成（`b6a6ead`）：分析输出新增合法 `YYYY-MM-DD` dueDate，两个行动桶按期限优先排序，Sidebar/Workbench 显示期限且过期或今日到期标红，翻译保持日期不变。全量测试 447 pass。Next: claim G5。
- 2026-07-14 · G5 已完成（`4c8cce3`）：Sidebar 23 处内联 click handler 迁入统一事件委托，三个 Webview 由 extension caller 传入独立随机 nonce，全部启用严格 CSP 且 script 带 nonce。全量测试 450 pass。Next: claim G6。
- 2026-07-14 · G6 已完成（`5d48d65`）：Sidebar 列表可聚焦，ArrowUp/ArrowDown 仅遍历当前真实可见 `.sb-row`，跳过两类折叠组隐藏项与组头，复用 openItem 并滚动入视野。全量测试 451 pass。Next: claim G7。
- 2026-07-14 · G7 已完成（`e323af6`）：pending/analyzed 单封邮件在 Sidebar 与 Workbench 显示附件元数据，batch prompt 含 count/name 且附件名先脱敏，实际 system prompt 明确禁止声称读取附件内容。全量测试 454 pass。Next: 全量收口复验。
- 2026-07-14 · R3 G 批次收口完成：G1-G7 全部 `[x]`，整体 diff 复核未发现 Critical/Important 问题；最终 `npm run compile`、454 项全量测试与 `git diff --check` 均通过。14 个本地 commit，未 push。
- 2026-07-14 · G8.1 已完成（`5683136`）：keyword 型 `manual_confirm` 不再落入 Pending，而是进入 Manual Confirm Required；显式确认分析仍可用，两个关键词设置的机制差异已写清。全量测试 455 pass。Next: claim G8.2。
- 2026-07-14 · G8.2 已完成（`f59eedf`）：Sidebar 发起的 Workbench 首次打开与后续 reveal 均保留 Sidebar 焦点，使既有上下键 handler 可继续接收按键。全量测试 456 pass。Next: claim G8.3。
- 2026-07-14 · G8.3 已完成（`1dac69c`）：Workbench 回传线程 id 时保留唯一 Next Action 选择，不再高亮同线程全部 action；按钮改为“标记已完成 / Mark Done”。全量测试 457 pass。Next: claim G8.4。

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

- **2026-07-14 · Codex（G7 completion）**：Action: 为 stored/analyzed mail row 增加 📎 tooltip，为 pending/analyzed Workbench metadata 增加附件数与文件名；batch digest 每封写 `AttachmentCount`，有名称时才写 `AttachmentNames`；`redactStoredMails` 对每个附件名走同一 `redactText` 并计入 replacement；在指南文件及实际加载的 `base-system.md` 加入禁止假装读取内容的约束。Validated: `npm run compile` 通过；相关五个测试文件 142 pass；`npm test` 454 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——Fetch 一封真实带附件邮件，核对 pending 与 analyzed 的 Sidebar 📎 tooltip、Workbench 附件行，并分析正文提及附件/漏附的邮件，确认结果只依据 count/name 且不声称读取内容。Next: 全量收口复验。

  **Completion Notes**
  - 改动文件：`src/lib/sidebar-render.ts`、`src/lib/workbench-render.ts`、`src/lib/mail-store.ts`、`src/lib/redaction.ts`、`prompts/analysis-prompt.md`、`prompts/base-system.md`、对应测试、本计划。
  - 实现边界：只暴露并传递已有附件元数据；未改 collector/digest 文件格式，未下载、预览或读取附件内容，也未新增线程 UI。
  - 验收结果：pending/analyzed 两条 UI 路径、带/不带附件的 batch digest、实际 prompt 防幻觉约束及附件名脱敏均有自动化覆盖；全量 454 pass。
  - Manual validation：**needs user validation**，真实 Outlook 附件采集值、Webview tooltip/metadata 与真实模型对附件存在/漏附的判断需实机确认。
  - Known issues：确认项结论为旧 `redactStoredMails` **不覆盖** attachmentNames，本 step 已补齐；模型仍只能看到 count/name，无法验证附件内容。
  - Commit：`e323af6`（本地，未 push）。

- **2026-07-14 · Codex（R3 G 批次 final verification）**：Action: 对 `fc062db..b499ac9` 的 34 个改动文件、G1-G7 状态/边界及 commit 链做整体复核，无 Critical/Important 发现；未越界改 VBS、collector 或 digest 文件格式。Validated: fresh `npm run compile` 通过；fresh `npm test` 454 pass / 0 fail（69 suites）；`git diff --check` 通过；G1-G7 均 `[x]` 且附实现 commit。Manual: 仍按各 step Completion Notes 的 **needs user validation** 清单进入真实 VS Code/Copilot/Outlook 验证轮。Next: 规划者全量复审与重打 VSIX；当前 worker 不 push。

- **2026-07-14 · Codex（G8.1 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `73897c5`；基线 `npm test` 454 pass / 0 fail。重新定位确认 `src/lib/security-gate.ts:89-106` 已正确生成 keyword 型 `manual_confirm`，设置读取链完整；根因仍在 `src/lib/classification.ts:111-114` 的 allowed filter 只排除 `block`，因此低 level 的 keyword 命中邮件仍落入 Pending。`src/lib/workbench-render.ts:26` 已对任意 `manual_confirm` 渲染 Confirm and Analyze，现有 level 型测试路径可复用。边界：只修共享队列归属、补 keyword 型回归测试并澄清两个 setting description；不改 security gate 判定、阈值语义或其他 G8 step。Action: claim G8.1。

- **2026-07-14 · Codex（G8.1 completion）**：Action: 将 `manual_confirm` 与 `block` 一并排除出 allowed/Pending，使 keyword 型人工确认邮件进入共享 blocked 队列；复用既有显式确认授权链，并澄清 `manualConfirmKeywords` 与 `classificationLevel3Keywords` 的机制差异。Validated: TDD RED 准确复现 keyword 邮件误入 allowed；`npm run compile` 通过；classification/security-gate/workbench 相关测试 64 pass；fresh `npm test` 455 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——在 `manualConfirmKeywords` 加入主题关键词，Fetch 后确认邮件进入 Manual Confirm Required，点击 Confirm and Analyze 后可完成分析。Next: G8.2。

  **Completion Notes**
  - 改动文件：`src/lib/classification.ts`、`src/test/classification.test.ts`、`package.json`、本计划。
  - 实现边界：只修共享队列归属和设置说明；未改 security gate 判定、自动阈值语义或 Workbench 消息协议。
  - 验收结果：keyword 型 `manual_confirm` 进入 blocked 队列、显式确认仍由 `canAnalyzeMail(..., true)` 放行，并与现有 level 型 UI 路径一致；全量 455 pass。
  - Manual validation：**needs user validation**，真实 Settings、Fetch、Manual Confirm Required 与 Confirm and Analyze 链路仍需扩展宿主确认。
  - Known issues：首次全量复验出现一次既有 G1 cancellation 测试的完成顺序抖动；该用例隔离重跑 5/5 通过，随后 fresh 全量 455/455 通过，因此未越界修改 G1。
  - Commit：`5683136`（本地，未 push）。

- **2026-07-14 · Codex（G8.2 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `6261038`；重新定位确认 Sidebar 点击 `openItem` 前已显式聚焦 `#itemList`，键盘 handler 也会按真实可见性过滤行；焦点随后被 `openWorkbench` 的既有 panel `reveal(ViewColumn.One)` 或首次 `createWebviewPanel(..., ViewColumn.One, ...)` 抢走。边界：只让 Sidebar 发起的 Workbench 打开/跟随保留 Sidebar 焦点，并补 caller 级回归断言；不改键位、循环规则、队列过滤或 Workbench 内部焦点行为。Action: claim G8.2。

- **2026-07-14 · Codex（G8.2 completion）**：Action: 为已有 Workbench panel 的 `reveal` 传入 `preserveFocus=true`，首次创建 panel 时使用同等 showOptions；保留 Sidebar 既有显式列表聚焦、可见行过滤和 openItem 路径。Validated: TDD RED 锁定两个焦点保留 caller；`npm run compile` 通过；sidebar/message-handler 相关测试 89 pass；fresh `npm test` 456 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——点击任意邮件后直接按 ↑/↓，确认 Workbench 跟随切换；在 pending folder 与已接受日程折叠组中确认跳过隐藏项和组头。Next: G8.3。

  **Completion Notes**
  - 改动文件：`src/extension.ts`、`src/test/sidebar-render.test.ts`、本计划。
  - 实现边界：只改变 Sidebar 发起的 Workbench 首开/reveal 焦点策略；未改变命令直接打开 Workbench 时的 toggle 语义、键位、循环或队列筛选。
  - 验收结果：首次创建和既有 panel reveal 两条路径都有 caller 级回归断言；既有可见行导航测试继续通过；全量 456 pass。
  - Manual validation：**needs user validation**，按用户要求由用户在 Extension Development Host 手动验证普通队列与两类折叠组的 ↑/↓ 全流程。
  - Known issues：本轮未执行 UI 自动控制；真实 Webview 焦点链仍以用户手动结果为最终依据。
  - Commit：`f59eedf`（本地，未 push）。

- **2026-07-14 · Codex（G8.3 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `ac52f37`；重新定位确认点击 Next Action 时 `openItem` 先用唯一 `data-next-action-id` 高亮，但 Workbench `showReader(threadId)` 随即回传 `focusSidebarItem(threadId)`，现有 `setActiveRow` 又以共享 `data-thread-id` 匹配同线程全部 action，覆盖唯一高亮。按钮文案锚点在 `dashboard-labels.ts` 的 `nextActions.markDone`。边界：保留当前 action 的唯一 id 选择，线程回传时不扩散到同线程兄弟 action；同步中英文按钮文案；不改 NextActionsStore、状态协议或排序。Action: claim G8.3。

- **2026-07-14 · Codex（G8.3 completion）**：Action: `setActiveRow` 在 Workbench 回传当前线程 id 时保留已激活的唯一 `data-next-action-id`，Next Action 行只按唯一 action id 匹配；中英文完成按钮改为“标记已完成 / Mark Done”。Validated: TDD RED 同时锁定共享 threadId 高亮回归与双语文案；`npm run compile` 通过；sidebar/labels 相关测试 55 pass；fresh `npm test` 457 pass / 0 fail；`git diff --check` 通过。Manual: **needs user validation**——用一个含多个 actionItems 的 sample 线程进入 Next Actions，逐项点击确认始终只有一行高亮，并检查按钮新文案。Next: G8.4。

  **Completion Notes**
  - 改动文件：`src/lib/sidebar-render.ts`、`src/lib/dashboard-labels.ts`、`src/test/sidebar-render.test.ts`、`src/test/dashboard-labels.test.ts`、本计划。
  - 实现边界：只修 Sidebar 选择 id 的解析和双语按钮 label；未改 action 状态更新、store、排序或 Workbench reader。
  - 验收结果：两个共享 threadId 的 action row 仍有不同唯一 id；线程回传保留当前唯一 action，其他 Next Action 不再用 threadId 参与匹配；全量 457 pass。
  - Manual validation：**needs user validation**，真实 Webview 的单选高亮与新按钮文案由用户手动确认。
  - Known issues：Workbench 独立聚焦一个线程且此前没有选中 action 时，不会猜测应高亮哪个 Next Action；会优先匹配普通线程行，这是有意避免多选。
  - Commit：`1dac69c`（本地，未 push）。

- **2026-07-14 · Codex（G8.4 pre-work checkpoint）**：`v3` 工作树 clean，HEAD `8e9f5a4`；重新定位确认 `app-analysis.ts` 在 chunk 划分后掌握 batch/chunk 总数，但初始 progress 固定为 `Completed 0/N chunks.`，后续完成进度也固定英文；`analyze:chunkStart` 在 transport 前、`analyze:response` 在返回后记录，足以供真实日志判断两个请求是否重叠。边界：只恢复含邮件数/chunk 数的本地化初始 toast，并保持现有完成数/预计剩余时间语义；不改并发池、日志事件、估时算法或模型调用。真实 Copilot 并发实效按用户要求留给人工日志验证。Action: claim G8.4。

---

## 5. 规划者复审记录（2026-07-14）

**复审结论：G1-G7 全部通过**（复审范围 `fc062db..24e2906`）。独立验证：`npm test` 全绿；双 VBS `--help` 通过；`run-sample-validation.ps1` 端到端通过；vsix 拆包确认含 G1 并发常量与 G5 CSP。逐项要点：G1 共享游标 worker pool + `serializeMerge` promise 链串行化 + 取消不启新块 + 预估除以并行度，全部符合处方；G3 `keywordsHash` 变更触发全量重算已实现；G5 三个运行时模板 onclick 清零、CSP meta + nonce 齐备（`dashboard-render.ts` 残留的 14 处 onclick 经核实全部位于无生产 caller 的死代码路径 `renderDashboardHtml`，无运行时暴露，留待 11 计划 H1 处理）；G7 `redactStoredMails` 已覆盖附件名。已知可接受边界：G1 的 merge 串行链在写盘失败时会污染后续合并（磁盘故障场景，本就是灾难态，不另行处理）。

**人工验证以 §2.2 的 R3-M01~M14 表为准**（worker 制作的版本比规划者初版更全面，含环境记录与逐步操作，已采纳为唯一清单）。R3 验证通过后，11 号仓库整理计划的 H0 门槛解锁。

---

## 6. Milestone G8 — R3 人工验证反馈批（2026-07-14，M01-M14 结果：11 项通过、#5/#10-11 失败、若干小优化）

> 验证结果已由用户回填至 §2.2 语境（通过：M01-M04/M06-M09/M12-M14；失败：M05 manualConfirm 词表、M10/M11 方向键）。规划者已定位两个失败项根因。协议同 §0。

### [x] G8.1 manualConfirm 关键词命中不进 Manual Confirm 队列（M05，P1，根因已确证）— `5683136`

- **根因（已确证）**：`security-gate.ts` 的 `decideMail` 对 manualConfirmKeywords 的判定正确（L104-106），设置接线也完整；坏在队列归属——F7.3（`e857db4`）给 `buildQueueState` 的 `allowed` 过滤只加了 `securityDecisions.get(id)?.decision !== "block"`，**漏排 `manual_confirm`**。关键词命中的邮件 level 未超标 → 仍留在 allowed/Pending，永远进不了 blocked（Manual Confirm Required）队列。hardBlock 正常正是因为被排除了。
- **做法**：`allowed` 过滤改为排除 `decision === "block" || decision === "manual_confirm"`；确认 blocked 队列的 UI 文案/确认按钮对 keyword 型 manual_confirm 与 level 型行为一致（workbench 的 Confirm and Analyze 应可用）。顺带回答用户 M04 的疑问——在两个设置的 description 中写清差异：`classificationLevel3Keywords` 改变邮件**分级**（影响徽标显示与阈值比较，调高 `autoAnalyzeMaxClassificationLevel` 到 3 后可自动分析）；`manualConfirmKeywords` **无视分级强制人工确认**（任何阈值下都要确认）。两者在默认阈值下效果相似但机制不同，不是重复配置。
- **验收**：单测——keyword 命中进 blocked 队列、Confirm and Analyze 可分析、与 level 型行为一致；`npm test` 全绿。**needs user validation**：manualConfirmKeywords 加词后邮件进入 Manual Confirm Required 队列且可确认分析。

### [x] G8.2 方向键导航真机无反应（M10/M11，P1，高概率根因已定位）— `f59eedf`

- **现状**：G6 实现存在（`#itemList` tabindex=0 + keydown 监听，sidebar-render.ts ~L567/L742），单测通过但真机零反应。
- **首要假设**：点击邮件行触发 `openInWorkbench` → workbench panel `reveal()` **抢走焦点** → sidebar webview 失焦，方向键从此进不来。修法：workbench reveal 加 `preserveFocus: true`（sidebar 发起的打开/跟随不抢焦点；用户主动点 workbench 时焦点自然过去）。次要排查点：VS Code webview 中点击非聚焦子元素是否真的把焦点给到 tabindex 容器（必要时在行 mousedown 里显式 `itemList.focus()`）。
- **要求**：必须在 Extension Development Host 实测复现 → 修复 → 再实测 ↑/↓ 全流程（含折叠跳过），把观察写进 Completion Notes——G6 的教训是单测过了不等于真机可用。
- **验收**：`npm test` 全绿 + dev host 实测记录。**needs user validation**：点击邮件后直接 ↑/↓ 可切换且 workbench 跟随。

### [x] G8.3 Next Actions 多项高亮回归 + 按钮改名（额外反馈#1，P2）— `1dac69c`

- 用 sample 线程数据复现"多个 action 同时高亮"（F7.2 修过一次，线程来源的 action 疑似再破）；修复并补覆盖线程场景的单测。按钮 label：`Done/完成` → `Mark Done/标记已完成`（中英文）。
- **验收**：单测 + `npm test` 全绿。**needs user validation**：sample 线程下单选高亮正确。

### [~] G8.4 分析进度 toast 恢复丰富文案 + 并发实效核查（M01 附带要求 + 额外反馈#2，P2）

- 文案回滚增强：初始行恢复上一版信息量——`Analyzing 20 emails in 2 chunks…`（含邮件总数与 chunk 总数，替换现在干瘪的 `Completed 0/2 chunks.`）；进行中保留 `Completed x/N chunks (about X minutes remaining)`。中英文同步。
- **并发实效核查（用户反馈提速无感）**：在日志中对比同一次分析里两个 chunk 的 `analyze:chunkStart`/`analyze:response` 时间戳是否重叠——若 vscode.lm 对同会话请求内部串行化导致并发无效，如实记入 Completion Notes 的 Known issues（属平台限制，不强行绕），并在 §7 汇报给规划者。
- **验收**：单测锁初始文案；`npm test` 全绿。**needs user validation**：初始 toast 含邮件数与 chunk 数。

### [ ] G8.5 折叠组头视觉强化（额外反馈#3，P2）

- pending folder 组头与会议"已接受的日程"组头字体存在感不足：font-weight 提到 700、颜色用更亮的前景变量（如 `--vscode-sideBarSectionHeader-foreground`），可加少量 letter-spacing/上下 padding；不加大字号。两处组头样式统一。
- **验收**：`npm test` 全绿。**needs user validation**：目视组头明显但不突兀。

### [ ] G8.6 设置保存与动作按钮的竞态（额外反馈#4，P2）

- **现象**：sidebar 改 maxItems 后直接点 Fetch New，本次仍按旧值执行（需先点别处触发保存 toast 才生效）。
- **根因方向**：webview 消息（settings 更新、fetch）虽按序到达，但 `handleMessage` 异步并发处理——fetch 读 config 时 settings.update 还没落盘。
- **做法**：extension 侧跟踪"最近一次设置写入"的 promise（`updateSettings` 赋值），`pullMail`/`analyze` 等读取 config 的动作入口先 `await` 它再读配置。不改 UI、不加额外点击。注意别把长任务本身串进链里（只 await 设置写入，不 await 其他动作）。
- **验收**：单测——改设置消息后立刻发 fetch 消息，fetch 读到新值；`npm test` 全绿。**needs user validation**：改 maxItems 后直接点 Fetch New 即按新值工作。

### [ ] G8.7 设置枚举文案统一（额外反馈#5，P3）

- `easyMail.draftGeneration` 的 enumItemLabels `Automatic` → `Auto`（与 Draft Language 的 Auto 一致）；顺带扫一遍其余枚举 label 用词一致性。
- **验收**：`npm test` 全绿。

### [ ] G8.8 附件计数过滤内嵌图片（M12 用户"勉强接受"项，P3）

- **现状**：正文内嵌图片（签名 logo 等）被 Outlook 计为附件，导致大量邮件误挂 📎。
- **做法**：VBS `SafeAttachmentCount`/`SafeAttachmentNames` 过滤隐藏/内嵌附件——用 `Attachment.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x7FFE000B")`（PR_ATTACHMENT_HIDDEN）为 True 的跳过；读取失败时保守保留（宁可多算不可漏算真附件）；On Error 守护齐全。sample 不受影响。
- **验收**：VBS `--help`/`--sample` 通过；`npm test` 全绿。**needs user validation**：带签名图片的普通邮件不再显示 📎，真附件仍显示。

### [ ] G8.9 草稿动作时收起 Outlook Actions 下拉（额外反馈#8，P3）

- workbench 点击 Polish/Refine（或任何草稿动作）时，立即关闭处于展开态的 `details.draft-outlook-actions`（`document.querySelectorAll('details[open]')` 收起），不等任务结束由重渲染关闭。
- **验收**：单测断言收起逻辑存在；`npm test` 全绿。**needs user validation**：点 Polish 瞬间下拉收起。

---

## 7. 问答记录（2026-07-14 验证反馈随附问题）

- **M04 疑问（level3 词表 vs manualConfirm 词表是否重复）**：不重复，机制不同——前者改**分级**（徽标+阈值比较，受 `autoAnalyzeMaxClassificationLevel` 调节），后者**无视分级强制确认**。默认阈值 2 下两者效果相似；把阈值调到 3 时差异立现（level3 邮件自动分析、manualConfirm 命中仍要确认）。已在 G8.1 中要求写进设置 description。
- **额外#6（一次性 toast 存活时长）**：VS Code 无官方配置或 API 可延长 information message 的显示时长（只有 modal 阻塞式或 withProgress 常驻式两种替代，都不适合"设置已保存"这类轻提示）。按用户规则：不自造，放弃。补充：通知中心（右下角铃铛）可回看错过的历史通知。
- **额外#7（analysis incomplete toast 何时出现）**：这是 F1.2 对账兜底的提示——模型返回的 JSON 里**漏掉了某封送析邮件**（`0 chunk(s) skipped` 说明传输/解析都正常，纯属模型少返了一条）。该邮件被强制落入 Uncertain 并标注 "analysis incomplete: model omitted this mail"，保证不消失。处理：对该邮件单独点 Re-analyze 通常即可；若某模型频繁漏返可换模型。
- **M12 疑问（正文图片算附件）**：是 Outlook 的行为——内嵌图片（含签名 logo）在 COM 层就是 Attachment 对象。已立项 G8.8 过滤隐藏/内嵌附件。
