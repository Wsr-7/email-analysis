## Project Overview

Easy Mail is a VS Code extension that collects emails and meetings from classic Outlook via VBScript COM automation, analyzes them with GitHub Copilot (via the VS Code Language Model API), and displays results in a two-panel UI (sidebar + workbench). It runs entirely locally — no cloud services beyond Copilot.

The data pipeline:

```
cscript.exe collect-outlook-mails.vbs → mail-digest.md → VS Code extension parses into mail-store.json → Copilot analyzes → analysis-result.json → Sidebar + Workbench webviews + reports
cscript.exe collect-outlook-meetings.vbs → meeting-digest.md → meeting-store.json → Sidebar + Workbench
```

## Build & Test Commands

```bash
npm run compile          # Clean out/ then tsc
npm test                 # Compile + run all tests via node --test
npm run package:vsix     # Build .vsix to releases/
```

Run a single test after compiling:

```bash
node --test out/test/digest.test.js
```

Tests use Node.js built-in `node:test` and `node:assert/strict` — no external test framework. Each test file lives at `src/test/<module>.test.ts` mirroring `src/lib/<module>.ts`. Currently 32 test files, 258+ tests.

## Project Structure

```
easy-mail/
├── src/
│   ├── extension.ts              # Entry point: activate/deactivate + EasyMailApp coordinator (~1020 lines)
│   ├── lib/                      # All business logic modules (40 files)
│   │   ├── app-data.ts           #   Data persistence layer (AppDataStore)
│   │   ├── app-analysis.ts       #   LLM analysis pipeline
│   │   ├── message-handler.ts    #   Webview ↔ extension message dispatch
│   │   ├── sidebar-render.ts     #   Sidebar webview HTML (queue-first triage)
│   │   ├── workbench-render.ts   #   Workbench webview HTML (reading pane)
│   │   ├── dashboard-render.ts   #   Shared render helpers + legacy dashboard
│   │   ├── dashboard-labels.ts   #   i18n labels (zh-CN / en-US)
│   │   ├── dashboard-state.ts    #   Dashboard state builder + filters
│   │   ├── dashboard-provider.ts #   VS Code WebviewViewProvider
│   │   ├── mail-store.ts         #   MailStore + MailIndex (dedup, retention)
│   │   ├── digest.ts             #   Mail digest markdown parser
│   │   ├── meeting-store.ts      #   MeetingStore (calendar items)
│   │   ├── meeting-digest.ts     #   Meeting digest parser
│   │   ├── thread-store.ts       #   ThreadStore
│   │   ├── thread-engine.ts      #   Thread grouping by conversationId/subject
│   │   ├── thread-timeline.ts    #   Timeline body diff + dedup
│   │   ├── thread-prompt-builder.ts # Thread analysis prompt assembly
│   │   ├── analysis-schema.ts    #   AnalysisResult schema + merge/prune
│   │   ├── thread-analysis-schema.ts # ThreadAnalysisResult schema
│   │   ├── classification.ts     #   Security classification (PUBLIC→HIGH REGISTERED)
│   │   ├── security-gate.ts      #   Per-mail/thread allow/block/confirm decisions
│   │   ├── security-types.ts     #   Security type definitions
│   │   ├── redaction.ts          #   PII redaction for LLM prompts
│   │   ├── prompt-config.ts      #   Prompt composition from markdown/JSON parts
│   │   ├── copilot-provider.ts   #   CopilotProvider (vscode.lm API)
│   │   ├── llm-provider.ts       #   LlmProvider interface
│   │   ├── mock-provider.ts      #   MockProvider for tests
│   │   ├── analysis-translation.ts # LLM-based locale translation of results
│   │   ├── reply-template.ts     #   Draft reply template engine
│   │   ├── report-daily.ts       #   Daily brief markdown report
│   │   ├── report-single-mail.ts #   Single mail detail report
│   │   ├── report-thread.ts      #   Thread analysis report
│   │   ├── next-actions.ts        #   NextActionsStore (task queue from thread analysis)
│   │   ├── guide-webview.ts      #   First-run guide panel
│   │   ├── html-utils.ts         #   HTML escaping + DOM ID helpers
│   │   ├── config-utils.ts       #   Config parsing utilities
│   │   ├── process-runner.ts     #   Child process execution
│   │   └── summary.ts            #   Analysis summary markdown builder
│   └── test/                     # 32 test files mirroring lib/ (258+ tests)
├── prompts/                      # LLM prompt templates (markdown + JSON)
├── scripts/                      # VBScript COM automation for Outlook
│   ├── collect-outlook-mails.vbs
│   ├── collect-outlook-meetings.vbs
│   ├── compose-outlook-mail.vbs
│   └── open-outlook-mail.vbs
├── media/                        # Extension icon
├── releases/                     # Built .vsix packages
├── data/                         # Sample/debug digest files
├── default-config.json           # Default extension settings
├── package.json                  # VS Code extension manifest + commands
└── tsconfig.json
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Extension                        │
│  ┌───────────┐                                                  │
│  │ extension  │─── EasyMailApp (coordinator, ~1020 lines)       │
│  │   .ts      │    ├─ registers commands (easyMail.*)           │
│  │            │    ├─ manages busy state + webview lifecycle     │
│  │            │    └─ delegates to modules below                 │
│  └─────┬──┬──┘                                                  │
│        │  │                                                     │
│   ┌────┘  └────────────────┐                                    │
│   ▼                        ▼                                    │
│  Data Layer             UI Layer                                │
│  ┌──────────┐          ┌──────────────┐    ┌─────────────────┐  │
│  │app-data  │◄────────▶│sidebar-render│    │workbench-render │  │
│  │  .ts     │          │  .ts         │    │  .ts            │  │
│  │          │          │ (WebviewView)│    │ (WebviewPanel)  │  │
│  │ 17 paths │          └──────┬───────┘    └────────┬────────┘  │
│  │ 22+ r/w  │                 │                     │           │
│  └────┬─────┘          ┌──────┴─────────────────────┘           │
│       │                ▼                                        │
│       │          ┌─────────────┐  ┌────────────────┐            │
│       │          │dashboard-   │  │dashboard-      │            │
│       │          │render.ts    │  │labels.ts       │            │
│       │          │(shared fns) │  │(i18n zh/en)    │            │
│       │          └─────────────┘  └────────────────┘            │
│       │                                                         │
│  ┌────┴──────────────────────────────────┐                      │
│  │           JSON Data Stores            │                      │
│  │  mail-store │ thread-store │ meeting  │                      │
│  │  analysis   │ thread-analysis│ index  │                      │
│  │  classification-cache │ next-actions  │                      │
│  │  config                               │                      │
│  └───────────────────────────────────────┘                      │
│                                                                 │
│  Analysis Pipeline           Security Gate                      │
│  ┌──────────────┐           ┌──────────────┐                    │
│  │app-analysis  │──────────▶│security-gate │                    │
│  │  .ts         │           │  .ts         │                    │
│  │ batch/thread │           │ allow/block/ │                    │
│  │ translate    │           │ manual-confirm│                   │
│  └──────┬───────┘           └──────────────┘                    │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐  ┌────────────┐  ┌──────────┐                │
│  │copilot-      │  │prompt-     │  │redaction │                 │
│  │provider.ts   │  │config.ts   │  │  .ts     │                 │
│  │(vscode.lm)   │  │(compose)   │  │(PII mask)│                │
│  └──────────────┘  └────────────┘  └──────────┘                │
│                                                                 │
│  Outlook COM (via cscript.exe)                                  │
│  ┌──────────────────────┐  ┌──────────────────────┐             │
│  │collect-outlook-      │  │collect-outlook-      │             │
│  │mails.vbs             │  │meetings.vbs          │             │
│  └──────────────────────┘  └──────────────────────┘             │
│  ┌──────────────────────┐                                       │
│  │compose-outlook-      │                                       │
│  │mail.vbs              │                                       │
│  └──────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Extension entry point

`src/extension.ts` (~1020 lines) — the `EasyMailApp` class coordinates state and VS Code API calls. After v2 refactoring, rendering, data persistence, analysis logic, and message handling are extracted into dedicated modules under `src/lib/`. v3 additions: draft polish/refine via LLM, Outlook compose window integration, next actions sync from thread analysis.

### UI — Two-panel design

- **Sidebar** (`sidebar-render.ts`) — WebviewView in the activity bar. Queue-first triage layout: queue navigation (category counts, Next Actions queue), compact mail rows, settings panel, action buttons.
- **Workbench** (`workbench-render.ts`) — WebviewPanel in the editor area. Full-width reading pane for the item selected in sidebar. Shows analysis details, Thread Spotlight (thread analysis summary), editable draft area with polish/refine/compose actions, thread timelines, meeting details.
- **Dashboard render** (`dashboard-render.ts`) — Shared rendering utilities: `formatClassification`, `formatPriority`, `renderDraftBox`, `renderEditableDraftBox`, `renderButtonSpinner`, etc. Also contains the legacy full-dashboard renderer.
- **Dashboard labels** (`dashboard-labels.ts`) — `LABELS` constant with zh-CN / en-US translations, `getLabels()`, `buildCategoryLabels()`.

### Data layer

- **AppDataStore** (`app-data.ts`) — All filesystem I/O: path getters (17), read/write methods (22+) for every JSON store. Constructed with `globalStorageUri` paths.
- **AppAnalysis** (`app-analysis.ts`) — `analyzeBatchCore`, `analyzeThreadCore`, `sendPromptToModel`, `translateExistingAnalysis`.
- **MessageHandler** (`message-handler.ts`) — `handleWebviewMessage` dispatches 28+ message types from webview to extension commands (including polishDraft, refineDraft, composeMail, markNextAction).

### LLM abstraction

`LlmProvider` interface (`llm-provider.ts`) with `CopilotProvider` (`copilot-provider.ts`) wrapping `vscode.lm.selectChatModels()`. `MockProvider` for testing.

### Data stores (all JSON, persisted to `globalStorageUri/data/`)

- **MailStore** (`mail-store.ts`) — raw pulled emails with retention/pruning, dedup via InternetMessageId/EntryId/hash
- **MailIndex** (`mail-store.ts`) — lightweight dedup index with folder anchors for "load more" pagination
- **ThreadStore** (`thread-store.ts` + `thread-engine.ts`) — groups mails into conversation threads by conversationId or normalized subject
- **ClassificationCache** (`classification.ts`) — security classification levels (PUBLIC/INTERNAL/REGISTERED/HIGH REGISTERED)
- **AnalysisResult** (`analysis-schema.ts`) — structured Copilot output with categories, priorities, draft replies
- **ThreadAnalysisResult** (`thread-analysis-schema.ts`) — thread-level analysis results
- **MeetingStore** (`meeting-store.ts` + `meeting-digest.ts`) — Outlook calendar items with response status tracking
- **NextActionsStore** (`next-actions.ts`) — task queue extracted from thread analysis actionItems, with open/done/ignored statuses

### Security gate

`security-gate.ts` + `security-types.ts` — decides per-mail and per-thread whether to allow/block/require-manual-confirm for Copilot analysis based on classification level.

### Prompt system

Prompts live in `prompts/` as markdown/JSON files:
- `base-system.md` + `analysis-prompt.md` + `output-schema.md` — single-mail analysis
- `thread-base-system.md` + `thread-analysis-prompt.md` + `thread-output-schema.md` — thread analysis
- `reply-draft-prompt.md` + `reply-template.md` — draft reply generation
- `prompt-config.default.json` — category definitions (user-customizable copy at globalStorageUri)

### Utility modules

- `html-utils.ts` — `escapeHtml`, `escapeAttr`, `domIdFor*`, `safeDomId`, `toJsLiteral`
- `config-utils.ts` — `positiveNumber`, `parseFolders`, `getLocaleFromConfig`, `buildSecuritySettings`
- `process-runner.ts` — `runProcess`, `sanitizeProcessArgs`, `formatError`, `formatElapsedSeconds`
- `dashboard-state.ts` — `buildDashboardState`, `filterVisibleThreadsForDashboard`, `buildThreadLookup`
- `dashboard-provider.ts` — VS Code `WebviewViewProvider` for the sidebar
- `redaction.ts` — PII redaction for prompts (emails, URLs, IPs, phone numbers, money)

### Mail collection & compose

- `scripts/collect-outlook-mails.vbs` — VBScript for Outlook mail COM. Accepts CLI args for range, folders, body truncation, sample mode, pagination anchors.
- `scripts/collect-outlook-meetings.vbs` — VBScript for Outlook calendar COM. Collects meetings within a date range.
- `scripts/compose-outlook-mail.vbs` — VBScript for Outlook compose (reply/replyAll/forward). Opens Outlook editor with optional draft body prefill; never calls Send.

### Reports

Three report generators: `report-daily.ts`, `report-single-mail.ts`, `report-thread.ts` — produce markdown reports from analysis results.

## Key Conventions

- All config is read from VS Code settings (`easyMail.*` namespace), merged with `default-config.json` defaults
- Analysis categories: `importantSender`, `mustHandleToday`, `risk`, `waitingForMe`, `followUp`, `notice`, `ignored`, `uncertain`
- Priorities: P0–P3
- Mail IDs use `InternetMessageId` or `EntryId` for dedup; hash fallback when both are missing
- The extension uses `vscode.ExtensionContext.globalStorageUri` for all persistent data — never writes to the workspace folder
- The `--sample` flag generates fake mail data for demo/testing without Outlook
- Dual-locale support (zh-CN / en-US) via `dashboard-labels.ts`; switching locale can trigger LLM-based translation of existing results (`analysis-translation.ts`)
