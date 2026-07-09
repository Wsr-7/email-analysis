# Outlook Migration 远期兼容方案调研

> 调研日期：2026-07-04
>
> 适用项目：Easy Mail VS Code extension
>
> 当前项目现状：Easy Mail 目前通过 `cscript.exe + scripts/collect-outlook-mails.vbs` / `collect-outlook-meetings.vbs` 调用 Windows Outlook Classic 的 COM/MAPI 对象模型，把邮件和会议导出为 digest markdown，再进入 `MailStore` / `MeetingStore` / `ThreadStore` / Copilot 分析 / Webview UI 管线。

## 1. 结论摘要

1. **Exchange Online migration 不等于一定没有 Outlook 客户端。** 企业可能只是把邮箱服务器迁到 Microsoft 365 / Exchange Online，用户仍继续使用 Windows Outlook Classic。此时当前 VBS/COM 方案大概率仍能继续工作，因为它读的是本机 Outlook profile 中的邮件对象。
2. **真正会打断当前方案的是客户端迁移，而不是单纯服务器迁移。** 如果用户从 Outlook Classic 切到 new Outlook for Windows、Outlook on the web，或者没有本机 Outlook Classic，`Outlook.Application` COM/VBS 方案会失效。
3. **远期主线应该是 Microsoft Graph Provider。** Graph 能覆盖 Exchange Online、new Outlook、Outlook on the web、macOS、无本地 Outlook 客户端等场景，是 Exchange Online 迁移的长期兼容主路线。
4. **Windows VBS/COM 和 macOS AppleScript/JXA 应保留为 Local Outlook Provider。** 这两类 provider 的价值是“不需要 Entra app registration / Graph admin consent”，但它们都依赖本机 Outlook 客户端和本机自动化权限，不能作为长期唯一方案。
5. **不建议新增 EWS Provider。** EWS 在 Exchange Online 上已经进入退役倒计时，应避免把工程投入放到将被关闭的 API 上。
6. **推荐架构是 Multi Provider + Normalization Layer。** 把“收集邮件/会议”的入口从 `extension.ts` 中抽象出来，后续所有 provider 都输出同一种 `MailDigestData` / `MeetingDigestData` 或 normalized item，复用现有 store、thread、analysis、UI。

## 2. 官方/公开时间线与兼容性事实

### 2.1 new Outlook for Windows 与 Classic Outlook

Microsoft Learn 的 new Outlook migration 文档把迁移分成三阶段：

| 阶段 | 含义 | 对 Easy Mail 的影响 |
| --- | --- | --- |
| Opt-in | new Outlook 默认关闭，用户可在 Outlook Classic 中打开 “Try the new Outlook” 开关。两个客户端可并行。 | 当前 VBS/COM 方案仍可服务保留 Classic 的用户；但切到 new Outlook 的用户会失效。 |
| Opt-out | new Outlook 默认开启，用户仍可回退到 Classic；企业管理员至少有 12 个月通知。 | 需要开始把 Graph Provider 放到主流程，否则企业批量切换时会失效。 |
| Cutover | 用户不能再切回 Classic；Microsoft 365 新部署会使用 new Outlook。Classic Outlook 既有 perpetual/subscription 安装至少支持到 2029。 | 必须有 Graph Provider；VBS/COM 只能作为历史/兼容路径。 |

来源：Microsoft Learn - Stages of migration to new Outlook for Windows  
https://learn.microsoft.com/en-us/microsoft-365-apps/outlook/get-started/guide-product-availability

关键点：

- new Outlook for Windows 在 2024-08-01 进入 GA。
- Classic Outlook 现有 perpetual/subscription 安装会继续支持到至少 2029。
- opt-out / cutover 阶段都会提前至少 12 个月通知企业管理员。

### 2.2 new Outlook 不支持 COM/VSTO

Microsoft Learn 明确说明：new Outlook on Windows 不支持 VSTO 和 COM add-ins；如果要兼容 new Outlook，传统 COM/VSTO 插件要迁移到 Outlook web add-in。Classic Outlook on Windows 仍支持 VSTO/COM。

来源：Microsoft Learn - Develop Outlook add-ins for the new Outlook on Windows  
https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/one-outlook

对 Easy Mail 的影响：

- 当前 VBS 不是 COM add-in，但同样依赖 `Outlook.Application` 这类 Classic Outlook COM 自动化能力。
- 用户一旦只保留 new Outlook，不安装 Classic Outlook，本地 COM 自动化入口就不可用。
- VS Code extension 本身不是 Outlook web add-in，因此为了继续“后台收集和分析邮件”，应走 Graph，而不是把 VS Code extension 直接改成 Office.js add-in。

### 2.3 Outlook web add-in 的覆盖范围

Outlook web add-ins 支持 Outlook on the web、new/classic Outlook on Windows、Outlook on Mac、iOS、Android 和 Outlook.com。它们需要网络连接运行，并且 web add-in 的代码运行在 browser/webview sandbox 中。

来源：Microsoft Learn - Outlook add-ins overview  
https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview

对 Easy Mail 的影响：

- 如果以后要做“Outlook 内嵌侧栏版 Easy Mail”，可以另起一个 Office.js Outlook add-in 产品线。
- 但当前项目是 VS Code extension，用户预期是在 VS Code 内收集、分析、展示邮件，因此 Graph Provider 更适合作为核心采集入口。

### 2.4 Microsoft Graph Mail API

Microsoft Graph Mail API 可授权访问用户 Outlook 邮件数据。它支持 Microsoft 365 / Exchange Online 云邮箱、shared mailbox、以及部分 Exchange hybrid deployment 场景；不支持 in-place archive mailboxes。

来源：Microsoft Learn - Use the Outlook mail REST API  
https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0

关键能力：

| 能力 | Graph 支持情况 | 对 Easy Mail 的意义 |
| --- | --- | --- |
| 读取邮件 | `/me/messages`、`/me/mailFolders/{id}/messages` | 替代 VBS 读取 Inbox / Sent Items。 |
| 读取文件夹 | well-known folders: `Inbox`、`Drafts`、`SentItems`、`DeletedItems` 等 | 替代当前 `easyMail.folders` 中的 Outlook display name。 |
| 读取正文 | message `body` / `bodyPreview` / `uniqueBody` | 生成 `bodyExcerpt`。 |
| 纯文本正文 | `Prefer: outlook.body-content-type="text"` | 避免直接把 HTML 喂给 prompt。 |
| MIME 原文 | `GET /me/messages/{id}/$value` | 如果未来需要“邮件原始数据”或 `.eml` 导出可用。 |
| 增量同步 | message delta query | 替代每次全量扫描，适合本地 store。 |
| 稳定 ID | `Prefer: IdType="ImmutableId"` | 降低移动邮件导致 Graph `id` 变化的 dedupe 风险。 |
| 限流处理 | 429 + `Retry-After` | 必须做 retry/backoff。 |

### 2.5 EWS 退役风险

公开报道转述 Microsoft 2026 年公告：Exchange Online 的 EWS 将在 2026-10-01 开始分阶段默认禁用，并在 2027-04-01 完全关闭；该变化只影响 Microsoft 365 / Exchange Online，不影响 on-prem Exchange Server。

来源：

- Windows Central - Microsoft’s Exchange Web Services shutdown process now has concrete dates  
  https://www.windowscentral.com/microsoft/microsoft-ews-retirement-365-online
- TechRadar - Microsoft starts the countdown for the end of Exchange Web Services  
  https://www.techradar.com/pro/microsoft-starts-the-countdown-for-the-end-of-exchange-web-services

注意：这里使用的是媒体转述结果，工程决策上足够说明“不值得新建 EWS Provider”。如果后续要写对外文档，应再从 Microsoft Message Center / Exchange Team Blog 校验最新官方原文。

### 2.6 macOS 本地脚本能力与安全提示

macOS 上类似 Windows VBS/COM 的路线是 AppleScript 或 JavaScript for Automation (JXA)，通过 Apple Events 控制 scriptable applications。Apple 官方说明：AppleScript 可直接控制可脚本化的 Macintosh applications；scriptable application 是响应 Apple events 的应用。

来源：Apple Developer - AppleScript Language Guide  
https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/introduction/ASLR_intro.html

Script Editor 可打开应用的 scripting dictionary；如果应用没有 scripting terminology，会显示 nonscriptable app 错误。可通过 `Script Editor -> File -> Open Dictionary -> Microsoft Outlook` 检查本机 Outlook 是否可脚本化。

来源：Apple Developer - Opening a Scripting Dictionary  
https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/OpenaScriptingDictionary.html

macOS 的安全权限上：

| 权限 | Apple 描述 | Easy Mail 是否应依赖 |
| --- | --- | --- |
| Automation | 允许 app 访问并控制其他 app。 | macOS Outlook AppleScript Provider 需要。首次运行可能弹 “VS Code/osascript wants to control Microsoft Outlook”。 |
| Accessibility | 允许 app 运行脚本和系统命令来控制 Mac。 | 应避免依赖；只有 UI scripting / 模拟点击时才需要。 |
| Full Disk Access | 允许访问其他 app 数据、备份和管理设置。 | 不建议依赖；不要直接读 Outlook 本地数据库。 |

来源：Apple Support - Change Privacy & Security settings on Mac  
https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac

## 3. 场景矩阵

| 用户环境 | 是否继续支持当前 VBS | 推荐 provider | 说明 |
| --- | --- | --- | --- |
| Windows + Outlook Classic + 本地 Exchange | 是 | `outlookClassicWindows` | 当前能力。 |
| Windows + Outlook Classic + Exchange Online | 大概率是 | `outlookClassicWindows` 或 `graph` | 单纯服务器迁移不一定破坏 COM/MAPI。Graph 作为远期推荐。 |
| Windows + new Outlook only | 否 | `graph` | new Outlook 不支持 COM/VSTO，VBS 不能作为保证。 |
| Windows + Outlook on the web only | 否 | `graph` | 没有本机 Outlook 对象模型。 |
| macOS + Outlook for Mac + scripting dictionary 可用 | 否 | `outlookMacAppleScript` 或 `graph` | 可做本地 provider，但需要 Automation 权限，长期稳定性弱于 Graph。 |
| macOS + new Outlook / scripting dictionary 不可用 | 否 | `graph` | 本地脚本不可用。 |
| macOS + Outlook on the web only | 否 | `graph` | 纯云端。 |
| Linux VS Code + Microsoft 365 mailbox | 否 | `graph` | 无 Outlook 本地客户端。 |
| Shared mailbox | 当前 VBS 取决于 Outlook profile | `graph` 后续扩展 | Graph Mail API 支持 shared mailbox，但实现要处理 mailbox identity 和授权。 |
| In-place archive mailbox | 不稳定/不推荐 | 暂不支持 | Graph Mail API 文档明确不支持 in-place archive mailboxes。 |
| Gmail/Yahoo 等非 Microsoft 邮箱 | 当前取决于本地 Outlook | 暂不作为主目标 | Graph 不覆盖非 Microsoft 邮箱；new Outlook 对非 Microsoft 账号还有云同步和 add-in 限制。 |

## 4. 推荐产品策略

### 4.1 Provider 分层

建议把当前“拉邮件”入口拆成：

```text
Easy Mail
├─ Collector Provider Layer
│  ├─ OutlookClassicWindowsProvider  # Windows + Outlook Classic + VBS/COM
│  ├─ OutlookMacAppleScriptProvider  # macOS + Outlook scripting dictionary + osascript
│  └─ MicrosoftGraphProvider         # Exchange Online / new Outlook / OWA / no local client
│
├─ Normalization Layer
│  ├─ GraphMessage -> MailDigestItem
│  ├─ AppleScriptMessage -> MailDigestItem
│  ├─ VbsDigest -> MailDigestItem
│  └─ GraphEvent -> MeetingDigestItem
│
└─ Existing Easy Mail Pipeline
   ├─ parseDigest / mergeDigestIntoStore
   ├─ MailStore / MailIndex / MeetingStore
   ├─ ThreadStore / ThreadEngine
   ├─ Classification / SecurityGate / Redaction
   ├─ CopilotProvider / AppAnalysis
   └─ Sidebar / Workbench / Reports
```

### 4.2 Provider 选择策略

新增配置建议：

```json
{
  "easyMail.collector": "auto",
  "easyMail.graph.clientId": "",
  "easyMail.graph.tenantId": "organizations",
  "easyMail.graph.scopes": ["User.Read", "Mail.Read", "Calendars.Read", "offline_access"],
  "easyMail.graph.useDeltaSync": true,
  "easyMail.graph.preferTextBody": true,
  "easyMail.graph.useImmutableId": true,
  "easyMail.outlookMac.allowAppleScript": false
}
```

`easyMail.collector` 可选值：

```text
auto
outlookClassicWindows
graph
outlookMacAppleScript
sample
```

推荐默认：

1. 保持当前 Windows 用户体验不变：Windows + Classic Outlook 可用时仍可用 VBS。
2. 新用户、macOS、new Outlook、Exchange Online migration 文档中推荐 Graph。
3. macOS AppleScript 不应默认静默启用，首次使用前给用户明确说明 Automation 权限提示。

自动选择伪代码：

```ts
type CollectorMode =
  | "auto"
  | "outlookClassicWindows"
  | "outlookMacAppleScript"
  | "graph"
  | "sample";

async function chooseCollector(config: EasyMailConfig): Promise<CollectorProvider> {
  if (config.sampleMode || config.collector === "sample") {
    return new SampleCollectorProvider();
  }

  if (config.collector !== "auto") {
    return instantiateExplicitProvider(config.collector);
  }

  if (process.platform === "win32") {
    const winProvider = new OutlookClassicWindowsProvider();
    if (await winProvider.probe()) {
      return winProvider;
    }
  }

  if (process.platform === "darwin" && config.outlookMac.allowAppleScript) {
    const macProvider = new OutlookMacAppleScriptProvider();
    if (await macProvider.probe()) {
      return macProvider;
    }
  }

  const graphProvider = new MicrosoftGraphProvider();
  if (await graphProvider.canStartInteractiveLogin()) {
    return graphProvider;
  }

  throw new Error(
    "No mail collector is available. Install Outlook Classic, enable macOS Outlook automation, or sign in to Microsoft Graph."
  );
}
```

## 5. Provider 接口设计

### 5.1 核心接口

```ts
export type CollectorId =
  | "sample"
  | "outlook-classic-windows"
  | "outlook-mac-applescript"
  | "microsoft-graph";

export interface CollectorProbeResult {
  available: boolean;
  reason?: string;
  requiresUserAction?: "graphSignIn" | "macAutomationPermission" | "installOutlookClassic";
}

export interface CollectMailOptions {
  maxItems: number;
  recentHours: number;
  rangeMode: "recentHours" | "maxItems";
  folders: string[];
  bodyExcerptChars: number;
  loadMore: boolean;
  olderThanByFolder?: Record<string, string>;
}

export interface CollectMeetingOptions {
  daysAhead: number;
  bodyExcerptChars: number;
}

export interface CollectorProvider {
  readonly id: CollectorId;
  readonly displayName: string;

  probe(): Promise<CollectorProbeResult>;
  collectMail(options: CollectMailOptions): Promise<MailDigestData>;
  collectMeetings(options: CollectMeetingOptions): Promise<MeetingDigestData>;
}
```

### 5.2 Extension 侧调用改造

当前 `pullMailCore` 直接拼 `cscript.exe` 参数。建议改成：

```ts
private async pullMailCore(forceSample: boolean, loadMore = false): Promise<{ added: number; skipped: number }> {
  const config = await this.readConfig();
  const currentIndex = pruneMailIndex(
    await this.data.readMailIndex(),
    Number(config.mailIndexRetentionDays || 7)
  );

  const provider = await this.collectorFactory.create({ ...config, forceSample });
  const digest = await provider.collectMail({
    maxItems: Number(config.maxItems || 50),
    recentHours: Number(config.recentHours || 24),
    rangeMode: String(config.rangeMode || "recentHours") as RangeMode,
    folders: parseFolders(config.folders),
    bodyExcerptChars: Number(config.bodyExcerptChars || 1500),
    loadMore,
    olderThanByFolder: loadMore ? folderOldestReceivedTimes(currentIndex, folders) : undefined
  });

  await fs.promises.writeFile(this.data.getDigestPath(), renderMailDigest(digest), "utf8");

  const merge = mergeDigestIntoStore(
    await this.data.readMailStore(),
    digest,
    currentIndex.items.map((item) => item.mailId)
  );

  const nextIndex = pruneMailIndex(
    mergeDigestIntoIndex(currentIndex, digest),
    Number(config.mailIndexRetentionDays || 7)
  );

  const prunedStore = pruneMailStore(merge.store, Number(config.mailStoreRetentionDays || 1));
  await this.data.writeMailStore(prunedStore);
  await this.data.writeMailIndex(nextIndex);
  await this.data.writeThreadStore(buildThreadStore(prunedStore.items));
  await this.data.writeClassificationCache(
    ensureClassifications(prunedStore.items, await this.data.readClassificationCache())
  );

  await this.collectMeetingsWithProvider(provider, config, forceSample);
  return { added: merge.added, skipped: merge.skipped };
}
```

## 6. Windows Outlook Classic Provider

### 6.1 现状

当前 provider 实质上已经存在，只是散落在：

- `src/extension.ts`：拼参数、调用 `cscript.exe`。
- `scripts/collect-outlook-mails.vbs`：COM/MAPI 读取邮件，输出 `mail-digest.md`。
- `scripts/collect-outlook-meetings.vbs`：COM/MAPI 读取会议，输出 `meeting-digest.md`。

### 6.2 保留理由

- 对当前 Windows Outlook Classic 用户零迁移成本。
- 不需要 Entra app registration、Graph consent、OAuth 登录。
- 在很多企业迁移到 Exchange Online 后，只要仍保留 Outlook Classic，本地 profile 仍可能正常提供邮件对象。

### 6.3 风险

- 只支持 Windows。
- 依赖 Classic Outlook 安装和本机 profile。
- 不支持 new Outlook only / Outlook on the web only。
- COM 自动化和 Outlook 安全策略可能被企业限制。
- `EntryID` / StoreId / ConversationID 与 Graph ID 不同，跨 provider 去重需要 normalization。

### 6.4 抽取伪代码

```ts
export class OutlookClassicWindowsProvider implements CollectorProvider {
  readonly id = "outlook-classic-windows" as const;
  readonly displayName = "Outlook Classic for Windows";

  async probe(): Promise<CollectorProbeResult> {
    if (process.platform !== "win32") {
      return { available: false, reason: "Not Windows" };
    }

    // 轻量 probe：运行一个小 VBS，只 CreateObject("Outlook.Application") 并退出。
    const result = await runProcess("cscript.exe", ["//nologo", probeScriptPath], 10_000);
    return result.exitCode === 0
      ? { available: true }
      : { available: false, reason: result.stderr, requiresUserAction: "installOutlookClassic" };
  }

  async collectMail(options: CollectMailOptions): Promise<MailDigestData> {
    const output = this.tempDigestPath("mail");
    await runProcess("cscript.exe", [
      "//nologo",
      this.findScript("collect-outlook-mails.vbs"),
      "--max-items", String(options.maxItems),
      "--recent-hours", String(options.loadMore || options.rangeMode === "maxItems" ? 0 : options.recentHours),
      "--folders", options.folders.join(";"),
      "--body-chars", String(options.bodyExcerptChars),
      "--output", output,
      ...serializeOlderThanArgs(options.olderThanByFolder)
    ], 30_000);

    return parseDigest(await fs.promises.readFile(output, "utf8"));
  }
}
```

## 7. macOS Outlook AppleScript/JXA Provider

### 7.1 定位

这是“macOS 本地 Outlook Provider”，不是 Exchange Online 的长期主线。它适合：

- 用户在 macOS 上安装并登录 Outlook for Mac。
- Outlook for Mac 的 scripting dictionary 暴露足够的 mail/calendar 对象。
- 用户愿意允许 VS Code / Code Helper / osascript 控制 Microsoft Outlook。
- 企业未禁用 Automation 权限。

### 7.2 权限体验

首次运行大概率会弹出类似提示：

```text
"Visual Studio Code" wants access to control "Microsoft Outlook".
```

也可能显示为：

```text
"osascript" wants to control "Microsoft Outlook".
```

取决于脚本由 VS Code、Code Helper、Terminal 还是 `osascript` 直接触发。用户可在：

```text
System Settings -> Privacy & Security -> Automation
```

中允许相关 app 控制 Microsoft Outlook。

### 7.3 不建议做的事

- 不要用 Accessibility UI scripting 模拟点击 Outlook UI。
- 不要请求 Full Disk Access 去读 Outlook 本地数据库。
- 不要假设所有 Outlook for Mac 版本的 scripting dictionary 一致。
- 不要把 AppleScript Provider 作为默认无感启用；应给用户一个清晰开关和说明。

### 7.4 AppleScript 示例草案

最终字段名必须以目标 Outlook for Mac 的 scripting dictionary 为准。下面只是实现方向：

```applescript
on run argv
  set maxItems to item 1 of argv as integer
  set bodyChars to item 2 of argv as integer

  tell application "Microsoft Outlook"
    set outputLines to {}
    set inboxMessages to messages of inbox

    set counter to 0
    repeat with msg in inboxMessages
      if counter >= maxItems then exit repeat
      set counter to counter + 1

      set theSubject to subject of msg
      set theSender to sender of msg
      set theTime to time received of msg
      set theBody to plain text content of msg
      if length of theBody > bodyChars then set theBody to text 1 thru bodyChars of theBody

      set end of outputLines to "## Mail mail-" & counter
      set end of outputLines to "Subject: " & theSubject
      set end of outputLines to "From: " & theSender
      set end of outputLines to "ReceivedTime: " & theTime
      set end of outputLines to "BodyExcerpt:"
      set end of outputLines to theBody
      set end of outputLines to "---"
    end repeat

    return outputLines as string
  end tell
end run
```

JXA 方向也可行，但 Outlook 的脚本字典在 AppleScript 语义下通常更容易调试。建议第一版先 AppleScript，后续再评估 JXA。

### 7.5 Provider 伪代码

```ts
export class OutlookMacAppleScriptProvider implements CollectorProvider {
  readonly id = "outlook-mac-applescript" as const;
  readonly displayName = "Outlook for Mac AppleScript";

  async probe(): Promise<CollectorProbeResult> {
    if (process.platform !== "darwin") {
      return { available: false, reason: "Not macOS" };
    }

    const result = await runProcess("osascript", [
      "-e",
      'tell application "Microsoft Outlook" to return name'
    ], 10_000);

    if (result.exitCode === 0) {
      return { available: true };
    }

    return {
      available: false,
      reason: result.stderr,
      requiresUserAction: "macAutomationPermission"
    };
  }

  async collectMail(options: CollectMailOptions): Promise<MailDigestData> {
    const output = await runProcess("osascript", [
      this.findScript("collect-outlook-mails.applescript"),
      String(options.maxItems),
      String(options.bodyExcerptChars),
      options.folders.join(";")
    ], 30_000);

    return parseDigest(output.stdout);
  }
}
```

## 8. Microsoft Graph Provider

### 8.1 定位

Graph Provider 是远期主线，覆盖：

- Exchange Online / Microsoft 365 mailbox。
- Windows new Outlook。
- Outlook on the web。
- macOS / Linux / Windows VS Code。
- 无本地 Outlook 客户端。
- 企业逐步关闭 Classic Outlook 的未来阶段。

### 8.2 授权模型

VS Code extension 是桌面公共客户端，不应内置 client secret。推荐：

- Microsoft Entra app registration。
- Public client application。
- MSAL Node。
- Authorization Code + PKCE，或 Device Code Flow 作为保底。
- Token cache 存 VS Code SecretStorage 或受保护的本地 secret storage，不写普通 JSON。

最小只读 scopes：

```text
offline_access
User.Read
Mail.Read
Calendars.Read
```

后续写回能力再增加：

```text
Mail.ReadWrite      # 标记已读、移动、分类、创建 draft
Mail.Send           # 真正发送；第一阶段不建议
Calendars.ReadWrite # 会议写回；第一阶段不建议
```

### 8.3 Graph Auth 伪代码

```ts
export class GraphAuthManager {
  private pca: PublicClientApplication;

  constructor(private readonly secrets: vscode.SecretStorage, config: GraphConfig) {
    this.pca = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId || "organizations"}`
      },
      cache: {
        cachePlugin: new VscodeSecretStorageMsalCachePlugin(secrets)
      }
    });
  }

  async getToken(scopes: string[]): Promise<string> {
    const account = await this.getCachedAccount();
    if (account) {
      try {
        const silent = await this.pca.acquireTokenSilent({ account, scopes });
        if (silent?.accessToken) return silent.accessToken;
      } catch {
        // fall through to interactive
      }
    }

    return await this.acquireInteractive(scopes);
  }

  private async acquireInteractive(scopes: string[]): Promise<string> {
    // 推荐优先 auth code + PKCE + localhost callback。
    // 如果企业环境/VS Code remote 下 localhost callback 不稳定，可降级 device code flow。
    const result = await this.pca.acquireTokenByDeviceCode({
      scopes,
      deviceCodeCallback: (message) => showGraphSignInMessage(message)
    });

    if (!result?.accessToken) throw new Error("Microsoft Graph sign-in failed.");
    return result.accessToken;
  }
}
```

### 8.4 Graph Client 伪代码

```ts
export class GraphClient {
  constructor(private readonly auth: GraphAuthManager) {}

  async request<T>(urlOrPath: string, options: GraphRequestOptions = {}): Promise<T> {
    const token = await this.auth.getToken(options.scopes ?? DEFAULT_GRAPH_SCOPES);
    const url = urlOrPath.startsWith("https://")
      ? urlOrPath
      : `https://graph.microsoft.com/v1.0${urlOrPath}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...options.headers
    };

    if (options.preferImmutableId) {
      headers.Prefer = appendPrefer(headers.Prefer, 'IdType="ImmutableId"');
    }
    if (options.preferTextBody) {
      headers.Prefer = appendPrefer(headers.Prefer, 'outlook.body-content-type="text"');
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(url, { method: options.method ?? "GET", headers });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After") || "0");
        await delay((retryAfter || Math.pow(2, attempt)) * 1000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Graph request failed: ${response.status} ${await response.text()}`);
      }

      return await response.json() as T;
    }

    throw new Error("Graph request failed after throttling retries.");
  }
}
```

### 8.5 Graph Mail Collector MVP

第一版不要一上来做 delta，先做最近 N 小时 / N 封邮件：

```ts
const MESSAGE_SELECT = [
  "id",
  "internetMessageId",
  "conversationId",
  "conversationIndex", // 如果 Graph 返回不可用，就允许为空
  "subject",
  "from",
  "sender",
  "toRecipients",
  "ccRecipients",
  "receivedDateTime",
  "sentDateTime",
  "hasAttachments",
  "importance",
  "isRead",
  "body",
  "bodyPreview",
  "parentFolderId",
  "webLink"
].join(",");

async function collectGraphFolder(folder: string, options: CollectMailOptions): Promise<MailDigestItem[]> {
  const graphFolder = mapFolderName(folder); // "Sent Items" -> "SentItems"
  const timeField = graphFolder === "SentItems" ? "sentDateTime" : "receivedDateTime";
  const cutoff = new Date(Date.now() - options.recentHours * 3600_000).toISOString();

  const query = new URLSearchParams();
  query.set("$select", MESSAGE_SELECT);
  query.set("$top", String(Math.min(options.maxItems, 50)));
  query.set("$orderby", `${timeField} desc`);

  if (options.rangeMode === "recentHours" && !options.loadMore) {
    query.set("$filter", `${timeField} ge ${cutoff}`);
  }

  let url = `/me/mailFolders('${graphFolder}')/messages?${query.toString()}`;
  const items: MailDigestItem[] = [];

  while (url && items.length < options.maxItems) {
    const page = await graph.request<GraphCollection<GraphMessage>>(url, {
      preferImmutableId: true,
      preferTextBody: true
    });

    for (const message of page.value) {
      items.push(mapGraphMessageToDigestItem(message, folder, options.bodyExcerptChars));
      if (items.length >= options.maxItems) break;
    }

    url = page["@odata.nextLink"] ?? "";
  }

  return items;
}
```

### 8.6 Graph Delta Sync

第二阶段再上 delta。每个 folder 保存独立 state：

```ts
interface GraphSyncState {
  folders: Record<string, {
    deltaLink?: string;
    lastFullSyncAt?: string;
    lastError?: string;
  }>;
}
```

Delta 拉取伪代码：

```ts
async function syncFolderDelta(folder: string, state: GraphSyncState): Promise<MailDigestData> {
  const graphFolder = mapFolderName(folder);
  const folderState = state.folders[graphFolder] ?? {};

  let url = folderState.deltaLink
    ?? `/me/mailFolders('${graphFolder}')/messages/delta?$select=${encodeURIComponent(MESSAGE_SELECT)}`;

  const changed: MailDigestItem[] = [];
  const removed: RemovedMailRef[] = [];

  while (url) {
    const page = await graph.request<GraphDeltaPage<GraphMessage>>(url, {
      preferImmutableId: true,
      preferTextBody: true
    });

    for (const entity of page.value) {
      if (entity["@removed"]) {
        removed.push({ provider: "microsoft-graph", sourceId: entity.id, reason: entity["@removed"].reason });
      } else {
        changed.push(mapGraphMessageToDigestItem(entity, folder, bodyChars));
      }
    }

    if (page["@odata.nextLink"]) {
      url = page["@odata.nextLink"];
    } else if (page["@odata.deltaLink"]) {
      folderState.deltaLink = page["@odata.deltaLink"];
      url = "";
    } else {
      throw new Error("Graph delta response has no nextLink or deltaLink.");
    }
  }

  state.folders[graphFolder] = folderState;
  return { items: changed, removed };
}
```

Delta 注意事项：

- `@odata.nextLink` 表示还有分页，必须继续请求。
- `@odata.deltaLink` 表示本轮完成，下一轮从它继续。
- state token 是 opaque token，保存整条 URL，不要解析或改写 token。
- Delta 返回顺序不能假设；同一 item 可能在 nextLink 序列中任何位置出现，merge 逻辑要幂等。
- 可能出现 `@removed`，需要设计 store 里的删除/移动处理策略。
- 遇到 delta token 过期/无效，应清除 folder state 并重新做一次 full sync。

### 8.7 Graph Message 映射

```ts
function mapGraphMessageToDigestItem(
  message: GraphMessage,
  displayFolder: string,
  bodyExcerptChars: number
): MailDigestItem {
  const from = message.from?.emailAddress ?? message.sender?.emailAddress;
  const bodyText = normalizeGraphBody(message.body?.content ?? message.bodyPreview ?? "");

  return {
    mailId: stableMailId({
      provider: "microsoft-graph",
      internetMessageId: message.internetMessageId,
      sourceItemId: message.id,
      subject: message.subject,
      senderEmail: from?.address,
      sortTime: message.receivedDateTime ?? message.sentDateTime,
      bodyExcerpt: bodyText
    }),
    sourceProvider: "microsoft-graph",
    sourceItemId: message.id,
    internetMessageId: message.internetMessageId ?? "",
    entryId: "",
    storeId: "graph",
    conversationId: message.conversationId ?? "",
    conversationIndex: readConversationIndexFromHeadersOrEmpty(message),
    subject: message.subject ?? "",
    senderName: from?.name ?? "",
    senderEmail: from?.address ?? "",
    receivedTime: toLocalDigestTime(message.receivedDateTime ?? message.sentDateTime),
    sentTime: toLocalDigestTime(message.sentDateTime),
    sortKey: message.receivedDateTime ?? message.sentDateTime ?? "",
    folderPath: displayFolder,
    unread: String(!message.isRead),
    importance: mapGraphImportance(message.importance),
    toMe: computeToMe(message.toRecipients),
    ccMe: computeCcMe(message.ccRecipients),
    to: renderRecipients(message.toRecipients),
    cc: renderRecipients(message.ccRecipients),
    attachmentCount: message.hasAttachments ? -1 : 0,
    attachmentNames: "", // 第二阶段按需 GET attachments
    bodyExcerpt: truncateText(bodyText, bodyExcerptChars),
    webLink: message.webLink ?? ""
  };
}
```

## 9. ID、去重和线程归并注意事项

### 9.1 Graph `id` 不稳定

Graph 文档明确提醒：message 和 mailFolder 的 id 不应假设永远稳定，复制/移动等操作后可能变化。应使用 `Prefer: IdType="ImmutableId"`。Immutable ID 在 item 留在同一个 mailbox 内时不会因文件夹移动变化，但移动到 archive mailbox、导出再导入等场景仍会变化。

来源：

- Graph Mail API overview  
  https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0
- Obtain immutable identifiers for Outlook resources  
  https://learn.microsoft.com/en-us/graph/outlook-immutable-id

### 9.2 推荐存储字段

给 `MailItem` / `MailIndexItem` 增加 source metadata：

```ts
interface SourceMetadata {
  sourceProvider: "outlook-classic-windows" | "outlook-mac-applescript" | "microsoft-graph" | "sample";
  sourceMailbox?: string;        // UPN / mailbox GUID / profile display name
  sourceFolderId?: string;       // Graph parentFolderId / Outlook folder path
  sourceItemId?: string;         // Graph immutable id / Outlook EntryID
  sourceStoreId?: string;        // Outlook StoreID / graph tenant+user marker
  sourceWebLink?: string;        // Graph webLink
}
```

### 9.3 推荐 dedupe key 顺序

```ts
function computeDedupeKey(mail: NormalizedMail): string {
  if (mail.internetMessageId) {
    return `internet:${normalizeMessageId(mail.internetMessageId)}`;
  }

  if (mail.sourceProvider === "microsoft-graph" && mail.sourceItemId) {
    return `graph:${mail.sourceMailbox}:${mail.sourceItemId}`;
  }

  if (mail.sourceProvider === "outlook-classic-windows" && mail.entryId && mail.storeId) {
    return `mapi:${mail.storeId}:${mail.entryId}`;
  }

  return `hash:${sha256([
    mail.subject,
    mail.senderEmail,
    mail.receivedTime,
    mail.sentTime,
    normalizeWhitespace(mail.bodyExcerpt).slice(0, 500)
  ].join("\n"))}`;
}
```

注意：

- `internetMessageId` 对普通收发邮件通常最适合跨 provider 去重，但草稿、系统邮件、异常迁移数据可能缺失或重复，仍要防御。
- Graph immutable id 不是跨 mailbox 全局稳定，必须带上 `sourceMailbox`。
- Outlook EntryID 也不是跨 store/provider 稳定，必须带上 StoreID。
- provider 切换时，同一封邮件可能以不同 id 出现；`internetMessageId` 是跨 provider 合并的第一优先级。

### 9.4 Thread 归并

当前项目已有 `ThreadStore` 和 subject fallback。多 provider 下建议：

1. 优先使用 provider conversation id：
   - Windows Classic: `mail.ConversationID`
   - Graph: `message.conversationId`
   - Mac AppleScript: 如果字典可取 conversation id 则使用，否则为空
2. 如果 provider conversation id 为空或跨 provider 不一致，使用 normalized subject fallback。
3. 不要假设 Graph `conversationId` 与 Outlook COM `ConversationID` 字符串完全一致。
4. `conversationIndex` Graph 可能需要从 internet headers / MIME 中解析 `Thread-Index`，第一阶段允许为空。

## 10. 正文、附件、MIME 注意事项

### 10.1 正文

- VBS 当前读取 `mail.Body`，通常是纯文本。
- Graph 默认可能返回 HTML body；应请求 `Prefer: outlook.body-content-type="text"`，或者做 HTML-to-text normalization。
- 如果需要更干净的回复上下文，可评估 `uniqueBody`，但不同邮件格式下仍需兜底。
- 对 LLM prompt 仍沿用现有 `bodyExcerptChars` 和 redaction。

### 10.2 附件

MVP 只需要 `hasAttachments` / attachment count。第二阶段再按需请求附件列表：

```text
GET /me/messages/{id}/attachments?$select=id,name,contentType,size,isInline
```

不要默认下载附件内容。附件下载会明显增加 Graph 调用量、隐私风险和本地缓存风险。

### 10.3 MIME 原文

如果用户强调“邮件原始数据”，Graph 可用：

```text
GET /me/messages/{id}/$value
```

这返回 MIME 内容，可保存为 `.eml` 或用于解析 headers。不要默认全量拉 MIME：

- 数据量大。
- 限流风险高。
- MIME 中可能包含更多敏感信息。
- 当前 Easy Mail 分析只需要摘要字段和正文节选。

来源：Graph - Get MIME content of a message  
https://learn.microsoft.com/en-us/graph/outlook-get-mime-message

## 11. 安全、隐私和企业部署注意事项

### 11.1 Graph 权限与管理员审批

第一阶段坚持只读权限：

```text
User.Read
Mail.Read
Calendars.Read
offline_access
```

不要默认申请：

```text
Mail.ReadWrite
Mail.Send
Calendars.ReadWrite
```

原因：

- 企业 admin consent 阻力更小。
- 用户更容易理解“只读取用于本地分析”。
- 避免产品初期背上发送/修改邮件的合规风险。

### 11.2 Token 存储

- 使用 VS Code `context.secrets` 或 MSAL cache plugin + SecretStorage。
- 不把 token、refresh token、account cache 写入 `globalStorageUri/data/*.json`。
- log 中禁止输出 access token、authorization code、device code 原始值。

### 11.3 本地缓存

当前项目会把 raw mail store 保存在 VS Code globalStorage。Graph Provider 后应继续沿用：

- `mailStoreRetentionDays`
- `mailIndexRetentionDays`
- `analysisRetentionDays`
- `clearLocalCache`

并在 README / first-run guide 明确：

- 邮件节选会被缓存到本机 VS Code storage。
- 后续是否送给 Copilot 分析由 Security Gate / classification 控制。
- Graph 登录只用于读取用户授权范围内的邮箱数据。

### 11.4 macOS 本地脚本权限说明

文档和 UI 提示应明确：

```text
macOS 本地 Outlook 模式会请求 Automation 权限，以允许 VS Code/osascript 控制 Microsoft Outlook。
该模式不会请求 Accessibility 或 Full Disk Access。
如果你不希望授权本机自动化控制，请使用 Microsoft Graph 模式。
```

### 11.5 限流与重试

Graph 限流时会返回 HTTP 429 和 `Retry-After`。实现必须：

- 读取 `Retry-After` 秒数。
- 等待后重试。
- 无 `Retry-After` 时用 exponential backoff。
- 避免持续轮询，优先使用 delta query。

来源：Microsoft Graph throttling guidance  
https://learn.microsoft.com/en-us/graph/throttling

## 12. 实施路线图

### Phase 0：文档与探针

- 增加本文档。
- 增加 provider detection 设计。
- 增加 “current collector diagnostics” 命令，输出：平台、collector、Outlook Classic 是否可用、macOS Automation 是否可能需要授权、Graph 是否已登录。

### Phase 1：抽出当前 VBS Provider

目标：不改变现有用户行为。

涉及文件建议：

```text
src/lib/collector-types.ts
src/lib/collector-factory.ts
src/lib/outlook-classic-windows-provider.ts
src/extension.ts
```

验收：

```text
npm run compile
npm test
Windows + Outlook Classic 现有 Pull Mail / Load More / Meeting collection 行为不变
```

### Phase 2：Graph Mail MVP

目标：不依赖本机 Outlook，能拉 Exchange Online 邮件。

新增：

```text
src/lib/graph-auth.ts
src/lib/graph-client.ts
src/lib/graph-mail-provider.ts
src/lib/graph-mappers.ts
src/lib/graph-sync-state.ts
```

MVP 范围：

- Device code 或 auth code PKCE 登录。
- `Mail.Read` 拉 Inbox / SentItems 最近 N 小时或 maxItems。
- `Prefer: IdType="ImmutableId"`。
- `Prefer: outlook.body-content-type="text"`。
- 映射到现有 digest/store。
- 不下载附件内容。
- 不写回邮件。

验收：

```text
npm run compile
npm test
Graph mode 可在无 Outlook Classic 环境生成 mail-store.json
Graph mode 邮件能进入现有 ThreadStore 和分析 UI
```

### Phase 3：Graph Meeting MVP

目标：替代 `collect-outlook-meetings.vbs`。

范围：

- `Calendars.Read`。
- 读取未来 N 天 calendar view。
- 映射到现有 `MeetingDigestData`。
- 会议正文同样做 body excerpt 和 redaction。

### Phase 4：Graph Delta Sync

目标：降低 API 调用量，提高长期使用体验。

范围：

- 每个 folder 保存 `deltaLink`。
- 支持 `@odata.nextLink` / `@odata.deltaLink`。
- 支持 `@removed`。
- token invalid/expired 时自动 full resync。
- 不解析 delta token，保存整 URL。

### Phase 5：macOS AppleScript Provider

目标：给不方便申请 Graph consent 的 Mac Outlook 用户一个本地路径。

范围：

- `osascript` 运行 AppleScript。
- 检测 Outlook scripting dictionary / 基本可控性。
- 用户显式启用 `easyMail.outlookMac.allowAppleScript`。
- 文档说明 Automation 权限。
- 输出现有 digest 格式。

### Phase 6：Graph Draft/Open 后续能力

当前 VBS 还有 compose/open 能力。Graph 模式需要单独设计，不混进采集 MVP：

| 当前功能 | Classic Provider | Graph Provider 第一版 | Graph Provider 后续 |
| --- | --- | --- | --- |
| open mail | VBS 打开本地 Outlook item | 打开 `webLink` | 支持 fallback 到 OWA search/deep link |
| compose reply | VBS 打开本地 Outlook compose | 生成回复草稿文本，用户复制 | Graph createReply/createForward draft |
| send mail | 当前不自动发送 | 不支持 | 另行评审 `Mail.Send` |

## 13. 对用户问题的产品化回答模板

当用户说“公司要 migration 到 Exchange Online，以后是不是没 Outlook 客户端了？”时，产品文档/客服可这样解释：

```text
Exchange Online migration 通常指邮箱服务器迁到 Microsoft 365 云端，不必然代表你电脑上的 Outlook Classic 立刻消失。如果你仍在 Windows 上使用 Outlook Classic，Easy Mail 的本地 Outlook 模式通常还能继续工作。

但如果公司同时要求切换到 new Outlook for Windows、Outlook on the web，或者不再安装本地 Outlook Classic，那么本地 VBS/COM 模式会不可用。Easy Mail 的长期兼容方案是 Microsoft Graph 模式：它直接连接 Exchange Online 邮箱，不依赖本地 Outlook 客户端，也能覆盖 macOS 和 new Outlook 场景。
```

## 14. 不做事项

短期不建议做：

- 新增 EWS Provider。
- 默认下载附件内容。
- 默认拉 MIME 全文。
- 默认申请 `Mail.Send` / `Mail.ReadWrite`。
- macOS 下用 Accessibility UI scripting 模拟 Outlook 操作。
- 直接读取 Outlook 本地数据库或缓存文件。
- 把 VS Code extension 强行改造成 Outlook web add-in。

## 15. 参考资料

1. Microsoft Learn - Stages of migration to new Outlook for Windows  
   https://learn.microsoft.com/en-us/microsoft-365-apps/outlook/get-started/guide-product-availability
2. Microsoft Learn - Develop Outlook add-ins for the new Outlook on Windows  
   https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/one-outlook
3. Microsoft Learn - Outlook add-ins overview  
   https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview
4. Microsoft Learn - Use the Outlook mail REST API  
   https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0
5. Microsoft Learn - Get message  
   https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0
6. Microsoft Learn - Get MIME content of a message  
   https://learn.microsoft.com/en-us/graph/outlook-get-mime-message
7. Microsoft Learn - Use delta query to track changes in Microsoft Graph data  
   https://learn.microsoft.com/en-us/graph/delta-query-overview
8. Microsoft Learn - Obtain immutable identifiers for Outlook resources  
   https://learn.microsoft.com/en-us/graph/outlook-immutable-id
9. Microsoft Learn - Microsoft Graph throttling guidance  
   https://learn.microsoft.com/en-us/graph/throttling
10. Microsoft Learn - Initialize the public client application object in MSAL Node  
    https://learn.microsoft.com/en-us/entra/msal/javascript/node/initialize-public-client-application
11. Microsoft Learn - Acquire tokens in MSAL Node  
    https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests
12. Microsoft Learn - Get access on behalf of a user  
    https://learn.microsoft.com/en-us/graph/auth-v2-user
13. Apple Developer - AppleScript Language Guide  
    https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/introduction/ASLR_intro.html
14. Apple Developer - Opening a Scripting Dictionary  
    https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/OpenaScriptingDictionary.html
15. Apple Support - Change Privacy & Security settings on Mac  
    https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac
16. Windows Central - Microsoft’s Exchange Web Services shutdown process now has concrete dates  
    https://www.windowscentral.com/microsoft/microsoft-ews-retirement-365-online
17. TechRadar - Microsoft starts the countdown for the end of Exchange Web Services  
    https://www.techradar.com/pro/microsoft-starts-the-countdown-for-the-end-of-exchange-web-services
