# POC 验收标准

## 目标

交付一个可在另一台 `Windows + classic Outlook + VS Code + GitHub Copilot` 机器上安装和测试的 POC，完成以下链路：

```text
Pull Mail -> 生成 digest -> Analyze -> 生成 JSON / Summary -> Dashboard 展示 -> Copy Draft
```

## 验收范围

### 1. 仓库与发布

- 仓库包含完整 POC 源码，不仅是设计文档。
- 远端仓库为 `Wsr-7/easy-mail`。
- `main` 分支包含最新实现。

### 2. 邮件采集器

- 存在 `scripts/collect-outlook-mails.vbs`。
- 支持以下参数：
  - `--max-items`
  - `--recent-hours`
  - `--folders`
  - `--body-chars`
  - `--output`
  - `--sample`
- 默认通过 classic Outlook COM 读取邮件。
- `--sample` 模式下无需 Outlook 即可生成有效的 `mail-digest.md`。
- 输出 Markdown 包含：
  - 生成时间
  - 采集范围
  - 文件夹列表
  - 每封邮件的主题、发件人、时间、文件夹、未读状态、重要性、正文截断

### 3. VS Code 插件

- 插件目录包含可安装的 VS Code 扩展清单和入口。
- 提供命令：
  - `Easy Mail: Pull Mail`
  - `Easy Mail: Analyze with Copilot`
  - `Easy Mail: Open Digest`
  - `Easy Mail: Open Summary`
  - `Easy Mail: Open Settings`
  - `Easy Mail: Generate Sample Digest`
- 提供 Activity Bar 入口和 Sidebar / Webview 看板。
- 插件运行时将数据写入本地 `data` 目录或 `globalStorage` 目录。

### 4. AI 分析链路

- 支持读取 `mail-digest.md` 并调用 VS Code Language Model API。
- 优先选择 `vendor: copilot`。
- 如果没有可用模型，明确报错。
- 模型输出被解析为结构化 JSON。
- JSON 字段至少包含：
  - `generatedAt`
  - `overview`
  - `items`
- 每个 item 至少包含：
  - `mailId`
  - `category`
  - `priority`
  - `subject`
  - `summary`
  - `reason`
  - `suggestedAction`
  - `draftReply`
- 同步生成 `mail-summary.md`。

### 5. Dashboard

- 看板显示统计卡片：
  - `Must Handle Today`
  - `Risk`
  - `Waiting`
  - `Notice`
- 看板按分类渲染邮件卡片。
- 每张卡片至少显示：
  - 标题
  - 发件人
  - 时间
  - 优先级
  - AI 摘要
  - 原因
  - 建议动作
- 支持交互：
  - `Copy Draft`
  - `Ignore`
  - `Open Digest`
  - `Open Summary`

### 6. 配置

- 存在默认配置文件。
- 支持配置：
  - 最近 N 封
  - 最近 N 小时
  - 扫描文件夹
  - 正文截断长度
  - 是否使用 sample 模式

### 7. 本地验证

- 存在无需 Outlook / Copilot 即可运行的自动化验证。
- 至少覆盖：
  - digest 解析
  - AI JSON 解析与校验
  - Markdown summary 生成
  - dashboard 数据分组
- 存在一条本地可运行的 sample 流程验证命令。

### 8. 交付物

- 代码已提交并推送。
- 文档包含使用说明。
- 如果能打包 `.vsix`，仓库包含打包命令或产物说明。
- 如果当前环境不能打包 `.vsix`，必须说明原因，并保证另一台机器可按文档直接打包或调试运行。

