# 11 · 仓库结构、图标与文档洁净计划

> 状态：`[~]` **执行中。用户已明确确认 #10 全部人工验收通过；以 `main` 合并 `release-0.4.0` 后创建的 `develop` 为执行分支。**

## 1. 目标

在不改变 EasyMail 实际逻辑、配置语义、数据格式和 UI 行为的前提下，让仓库达到以下状态：

- `src/lib` 按稳定职责分成少量子目录，不再由 42 个平铺文件组成。
- Marketplace / Extension Details 与 Activity Bar 使用同一套清晰、可辨识的线条型“AI 邮件”图标语言，不再依赖带毛边的复杂位图或右上角小徽标。
- Git 只保留用户、贡献者和发布真正需要的文档；本地规划、截图、handover 和历史执行记录进入不跟踪的本地区域。
- VSIX 只包含运行时文件与必要用户文档，不再包含编译测试、旧版实现、agent 指令和开发脚本。
- README、User Guide、Development、Security、Architecture 与当前 `package.json`、命令和实现保持一致。
- 删除必须先证明无引用；目录移动只改 import 路径，不顺手重构代码正文。

## 2. 本轮不做

- 不拆分 `extension.ts`、`sidebar-render.ts`、`dashboard-render.ts` 或其他大文件。
- 除本计划新增的图标资产外，不改业务逻辑、UI、prompt、schema、settings、命令、数据路径或 Outlook 脚本行为。
- 不引入 TypeScript path alias、barrel `index.ts`、新构建器、新依赖或新测试框架。
- 不重排 `src/test`；测试目录继续保持现状，避免同时扩大 import 与 test runner 的改动面。
- 不清理 Git 历史，不使用 history rewrite；被移出当前树的历史文档仍可从 Git 历史恢复。

## 3. 当前体检快照

### 3.1 源码结构

- `src/lib` 当前有 42 个 `.ts` 文件，总计约 398 KB，全部平铺。
- `workbench-render-v1.ts` 没有生产或测试 caller，仍会被 TypeScript 编译并打进 VSIX，是首个明确可删除候选。
- `mock-provider.ts` 仅被测试引用，应移到 `src/test/support/`，不属于发布代码。
- `dashboard-render.ts` 中的 legacy `renderDashboardHtml` 当前没有生产 caller，但同文件仍承载 Sidebar/Workbench 共用 helper；只能做单独的死代码审计，不能整文件删除。

### 3.2 文档结构

- Git 当前跟踪 39 个 `docs/` 文件，约 1.61 MB。
- `docs/v2-design/` 主要是历史设计、截图、执行计划和 handover；对本机开发有价值，但不是插件用户或普通贡献者必需内容。
- `README.md` 与 `docs/marketplace-details.md` 当前共享大量内容，存在双份维护漂移风险，但后者已被打包流程刻意与 GitHub README 解耦，不能简单删除或自动覆盖。
- 根目录的 `user guide.md` 含空格，`setup.md`、`docs/vsix-build.md` 与 `scripts/README.md` 职责重叠。
- `tasks/todo.md` 已积累大量历史完成项，属于 agent 工作记录，不是产品文档。
- `AGENTS.md` 仍引用部分历史设计文档；移动文档前必须先更新这些引用。

### 3.3 Git 与 VSIX 边界

- `.gitignore` 当前只有 12 行，已忽略 `out/`、`node_modules/`、`.codex/` 等，但没有明确忽略 `.tmp/`、`.local/`、`.agents/` 和 `tasks/`。
- 项目没有 `.vscodeignore`，但 `package.json.files` 已经是 VSIX allow-list。当前 `@vscode/vsce 3.9.2` 会拒绝同时存在非空 `files` 与 `.vscodeignore`，因此本计划**不新增 `.vscodeignore`**。
- 当前 `files` 中的 `out/**` 会把 `out/test/**`、`out/lib/workbench-render-v1.js` 和 `out/lib/mock-provider.js` 一起打包。
- 当前 `scripts/**` 会把 `clean-out.js`、`run-sample-validation.ps1`、sample classifier 和 `scripts/README.md` 一起打包；运行时实际只需要 4 个 `.vbs`。
- 当前 VSIX 还包含 `AGENTS.md`、`setup.md` 等开发材料。
- 2026-07-14 实测当前包为 109 个文件、530.9 KB；其中 `out/` 有 80 个文件，证明测试产物确实进入发布包，而不只是静态推测。

### 3.4 图标现状

- Marketplace 图标 `media/icon.png` 是 512×512 的拟物信封位图，缩放后边缘与细节容易发毛，右上角 AI 徽标与主体割裂。
- Activity Bar 图标 `media/activity-icon.svg` 把 AI 语义压缩在右上角小块内；VS Code 的 24px 容器中主体占比不足，最终只剩“邮件 + 小圆点/小块”的弱辨识度。
- 两个图标不是同一套几何语言，无法形成稳定的产品识别。

## 4. 方案比较与选择

### A. 只改 `.gitignore` 和文档

改动最小，但 `src/lib` 仍然平铺，VSIX 仍包含测试和开发文件，无法达到本次目标。

### B. 适度整理（采用）

做职责目录、明确清理已证明无引用的文件、收紧现有 VSIX allow-list、压缩公开文档集合，并把本地材料转入 ignored 区域。改动以文件移动和引用更新为主，风险可由编译、全量测试、package listing 和 sample validation 覆盖。

### C. 深度架构重构

同步拆大文件、镜像整理测试目录、增加 alias/barrel、重建文档站点。结构更“整齐”，但会制造大量非必要改动、循环依赖和发布风险，本轮明确否决。

## 5. 目标目录

### 5.1 `src/lib`

```text
src/lib/
├── analysis/
│   ├── analysis-schema.ts
│   ├── analysis-translation.ts
│   ├── app-analysis.ts
│   ├── copilot-provider.ts
│   ├── draft-prompt.ts
│   ├── language-contract.ts
│   ├── llm-provider.ts
│   ├── prompt-config.ts
│   ├── reply-template.ts
│   ├── summary.ts
│   ├── thread-analysis-schema.ts
│   └── thread-prompt-builder.ts
├── domain/
│   ├── digest.ts
│   ├── meeting-digest.ts
│   ├── thread-engine.ts
│   ├── thread-schema.ts
│   └── thread-timeline.ts
├── storage/
│   ├── app-data.ts
│   ├── mail-store.ts
│   ├── meeting-store.ts
│   ├── next-actions.ts
│   └── thread-store.ts
├── security/
│   ├── classification.ts
│   ├── redaction.ts
│   ├── security-gate.ts
│   └── security-types.ts
├── ui/
│   ├── dashboard-labels.ts
│   ├── dashboard-provider.ts
│   ├── dashboard-render.ts
│   ├── dashboard-state.ts
│   ├── guide-webview.ts
│   ├── html-utils.ts
│   ├── message-handler.ts
│   ├── sidebar-render.ts
│   └── workbench-render.ts
├── reports/
│   ├── report-daily.ts
│   ├── report-single-mail.ts
│   └── report-thread.ts
└── shared/
    ├── config-utils.ts
    └── process-runner.ts
```

补充处理：

- `src/lib/mock-provider.ts` 移到 `src/test/support/mock-provider.ts`。
- `src/lib/workbench-render-v1.ts` 在再次证明零 caller 后删除。
- 所有 import 保持直接相对路径；不新增 `index.ts` 或 alias。
- 文件内容除 import 路径外不改，避免把“搬家”变成隐性重构。

### 5.2 文档

Git 最终只保留这一组清晰入口：

```text
README.md
README_zh.md
AGENTS.md
CLAUDE.md
docs/
├── acceptance.md
├── architecture.md
├── development.md
├── marketplace-details.md
├── security.md
└── user-guide.md
```

处理规则：

- `user guide.md` 移到 `docs/user-guide.md`，同步 README 与 `package.json.files`。
- `setup.md`、`docs/vsix-build.md`、`scripts/README.md` 合并为 `docs/development.md` 后删除原文件。
- `docs/acceptance-criteria.md` 精简并改名为 `docs/acceptance.md`，只保留当前自动化与人工验收矩阵。
- `docs/design.md` 只保留经当前代码核对后的 architecture 内容，产出 `docs/architecture.md`；历史设计讨论不混入现状说明。
- `docs/security.md` 保留并核对当前 security gate、classification、redaction、CSP 与“绝不自动发送”边界。
- `docs/marketplace-details.md` 保留独立维护，继续作为 VSIX Marketplace README。
- `docs/implementation-steps.md`、`docs/progressive-analysis-design.md`、整个 `docs/v2-design/` 复制到 `.local/docs/archive/` 后从 Git 当前树移除。
- `.local/` 不上传；历史内容仍可从 Git 历史恢复。
- `tasks/` 转入 `.local/tasks/`，随后从 Git 当前树移除。

## 6. 执行步骤

### [x] H0 · 建立已通过验收后的整理基线 — `develop@7498836`

用户已明确回复 #10 全部通过；从最新 `main` 创建 `develop` 后执行本基线。

开工基线：

```powershell
rtk git status --short --branch
rtk git log -5 --oneline
rtk npm test
rtk npm run package:vsix
rtk npx vsce ls --readme-path docs/marketplace-details.md
```

要求：工作树干净、全量测试通过、现有 VSIX 可生成，并保存 package listing 作为前后对照。

Completion Notes（2026-07-14）：基线 `npm test` 为 467 pass / 0 fail；`npm run package:vsix` 生成 109 files、534.55 KB 的 `easymail-0.4.0.vsix`。`vsce ls` 确认当前包仍含 37 个 `out/test/**`、`workbench-render-v1.js`、`mock-provider.js`、8 个 scripts、`AGENTS.md`、`setup.md` 与根目录 `user guide.md`，作为 H2/H5 的前后对照。用户已确认 #10 全部人工通过；H0 无未决 blocker。

### [ ] H1 · 重做统一的 AI 邮件图标系统

1. 以“信封轮廓 + 位于主体内部的 AI 星芒/电路线”为唯一核心符号；不使用头像、文字、右上角小圆点/徽标、拟物材质、阴影或依赖高分辨率才能看清的细节。
2. `media/activity-icon.svg` 使用 24×24 视口、单色线条、足够粗的主轮廓和 2px 左右安全边距；AI 特征必须位于信封主体内并在 16/20/24px 下仍可辨识。
3. 为 Marketplace 图标建立可编辑 SVG 母版，并从同一几何符号导出透明背景的 512×512 `media/icon.png`；允许使用少量品牌色，但保持扁平线条设计，不用生成式纹理。
4. 通过本地矢量渲染导出 PNG，检查 alpha、尺寸与缩小后的边缘；`package.json` 继续引用 `media/icon.png` 与 `media/activity-icon.svg`。
5. 本任务是用户对 §2“UI 不改”的明确例外；只替换品牌资产，不改任何 Webview 布局或交互。

验证：

```powershell
rtk npm run compile
rtk npm test
rtk npm run package:vsix
```

人工验证：Marketplace / Extension Details 图标边缘平滑；Activity Bar 图标在常用缩放下主体足够大，能直接识别为“AI 驱动的邮件工具”。

### [ ] H2 · 清理已证明无引用的发布污染

1. 用 `rg` 再次枚举 `workbench-render-v1.ts`、`MockProvider`、`renderDashboardHtml` 的所有 caller。
2. 删除零 caller 的 `workbench-render-v1.ts`。
3. 把仅测试使用的 `mock-provider.ts` 移到 `src/test/support/` 并更新两处测试 import。
4. 对 legacy `renderDashboardHtml` 做函数级引用审计；只有其私有调用链完全不被共用 helper 使用时才删除对应死代码，否则保持不动并在 Completion Notes 说明。

验证：

```powershell
rtk npm run compile
rtk npm test
rtk git diff --check
```

### [ ] H3 · 一次性完成 `src/lib` 物理分类

1. 按 §5.1 使用 `git mv` 移动文件。
2. 用 `rg` 枚举并更新 `src/extension.ts`、`src/lib/**`、`src/test/**` 的直接相对 import。
3. 不修改函数、类型、常量、导出名或代码格式。
4. 不移动 `src/test/*.test.ts`。
5. 检查没有旧路径残留，也没有为了缩短路径新增 barrel。

验证：

```powershell
rtk npm run compile
rtk npm test
rtk rg -n "src/lib/(workbench-render-v1|mock-provider)" . --glob "!node_modules/**" --glob "!out/**"
rtk git diff --check
```

预期：编译零错误，全量测试零失败，引用检查零命中。

### [ ] H4 · 分离公开文档与本地开发资料

1. 创建 `.local/docs/archive/` 与 `.local/tasks/`，确认解析后的绝对路径仍位于仓库根目录内。
2. 把历史设计资料和 tasks 复制到 `.local/`，逐项比较文件数量和 hash 后再从 Git 当前树删除。
3. 按 §5.2 完成文档合并、重命名和链接更新。
4. 更新 `AGENTS.md`，删除对已移出历史文档的运行时依赖，只保留当前架构、命令、验证边界和真实未验证项。
5. `CLAUDE.md` 继续只作为指向 `AGENTS.md` 的兼容入口。

`.gitignore` 目标内容在保留当前规则基础上新增：

```gitignore
.tmp/
.local/
.agents/
tasks/
```

注意：`.gitignore` 只影响未跟踪文件；已跟踪的 `docs/v2-design/**` 和 `tasks/**` 必须通过 Git 删除记录移出当前树，不能误以为加 ignore 就完成了。

### [ ] H5 · 收紧 VSIX 内容

继续使用 `package.json.files`，不新增 `.vscodeignore`。allow-list 改为只包含：

```json
[
  "out/extension.js",
  "out/lib/**",
  "scripts/collect-outlook-mails.vbs",
  "scripts/collect-outlook-meetings.vbs",
  "scripts/compose-outlook-mail.vbs",
  "scripts/open-outlook-mail.vbs",
  "prompts/**",
  "media/icon.png",
  "media/activity-icon.svg",
  "LICENSE",
  "README_zh.md",
  "docs/user-guide.md",
  "default-config.json"
]
```

`docs/marketplace-details.md` 继续由 `--readme-path` 加入包。

验证 package listing 必须满足：

- 包含 `out/extension.js`、所有运行时 `out/lib/**`、4 个 VBS、prompts、media、LICENSE、用户指南和默认配置。
- 不包含 `out/test/**`、`AGENTS.md`、`.local/**`、`tasks/**`、历史设计文档、`clean-out.js`、sample validation 脚本或 sample classifier。

```powershell
rtk npm run package:vsix
rtk npx vsce ls --readme-path docs/marketplace-details.md
```

### [ ] H6 · 更新说明性文档

逐项以代码和 manifest 为准核对，不从旧设计文档复制结论：

- README / README_zh：定位、前置条件、快速开始、隐私边界、支持范围、指向详细文档的链接。
- User Guide：全部 commands、settings、Sidebar/Workbench、会议、draft、附件、dueDate、词表配置和限制。
- Development：Node/npm、compile/test/package/sample validation、目录结构、VSIX 内容检查。
- Architecture：真实数据流、模块职责、持久化位置、Outlook/Copilot/security 边界。
- Security：CSP、classification cache、keyword settings、redaction、人工确认和不自动发送。
- Marketplace Details：只保留用户购买/安装前真正需要的信息；不塞开发细节。
- AGENTS：更新新的模块路径、测试数量表述改为不易过期的动态描述，保留真实 Outlook 人工验证边界。

文档一致性检查：

```powershell
rtk rg -n "user guide\.md|setup\.md|docs/v2-design|workbench-render-v1|src/lib/[a-z-]+\.ts" README.md README_zh.md AGENTS.md CLAUDE.md docs package.json
rtk npm test
```

预期：不存在指向已移除文件或旧 `src/lib` 平铺路径的有效引用；代码块中的历史示例若保留，必须显式标成历史。

### [ ] H7 · 最终收口

```powershell
rtk npm run compile
rtk npm test
rtk npm run validate:sample
rtk npm run package:vsix
rtk npx vsce ls --readme-path docs/marketplace-details.md
rtk git diff --check
rtk git status --short --branch
```

人工验证：

1. 安装新 VSIX，确认扩展可激活。
2. 打开 Sidebar 与 Workbench，确认资源和 prompt 能正常加载。
3. 运行 Sample Digest，打开邮件、线程和会议详情。
4. 在真实 Outlook 上至少执行 Fetch New、Open in Outlook 与 Compose window。
5. 在 Copilot 可用环境加载模型并完成一次单封或批量分析。

## 7. Commit 边界

按以下顺序保持可回滚：

1. `design replace product and activity icons Generated with AI`
2. `chore remove obsolete and test-only artifacts Generated with AI`
3. `refactor organize library modules without behavior changes Generated with AI`
4. `docs separate public and local development material Generated with AI`
5. `build trim VSIX package contents Generated with AI`
6. `docs refresh repository guidance Generated with AI`
7. `build package repository hygiene release Generated with AI`

每个 commit 前至少运行与该阶段相符的 compile/test；H1、H3、H6、H7 必须跑全量测试。未得到用户明确指示不得 push。

## 8. 完成标准

- #10 已由用户人工确认，不再存在未决的功能验收阻塞。
- Marketplace 与 Activity Bar 图标共享清晰的 AI 邮件线条符号，小尺寸可辨且 PNG 边缘平滑。
- `src/lib` 符合 §5.1，且没有 alias、barrel 或业务代码改写。
- 当前树中只保留 §5.2 的公开文档集合；本地资料已复制校验并由 `.local/` 保护。
- VSIX listing 不包含测试、历史实现、agent 文件、内部设计资料或开发脚本。
- README、Guide、Development、Architecture、Security、Marketplace 与当前实现一致、互相链接有效。
- compile、全量 test、sample validation、VSIX package、`git diff --check` 全部通过。
- 工作树干净，每个阶段有独立 commit；是否 push 由用户在执行时明确决定。

## 9. 主要风险与防线

- **相对 import 漏改**：一次性移动、全仓 `rg`、compile 和全量测试共同兜底。
- **误删仍有价值的文档**：先复制到 `.local/`，核对数量与 hash，再从 Git 当前树移除；Git 历史仍可恢复。
- **VSIX 缺运行时资源**：以 `vsce ls` 前后对照和安装后 Sample/Outlook smoke test 兜底。
- **文档再次漂移**：文档只描述稳定边界；commands/settings 以 `package.json` 为准，测试数量不写死。
- **整理演变成重构**：任何函数正文变化、文件拆分或新抽象都视为越界，另开计划。

---

## 10. 规划者审核补充（2026-07-14，方案批准，附 3 条修订）

本计划经规划者审核**批准**（分阶段 commit、vsce files/.vscodeignore 互斥认知、`.gitignore` 不影响已跟踪文件、先复制校验再删除等关键防线齐备）。补充修订：

1. **H2 追加事实**：`dashboard-render.ts` 的 legacy `renderDashboardHtml` 已由 G5 复审确认无生产 caller，且其模板内残留 14 处 `onclick=` 内联属性（G5 已把三个运行时页面清零，这是最后的死代码残留）——若 H2 函数级审计确认其私有调用链（含 `renderPendingPanel` 等仅被它使用的函数）不被共用 helper 依赖，应连同删除，使全仓 `onclick=` 归零并可加回归断言；若确有共用，保留部分必须在 Notes 列出保留函数清单与理由。
2. **H4/H6 追加检查**：文档改名/移动后，除计划已列的 README/AGENTS/docs/package.json 一致性 grep 外，**必须补 `rg -n "user guide|setup\.md|vsix-build|docs/v2-design" src/` 确认零命中**（规划者已预核实 `user guide.md` 当前无运行时代码引用，Guide 命令走 webview 渲染而非打开 md 文件——此检查是防回归，不是已知问题）。
3. **H5 追加验证**：收紧 `files` 后的首次打包，除 `vsce ls` 对照外，**必须安装该 vsix 并跑一次 Generate Sample Digest + 打开 Guide**——`files` 漏掉运行时资源（prompts/media/default-config）的故障只有装包才能暴露，listing 看不出加载失败。
4. **执行时机确认**：H0 的硬门槛以用户在对话中明确回复"#10（R3）人工验证通过"为准；R3 验证清单见 `10-execution-plan-r3.md` §5。
