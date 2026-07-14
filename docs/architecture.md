# EasyMail Architecture

EasyMail is a local-first VS Code extension for classic Outlook. The extension coordinates Outlook collection, local JSON stores, optional Copilot analysis, and two webviews. It has no EasyMail-hosted service.

## Data flow

```text
classic Outlook COM
  -> cscript.exe + collect-outlook-mails.vbs / collect-outlook-meetings.vbs
  -> digest markdown
  -> AppDataStore in ExtensionContext.globalStorageUri
  -> MailStore, MeetingStore, ThreadStore, classifications, analysis
  -> optional vscode.lm Copilot request
  -> Sidebar, Workbench, and Markdown reports
```

The `--sample` collector path creates the same kind of digest without Outlook. It is used for development and first-run exploration, not as proof of live Outlook compatibility.

## Extension and UI

`src/extension.ts` contains `EasyMailApp`, the lifecycle and command coordinator. It owns busy state, command registration, Outlook process orchestration, state refreshes, and the connection between stores and UI.

- `src/lib/ui/sidebar-render.ts` produces the Activity Bar queue view.
- `src/lib/ui/workbench-render.ts` produces the editor-area reading pane.
- `src/lib/ui/dashboard-provider.ts` hosts the Sidebar webview.
- `src/lib/ui/message-handler.ts` dispatches messages from the webviews.
- `src/lib/ui/dashboard-render.ts` holds shared rendering helpers.

Both runtime webviews use a nonce CSP and event listeners; no inline event handlers are permitted.

## Module boundaries

```text
analysis/  Copilot provider, prompts, response schemas, translation, drafts
domain/    Digest parsing and mail-thread construction
storage/   AppDataStore plus mail, meeting, thread, and action stores
security/  Classification, keyword decisions, redaction, security gate
ui/        Webview providers, rendering, state, labels, and message handling
reports/   Daily, single-mail, and thread Markdown reports
shared/    Configuration parsing and child-process helpers
```

Imports stay direct and relative. The directory structure is organizational only; it does not introduce aliases or barrel modules.

## Persistence

All runtime persistence is beneath `ExtensionContext.globalStorageUri`. `AppDataStore` owns file paths and JSON read/write operations. The repository and the opened workspace are never used as runtime data storage.

The stored data includes collected mail and meetings, dedup/pagination metadata, threads, classifications, analysis results, next actions, user configuration, prompts, and reply templates. Retention and pruning are configuration-driven.

## Analysis and security boundary

`CopilotProvider` wraps `vscode.lm`. An analysis request is made only after the user selects an analysis action. The security modules classify mail, apply keyword decisions, and choose allow, block, or manual-confirm behavior. Redaction transforms prompt payloads according to the configured policy.

Thread analysis groups mail by conversation ID where available and uses normalized subjects as fallback. Timeline helpers trim quoted history and mark duplicate bodies before prompt construction.

## Outlook boundary

The four packaged VBScript files collect mail, collect meetings, open an existing Outlook item, and open a compose window. They use `cscript.exe` and classic Outlook COM. Compose operations never call Outlook's send API.

Live Outlook and Copilot behavior remains environment-dependent. See [Acceptance](./acceptance.md) for the verification matrix and [Security](./security.md) for handling boundaries.
