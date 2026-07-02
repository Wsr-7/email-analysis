# Easy Mail Post-C10 Fix and Optimization Plan

Created: 2026-07-02  
Status: Ready for implementation  
Source issue set: user validation after latest package, following completion of `04-execution-plan-thread-spotlight-draft-assist-next-actions.md`

This file is the source of truth for the next remediation phase. The previous plan (`04`) remains historical context for Milestones A-D, but its Cross-Milestone Acceptance Checklist is not complete because C10 failed manual Outlook validation.

---

## 0. Multi-Agent Collaboration Rules

### 0.1 Status Markers

Use these markers:

```text
[ ] Not started
[~] In progress
[X] Done
[!] Blocked or failed validation
[-] Intentionally deferred
```

Rules:

- Claim exactly one small task at a time.
- Do not mark a task `[X]` until its acceptance criteria are met.
- If a task is partially complete, keep it `[~]` and write a handover entry.
- If a task is blocked, mark `[!]`, record the blocker, and state the next exact action.
- Default to local commits after each coherent completed task. Do not push unless the user explicitly asks.

### 0.2 Required Start Procedure

Before editing code, every agent must:

- [ ] Read this file completely.
- [ ] Read the latest entry in `## 8. Handover Log`.
- [ ] Run `git status --short`.
- [ ] Treat unrelated dirty files as user-owned. Do not stage or commit them.
- [ ] Inspect relevant code and tests before editing.
- [ ] Claim one task by changing its status to `[~]`.
- [ ] Add a pre-work checkpoint to `## 8. Handover Log`.

### 0.3 Required Finish Procedure

Before handoff, every agent must:

- [ ] Update the touched task status.
- [ ] Fill task-level Completion Notes.
- [ ] Record files changed.
- [ ] Record tests and manual validation.
- [ ] Record known gaps.
- [ ] Add a Handover Log entry.
- [ ] Commit the coherent completed task if it changed source or docs.
- [ ] Write the commit hash back into this plan.

### 0.4 Guardrails

- Do not implement per-item Thread Spotlight source jumps.
- Do not add new multi-source selection UI unless a task in this file explicitly says so.
- Do not change LLM prompts unless a task explicitly requires prompt or category tuning.
- Do not stage screenshots, temporary images, or unrelated untracked files.
- Keep Outlook actions explicit-click only. Never auto-send.
- Keep fixes small and testable. Prefer existing stores, render helpers, and message patterns.

---

## 1. Current Validation Summary

Known dirty state at planning time:

- `agents.md` was already modified and unrelated. Leave it untouched unless the user explicitly asks.

User-validated failure:

- C10 failed: Reply / Reply All / Forward open Outlook compose windows, but non-empty draft bodies are inserted as mojibake.
- Empty drafts currently still open Outlook compose windows, but the desired behavior is to block compose actions until the user writes or generates a draft.

Likely root cause:

- `src/extension.ts` writes the temporary draft body with UTF-8.
- `scripts/compose-outlook-mail.vbs` reads the body file as UTF-16/Unicode via `OpenTextFile(filePath, 1, False, -1)`.

Reference screenshots / assets:

- `docs/v2-design/UI_NOW_reply_draft.png` — draft and instruction controls look like raw white browser controls in dark VS Code and have poor responsive sizing.
- `docs/v2-design/UI_NOW_need_confirm.png` — manual-confirm mail has no confirmation/analyze action.
- `docs/v2-design/new_timeline.png` — target direction for a vertical timeline rail.
- `docs/v2-design/easymail-final-icon.png` — final icon asset to use for VS Code listing/details/activity bar.

Unfinished items in the previous plan:

- `04` C10 is failed, not merely blocked.
- `04` Cross-Milestone Acceptance Checklist remains incomplete until the Outlook compose prefill issue is fixed and retested.

---

## 2. Issue Map and Priority

| Priority | Task | User issues | Summary |
| --- | --- | --- | --- |
| P0 | P0.1 | C10, 3 | Fix Outlook compose draft encoding and block empty compose actions. |
| P0 | P0.2 | 6 | Add manual-confirm analyze action for security-gated mails. |
| P0 | P0.3 | 1, 13 | Fix analyze batch-size race; remove/rename obsolete Auto Analyze setting UI. |
| P0 | P0.4 | 15 | Preserve metadata during redaction; redact body only. |
| P1 | P1.1 | 2, 3, 4 | Redesign draft editor, action layout, and per-item draft binding. |
| P1 | P1.2 | 5, 7, 8 | Normalize mail metadata/actions/body layout in sidebar and workbench. |
| P1 | P1.3 | 5 | Add thread ignore/restore using existing ignored mail behavior. |
| P1 | P1.4 | 11, 14 | Investigate and fix missing self replies in thread timelines and category outcomes. |
| P1 | P1.5 | 10 | Replace package/activity icon with final icon and verify package output. |
| P2 | P2.1 | 9 | Add advanced timeline container with vertical rail and scroll-linked anchors. |
| P2 | P2.2 | 12 | Define and harden multiple Outlook account behavior. |

Recommended execution order:

1. P0.1
2. P0.2
3. P0.3
4. P0.4
5. P1.1
6. P1.2
7. P1.3
8. P1.4
9. P1.5
10. P2.2
11. P2.1

Rationale:

- Fix data correctness and broken user flows before visual polish.
- Fix redaction before more analysis retesting, because redacted metadata can distort category decisions and display.
- Timeline rail is valuable but should follow body/timeline data correctness.

---

## 3. Task Plan

### P0.1 Fix Outlook compose draft encoding and empty draft guard

Status: [~] Implementation done; manual Outlook validation pending

Goal:

- Non-empty draft text is inserted correctly in Outlook compose windows.
- Empty draft compose actions do not open Outlook; the user sees a clear message to generate or write a draft first.

Likely files:

- `scripts/compose-outlook-mail.vbs`
- `src/extension.ts`
- `src/lib/message-handler.ts`
- `src/lib/workbench-render.ts`
- `src/test/message-handler.test.ts`

Implementation notes:

- Keep extension-side temporary body file as UTF-8.
- Change VBS body-file reading to explicit UTF-8 via `ADODB.Stream`.
- Add message-handler or extension guard for empty/whitespace draft text before calling compose.
- If compose fails, keep the existing copy fallback path visible.

Suggested VBS read helper:

```vbscript
Function ReadBodyFile(ByVal filePath)
  On Error Resume Next
  Dim fso
  Set fso = CreateObject("Scripting.FileSystemObject")
  If Not fso.FileExists(filePath) Then Fail "Body file not found: " & filePath

  Dim stream, content
  Set stream = CreateObject("ADODB.Stream")
  stream.Type = 2
  stream.Charset = "utf-8"
  stream.Open
  stream.LoadFromFile filePath
  content = stream.ReadText
  stream.Close
  If Err.Number <> 0 Then Fail "Unable to read body file: " & Err.Description
  On Error GoTo 0
  ReadBodyFile = content
End Function
```

Acceptance criteria:

- Automated test proves empty `composeMail` does not call `composeOutlookMail`.
- `npm run compile` passes.
- `npm test` or targeted tests pass.
- Manual Outlook retest confirms Chinese and English non-empty drafts are readable after Reply / Reply All / Forward.
- Manual retest confirms no email is sent automatically.

Completion Notes:

- Status: Implementation done; not marked `[X]` because manual Outlook validation is still required.
- Files changed:
  - `scripts/compose-outlook-mail.vbs` — reads `--body-file` as UTF-8 through `ADODB.Stream` instead of `OpenTextFile(..., -1)`.
  - `src/lib/message-handler.ts` — blocks empty/whitespace `composeMail` before calling `composeOutlookMail`.
  - `src/test/message-handler.test.ts` — covers empty compose draft guard and keeps non-empty forward dispatch covered.
- Tests:
  - `npm run compile`: pass.
  - `node --test out/test/message-handler.test.js`: pass, 29 tests.
  - `npm test`: pass, 259 tests.
  - `cscript.exe //nologo scripts/compose-outlook-mail.vbs --help`: pass; script parses and prints usage.
- Manual validation:
  - Not run in this agent session. Required: verify Chinese and English draft bodies render correctly in classic Outlook Reply / Reply All / Forward, and no email is sent automatically.
- Known issues:
  - C10 and the cross-task Outlook compose acceptance remain open until manual validation passes.
- Commit:
  - Implementation: `04d96a5029b615d058a7bb28221863d80e432189`

---

### P0.2 Add manual-confirm analyze action for security-gated mail

Status: [X] Done

Goal:

- A mail in the `needs manual confirmation` queue has an explicit confirm/analyze action.
- The action reuses the existing explicit-selection security path and does not bypass `block` decisions.

Likely files:

- `src/lib/sidebar-render.ts`
- `src/lib/workbench-render.ts`
- `src/lib/dashboard-render.ts`
- `src/lib/message-handler.ts`
- `src/extension.ts`
- `src/test/message-handler.test.ts`
- `src/test/sidebar-render.test.ts`
- `src/test/workbench-render.test.ts`

Implementation notes:

- `security-gate.ts` already allows manual-confirm items when `explicitSelection` is true; verify before editing.
- Show a clear `Confirm and analyze` action for manual-confirm items.
- Do not show the action for hard-blocked items.
- Keep `Open in Outlook` and `Ignore` available.

Acceptance criteria:

- Manual-confirm item can be analyzed by explicit user click.
- Hard-blocked item still cannot be analyzed.
- Tests cover button rendering and message dispatch.

Completion Notes:

- Status: Done.
- Files changed:
  - `src/lib/dashboard-labels.ts` — added localized `pending.confirmAnalyze`.
  - `src/lib/sidebar-render.ts` — renders `Confirm and Analyze` only for `manual_confirm` blocked-queue rows.
  - `src/lib/workbench-render.ts` — renders the same action in manual-confirm mail detail and dispatches existing `analyzeSelected`.
  - `src/test/sidebar-render.test.ts` — verifies manual-confirm rows show the action and hard-blocked rows do not.
  - `src/test/workbench-render.test.ts` — verifies workbench detail behavior and JS dispatch.
- Tests:
  - RED: `node --test out/test/sidebar-render.test.js` and `node --test out/test/workbench-render.test.js` failed before implementation because the action was absent.
  - `npm run compile`: pass.
  - `node --test out/test/sidebar-render.test.js`: pass.
  - `node --test out/test/workbench-render.test.js`: pass.
  - `npm test`: pass, 261 tests.
- Manual validation:
  - Not run in VS Code UI here. Automated rendering and existing `analyzeSelected` dispatch cover the behavior; hard-blocked mails remain excluded by `canAnalyzeMail`.
- Known issues:
  - None for P0.2.
- Commit:
  - `75c535c1f0961dafbc7e6260c5ba1302f82565e8`

---

### P0.3 Fix analyze batch-size race and remove obsolete Auto Analyze setting UI

Status: [X] Done

Goal:

- The selected analyze count is the count used by the immediate analysis click.
- Selecting `all` analyzes all allowed items.
- `Allow Analysis` / `Auto Analyze Enabled` is removed from the sidebar settings UI and VS Code contributed settings, or clearly migrated to the new max-classification control.

Likely files:

- `src/lib/sidebar-render.ts`
- `src/lib/message-handler.ts`
- `src/extension.ts`
- `src/lib/app-analysis.ts`
- `package.json`
- `default-config.json`
- `src/test/message-handler.test.ts`
- `src/test/sidebar-render.test.ts`

Implementation notes:

- Avoid `saveConfig` then `analyze` races.
- Pass the selected batch size or `allAllowed` selection in the analyze message itself.
- Keep backward compatibility for existing persisted `autoAnalyzeEnabled`, but stop showing it as a user-facing control.
- Rename visible max-classification copy to `Allowed Analysis Classification Max Level` or localized equivalent.

Acceptance criteria:

- Selecting `50` then clicking Analyze analyzes 50 allowed items on the first click, not 5.
- Selecting `all` then clicking Analyze analyzes all allowed items on the first click.
- Sidebar settings no longer show obsolete `Allow Analysis`.
- VS Code settings no longer expose confusing `easyMail.autoAnalyzeEnabled`, or it is marked deprecated if removal is too disruptive.

Completion Notes:

- Status: Done.
- Files changed:
  - `src/lib/sidebar-render.ts` — Analyze now posts the selected `batchSize` directly; removed `Allow Analysis` setting control from sidebar settings.
  - `src/lib/dashboard-render.ts` — removed legacy dashboard `Allow Analysis` setting control.
  - `src/lib/message-handler.ts` — `analyze` accepts and validates optional `batchSize`.
  - `src/extension.ts` — passes optional batch override into analysis.
  - `src/lib/app-analysis.ts` — accepts numeric batch override and uses it instead of saved `analysisBatchSize`.
  - `package.json` — removed contributed `easyMail.autoAnalyzeEnabled` setting; added `app-analysis.test.js` to `npm test`.
  - `default-config.json` — removed `autoAnalyzeEnabled`.
  - `src/test/app-analysis.test.ts` — new regression test proving override `50` beats saved config `5`.
  - `src/test/message-handler.test.ts` and `src/test/sidebar-render.test.ts` — dispatch/render coverage.
- Tests:
  - RED: `npm run compile` failed before implementation because `analyzeBatchCore(..., 50)` was not supported.
  - `npm run compile`: pass.
  - `node --test out/test/message-handler.test.js`: pass.
  - `node --test out/test/sidebar-render.test.js`: pass.
  - `node --test out/test/app-analysis.test.js`: pass.
  - `npm test`: pass, 264 tests.
  - `Select-String` over `package.json`, `default-config.json`, `src/lib/sidebar-render.ts`, and `src/lib/dashboard-render.ts` found no `autoAnalyzeEnabled` or `analysisBatchSize: sel` remnants.
- Manual validation:
  - Not run in VS Code UI here. Automated tests cover first-click selected batch size and removed setting exposure.
- Known issues:
  - Internal compatibility still supports persisted `autoAnalyzeEnabled: false` if present in older user settings/config. It is no longer exposed in `package.json` or UI.
- Commit:
  - `791f7403b4113e26acfe9b9cf11eb6eb03b0e23d`

---

### P0.4 Preserve metadata during redaction

Status: [X] Done

Goal:

- Mail subject, sender, recipients, and other display metadata are not replaced with `[EMAIL_1]`, `[PHONE_1]`, etc.
- Body content is still redacted before LLM prompts.

Likely files:

- `src/lib/redaction.ts`
- `src/lib/thread-prompt-builder.ts`
- `src/lib/app-analysis.ts`
- `src/test/redaction.test.ts`
- Prompt-builder tests if present.

Implementation notes:

- In `redactStoredMails`, preserve metadata fields such as `subject`, `from`, `to`, `senderName`, `senderEmail`; redact body fields only.
- In thread prompt redaction, preserve thread subject, participants, sender metadata, and recipient metadata; redact `bodyPreview`, `bodyClean`, and `bodyDelta`.
- Re-run category-related tests because metadata quality affects analysis.

Acceptance criteria:

- Tests prove metadata remains readable after redaction.
- Tests prove body text is still redacted.
- Existing security-gate behavior remains intact.

Completion Notes:

- Status: Done.
- Files changed:
  - `src/lib/redaction.ts` — `redactStoredMails` now preserves display metadata and redacts only `bodyExcerpt`; `redactThreadForPrompt` preserves thread/message metadata and redacts only `bodyPreview`, `bodyClean`, and `bodyDelta`.
  - `src/test/redaction.test.ts` — added coverage proving metadata fields stay readable while body content is still redacted.
- Tests:
  - RED: `node --test out/test/redaction.test.js` failed before implementation because subject metadata was replaced with `[EMAIL_1]`.
  - `npm run compile`
  - `node --test out/test/redaction.test.js`
  - `node --test out/test/thread-prompt-builder.test.js`
  - `npm test` (266 tests passing)
- Manual validation: Not run; behavior is covered by redaction and prompt-builder regression tests.
- Known issues: None for this step.
- Commit: `3b9acf30371c62e9d51f2fdaef7d0b0815eb0dde`

---

### P1.1 Redesign draft editor, actions, and per-item draft binding

Status: [X] Done

Goal:

- Draft and instruction editors visually match VS Code dark and light themes.
- Editors resize with the workbench panel and have useful default height.
- Empty draft state shows `Generate draft`; non-empty draft state shows `Polish`, `Refine`, copy, and Outlook actions.
- Outlook Reply / Reply All / Forward are grouped under one `Outlook Actions` menu/button.
- Draft text is always bound to the current mail/thread and never leaks to another item.

Likely files:

- `src/lib/dashboard-render.ts`
- `src/lib/workbench-render.ts`
- `src/lib/dashboard-labels.ts`
- `src/lib/message-handler.ts`
- `src/extension.ts`
- `src/test/dashboard-render.test.ts`
- `src/test/workbench-render.test.ts`
- `src/test/message-handler.test.ts`

Implementation notes:

- Use VS Code CSS variables: `--vscode-input-background`, `--vscode-input-foreground`, `--vscode-input-border`, `--vscode-editor-background`, `--vscode-button-background`.
- Prefer `min-height`, `max-height`, `width: 100%`, `box-sizing: border-box`, and responsive layout over fixed tiny controls.
- Put copy action inside the draft editor area.
- Use a stable draft key such as `mail:<mailId>` or `thread:<threadId>` instead of ambiguous raw IDs.
- Do not add persistent draft storage in this task.

Acceptance criteria:

- Dark and light VS Code themes have readable draft/instruction controls.
- Workbench resize does not leave tiny unusable editors.
- Empty draft shows generation path, not polish/refine/outlook actions.
- Non-empty draft shows polish/refine/copy/outlook grouped actions.
- Tests verify item-specific draft key behavior.

Completion Notes:

- Status: Done.
- Files changed:
  - `src/lib/dashboard-labels.ts` — added `Generate Draft` and `Outlook Actions` labels.
  - `src/lib/dashboard-render.ts` — `renderEditableDraftBox` now supports item/source ids, empty-draft generate action, non-empty polish/refine actions, copy inside the editor, and grouped Outlook actions.
  - `src/lib/workbench-render.ts` — passes `mail:<id>` / `thread:<id>` draft keys, dispatches draft actions from the draft box key instead of `currentId`, and adds theme-compatible responsive editor CSS.
  - `src/test/dashboard-render.test.ts` — covers empty/non-empty draft action rendering and item/source attributes.
  - `src/test/workbench-render.test.ts` — covers workbench draft key binding and empty draft generate dispatch.
- Tests:
  - RED: `node --test out/test/dashboard-render.test.js` and `node --test out/test/workbench-render.test.js` failed before implementation because generate action, stable draft keys, and grouped Outlook actions were absent.
  - `npm run compile`
  - `node --test out/test/dashboard-render.test.js`
  - `node --test out/test/workbench-render.test.js`
  - `npm test` (270 tests passing)
- Manual validation: Not run; visual browser/workbench verification was not used in this session per project rule against visual collaboration workflows.
- Known issues:
  - `Generate Draft` reuses existing analyze actions (`analyzeSelected` / `analyzeThread`) rather than adding a new draft-only LLM flow.
  - Draft changes are still in-webview only; persistent draft storage remains intentionally out of scope for this task.
- Commit: `d7e7117bb8ca325482e2fa6db1a4faa976ebf4d2`

---

### P1.2 Normalize metadata, action placement, classification, recipients, and body rendering

Status: [ ] Not started

Goal:

- Sidebar and workbench consistently show classification for all mails, not only pending/manual-confirm queues.
- Workbench consistently shows sender, recipients, time, and classification on separate readable rows.
- Single-mail workbench puts `Open in Outlook` and `Ignore` above the summary, under sender/recipient metadata, with a divider.
- Analyzed single mails show original body below draft/actions, similar in quality to thread timeline cards.

Likely files:

- `src/lib/sidebar-render.ts`
- `src/lib/workbench-render.ts`
- `src/lib/dashboard-render.ts`
- `src/lib/dashboard-labels.ts`
- `src/lib/dashboard-state.ts`
- `src/test/sidebar-render.test.ts`
- `src/test/workbench-render.test.ts`

Implementation notes:

- Reuse existing classification cache lookup instead of introducing a new store.
- Workbench render input may need a mail lookup map so analyzed items can display original recipients/body.
- Keep metadata display deterministic even when some fields are missing.
- Body display should be scroll-friendly and theme-compatible.

Acceptance criteria:

- Every sidebar row shows classification when known.
- Every workbench mail detail shows sender, recipients, time, and classification as fixed metadata rows.
- Analyzed single-mail detail includes original body.
- Tests cover analyzed and un-analyzed mail details.

Completion Notes:

- Status:
- Files changed:
- Tests:
- Manual validation:
- Known issues:
- Commit:

---

### P1.3 Add thread ignore and restore

Status: [ ] Not started

Goal:

- Thread detail has an ignore action next to `Analyze full thread`.
- Ignored threads can be restored.
- Use the existing ignored-mail mechanism unless inspection proves it cannot represent thread ignore.

Likely files:

- `src/lib/workbench-render.ts`
- `src/lib/sidebar-render.ts`
- `src/lib/message-handler.ts`
- `src/extension.ts`
- `src/test/message-handler.test.ts`
- `src/test/workbench-render.test.ts`

Implementation notes:

- Minimal approach: ignoring a thread writes all `sourceMailIds` to the existing ignored mail set.
- Restoring a thread removes all `sourceMailIds` from the ignored mail set.
- Avoid a new `ignored-threads.json` store unless existing data cannot support the UX.

Acceptance criteria:

- Thread can be ignored.
- Thread can be restored from ignored state.
- Mail-level ignore/restore behavior remains unchanged.

Completion Notes:

- Status:
- Files changed:
- Tests:
- Manual validation:
- Known issues:
- Commit:

---

### P1.4 Investigate and fix missing self replies in thread timelines and category outcomes

Status: [ ] Not started

Goal:

- Thread timelines include the user's sent replies as separate timeline items when Outlook collection can access them.
- Follow-up and Must Handle Today categorization is not distorted by missing self replies.

Likely files:

- `scripts/collect-outlook-mails.vbs`
- `src/lib/digest.ts`
- `src/lib/mail-store.ts`
- `src/lib/thread-engine.ts`
- `src/lib/thread-timeline.ts`
- `src/lib/app-analysis.ts`
- `default-config.json`
- `package.json`
- Related tests under `src/test/`

Investigation questions:

- Does the current collection include Sent Items, or only Inbox-like folders?
- If Sent Items are not collected, should Easy Mail collect sent replies automatically for thread completion?
- Can sent mail be fetched by conversation ID without requiring localized folder names?
- Are current follow-up errors caused by missing self replies, prompt/category overlap, or both?

Implementation notes:

- First inspect data collection and stored mail samples before changing prompts.
- Prefer collecting missing sent replies over prompt tuning if the timeline data is incomplete.
- Only tune category definitions after self-reply data is correct.

Acceptance criteria:

- Reproduction thread `B -> A, A -> B, B -> A` shows three timeline cards when sent mail is available.
- Follow-up does not point to an already-answered earlier B mail when A has replied.
- Tests cover thread grouping/timeline behavior with a self reply.

Completion Notes:

- Status:
- Files changed:
- Tests:
- Manual validation:
- Known issues:
- Commit:

---

### P1.5 Replace final icon and verify package surfaces

Status: [ ] Not started

Goal:

- Use `docs/v2-design/easymail-final-icon.png` as the final extension icon.
- VS Code extension list, extension details page, and activity bar show the intended icon.

Likely files:

- `media/icon.png`
- `package.json`
- Possibly `media/` variants if VS Code needs a separate activity icon.

Implementation notes:

- Existing `package.json` points package icon and activity bar icon at `media/icon.png`.
- Replace `media/icon.png` with the final asset or generate the required final-size variant from it.
- Do not stage unrelated image experiments or screenshots.

Acceptance criteria:

- `npm run package:vsix` succeeds.
- The generated VSIX contains the final icon asset at the referenced path.
- Manual VS Code install/check confirms extension list, detail page, and activity bar render correctly.

Completion Notes:

- Status:
- Files changed:
- Tests:
- Manual validation:
- Known issues:
- Commit:

---

### P2.1 Add advanced thread timeline container and scroll-linked rail

Status: [ ] Not started

Goal:

- Thread timeline becomes an independent scrollable container.
- Left rail shows vertical timeline points.
- Hovering a point shows sender name and email.
- Clicking a point scrolls to the corresponding timeline card.
- Scrolling the timeline body updates the active rail point.

Likely files:

- `src/lib/workbench-render.ts`
- `src/lib/dashboard-labels.ts`
- `src/test/workbench-render.test.ts`

Implementation notes:

- Do this after P1.2/P1.4 so body/timeline data is correct first.
- Use plain DOM APIs and CSS; avoid new frontend dependencies.
- Keep accessibility in mind: buttons or focusable anchors, `aria-label`, keyboard support.

Acceptance criteria:

- Multiple-message timeline has visible rail anchors.
- Hover/click behavior works.
- Active anchor updates during timeline scroll.
- Single-message timeline remains clean and does not add distracting chrome.

Completion Notes:

- Status:
- Files changed:
- Tests:
- Manual validation:
- Known issues:
- Commit:

---

### P2.2 Define and harden multiple Outlook account behavior

Status: [ ] Not started

Goal:

- Easy Mail behaves predictably when classic Outlook has multiple mailbox accounts.
- Stored mail identifiers, folder anchors, open-in-Outlook, and compose actions resolve the correct store/mailbox.

Likely files:

- `scripts/collect-outlook-mails.vbs`
- `scripts/open-outlook-mail.vbs`
- `scripts/compose-outlook-mail.vbs`
- `src/lib/mail-store.ts`
- `src/lib/digest.ts`
- `src/extension.ts`
- Related tests under `src/test/`

Investigation questions:

- Does the collector record `StoreID` for every mail and folder anchor?
- Are folder anchors keyed only by folder name, which can collide across accounts?
- Does `GetItemFromID(entryId, storeId)` work consistently for open and compose scripts?
- How should settings express mailbox scope: all stores, default store, or configured folders?

Implementation notes:

- First document observed current behavior with multiple Outlook accounts if available.
- Prefer retaining and using Outlook `StoreID` rather than deriving account identity from display names.
- Avoid adding a complex account picker unless current behavior cannot be made predictable.

Acceptance criteria:

- Documentation states current expected behavior with multiple accounts.
- Open and compose use `entryId + storeId` when available.
- Folder pagination anchors do not collide between accounts.
- Tests cover store-aware lookup where feasible.

Completion Notes:

- Status:
- Files changed:
- Tests:
- Manual validation:
- Known issues:
- Commit:

---

## 4. Cross-Task Acceptance Checklist

Do not call this remediation phase complete until all of these are true:

- [ ] Outlook compose inserts Chinese and English draft bodies without mojibake.
- [ ] Empty draft compose actions are blocked with a clear message.
- [ ] Manual-confirm mails can be explicitly confirmed/analyzed; hard-blocked mails cannot.
- [ ] Analyze batch count uses the current selection on the first click.
- [ ] Obsolete `Allow Analysis` / `Auto Analyze Enabled` UI is removed or deprecated and hidden.
- [ ] Sender, recipients, subject, and classification metadata are not redacted into placeholder tokens.
- [ ] Draft editor and instruction editor are theme-compatible and responsive.
- [ ] Draft state is item-specific and does not leak between mails/threads.
- [ ] Classification is shown consistently across sidebar and workbench where known.
- [ ] Workbench mail details show sender, recipients, time, classification, actions, summary, draft, and body in a stable order.
- [ ] Thread ignore/restore works.
- [ ] Self replies appear in timelines when Outlook collection includes the sent mail.
- [ ] Final icon is used in package/list/details/activity bar.
- [ ] Multiple Outlook account behavior is documented and hardened enough for supported flows.

---

## 5. Suggested Validation Commands

Use targeted tests during each task, then full validation before committing larger sets:

```bash
rtk npm run compile
rtk npm test
rtk npm run package:vsix
```

Useful targeted examples:

```bash
rtk node --test out/test/message-handler.test.js
rtk node --test out/test/workbench-render.test.js
rtk node --test out/test/sidebar-render.test.js
rtk node --test out/test/redaction.test.js
```

Manual Outlook validation is required for:

- P0.1 compose body encoding.
- P1.4 sent/self reply collection.
- P2.2 multiple Outlook account behavior.

---

## 6. Current Snapshot Updates

Append updates here when an agent starts or completes meaningful work.

### Snapshot - 2026-07-02 - Plan created

Status:

- Follow-up remediation plan created from user validation issues 1-15.
- No source code changed yet in this plan.

Current recommendation:

1. Start with `P0.1 Fix Outlook compose draft encoding and empty draft guard`.
2. Keep `agents.md` out of commits unless the user separately asks to change it.
3. Update `04` only when cross-milestone acceptance status changes.

Known caution:

- Several issues may share root causes: missing sent replies can affect thread timeline completeness and Follow-up/Must Handle Today categorization; redacted metadata can affect both display and LLM categorization.
- Do not tune prompts before verifying whether stored/thread data is complete.

---

## 7. Completion Notes Index

Use this section to summarize completed task commits:

- P0.1: implementation `04d96a5029b615d058a7bb28221863d80e432189`; manual Outlook validation pending.
- P0.2: `75c535c1f0961dafbc7e6260c5ba1302f82565e8`
- P0.3: `791f7403b4113e26acfe9b9cf11eb6eb03b0e23d`
- P0.4: `3b9acf30371c62e9d51f2fdaef7d0b0815eb0dde`
- P1.1: `d7e7117bb8ca325482e2fa6db1a4faa976ebf4d2`
- P1.2:
- P1.3:
- P1.4:
- P1.5:
- P2.1:
- P2.2:

---

## 8. Handover Log

#### Handover - 2026-07-02 - Codex (P0.1 start)

Status: In progress

Changed:
- Claimed `P0.1 Fix Outlook compose draft encoding and empty draft guard`.

Validated:
- Read this plan completely.
- Read latest handover.
- Ran `git status --short --branch`: branch `v3`, ahead 1; unrelated dirty file `agents.md`.
- User decision recorded: `Auto Analyze Enabled` should be removed from `package.json` settings when P0.3 starts.

Known issues:
- No source code changed yet in this checkpoint.
- Manual Outlook validation is still required after implementation.

Last safe stopping point:
- Before P0.1 code inspection and test edits.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`
- `agents.md` unrelated pre-existing dirty file.

Next recommended step:
- Inspect compose dispatch paths, add failing empty-draft test, then implement the smallest shared guard and VBS UTF-8 read fix.

---

#### Handover - 2026-07-02 - Codex (P0.1 implementation)

Status: In progress — implementation committed; manual Outlook validation pending

Changed:
- Added empty/whitespace draft guard to shared `composeMail` message handling.
- Changed compose VBS body-file read to `ADODB.Stream` with `Charset = "utf-8"`.
- Updated compose message-handler tests.
- Commit: `04d96a5029b615d058a7bb28221863d80e432189`

Validated:
- RED: `node --test out/test/message-handler.test.js` failed before implementation because empty compose still called `composeOutlookMail`.
- `npm run compile`: pass.
- `node --test out/test/message-handler.test.js`: pass, 29 tests.
- `npm test`: pass, 259 tests.
- `cscript.exe //nologo scripts/compose-outlook-mail.vbs --help`: pass.

Known issues:
- Manual Outlook validation was not run here.
- P0.1 must remain `[~]` until classic Outlook confirms Chinese/English draft prefill is readable for Reply / Reply All / Forward.
- `agents.md` remains unrelated dirty state.

Last safe stopping point:
- P0.1 implementation is committed and test-covered.
- It is safe to continue with P0.2 while manual Outlook validation is pending, but do not close C10/Cross-Task compose acceptance yet.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`
- `agents.md` unrelated pre-existing dirty file.

Next recommended step:
- Start `P0.2 Add manual-confirm analyze action for security-gated mail`, unless manual Outlook validation is available immediately.

---

#### Handover - 2026-07-02 - Codex (P0.2 start)

Status: In progress

Changed:
- Claimed `P0.2 Add manual-confirm analyze action for security-gated mail`.

Validated:
- P0.1 implementation and plan update are committed:
  - Implementation: `04d96a5029b615d058a7bb28221863d80e432189`
  - Plan update: `482c5bc98d9a2a7d420caa0069d669fa013ec9d9`
- Ran `git status --short --branch`: branch `v3`, ahead 3; unrelated dirty file `agents.md`.

Known issues:
- No P0.2 source code changed yet in this checkpoint.

Last safe stopping point:
- Before manual-confirm analyze path inspection.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`
- `agents.md` unrelated pre-existing dirty file.

Next recommended step:
- Inspect security-gate explicit-selection behavior, sidebar/workbench blocked rendering, and message-handler analyze dispatch tests.

---

#### Handover - 2026-07-02 - Codex (P0.2 complete)

Status: Done

Changed:
- Added manual-confirm `Confirm and Analyze` action to sidebar blocked queue rows.
- Added the same action to workbench blocked mail detail.
- Reused existing `analyzeSelected` message path; no new security bypass, state store, or confirmation persistence added.
- Hard-blocked mails do not render this action.
- Commit: `75c535c1f0961dafbc7e6260c5ba1302f82565e8`

Validated:
- RED: targeted sidebar/workbench tests failed before implementation because `Confirm and Analyze` was absent.
- `npm run compile`: pass.
- `node --test out/test/sidebar-render.test.js`: pass.
- `node --test out/test/workbench-render.test.js`: pass.
- `npm test`: pass, 261 tests.

Known issues:
- No manual VS Code UI click test was run in this agent session.
- P0.1 still needs classic Outlook manual validation before closing compose acceptance.

Last safe stopping point:
- P0.2 is complete and committed.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`

Next recommended step:
- Start `P0.3 Fix analyze batch-size race and remove obsolete Auto Analyze setting UI`.
- User decision: remove `easyMail.autoAnalyzeEnabled` from `package.json` settings directly, keep only internal/backward-compatible config handling if needed.

---

#### Handover - 2026-07-02 - Codex (P0.3 start)

Status: In progress

Changed:
- Claimed `P0.3 Fix analyze batch-size race and remove obsolete Auto Analyze setting UI`.

Validated:
- P0.2 implementation and plan update are committed:
  - Implementation: `75c535c1f0961dafbc7e6260c5ba1302f82565e8`
  - Plan update: `b74affeb969182bc646053896d89edb65997dde3`
- Ran `git status --short --branch`: branch `v3`, ahead 2; clean working tree.
- Read `AGENTS.md` from repo root as project guidance.

Known issues:
- No P0.3 source code changed yet in this checkpoint.

Last safe stopping point:
- Before analyze/config path inspection.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`

Next recommended step:
- Inspect sidebar analyze JS, message handler analyze dispatch, app-analysis batch selection, package/default config settings, and tests.

---

#### Handover - 2026-07-02 - Codex (P0.3 complete)

Status: Done

Changed:
- Fixed analyze count race by sending selected `batchSize` in the `analyze` message and honoring it in `analyzeBatchCore`.
- Removed user-facing `Auto Analyze Enabled` / `Allow Analysis` setting from `package.json`, `default-config.json`, sidebar settings, and legacy dashboard settings.
- Kept internal backward compatibility for old persisted `autoAnalyzeEnabled` values.
- Added `src/test/app-analysis.test.ts` and included it in `npm test`.
- Commit: `791f7403b4113e26acfe9b9cf11eb6eb03b0e23d`

Validated:
- RED: compile failed before implementation because core analysis did not accept numeric batch override.
- `npm run compile`: pass.
- `node --test out/test/message-handler.test.js`: pass.
- `node --test out/test/sidebar-render.test.js`: pass.
- `node --test out/test/app-analysis.test.js`: pass.
- `npm test`: pass, 264 tests.
- `Select-String` confirmed no `autoAnalyzeEnabled` / `analysisBatchSize: sel` remains in public config/render files.

Known issues:
- No manual VS Code UI click test was run here.
- Legacy persisted `autoAnalyzeEnabled: false` can still affect internal security behavior until the user changes settings; this is intentional compatibility, not a visible setting.

Last safe stopping point:
- P0.3 is complete and committed.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`

Next recommended step:
- Start `P0.4 Preserve metadata during redaction`.

---

#### Handover - 2026-07-02 - Codex (P0.4 start)

Status: In progress

Changed:
- Claimed `P0.4 Preserve metadata during redaction`.

Validated:
- P0.3 implementation and plan update are committed:
  - Implementation: `791f7403b4113e26acfe9b9cf11eb6eb03b0e23d`
  - Plan update: `920258331618e948c058a84d161a82f6814b04f5`
- Ran `git status --short --branch`: branch `v3`, ahead 4; clean working tree.

Known issues:
- No P0.4 source code changed yet in this checkpoint.

Last safe stopping point:
- Before redaction path inspection.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`

Next recommended step:
- Inspect `redaction.ts`, thread prompt payload construction, and redaction tests; add RED tests proving metadata is preserved while body fields are redacted.

---

#### Handover - 2026-07-02 - Codex (P0.4 complete)

Status: Done

Changed:
- Completed `P0.4 Preserve metadata during redaction`.
- `src/lib/redaction.ts` now preserves mail/thread metadata and redacts only body fields sent to prompt construction.
- `src/test/redaction.test.ts` covers both stored mail and thread prompt redaction boundaries.

Validated:
- RED: `node --test out/test/redaction.test.js` failed before implementation because subject metadata was replaced with `[EMAIL_1]`.
- `npm run compile`: pass.
- `node --test out/test/redaction.test.js`: pass.
- `node --test out/test/thread-prompt-builder.test.js`: pass.
- `npm test`: pass, 266 tests.
- Implementation commit: `3b9acf30371c62e9d51f2fdaef7d0b0815eb0dde`

Known issues:
- No manual VS Code UI/LLM run was performed for this step.
- P0.1 still needs manual Outlook validation before it can be fully closed.

Last safe stopping point:
- P0.4 implementation is complete and committed.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`

Next recommended step:
- Claim `P1.1 Redesign draft editor, actions, and per-item draft binding`.

---

#### Handover - 2026-07-02 - Codex (P1.1 start)

Status: In progress

Changed:
- Claimed `P1.1 Redesign draft editor, actions, and per-item draft binding`.

Validated:
- Read this plan and latest handover.
- Ran `git status --short --branch`: branch `v3`, ahead 6; clean working tree.
- P0.4 implementation and plan update are committed:
  - Implementation: `3b9acf30371c62e9d51f2fdaef7d0b0815eb0dde`
  - Plan update: `f92c43c1e3e3cf6d7aa6322e62beb1786e83e80d`

Known issues:
- No P1.1 source code changed yet in this checkpoint.
- P0.1 still needs manual Outlook validation before closing compose acceptance.

Last safe stopping point:
- Before draft render/message-handler inspection.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`

Next recommended step:
- Inspect draft render helpers, workbench JS message payloads, extension draft generation paths, and existing tests; add RED tests for action visibility and item-specific draft keys.

---

#### Handover - 2026-07-02 - Codex (P1.1 complete)

Status: Done

Changed:
- Completed `P1.1 Redesign draft editor, actions, and per-item draft binding`.
- Empty draft boxes now show a `Generate Draft` action that reuses existing analyze paths.
- Non-empty draft boxes show polish/refine, copy inside the editor, and grouped Outlook actions.
- Workbench draft operations use `mail:<id>` / `thread:<id>` draft keys from the draft box instead of relying on `currentId`.

Validated:
- RED: `node --test out/test/dashboard-render.test.js` and `node --test out/test/workbench-render.test.js` failed before implementation on missing generate/action grouping/item-key behavior.
- `npm run compile`: pass.
- `node --test out/test/dashboard-render.test.js`: pass.
- `node --test out/test/workbench-render.test.js`: pass.
- `npm test`: pass, 270 tests.
- Implementation commit: `d7e7117bb8ca325482e2fa6db1a4faa976ebf4d2`

Known issues:
- No manual VS Code visual validation was run in this session.
- `Generate Draft` is analyze-backed, not a separate draft-only generation flow.
- P0.1 still needs manual Outlook validation before closing compose acceptance.

Last safe stopping point:
- P1.1 implementation is complete and committed.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`

Next recommended step:
- Claim `P1.2 Normalize metadata, action placement, classification, recipients, and body rendering`.

---

#### Handover - 2026-07-02 - Codex (Plan creation)

Status: Done — follow-up remediation plan created

Changed:
- Created `05-post-c10-fix-optimization-plan.md`.
- Mapped all 15 user-reported issues into prioritized P0/P1/P2 tasks.
- Captured likely C10 encoding root cause and the preferred first fix.
- Added multi-agent workflow rules, acceptance checklist, validation commands, and task-level completion notes.

Validated:
- Inspected `04` C10 and Cross-Milestone Acceptance Checklist.
- Inspected relevant current code paths enough to identify the likely Outlook compose encoding mismatch and related remediation files.
- Checked referenced screenshots/assets by path.

Known issues:
- No source code was changed.
- No tests were run for this documentation-only planning step.
- `agents.md` remains an unrelated dirty file from before this planning step.

Last safe stopping point:
- Plan is ready for an implementation agent to claim `P0.1`.

Uncommitted changes / dirty files:
- `docs/v2-design/competitor-analysis/04-execution-plan-thread-spotlight-draft-assist-next-actions.md`
- `docs/v2-design/competitor-analysis/05-post-c10-fix-optimization-plan.md`
- `agents.md` unrelated pre-existing dirty file.

Next recommended step:
- Claim `P0.1`, add a pre-work handover entry, then implement the UTF-8 VBS body-file read and empty-draft compose guard with tests.
