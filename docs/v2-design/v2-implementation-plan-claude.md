# Easy Mail V2 — Refactoring + UI Redesign Implementation Plan

## Context

Easy Mail 是一个 VS Code 扩展，通过 VBScript COM 自动化从经典 Outlook 收集邮件，用 GitHub Copilot（VS Code Language Model API）分析，结果显示在 webview dashboard 中。

**当前问题**：
1. `src/extension.ts` 是 2672 行的巨石文件（God Class），承载了 UI 渲染、数据持久化、LLM 调用、消息分发、配置管理等 6 种职责
2. 当前 dashboard UI 是 POC 级别——视觉层级扁平、操作按钮过多且无优先级、统计卡片等权重、暗色主题不匹配
3. V2 设计方向已有 3 套方案（D1 运维控制台 / D2 审阅队列 / D3 分体工作台）和详细组件设计文档，但尚未开始实现

**目标**：拆分巨石文件 → 重新设计 UI → 基于重构后架构实现新 UI → 编译通过、测试通过、VSIX 打包可用。

**分支**：`v2`（从 `main` 分叉，V1 功能完整）

---

## Verifiable Goals（可验收目标）

| # | 目标 | 验收标准 |
|---|------|---------|
| G1 | extension.ts 从 2672 行降至 ~500 行 | `wc -l src/extension.ts` ≤ 600 |
| G2 | 拆分出的模块全部有单元测试 | 新增 ≥8 个 test 文件，`npm test` 全部通过 |
| G3 | 零功能回归 | 所有 19 个命令正常工作（手动验证） |
| G4 | 新 Sidebar UI（窄屏队列模式） | 安装 VSIX 后 sidebar 显示新布局，队列过滤可用 |
| G5 | 新 Workbench UI（编辑器区域三栏模式） | `easyMail.openWorkbench` 命令打开三栏工作台 |
| G6 | 编译零错误 | `npm run compile` 成功 |
| G7 | 测试全部通过 | `npm test` ≥ 80 tests pass, 0 fail |
| G8 | VSIX 打包成功 | `npm run package:vsix` 生成 .vsix 文件 |

---

## Phase 0: Pre-flight（基线确认）

**Goal**: 确认当前代码可编译、测试通过、可打包。

**Steps**:
1. `npm run compile` — 零错误
2. `npm test` — 71 tests pass
3. `npm run package:vsix` — 生成 VSIX

**Deliverable**: 确认基线 commit `6d79b34` 状态良好。

---

## Phase 1: 提取纯工具模块（~390 行移出，零行为变化）

将 extension.ts 底部的无状态纯函数按职责分组提取。这些函数不依赖 `this` 或 VS Code API，机械搬运即可。

### 1a: `src/lib/html-utils.ts`（~45 行）

**提取函数**（extension.ts 2352-2387）:
- `escapeHtml`, `escapeAttr`, `domIdForMail`, `domIdForThread`, `domIdForThreadMessage`, `domIdForCategory`, `safeDomId`, `selected`, `toJsLiteral`

**新建测试**: `src/test/html-utils.test.ts`
**验证**: `npm run compile && npm test`

### 1b: `src/lib/config-utils.ts`（~80 行）

**提取函数**（extension.ts 2389-2523 散布）:
- `Locale` 类型
- `positiveNumber`, `parseFolders`, `mergeStringLists`, `serializeFolderDateMap`, `getLocaleFromConfig`
- `buildSecuritySettings`, `buildDefaultRedactionPolicy`

**依赖**: `SecurityGateSettings`（from security-types）, `RedactionPolicy`（from redaction）— 仅类型依赖。

**新建测试**: `src/test/config-utils.test.ts`
**验证**: `npm run compile && npm test`

### 1c: `src/lib/dashboard-labels.ts`（~280 行）

**提取内容**（extension.ts 28-350）:
- `DashboardLabels` 类型定义
- `LABELS` 常量（zh-CN + en-US，~270 行纯数据）
- `getLabels()`, `buildCategoryLabels()`

**依赖**: `Locale`（from config-utils）, `PromptConfig`（from prompt-config）

**新建测试**: `src/test/dashboard-labels.test.ts`
**验证**: `npm run compile && npm test`

### 1d: `src/lib/process-runner.ts`（~70 行）

**提取函数**（extension.ts 2299-2350, 2640-2671）:
- `runProcess`, `sanitizeProcessArgs`, `formatError`, `formatElapsedSeconds`, `deleteFileIfExists`

**依赖**: `node:child_process`, `node:fs`

**新建测试**: `src/test/process-runner.test.ts`
**验证**: `npm run compile && npm test`

### Phase 1 小结
- extension.ts: 2672 → ~2280 行
- 新增 4 个 lib 模块 + 4 个 test 文件

---

## Phase 2: 提取数据层和分析逻辑（~680 行移出）

### 2a: 将剩余独立函数迁移到已有模块

把 extension.ts 中剩余的独立函数归入它们逻辑上属于的现有模块：

| 函数 | 目标模块 | 理由 |
|------|---------|------|
| `mergeAnalysisResults`, `pruneAnalysisResult` | `analysis-schema.ts` | 操作 AnalysisResult 类型 |
| `mergeThreadAnalysisResults` | `thread-analysis-schema.ts` | 操作 ThreadAnalysisResult |
| `buildMailSecurityDecisionMap`, `canAnalyzeMail` | `security-gate.ts` | 安全决策逻辑 |
| `fallbackClassification` | `classification.ts` | 默认分类 |
| `redactStoredMails`, `redactThreadForPrompt` | `redaction.ts` | 脱敏组合函数 |
| `filterVisibleThreadsForDashboard`, `buildThreadLookup`, `compareTimelineMessagesForDisplay` | `dashboard-state.ts` | Dashboard 数据筛选 |

**更新现有测试**：为每个目标模块的 test 文件添加新测试 case。

**验证**: `npm run compile && npm test`

### 2b: `src/lib/app-data.ts`（~250 行）

**提取内容**：EasyMailApp 中所有 get*Path() (16个) + read*/write* (20+个) 方法。

**设计**:
```typescript
export interface AppPaths {
  globalStorageDir: string;
  extensionDir: string;
}

export class AppDataStore {
  constructor(private readonly paths: AppPaths) {}
  
  // 16 个路径方法
  getDataDir(): string { ... }
  getMailStorePath(): string { ... }
  // ...
  
  // 20+ 个读写方法
  async readMailStore(): Promise<MailStore> { ... }
  async writeMailStore(store: MailStore): Promise<void> { ... }
  // ...
  
  // 状态方法
  async ensureConfig(): Promise<void> { ... }
  async readConfig(): Promise<Record<string, unknown>> { ... }
  async loadState(): Promise<DashboardRenderInput> { ... }
}
```

**EasyMailApp 中**: `this.data = new AppDataStore(...)`, 所有 `this.read*()` → `this.data.read*()`

**新建测试**: `src/test/app-data.test.ts`（路径计算 + 配置合并逻辑）
**验证**: `npm run compile && npm test`

### 2c: `src/lib/app-analysis.ts`（~200 行）

**提取内容**：
- `analyzeBatchCore`（~90 行）
- `analyzeThreadCore`（~40 行）  
- `sendPromptToModel`（~25 行）
- `translateExistingAnalysis`（~30 行）

**设计**:
```typescript
export interface AnalysisContext {
  data: AppDataStore;
  llmProvider: LlmProvider;
  extensionPath: string;
  log: (event: string, data: Record<string, unknown>) => Promise<void>;
}

export async function analyzeBatchCore(ctx: AnalysisContext, selection?: "allAllowed" | string[]): Promise<{ batchSize: number }> { ... }
export async function analyzeThreadCore(ctx: AnalysisContext, threadId: string): Promise<{ subject: string }> { ... }
```

**新建测试**: `src/test/app-analysis.test.ts`
**验证**: `npm run compile && npm test`

### 2d: `src/lib/message-handler.ts`（~150 行）

**提取内容**：`handleMessage`（24 分支的 if-else 分发）+ `saveConfigFromMessage`

**设计**:
```typescript
export interface MessageHandlerContext {
  // 所有 EasyMailApp 的公开操作方法的引用
  refresh: () => Promise<void>;
  pullMail: (forceSample?: boolean) => Promise<void>;
  analyze: () => Promise<void>;
  // ... 其余操作方法
}

export async function handleWebviewMessage(ctx: MessageHandlerContext, message: unknown): Promise<void> { ... }
```

**新建测试**: `src/test/message-handler.test.ts`
**验证**: `npm run compile && npm test`

### Phase 2 小结
- extension.ts: ~2280 → ~1600 行
- 新增 3 个 lib 模块 + 3 个 test 文件
- 更新 5+ 个现有 test 文件

---

## Phase 3: 提取 Dashboard 渲染（~850 行移出）

### 3a: `src/lib/dashboard-render.ts`（~500 行）

**提取内容**：
- `getDashboardHtml()`（324 行） → 转为纯函数 `renderDashboardHtml(input)`
- 所有 `render*` 函数（14 个）
- 所有 `format*` 函数（8 个）
- `openTextDocument`（保留在 extension.ts，因为依赖 vscode API）

**设计**:
```typescript
export interface DashboardRenderInput {
  state: DashboardState;
  store: MailStore;
  threadStore: ThreadStore;
  threadAnalysis: ThreadAnalysisResult | null;
  config: Record<string, unknown>;
  locale: Locale;
  busy: BusyState | null;
  availableModels: AvailableModel[];
  // ... 其余所需数据
}

export function renderDashboardHtml(input: DashboardRenderInput): string { ... }
```

**核心转换**：`getDashboardHtml()` 从 `this.loadState()` 的结果组装数据，传入纯函数。EasyMailApp 中的 `getDashboardHtml()` 变成 ~10 行的数据组装 + 调用。

**新建测试**: `src/test/dashboard-render.test.ts`
**验证**: `npm run compile && npm test`

### 3b: `src/lib/dashboard-provider.ts`（~30 行）

**提取内容**：DashboardProvider class（extension.ts 2017-2043）

已经是独立的小类，机械搬运。

**验证**: `npm run compile && npm test`

### Phase 3 小结
- extension.ts: ~1600 → ~500-600 行
- 新增 2 个 lib 模块 + 1 个 test 文件

---

## Phase 4: 最终清理 + 重构验收

**Goal**: extension.ts 只保留 activate/deactivate + EasyMailApp 协调逻辑。

### 4a: 清理 extension.ts

重构后 extension.ts 应包含：
- imports（~30 行）
- `activate()` + command 注册（~35 行）
- `deactivate()`（1 行）
- `EasyMailApp` class：
  - 状态字段 + 构造函数（~20 行）
  - `initialize()`（~15 行）
  - Guide 面板方法（~80 行）
  - `pullMail/loadMore/pullMailCore`（~60 行，可后续提取）
  - `analyze*/runWithBusy` 等薄包装（~50 行）
  - `open*/clear*/change*` 等委托方法（~50 行）
  - `loadState()`（~55 行，如果没移入 app-data）
  - `getDashboardHtml()` 薄包装（~10 行）
  - `handleMessage()` 薄包装（~5 行）
  - `log/initializeLogger`（~15 行）
- 总计 ~500 行

### 4b: 检查循环依赖

确保所有模块依赖是单向的：
```
extension.ts
  └→ app.ts (EasyMailApp)
       ├→ app-data.ts
       ├→ app-analysis.ts
       ├→ dashboard-render.ts → dashboard-labels.ts, html-utils.ts
       ├→ message-handler.ts
       ├→ config-utils.ts
       └→ process-runner.ts
```

### 4c: 重构验收

- [ ] `npm run compile` — 零错误
- [ ] `npm test` — ≥79 tests pass（原 71 + 新 8+）, 0 fail
- [ ] `npm run package:vsix` — VSIX 生成成功
- [ ] Git commit: "refactor: split extension.ts into focused modules"

---

## Phase 5: UI Redesign — Sidebar 模式

**设计理念（Claude 版方案 — 两阶段自适应）**:

核心洞察：VS Code sidebar 约 350px 宽，硬塞三栏不现实。Sidebar 负责"快速扫描 + 分诊"（D2 思路），编辑器区域的 Workbench 负责"深度审阅"（D3 思路）。两种模式共享数据和渲染组件。

### 5a: Sidebar 布局设计

```
┌─────────────────────────┐
│ ● Idle · Last: 09:12    │  ← 一行运行状态
│ [Fetch] [Analyze 5]     │  ← 两个主操作按钮
├─────────────────────────┤
│ ⚠ Needs Confirm    4    │  ← 队列计数，可点击过滤
│ ■ Must Handle      2    │
│ ■ Risk             1    │
│ · Waiting          3    │
│ · Pending         12    │
│ · Notice          28    │
│ · Threads          6    │
├─────────────────────────┤
│ ▸ Contract approval...  │  ← 紧凑行，点击展开详情
│   From: Alice           │
│   P0 · Reply needed     │
│   [Open] [Ignore]       │
│ ▸ Budget review Q3...   │
├─────────────────────────┤
│ Settings · Reports · ⋯  │  ← 底部安静区
└─────────────────────────┘
```

**设计原则**:
- 暗色中性底色，使用 VS Code CSS 变量（`--vscode-editor-background` 等）
- 超扁平、高密度、状态驱动
- 队列计数即导航 — 点击过滤下方列表
- 所有 item 预渲染，JS 控制 `data-queue` 属性的显隐
- 详情用 disclosure 展开，不跳转

### 5b: 实现 Sidebar 渲染

**修改文件**: `src/lib/dashboard-render.ts`
- 新增 `renderSidebarHtml(input: DashboardRenderInput): string`
- CSS 使用 VS Code design tokens
- Client-side JS 处理队列过滤、行展开、消息分发

**CSS 关键 token**:
```css
--vscode-sideBar-background
--vscode-sideBar-foreground  
--vscode-button-background
--vscode-badge-background
--vscode-list-hoverBackground
--vscode-list-activeSelectionBackground
--vscode-focusBorder
```

### 5c: 队列过滤逻辑

- 所有 item 按 `data-queue="mustHandleToday"` 等属性分组渲染
- JS 切换 `.active` 类控制显隐
- 默认显示第一个非空队列（Must Handle > Risk > Pending > Notice）

### 5d: 线程视图（Sidebar 内）

- Threads 队列中显示线程卡片（subject, 参与者数, 消息数, 最后时间）
- 展开显示紧凑时间线（sender + time + bodyDelta 首行）
- "Analyze Thread" 按钮

### 5e: Sidebar 验收

- [ ] `npm run compile` — 零错误
- [ ] `npm test` — 全部通过
- [ ] `npm run package:vsix` — 成功
- [ ] 手动验证：安装 VSIX，sidebar 显示新布局
- [ ] 手动验证：队列过滤、行展开、所有按钮可用
- [ ] 手动验证：zh-CN 和 en-US 切换正常
- [ ] 手动验证：暗色和亮色主题兼容
- [ ] Git commit: "feat: new sidebar UI with queue-first triage"

---

## Phase 6: UI Redesign — Workbench 模式

### 6a: 注册 Workbench 命令

- `package.json` 新增 `easyMail.openWorkbench` 命令
- `activate()` 中注册打开 `WebviewPanel` 的逻辑

### 6b: 三栏布局实现

```
┌──────────┬──────────────────────┬─────────────────────┐
│ Queues   │ Must Handle (2)      │ Contract approval   │
│          │                      │                     │
│ ⚠ Confirm│ ▸ Contract approval  │ From: Alice         │
│ ■ Must 2 │ ▸ Budget review      │ P0 · mustHandleToday│
│ ■ Risk 1 │                      │                     │
│ · Wait 3 │                      │ Summary: ...        │
│ · Pend 12│                      │ Reason: ...         │
│ · Notice │                      │ Action: ...         │
│ · Thread │                      │                     │
│          │                      │ [Draft Reply]       │
│ ─────── │                      │ --- Timeline ---    │
│ Reports  │                      │ [Open] [Ignore]     │
│ Settings │                      │ [Analyze Thread]    │
└──────────┴──────────────────────┴─────────────────────┘
```

**新建文件**: `src/lib/workbench-render.ts`（~400 行）
- 左栏导航 rail（~200px）：section + count badge
- 中栏列表（~350px）：当前 section 的 item 列表
- 右栏详情（剩余宽度）：选中 item 的完整信息

### 6c: 详情面板模式

- **邮件详情**：完整卡片、evidence、draft reply、操作按钮
- **线程详情**：完整时间线、分析摘要、action items、risks
- **报告预览**：渲染的 markdown
- **设置面板**：完整设置表单

### 6d: Workbench 验收

- [ ] `npm run compile && npm test` — 通过
- [ ] 手动验证：命令打开三栏工作台
- [ ] 手动验证：导航切换、item 选择、详情展示
- [ ] Git commit: "feat: workbench mode with three-column layout"

---

## Phase 7: 集成和收尾

### 7a: Sidebar ↔ Workbench 联动

- Sidebar 中 "Open in Workbench" 按钮 → 打开 Workbench 并选中该 item
- 双击 sidebar item → 打开 Workbench

### 7b: 删除旧渲染器

- 移除旧的 `renderDashboardHtml`（Phase 3 的过渡版本）
- 清理未使用的 render/format 函数

### 7c: 最终验收

- [ ] `npm run compile` — 零错误
- [ ] `npm test` — ≥80 tests pass, 0 fail
- [ ] `npm run package:vsix` — VSIX 文件生成
- [ ] 手动测试清单：
  - 所有 19 个命令正常工作
  - Sidebar 新布局显示正确
  - 队列过滤功能可用
  - Item 展开/折叠正常
  - Workbench 三栏布局正常
  - 线程时间线显示正确
  - zh-CN 和 en-US 语言切换正常
  - 暗色和亮色主题兼容
  - Sample 模式可用（无需 Outlook）
- [ ] Git commit: "v2: complete UI redesign with sidebar + workbench"
- [ ] `git push origin v2`

---

## Execution Order and Dependencies

```
Phase 0 (baseline)
    │
    ├── Phase 1a (html-utils) ──┐
    ├── Phase 1b (config-utils) ┤ 可并行
    ├── Phase 1c (labels)       ┤
    └── Phase 1d (process-runner)┘
            │
        Phase 2a (relocate standalone functions)
            │
            ├── Phase 2b (app-data)
            │       │
            │   Phase 2c (app-analysis)  ← 依赖 2b
            │
            └── Phase 2d (message-handler) ← 可与 2c 并行
                    │
                Phase 3a (dashboard-render) ← 依赖 Phase 2
                Phase 3b (dashboard-provider) ← 可与 3a 并行
                    │
                Phase 4 (final cleanup)
                    │
                Phase 5 (sidebar UI)
                    │
                Phase 6 (workbench UI)
                    │
                Phase 7 (integration)
```

---

## Skills 清单

已确认可用的 skills：

| Skill | 路径 | 用途 | 阶段 |
|-------|------|------|------|
| taste-skill (design-taste-frontend) | `C:\Users\Wsr\.claude\skills\taste-skill` | 视觉层级和组件设计 | Phase 5-6 |
| redesign-existing-projects | `C:\Users\Wsr\.claude\skills\redesign-existing-projects` | 系统性 UI 转换方法论 | Phase 5-6 |
| minimalist-skill | `C:\Users\Wsr\.claude\skills\minimalist-skill` | 极简设计原则 | Phase 5-6 |
| karpathy-guidelines | 全局默认加载 | 编码质量 | 全程 |
| ai-coding-agent-guidelines | 全局默认加载 | AI 编码规范 | 全程 |

待安装（Phase 5 开始时）：
- **full-output-enforcement**: `npx skills add https://github.com/Leonxlnx/taste-skill --skill "full-output-enforcement"`

---

## Final File Inventory（重构完成后）

```
src/
  extension.ts                  (~500 行)   activate + EasyMailApp 协调
  lib/
    # 新增模块（Phase 1-3）
    html-utils.ts               (~45 行)    HTML 转义/DOM ID
    config-utils.ts             (~80 行)    配置解析工具
    dashboard-labels.ts         (~280 行)   i18n 标签常量
    process-runner.ts           (~70 行)    子进程执行
    app-data.ts                 (~250 行)   AppDataStore 数据持久化
    app-analysis.ts             (~200 行)   分析流水线
    message-handler.ts          (~150 行)   Webview 消息分发
    dashboard-provider.ts       (~30 行)    DashboardProvider 类
    dashboard-render.ts         (~500 行)   Sidebar HTML 渲染
    workbench-render.ts         (~400 行)   Workbench HTML 渲染

    # 现有模块（扩展了新函数）
    analysis-schema.ts          (+merge/prune)
    thread-analysis-schema.ts   (+merge)
    classification.ts           (+fallback)
    security-gate.ts            (+decisionMap/canAnalyze)
    redaction.ts                (+redactStoredMails/Thread)
    dashboard-state.ts          (+filter/lookup/compare)
    
    # 现有模块（不变）
    copilot-provider.ts, digest.ts, guide-webview.ts,
    llm-provider.ts, mail-store.ts, mock-provider.ts,
    prompt-config.ts, reply-template.ts, report-daily.ts,
    report-single-mail.ts, report-thread.ts, security-types.ts,
    summary.ts, thread-analysis-schema.ts, thread-engine.ts,
    thread-prompt-builder.ts, thread-schema.ts, thread-store.ts,
    thread-timeline.ts

  test/
    # 新增测试
    html-utils.test.ts, config-utils.test.ts,
    dashboard-labels.test.ts, process-runner.test.ts,
    app-data.test.ts, app-analysis.test.ts,
    message-handler.test.ts, dashboard-render.test.ts,
    workbench-render.test.ts, sidebar-render.test.ts

    # 现有测试（部分扩展）
    (20 个现有 test 文件)
```
