# EasyMail

> Bring classic Outlook mail into a local, Copilot-assisted triage workspace in VS Code.

[简体中文](./README_zh.md)

## Overview

EasyMail is a Windows VS Code extension for classic desktop Outlook. It uses local VBScript COM automation to collect mail and meetings, keeps its local data in VS Code storage, and uses the GitHub Copilot Language Model API only when you choose to analyze an item.

Mail content is not uploaded by EasyMail to its own service. The excerpt selected for analysis is sent to the Copilot model you select.

## Features

### Collect and organize locally

- Collect mail from one or more classic Outlook folders, by recent-hours window or maximum item count.
- Collect upcoming meetings and retain local mail, meeting, thread, and analysis data in VS Code storage.
- Use Sample mode to explore the workflow with generated data before connecting Outlook.

### Triage and analyze

- Review pending mail in the Sidebar with category counts and a focused queue.
- Analyze the next batch, selected mail, a thread, or all permitted mail with a loaded Copilot model.
- Group related messages into threads and trim repeated quoted history before analysis.
- Keep higher-classification mail behind the existing confirmation gate instead of auto-analyzing it.

### Read and act

- Open a full-width Workbench reading pane for mail, threads, meetings, and analysis details.
- Generate, polish, and refine reply drafts, then hand them to an Outlook compose window; EasyMail never sends mail automatically.
- Switch the UI and analysis output between English and Simplified Chinese.

<!-- SCREENSHOT: sidebar-triage-counts.png — Sidebar 分诊队列，需截到分类计数、待分析邮件和当前选中项 -->

## Quick Start

1. Install a package from [releases/](./releases), then open the **EasyMail** view from the VS Code Activity Bar.
2. To try the extension without Outlook, run **EasyMail: Generate Sample Digest**.
3. Otherwise, run **EasyMail: Fetch New Mail** to collect mail from the configured Outlook folders.
4. Run **EasyMail: Load Copilot Models**, choose an **Analysis Model** in the Sidebar, and use **Analyze Next Batch**.
5. Open a queue item to read its details and work on a draft in the Workbench.

<!-- SCREENSHOT: sample-mode-results.png — Generate Sample Digest 后的示例邮件、会议与分诊结果 -->

For source setup and development commands, see [setup.md](./setup.md).

## Usage

### Collect mail and meetings

Set the mail range in VS Code Settings or the Sidebar, then use **Fetch New Mail**. EasyMail collects the configured mail folders and the applicable Outlook calendar range locally. Use **More History** when you need older mail, or **Generate Sample Digest** for generated demo data.

### Analyze the queue

Load an available Copilot model, choose it in the Sidebar, then run **Analyze Next Batch**, **Analyze All Allowed**, or analyze an individual mail or thread from the Workbench. Items above the configured automatic-analysis classification level require the existing confirmation action.

<!-- SCREENSHOT: analysis-in-progress.png — 点击 Analyze Next Batch 后的分析进行中状态，需包含取消按钮或忙碌提示 -->

### Draft replies

Open a mail or thread in the Workbench. Generate a reply draft, edit it directly, then use **Polish** or **Refine** when needed. **Compose in Outlook** opens a compose window with the draft; review and send it in Outlook yourself.

<!-- SCREENSHOT: workbench-draft.png — Workbench 阅读面板，需同时截到邮件正文、分析结果和草稿编辑区 -->

### Choose Outlook folders

Run **EasyMail: Select Outlook Folders** to load folders from the running classic Outlook client and select the folders to scan. The selection is saved to `easyMail.folders`; you can also edit that setting manually when needed.

<!-- SCREENSHOT: select-outlook-folders.png — Select Outlook Folders QuickPick，需截到可多选文件夹和 Sent Items 标记 -->

See [user guide.md](./user%20guide.md) for the complete command list and workflow details.

## Configuration

All settings use the `easyMail.*` namespace in VS Code Settings. Common settings include:

- `easyMail.rangeMode`, `easyMail.recentHours`, and `easyMail.maxItems` for collection scope.
- `easyMail.folders` for Outlook folders, preferably populated with **Select Outlook Folders**.
- `easyMail.modelFamily` for the Copilot model identifier; loading and selecting a currently available model in the Sidebar is the recommended path.
- `easyMail.outputLanguage` and `easyMail.draftLanguage` for display and reply language.
- `easyMail.autoAnalyzeMaxClassificationLevel` for the automatic-analysis gate.
- `easyMail.bodyExcerptChars` for the maximum number of body characters retained per mail for analysis.

The Sidebar exposes a small set of common controls. VS Code Settings remains the source of truth; see [user guide.md](./user%20guide.md) for the full reference.

## FAQ

### Can I use EasyMail without Outlook?

Yes, Sample mode creates generated mail and meeting data for exploring the UI. Collecting real mail and meetings requires classic Outlook on Windows.

### Does EasyMail send mail automatically?

No. It can open an Outlook compose window with a draft, but sending remains an Outlook action under your control.

### Why is a mail not analyzed automatically?

The mail may be pending, not yet selected, or above `easyMail.autoAnalyzeMaxClassificationLevel`. High-classification mail follows the confirmation flow.

### Where is the detailed command and configuration reference?

Read [user guide.md](./user%20guide.md). Contributors can use [setup.md](./setup.md) and the project map in [AGENTS.md](./AGENTS.md).

## Known Limitations

- EasyMail is Windows-only because its collectors use Windows Script Host and Outlook COM automation.
- It supports classic desktop Outlook, not the new Outlook client or Outlook on the web.
- Copilot analysis requires an active GitHub Copilot subscription and a VS Code runtime that exposes the Language Model API; the available models depend on that environment.
- `easyMail.bodyExcerptChars` truncates each mail body during collection (default `1500`, minimum `100`). Very long new content can therefore be incomplete for analysis; increase the setting or use **Open in Outlook** for the full original message.
- Outlook and Exchange behavior, including folder enumeration and recipient address resolution, can vary by local profile and has to be verified in the target mailbox.

## Author

Wsr-7

## License

[MIT](./LICENSE)
