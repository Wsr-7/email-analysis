# EasyMail

> 在 VS Code 中把 classic Outlook 邮件带入本地、由 Copilot 辅助的分诊工作区。

[English](./README.md)

## Overview

EasyMail 是面向 Windows 与 classic 桌面版 Outlook 的 VS Code 插件。它通过本地 VBScript COM 自动化采集邮件和会议，把本地数据保存在 VS Code 存储中，并且只在你主动执行分析时调用 GitHub Copilot Language Model API。

EasyMail 不会把邮件内容上传到自己的服务。用于分析的邮件摘录只会发送给你所选择的 Copilot 模型。

## Features

### 本地采集与整理

- 从一个或多个 classic Outlook 文件夹采集邮件，支持按最近小时数或最大条数限定范围。
- 采集近期会议，并把邮件、会议、线程和分析结果保存在 VS Code 本地存储中。
- 用 Sample 模式生成示例数据，在连接 Outlook 前体验完整流程。

### 分诊与分析

- 在 Sidebar 中查看带分类计数的待办队列。
- 用已加载的 Copilot 模型分析下一批、选中邮件、线程或全部允许分析的邮件。
- 将相关邮件归成线程，并在分析前裁掉重复的引用历史。
- 对较高密级邮件保留既有确认门控，不会自动分析。

### 阅读与处理

- 在全宽 Workbench 阅读邮件、线程、会议和分析详情。
- 生成、润色和改写回复草稿，再交给 Outlook 撰写窗口；EasyMail 绝不会自动发送邮件。
- 在英文与简体中文之间切换界面和分析输出。

<!-- SCREENSHOT: sidebar-triage-counts.png — Sidebar 分诊队列，需截到分类计数、待分析邮件和当前选中项 -->

## Quick Start

1. 从 [releases/](./releases) 安装扩展包，然后从 VS Code Activity Bar 打开 **EasyMail** 视图。
2. 若暂时没有 Outlook，运行 **EasyMail: Generate Sample Digest**。
3. 否则运行 **EasyMail: Fetch New Mail**，从已配置的 Outlook 文件夹采集邮件。
4. 运行 **EasyMail: Load Copilot Models**，在 Sidebar 选择 **Analysis Model**，然后执行 **Analyze Next Batch**。
5. 打开队列中的邮件，在 Workbench 中阅读详情并处理草稿。

<!-- SCREENSHOT: sample-mode-results.png — Generate Sample Digest 后的示例邮件、会议与分诊结果 -->

源码搭建和开发命令见 [setup.md](./setup.md)。

## Usage

### 采集邮件与会议

在 VS Code Settings 或 Sidebar 中设置采集范围，然后使用 **Fetch New Mail**。EasyMail 会在本地采集已配置的邮件文件夹和相应日历范围。需要较早邮件时使用 **More History**；需要演示数据时使用 **Generate Sample Digest**。

### 分析队列

先加载可用 Copilot 模型并在 Sidebar 中选择它，再执行 **Analyze Next Batch**、**Analyze All Allowed**，或者在 Workbench 中分析单封邮件或线程。高于自动分析密级阈值的项目仍需通过既有确认操作。

<!-- SCREENSHOT: analysis-in-progress.png — 点击 Analyze Next Batch 后的分析进行中状态，需包含取消按钮或忙碌提示 -->

### 处理回复草稿

在 Workbench 打开邮件或线程。生成回复草稿后可以直接编辑，需要时使用 **Polish** 或 **Refine**。**Compose in Outlook** 会带着草稿打开 Outlook 撰写窗口；请自行在 Outlook 中检查并发送。

<!-- SCREENSHOT: workbench-draft.png — Workbench 阅读面板，需同时截到邮件正文、分析结果和草稿编辑区 -->

### 选择 Outlook 文件夹

运行 **EasyMail: Select Outlook Folders**，从正在运行的 classic Outlook 加载文件夹并选择要扫描的目录。选择结果会保存到 `easyMail.folders`；有需要时也可以手动编辑该设置。

<!-- SCREENSHOT: select-outlook-folders.png — Select Outlook Folders QuickPick，需截到可多选文件夹和 Sent Items 标记 -->

完整命令列表和工作流细节见 [user guide.md](./user%20guide.md)。

## Configuration

全部设置位于 VS Code Settings 的 `easyMail.*` 命名空间。常用项包括：

- `easyMail.rangeMode`、`easyMail.recentHours`、`easyMail.maxItems`：采集范围。
- `easyMail.folders`：Outlook 文件夹，推荐通过 **Select Outlook Folders** 填充。
- `easyMail.modelFamily`：Copilot 模型标识；推荐在 Sidebar 中加载并选择当前可用模型。
- `easyMail.outputLanguage`、`easyMail.draftLanguage`：界面与回复语言。
- `easyMail.autoAnalyzeMaxClassificationLevel`：自动分析门控阈值。
- `easyMail.bodyExcerptChars`：每封邮件保留给分析的最大正文字符数。

Sidebar 只提供少量常用控件，VS Code Settings 始终是唯一生效源。完整参考见 [user guide.md](./user%20guide.md)。

## FAQ

### 没有 Outlook 也能使用吗？

可以。Sample 模式会创建演示用的邮件和会议数据，便于体验界面；采集真实邮件和会议仍需要 Windows 上的 classic Outlook。

### EasyMail 会自动发送邮件吗？

不会。它可以带着草稿打开 Outlook 撰写窗口，但发送操作始终由你在 Outlook 中完成。

### 为什么有些邮件没有自动分析？

邮件可能仍在 Pending、尚未被选择，或密级高于 `easyMail.autoAnalyzeMaxClassificationLevel`。高密级邮件需要走确认流程。

### 到哪里看完整命令与配置说明？

查看 [user guide.md](./user%20guide.md)。贡献或本地开发可参阅 [setup.md](./setup.md) 与项目结构说明 [AGENTS.md](./AGENTS.md)。

## Known Limitations

- EasyMail 依赖 Windows Script Host 与 Outlook COM 自动化，因此仅支持 Windows。
- 仅支持 classic 桌面版 Outlook，不支持新版 Outlook 客户端或 Outlook 网页版。
- Copilot 分析需要有效的 GitHub Copilot 订阅，以及暴露 Language Model API 的 VS Code 运行时；可选模型由该环境决定。
- `easyMail.bodyExcerptChars` 会在采集时截断每封邮件正文（默认 `1500`，最小 `100`）。很长的新增内容可能导致分析不完整；可调大该设置，或用 **Open in Outlook** 查看完整原文。
- Outlook 与 Exchange 的行为（包括文件夹枚举和收件人地址解析）会随本地配置而异，需要在目标邮箱中验证。

## Author

Wsr-7

## License

[MIT](./LICENSE)
