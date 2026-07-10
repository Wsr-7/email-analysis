# EasyMail

**EasyMail** is a VS Code extension that turns classic desktop Outlook into a locally-analyzed, AI-triaged inbox. It collects mail and calendar data via VBScript COM automation, analyzes it with GitHub Copilot through the VS Code Language Model API, and presents a triage dashboard — all without sending data to any service other than Copilot itself.

[简体中文](./README_zh.md)

## How it works

```text
classic Outlook (Windows)
  │  VBScript COM automation (cscript.exe)
  ▼
mail-digest.md / meeting-digest.md
  │  parsed by the extension
  ▼
mail-store.json / meeting-store.json / thread-store.json
  │  analyzed by GitHub Copilot (vscode.lm API)
  ▼
analysis-result.json / thread-analysis-result.json
  │
  ▼
Sidebar (triage queue) + Workbench (reading pane) + Markdown reports
```

Everything runs locally. No mail content leaves your machine except the excerpts sent to the Copilot model you select.

## Features

- **Local collection** — pulls mail and meetings from classic Outlook via COM, no server or mailbox export required
- **Flexible range** — collect by recent hours or a max item count, across one or more folders
- **Progressive analysis** — mail lands in a local queue first; analyze it next-batch, selected, or all-allowed
- **Thread awareness** — groups mail into conversations, trims quoted history, and dedupes repeated bodies before sending to the model
- **Security classification gate** — mail above a configured classification level (`PUBLIC` → `HIGH REGISTERED`) requires manual confirmation instead of auto-analysis
- **Draft replies** — Copilot drafts a reply per mail/thread, with polish/refine actions and one-click hand-off to an Outlook compose window (never auto-sends)
- **Two-panel UI** — a sidebar triage queue (category counts, Next Actions) and a full-width workbench reading pane
- **Bilingual** — UI and analysis output support English and Simplified Chinese, switchable at runtime
- **Sample mode** — generates fake mail data so you can try the extension without Outlook or Copilot
- **No cloud storage** — all data is written to VS Code's `globalStorageUri`, with configurable retention and a one-click local cache clear

## Requirements

- Windows, with classic (desktop) Outlook installed and configured
- VS Code `^1.90.0`
- A signed-in GitHub Copilot subscription with Language Model API access

## Installation

Download the `.vsix` from [releases/](./releases) and install it:

```powershell
code --install-extension releases/easymail-0.3.0.vsix
```

Or build from source — see [Development](#development) below.

## Quick start

1. Open the EasyMail view from the Activity Bar.
2. No Outlook yet? Run **EasyMail: Generate Sample Digest** to try the flow with fake data.
3. Run **EasyMail: Fetch New Mail** to pull recent mail from Outlook.
4. Pick an **Analysis Model** in the sidebar, then run **Analyze Next Batch** (or **Analyze All Allowed**).
5. Review triaged mail in the sidebar queue; open an item to read, draft a reply, or take action in the workbench.

See [user guide.md](./user%20guide.md) for the full command list, configuration reference, and custom classification prompts.

## Configuration

All settings live under the `easyMail.*` namespace in VS Code Settings (`easyMail.rangeMode`, `easyMail.folders`, `easyMail.outputLanguage`, `easyMail.autoAnalyzeMaxClassificationLevel`, retention windows, `easyMail.importantSenders`, etc.). The dashboard's Settings panel is a shortcut editor for common fields — VS Code Settings is always the source of truth.

## Project layout

```text
src/         TypeScript extension source (src/lib holds the business logic modules)
scripts/     VBScript COM automation for Outlook, plus build/validation scripts
prompts/     Copilot analysis prompt templates
media/       Extension icon assets
releases/    Versioned .vsix packages
docs/        Design and remediation-plan documents
```

For the full module map and architecture diagram, see [AGENTS.md](./AGENTS.md).

## Development

```powershell
npm install
npm run compile      # clean out/ then tsc
npm test             # compile + run all tests (node --test)
npm run package:vsix # build releases/easymail-0.3.0.vsix
```

Run a single test file after compiling:

```powershell
node --test out/test/digest.test.js
```

See [setup.md](./setup.md) for a step-by-step first-time setup, and [AGENTS.md](./AGENTS.md) for architecture and contribution conventions.

## License

[MIT](./LICENSE)
