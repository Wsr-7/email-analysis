# EasyMail User Guide

## Requirements

EasyMail runs on Windows. Real mail and meeting collection requires classic Outlook, a profile that Outlook COM can access, and permission to run `cscript.exe`. Copilot analysis and draft assistance additionally require VS Code with GitHub Copilot signed in and a model available through the VS Code Language Model API.

Use **Generate Sample Digest** first when you want to explore the extension without Outlook or Copilot.

## Typical workflow

1. Open the EasyMail Activity Bar view and choose **Fetch New** or **Sample**.
2. Choose a queue item in the Sidebar. The Workbench opens the first item in that queue and follows subsequent selections.
3. Load a Copilot model, then analyze the next batch, a selected item, a thread, or all allowed mail.
4. Read the result in the Workbench. Generate, polish, or refine a draft if needed, then use the Outlook action menu to open a compose window.
5. Generate daily, single-mail, or thread reports when a Markdown handoff is useful.

EasyMail never sends mail automatically. Outlook compose actions only open a draft window.

## First use

Open **EasyMail: Open User Guide** for the same five-step checklist inside VS Code. The checklist remembers completed steps in your local VS Code profile.

1. **Load Sample Data** first to explore the Sidebar, Workbench, and analysis flow without reading Outlook.
2. **Load Copilot Models**, then choose the model in the Sidebar before running analysis.
3. **Select Outlook Folders** after starting Outlook. The selected folders are saved to VS Code Settings.
4. Optionally open **Settings** for important or ignored senders, security keywords, and retention. These are non-blocking: choose **Set up later** when you are not ready to decide, and return at any time.
5. **Fetch New Mail** for the first real collection. Choose an item in the Sidebar, then analyze the next batch or selected mail as needed.

The checklist does not infer completion from defaults or saved settings. Mark a step complete after you have performed it, so it remains a deliberate, user-controlled record.

## Commands

| Command | What it does |
| --- | --- |
| `EasyMail: Fetch New Mail` | Collects mail using the selected range and folders. |
| `EasyMail: More History` | Loads an earlier page using stored folder anchors. |
| `EasyMail: Generate Sample Digest` | Loads generated sample mail without Outlook. |
| `EasyMail: Analyze Next Batch with Copilot` | Analyzes the next permitted batch. |
| `EasyMail: Analyze Thread with Copilot` | Analyzes the selected thread. |
| `EasyMail: Analyze All Allowed with Copilot` | Analyzes all mail currently allowed by the security gate. |
| `EasyMail: Load Copilot Models` | Refreshes selectable VS Code Language Model API models. |
| `EasyMail: Open Digest` | Opens the locally stored digest. |
| `EasyMail: Open Summary` | Opens the locally stored summary. |
| `EasyMail: Generate Reports` | Rebuilds Markdown reports from current results. |
| `EasyMail: Open Daily Brief` | Opens the current daily brief report. |
| `EasyMail: Open Thread Report` | Opens the selected thread report. |
| `EasyMail: Open Single Mail Report` | Opens the selected mail report. |
| `EasyMail: Select Outlook Folders` | Chooses Outlook folders used by collection. |
| `EasyMail: Open Settings` | Opens the EasyMail settings page. |
| `EasyMail: Open User Guide` | Opens this guide inside VS Code. |
| `EasyMail: Open Reply Template` | Opens the local editable reply template. |
| `EasyMail: Open Prompt Config` | Opens the local editable prompt configuration. |
| `EasyMail: Clear Local Cache` | Clears EasyMail's locally stored data. |
| `EasyMail: Open Workbench` | Opens the reading pane. |

## Sidebar and Workbench

The Sidebar is a compact triage queue. It keeps the selected queue, shows category counts, supports pending, blocked, analyzed, ignored, meeting, and next-action items, and exposes the frequent actions. Range and model controls save automatically; actions that depend on them flush the current control values first.

The Workbench is the full reader. It shows original mail details, classification, recipients, analysis, due dates, attachments, thread spotlight, meetings, drafts, and Outlook actions. Thread timelines can switch between ascending and descending time order. Ignoring or restoring a thread applies to all source mail in that thread.

## Settings

VS Code Settings is the source of truth. The Sidebar only exposes the high-frequency range and model controls.

| Setting | Purpose |
| --- | --- |
| `easyMail.rangeMode` | Uses `recentHours` or `maxItems` for collection. |
| `easyMail.recentHours` / `easyMail.maxItems` | Value for the selected collection range. |
| `easyMail.folders` | Outlook folders to scan. |
| `easyMail.collectorTimeoutSeconds` | Timeout for collection scripts; default is 120 seconds. |
| `easyMail.meetingDaysAhead` | Number of future calendar days to collect. |
| `easyMail.modelFamily` | Preferred Copilot model identity. |
| `easyMail.outputLanguage` / `easyMail.draftLanguage` | Output and draft language selection. |
| `easyMail.draftGeneration` | Generates drafts automatically or on demand. |
| `easyMail.bodyExcerptChars` | Maximum collected body characters per mail. |
| `easyMail.sampleMode` | Uses generated sample data instead of Outlook collection. |
| `easyMail.mailStoreRetentionDays` | Mail body retention; default is seven days. |
| `easyMail.analysisRetentionDays` / `easyMail.mailIndexRetentionDays` | Retention for results and pagination/dedup metadata. |
| `easyMail.autoAnalyzeMaxClassificationLevel` | Highest classification level that can be analyzed automatically. |
| `easyMail.hardBlockKeywords` / `easyMail.manualConfirmKeywords` | Keyword-driven block and confirmation rules. |
| `easyMail.classificationLevel2Keywords` / `easyMail.classificationLevel3Keywords` | Keyword-driven classification elevation. |
| `easyMail.importantSenders` / `easyMail.ignoredSenders` | Sender rules for Important Senders and Ignored queues. |

Prompt categories, reply templates, model choices, and cached analysis are saved under VS Code global storage. They are local to the VS Code user profile, not this repository.

## Reply templates and prompt categories

**Reply Template** controls the local layout of a generated draft. It has four required fixed placeholders: `{{GREETING}}`, `{{MAIN_MESSAGE}}`, `{{REQUESTED_ACTION}}`, and `{{CLOSING}}`. EasyMail asks the model for those four parts, then fills the template locally, so fixed headings, spacing, and sign-off text remain under your control. Automatic analysis may leave a draft empty when no reply is needed. **Generate Draft** is different: clicking it is an explicit request and always asks the model to produce a draft, even for a notification or no-action mail.

**Prompt Categories** controls the classification vocabulary used in analysis. Open it with **EasyMail: Open Prompt Config**. Each category contains an `id`, Chinese and English labels, a `description` sent to the model, and an optional `priorityHint`. You can add categories for future analyses or adjust their labels and guidance. Changes are read on the next refresh or analysis; they do not reclassify existing results. Removing a category does not delete historical results; an existing result with that ID remains visible but falls back to displaying the raw ID if its custom label no longer exists.

## Security and privacy

Collection and storage are local. When you start analysis, the selected prompt payload is sent to the Copilot model selected through VS Code. Classification, keyword rules, and redaction are applied before that request. Mail above the automatic threshold may require confirmation or be blocked.

Review the original message in Outlook before acting on a generated result or draft. See [Security](./security.md) for the complete boundary.

## Known limits and real checks

Sample mode validates the local flow, not Outlook. On a real mailbox, verify folder selection, pagination, CC-only recipient direction, recurring meetings, opening Outlook items, and compose windows. Copilot availability also depends on the signed-in account, subscription, and organization policy.
