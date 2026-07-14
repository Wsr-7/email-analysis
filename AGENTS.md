# EasyMail Contributor Guide

EasyMail is a local-first VS Code extension for classic Outlook. It collects mail and meetings through VBScript COM automation, stores data under VS Code global storage, and uses the VS Code Language Model API only when the user asks for Copilot analysis.

## Commands

```powershell
npm install
npm run compile
npm test
npm run validate:sample
npm run package:vsix
npx vsce ls --readme-path docs/marketplace-details.md
```

`npm test` compiles first and runs the complete Node built-in test suite. `npm run validate:sample` does not require Outlook or Copilot. The VSIX is written to `releases/`.

## Repository map

```text
src/
├── extension.ts                 Extension entry point and EasyMailApp coordinator
├── lib/
│   ├── analysis/                Copilot providers, prompts, schemas, drafts
│   ├── domain/                  Digest parsing and thread construction
│   ├── storage/                 JSON stores and AppDataStore persistence
│   ├── security/                Classification, redaction, and gate decisions
│   ├── ui/                      Sidebar, Workbench, webview helpers, messages
│   ├── reports/                 Daily, mail, and thread reports
│   └── shared/                  Configuration and process utilities
└── test/                        Node tests; test support belongs in test/support/

scripts/                         Four packaged Outlook VBScript entry points
prompts/                         Runtime prompt templates and default categories
media/                           Marketplace PNG and Activity Bar SVG icons
docs/                            Public product, development, and architecture docs
```

Keep runtime modules under their current `src/lib/<area>/` directory. Use direct relative imports; do not add aliases, barrels, or a test-only provider to `src/lib`.

## Runtime flow

```text
classic Outlook COM
  -> collect-outlook-*.vbs
  -> digest markdown
  -> MailStore / MeetingStore / ThreadStore in globalStorageUri
  -> optional Copilot analysis through vscode.lm
  -> Sidebar + Workbench + markdown reports
```

`EasyMailApp` in `src/extension.ts` owns VS Code lifecycle and commands. `AppDataStore` owns all filesystem paths and JSON read/write operations; runtime code must not write into the workspace. The Sidebar is the queue-first Activity Bar view. The Workbench is the reading pane for a selected mail, thread, or meeting.

## Core boundaries

- Windows and classic Outlook are required for real collection, opening, and compose windows.
- GitHub Copilot and a model authorized through VS Code are required only for analysis and draft assistance.
- Collection, open, and compose calls use local `cscript.exe`; compose opens a draft window and never sends mail automatically.
- Persisted data lives in `ExtensionContext.globalStorageUri`, never in the repository or current workspace.
- Security classification and the gate decide whether analysis is automatic, blocked, or requires manual confirmation. Redaction applies to model payloads according to the configured policy.
- Webview HTML must keep a nonce CSP and event listeners rather than inline handlers.

## Testing and packaging expectations

- Add or update a matching `src/test/*.test.ts` when behavior changes.
- Keep test fixtures and mocks in `src/test/`; do not package tests.
- The VSIX allow-list in `package.json` is intentionally narrow: runtime JavaScript, four VBS files, prompts, both runtime icons, user guide, default config, license, and the Marketplace README.
- After changing packaging, run `npx vsce ls --readme-path docs/marketplace-details.md` and install the produced VSIX before claiming runtime packaging is valid.

## Real-environment verification still required

Automated tests and Sample mode do not prove Outlook integration. Verify on a real Windows + classic Outlook + VS Code + Copilot installation:

1. Fetch New and More History against a mailbox, including the configured folders.
2. Open a mail and meeting in Outlook; open reply, reply-all, and forward compose windows.
3. Confirm a CC-only message reports recipient direction correctly.
4. Confirm recurring meetings are collected correctly.
5. Open the Activity Bar, Sidebar, Workbench, Guide, and Marketplace details from the installed VSIX; check the icon at the target theme and scale.
6. Trigger Copilot analysis only with an account and organization policy that permit the VS Code Language Model API.
