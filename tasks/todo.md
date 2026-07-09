- [x] 对设计文档做实现级补充，并固化验收标准
- [x] 实现 `collect-outlook-mails.vbs`
- [x] 实现 sample digest 生成路径
- [x] 实现 VS Code 扩展清单和入口
- [x] 实现本地配置与数据目录管理
- [x] 实现 `Pull Mail`
- [x] 实现 `Analyze with Copilot`
- [x] 实现 JSON 校验与 Markdown summary 生成
- [x] 实现 dashboard webview
- [x] 实现 `Copy Draft` / `Ignore` 交互
- [x] 实现本地自动化测试
- [x] 尝试打包 `.vsix`
- [x] 更新文档
- [x] 运行验证
- [x] 提交并推送

## 验收要求

- [x] 本地 sample 流程可跑通
- [x] 关键逻辑有测试
- [x] 远端仓库已更新

## 当前迭代

- [x] 定位 dashboard 现有实现
- [x] 增加 Pull / Analyze 进度反馈
- [x] 设置区改为按需展开
- [x] 让 `outputLanguage` 同时控制 UI 语言
- [x] 更新文档
- [x] 运行验证并推送

## 渐进式分析迭代

- [x] 固化设计文档
- [x] 新增 mail store 与稳定去重 id
- [x] 新增 pending / blocked / analysed 队列状态
- [x] 新增 batch / selected 分析入口
- [x] 新增 classification gating 配置与默认分类器
- [x] 新增 prompt 组合与自定义分类配置
- [x] 更新 dashboard 控件和文档
- [x] 增加测试并打包
- [x] 提交并推送

## v0.2 / Issue 1: Single Mail Analysis Schema and Evidence

- [x] 目标：只实现 `easy-mail-repo-specific-implementation-plan.md` 中 v0.2 / Issue 1
- [x] 验收：旧 JSON 仍可解析
- [x] 验收：新 JSON 中 optional `source` / `evidence` 可保留
- [x] 验收：summary 可选显示 evidence
- [x] 验收：`prompts/output-schema.md` 描述新增字段
- [x] 验收：`npm test` 通过

### Working Notes

- `architecture-background.md` 只作为背景；本轮唯一执行依据是 `docs/v2-design/easy-mail-repo-specific-implementation-plan.md`。
- 不实现 Issue 2/3，不改 thread/security gate，不打包，除非后续明确要求。
- 保留 existing single mail analysis pipeline，不改变 category / priority / draft reply 行为。

## v0.3 Wave 0-1: Thread Timeline MVP Data Layer

- [x] Wave 0：确认 v0.2 / Issue 1 成果存在
- [x] Wave 0：baseline `npm test` 通过
- [x] Wave 1A：Thread Data fields
- [x] Wave 1B：Thread Store / Engine
- [x] Wave 1C：Thread Timeline helpers
- [x] Wave 1：统一验证 `npm test`

### Working Notes

- 本阶段从 `docs/v2-design/easy-mail-repo-specific-implementation-plan.md` 的 v0.3 Thread Timeline MVP 开始。
- `src/extension.ts` 暂不修改，留给后续 Thread Timeline Integration Agent。
- `scripts/collect-outlook-mails.vbs`、`src/lib/digest.ts`、`src/lib/mail-store.ts` 归 Thread Data Agent。
- `src/lib/thread-store.ts` / `src/lib/thread-engine.ts` 归 Thread Engine Agent。
- `src/lib/thread-timeline.ts` 归 Thread Timeline Agent。

## v0.3 Wave 1 Integration: Thread Timeline MVP

- [x] pull mail 后写入 `thread-store.json`
- [x] `thread-store` 合并新旧线程，避免分析后清空 `mail-store` 导致线程上下文立即丢失
- [x] clear local cache 同步清空 thread store
- [x] Dashboard 显示 Threads 面板和 thread 统计
- [x] 邮件卡片显示所属 thread，并可跳转到 thread card
- [x] Thread timeline mailId 可跳回邮件卡片
- [x] `npm test` 通过

### Working Notes

- 本轮只完成 v0.3 Thread Timeline 阅读能力，不调用 Copilot 做 Thread AI。
- 没有新增 Outlook 写回能力，仍保持只读。
- `src/extension.ts` 只做 thread-store 接入和 dashboard render 扩展。

## v0.4 Wave 2: Redaction + Security Gate

- [x] Wave 2E：新增 Redaction 纯模块和单测
- [x] Wave 2F：新增 Security Gate 纯模块和单测
- [x] Wave 2：统一接入测试脚本并运行 `npm test`
- [x] Wave 2：提交纯模块小提交
- [x] Wave 2 Integration：分析入口过滤 block，手动选择允许 manual_confirm
- [x] Wave 2 Integration：AI payload 使用 redacted mail digest
- [x] Wave 2 Integration：Dashboard 显示 mail/thread security 状态
- [x] Wave 2 Integration：统一验证 `npm test`

### Working Notes

- 本阶段先不接 `src/extension.ts`，不改变现有 Single Mail 分析入口。
- `classification.ts` 保持为 Security Gate 的输入，不推倒重写。
- Wave 2 Integration 已接入 redacted payload、block/manual_confirm 行为和 Dashboard 安全状态。

## v0.5 Wave 3: Thread AI Foundation

- [x] 当前状态：`main` 已同步远端，Wave 2 完成且工作树干净
- [x] 决策：先做 Thread AI schema / prompt builder 纯模块，不接 UI / Copilot
- [x] 新增 `thread-analysis-schema.ts` 和 schema tests
- [x] 新增 `thread-prompt-builder.ts`、thread prompts 和 prompt builder tests
- [x] 运行 `npm test`
- [x] 提交 v0.5 foundation 小提交

### Working Notes

- 本切片不修改 `src/extension.ts`，避免把 Thread AI command、Dashboard 和 Copilot 调用一次性混入。
- Thread prompt 输入使用 JSON-like timeline，不复用 single mail Markdown digest。
- Provider abstraction 仍然推迟到 Thread AI 跑通之后。

## v0.6 Wave 3: Reports Foundation

- [x] 新增 single mail report 纯模块和测试
- [x] 新增 thread report 纯模块和测试
- [x] 新增 daily brief 纯模块和测试
- [x] 接入主 `npm test`
- [x] 提交 reports foundation 小提交

### Working Notes

- Reports 只消费已分析结果字段，不读取 mail-store 原始正文。
- Reports 暂不接 Dashboard / commands，留给后续 Integration Agent 决定入口。

## v0.5 Wave 3 Integration: Thread AI

- [x] 新增 `thread-analysis-result.json` 读写
- [x] 新增 `Analyze Thread` command / Dashboard 入口
- [x] Thread AI prompt 使用 redacted timeline
- [x] blocked thread 不进入模型
- [x] Dashboard 展示 Thread Analysis 摘要
- [x] 运行 `npm test`

### Working Notes

- 本阶段仍然不做 Provider abstraction。
- Reports 生成器已存在，但暂不接 Dashboard / commands。

## Wave 3.5: Reports Integration

- [x] 新增 Daily Brief / Thread Report / Single Mail Report 生成入口
- [x] Dashboard 增加报告生成和打开按钮
- [x] 报告写入本地 `data/*.md`
- [x] 运行 `npm test`

### Working Notes

- 本切片只接入现有 report 纯模块，不做 Provider abstraction。
- 报告只消费已分析结果，不读取 `mail-store` 原始正文。

### Results

- 新增 `Generate Reports` / `Open Daily Brief` / `Open Thread Report` / `Open Single Mail Report` 命令和 Dashboard 按钮。
- 报告文件输出到本地 data 目录：`daily-brief.md`、`thread-report.md`、`single-mail-report.md`。
- `npm test` 通过。

## Wave 4: Provider Abstraction

- [x] 新增 `LlmProvider` 接口和模型选择 helpers
- [x] 新增 `CopilotProvider`，复用当前 `vscode.lm` 行为
- [x] 新增 `MockProvider` 和 provider unit tests
- [x] Single Mail AI / Thread AI 统一走 provider
- [x] 运行 `npm test`

### Working Notes

- 本阶段最后做 Provider abstraction，不再改 Thread AI / Reports 业务逻辑。
- 不实现复杂 OpenAI-compatible / internal API provider，只预留接口边界。
- `src/extension.ts` 是高冲突集成文件，由主线程串行修改。

### Results

- 新增 provider 边界：`llm-provider.ts`、`copilot-provider.ts`、`mock-provider.ts`。
- Dashboard 模型列表与分析发送路径共用同一套模型选择 helper。
- Single Mail AI 和 Thread AI 继续使用 Copilot，但经由 `LlmProvider` 调用。
- `npm test` 通过。

## Dashboard Bugfix: Progress, Counts, Navigation, Settings

- [x] 定位 busy 进度条不收尾、语言切换卡顿、统计不准、忽略不可见、settings 同步不一致的交互层根因
- [x] 修复 analysed / ignored dashboard 状态计算
- [x] 修复 thread timeline normalize/display ASC
- [x] 统一 dashboard settings 自动同步到 VS Code Settings
- [x] 移除 dashboard settings 的手动保存按钮，自动保存时显示 VS Code toast
- [x] 让统计小卡片可跳转并展开对应 panel
- [x] 运行测试并重新打包

### Working Notes

- `mail-store` 在分析后会移除原文队列，因此已分析数量必须从 `analysis-result.json` 计算。
- Dashboard 渲染不能被 `vscode.lm.selectChatModels()` 长时间阻塞，模型列表需要缓存和短超时。
## Dashboard Regression Rework

### Scope

- [x] P1: Sample data progress must end and sample can be reloaded for demos.
- [x] P2: Analyze progress must end after model response, and analysed count must reflect `analysis-result.json`.
- [x] P3: Ignore must log the action, move analyzed mails into Ignored, and refresh without hanging.
- [x] P4: Language switching must not trigger automatic Copilot model discovery.
- [x] P5: Analyze Thread button must either run or show an actionable error; timeline must render ASC.
- [x] P6: Stat tiles must jump to and expand the target panel.
- [x] P7: Settings panel uses one behavior only: dashboard controls auto-save to VS Code Settings.
- [x] P8: Model list is loaded only by explicit user action, persists until manually reloaded, and is not auto-refreshed on extension open.
- [x] P9: Replace extension/activity icon with transparent-background icon from docs/v2-design/icon.png.

### Evidence

- Runtime log shows `pullMail:done` and `analyze:done` without `busy:end`; root is an awaited dashboard refresh inside task core.
- Runtime log shows repeated sample data got `added:0, skipped:4, storeItems:0`; sample mode was incorrectly subject to historical index de-dup for demo reload.

## Dashboard Regression Rework Round 2

### Scope

- [x] R2-1: Sample data busy/toast/dashboard progress must end without VS Code reload.
- [x] R2-2: Analyze busy/toast/dashboard progress must end and analysed count must refresh without VS Code reload.
- [x] R2-3: Ignore action must work from classified mail cards and move the item into Ignored.
- [x] R2-4: Language switch must remain responsive after other fixes.
- [x] R2-5: Analyze Thread button must respond, and thread timeline display must be ASC/chat-style.
- [x] R2-6: Stat tiles must jump to and expand the corresponding category/thread panel.
- [x] R2-7: Load Models control must be a compact action next to Analysis Model.
- [x] R2-8: Dashboard should explain or avoid singleton mail threads in the thread category.

### Working Notes

- Runtime logs show `pullMail:done` / `analyze:done` before `busy:end`; one confirmed cause is awaiting VS Code information notifications inside progress tasks.
- Fixes in this round must be sequential and verified point by point.
- R2-1 fix: sample/pull completion notification is no longer awaited, so the progress task can reach `busy:end` immediately after pull completes.
- R2-2 fix: single-mail analysis completion notification is no longer awaited; existing analysed count already comes from `analysis-result.json`, so the missing piece was the blocked final refresh.
- R2-3 fix: ignore now records the target panel in webview state, shows a non-blocking ignored toast, refreshes, and reopens the Ignored panel after render.
- R2-4 check: language toggle still only posts `saveConfig`; dashboard render reads cached models from disk and does not call Copilot model discovery.
- R2-5 fix: thread analysis completion notification is no longer awaited, and timeline display now sorts by received/sent time ASC before using `conversationIndex` as a tie-breaker.
- R2-6 fix: stat tile navigation now records/restores the target panel, opens details panels, updates the hash, scrolls, and focuses the panel with a visible outline.
- R2-7 fix: Load Models is now a compact inline action beside the Analysis Model field title.
- R2-8 fix: thread records with a single message remain in storage for future merging, but Dashboard thread stats/panel/linking only use threads with more than one message.

## Dashboard Interaction Rework Round 3

### Scope

- [x] R3-1: Fix card-level dynamic button handlers for Ignore, Copy Draft, and Analyze Full Thread.
- [x] R3-2: Remove low-value auto-allowed badge from pending cards.
- [x] R3-3: Make Analyze Next explicit about batch size.
- [x] R3-4: Simplify low-utility report/debug toolbar buttons.
- [x] R3-5: Hide or guard Copy Draft when there is no draft reply.
- [x] R3-6: Change language toggle to globe/text/chevron style.
- [x] R3-7: Clarify thread analysis means whole-thread context, not the latest single mail only.

### Working Notes

- R3 root cause: card-level buttons embedded JS literals inside double-quoted `onclick` attributes, so dynamic ids/draft text broke the handler before messages reached the extension.
- Thread analysis button now says full-thread analysis; it analyzes the thread timeline/context, not only the newest mail.

## Dashboard Interaction Rework Round 4

### Scope

- [x] R4-1: Remove standalone Dashboard busy/progress row and show an inline spinner on the active toolbar button.
- [x] R4-2: Ignore should not jump to or expand the Ignored panel after click.
- [x] R4-3: Ignored category cards should not show another Ignore action.
- [x] R4-4: Replace text copy buttons with an overlaid copy icon inside draft blocks for single-mail and thread drafts.

### Working Notes

- Progress remains visible in VS Code notification/toast; Dashboard now keeps the surface compact by showing spinner state inside the active button.
- Ignore now only updates local ignored state and refreshes in place; it no longer opens the Ignored panel.

## Dashboard Interaction Rework Round 5

### Scope

- [x] R5-1: Open the Easy Mail walkthrough automatically on first activation after install, and expose a Dashboard `?` button to reopen it.
- [x] R5-2: Category/pending/thread panels should default to closed.
- [x] R5-3: Normal toolbar actions must not restore a previous panel jump after refresh.
- [x] R5-4: Localize the Analysis Model setting label.

### Working Notes

- Walkthrough is now both automatic-once via VS Code globalState and manually accessible from the Dashboard help button.
- Panel jumps are now immediate-only for stat tile clicks; they are no longer stored and replayed after refresh.

## Dashboard Interaction Rework Round 6

### Scope

- [x] R6-1: Preserve open category/thread panels across dashboard refresh without scrolling.
- [x] R6-2: Make the Dashboard `?` help entry visibly open packaged help even when VS Code walkthrough command resolves without showing UI.

### Working Notes

- Open panel state is now a list of expanded `details.category` ids, restored only as expanded state, not as scroll position.
- The walkthrough command logs as successful in this environment, but the user can still miss it visually; opening `user guide.md` gives a deterministic visible fallback.

## Next UX Slice: Guide, Outlook Open, Reply Template, Translation

### Scope

- [x] G1: Replace the fragile walkthrough-only help path with a custom Easy Mail Guide webview.
- [x] G2: Wire first activation and Dashboard `?` to the same visible Guide webview.
- [x] G3: Verify compile/tests after Guide changes.
- [x] O1: Add a minimal read-only Open in Outlook path for classic Outlook using stored item identifiers.
- [x] R1: Add reply draft prompt/template support without changing Outlook send behavior.
- [x] L1: Add a safe language-switch translation plan/slice for existing analysis results.

### Working Notes

- Native VS Code walkthrough contribution stays in `package.json`, but runtime help should not depend on whether VS Code visibly surfaces it.
- Open in Outlook must remain read-only: display only, no send/delete/move/archive/mark-read writeback.
- G1-G3 result: added `src/lib/guide-webview.ts`, an `easyMail.openGuide` command, a versioned first-run Guide panel, and a Dashboard `?` entry that opens the same panel. `npm test` passes.
- O1 result: added `StoreId` collection/index preservation, a read-only `open-outlook-mail.vbs` display helper, and `Open in Outlook` buttons on analyzed mail cards. `npm test` passes.
- R1 result: added `reply-draft-prompt.md`, user-editable `reply-template.md`, `draftReplyParts` schema support, template rendering, and an `Open Reply Template` command. `npm test` passes.
- L1 result: language toggle now asks whether to translate existing analysis or switch UI only; translation updates display analysis fields, preserves categories/evidence/source/draft replies, and writes language metadata. `npm test` passes.

## Small UX Adjustments

### Scope

- [x] Rename visible reply template references to `reply-template.md`.
- [x] Show elapsed time for all `runWithBusy` long-running operations.
- [x] Render thread Timeline above Thread Analysis.
- [x] Swap Settings panel order so Allow Auto Analysis is left of Max Auto Classification.

### Working Notes

- Long-running operations covered by `runWithBusy`: fetch new mail, more history, sample data, mail analysis, thread analysis, reports, model loading, and translation.
