# EasyMail

**EasyMail** 是一个 VS Code 插件，把本地 classic Outlook 变成一个由 AI 分诊的收件箱：通过 VBScript COM 自动化采集邮件与日程，用 GitHub Copilot（VS Code Language Model API）在本地分析，再用一个分诊看板展示结果 —— 除了发送给 Copilot 模型的摘录之外，数据不会离开你的机器。

[English](./README.md)

## 工作原理

```text
classic Outlook（Windows）
  │  VBScript COM 自动化（cscript.exe）
  ▼
mail-digest.md / meeting-digest.md
  │  由插件解析
  ▼
mail-store.json / meeting-store.json / thread-store.json
  │  由 GitHub Copilot 分析（vscode.lm API）
  ▼
analysis-result.json / thread-analysis-result.json
  │
  ▼
Sidebar（分诊队列）+ Workbench（阅读面板）+ Markdown 报告
```

所有数据都在本地处理，除发送给所选 Copilot 模型的邮件摘录外，不会有邮件内容离开本机。

## 核心能力

- **本地采集** —— 通过 COM 从 classic Outlook 拉取邮件与会议，无需服务器或邮箱导出
- **灵活的拉取范围** —— 支持按最近 N 小时或最大条数拉取，可指定一个或多个文件夹
- **渐进式分析** —— 邮件先进入本地队列，再按下一批 / 已选中 / 全部允许三种方式分析
- **会话感知** —— 按会话把邮件分组、裁剪引用历史、在送给模型前对重复正文去重
- **安全密级门控** —— 超过配置密级（`PUBLIC` → `HIGH REGISTERED`）的邮件不会自动分析，需要手动确认
- **草稿回复** —— Copilot 为邮件/会话生成回复草稿，支持润色/改写，并可一键交给 Outlook 编辑窗口（绝不会自动发送）
- **双栏界面** —— 侧边栏分诊队列（分类计数、待办事项）+ 全宽 workbench 阅读面板
- **双语支持** —— 界面与分析输出支持中英文，运行时可切换
- **Sample 模式** —— 生成演示用的虚构邮件数据，无需 Outlook 或 Copilot 即可体验
- **不落云端存储** —— 所有数据写入 VS Code 的 `globalStorageUri`，保留期可配置，并提供一键清空本地缓存

## 环境要求

- Windows，已安装并配置 classic（桌面版）Outlook
- VS Code `^1.90.0`
- 已登录、具备 Language Model API 权限的 GitHub Copilot 订阅

## 安装

从 [releases/](./releases) 下载 `.vsix` 后安装：

```powershell
code --install-extension releases/easy-mail-0.2.0.vsix
```

也可以从源码构建，见下方[开发](#开发)部分。

## 快速开始

1. 从 Activity Bar 打开 EasyMail 视图。
2. 还没有 Outlook？先执行 **EasyMail: Generate Sample Digest** 用演示数据体验整个流程。
3. 执行 **EasyMail: Fetch New Mail** 从 Outlook 拉取最近邮件。
4. 在侧边栏选择一个 **Analysis Model**，然后执行 **Analyze Next Batch**（或 **Analyze All Allowed**）。
5. 在侧边栏队列中查看分诊结果，点开某一项在 workbench 中阅读、生成草稿或执行操作。

完整命令列表、配置说明与自定义分类 prompt 见 [user guide.md](./user%20guide.md)。

## 配置

所有设置都在 VS Code Settings 的 `easyMail.*` 命名空间下（`easyMail.rangeMode`、`easyMail.folders`、`easyMail.outputLanguage`、`easyMail.autoAnalyzeMaxClassificationLevel`、各类保留期、`easyMail.importantSenders` 等）。看板顶部的 Settings 面板只是常用字段的快捷编辑器，VS Code Settings 始终是唯一生效源。

## 目录结构

```text
src/         TypeScript 插件源码（src/lib 是业务逻辑模块）
scripts/     Outlook VBScript COM 自动化脚本，以及构建/验证脚本
prompts/     Copilot 分析提示词模板
media/       插件图标资源
releases/    带版本号的 .vsix 安装包
docs/        设计文档与修复计划
```

完整的模块地图与架构图见 [AGENTS.md](./AGENTS.md)。

## 开发

```powershell
npm install
npm run compile      # 清空 out/ 后执行 tsc
npm test             # 编译 + 运行全部测试（node --test）
npm run package:vsix # 打包 releases/easy-mail-0.2.0.vsix
```

编译后运行单个测试文件：

```powershell
node --test out/test/digest.test.js
```

首次搭建环境的分步说明见 [setup.md](./setup.md)；架构与协作约定见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
