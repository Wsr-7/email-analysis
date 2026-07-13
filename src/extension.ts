import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseDigest, type DigestData } from "./lib/digest";
import { buildQueueState, ensureClassifications, normalizeClassificationCache, type ClassificationCache } from "./lib/classification";
import { buildDashboardState, CATEGORY_ORDER, filterVisibleThreadsForDashboard, type DashboardState } from "./lib/dashboard-state";
import { allowedCategoryIds, normalizePromptConfig, type PromptConfig } from "./lib/prompt-config";
import { emptyMailIndex, emptyMailStore, folderOldestReceivedTimes, mergeDigestIntoIndex, mergeDigestIntoStore, pruneMailIndex, pruneMailStore, type MailIndex, type MailStore, type StoredMail } from "./lib/mail-store";
import { buildThreadStore } from "./lib/thread-engine";
import { emptyThreadStore, mergeThreadStores, normalizeThreadStore, pruneThreadStore, type ThreadStore } from "./lib/thread-store";
import { buildThreadGateDecision, buildMailSecurityDecisionMap } from "./lib/security-gate";
import type { SecurityGateDecisionResult, SecurityGateSettings } from "./lib/security-types";
import { type ThreadAnalysisResult } from "./lib/thread-analysis-schema";
import { buildDailyBrief } from "./lib/report-daily";
import { buildSingleMailReport } from "./lib/report-single-mail";
import { buildThreadReport } from "./lib/report-thread";
import { CopilotProvider } from "./lib/copilot-provider";
import { type AvailableModel, type CancellationTokenLike, type LlmProvider } from "./lib/llm-provider";
import { renderEasyMailGuideHtml } from "./lib/guide-webview";
import { type Locale, serializeFolderDateMap, getLocaleFromConfig, buildSecuritySettings, buildClassificationKeywords, normalizeMailFolders, parseOutlookFolderList, buildOutlookFolderPickItems, normalizeOutlookFolderSelection, positiveNumber, resolveModelFamily, shouldMigrateLegacyModelFamily } from "./lib/config-utils";
import { getLabels, buildCategoryLabels } from "./lib/dashboard-labels";
import { renderSidebarHtml } from "./lib/sidebar-render";
import { analyzeBatchCore as analyzeBatchCoreImpl, analyzeThreadCore as analyzeThreadCoreImpl, translateExistingAnalysis as translateExistingAnalysisImpl, sendPromptToModel, type AnalysisBatchResult, type AnalysisContext } from "./lib/app-analysis";
import { handleWebviewMessage, type MessageHandlerContext } from "./lib/message-handler";
import { draftOutputInstruction, latestNonSelfThreadText, normalizeDraftLanguage, resolveDraftLanguage, resolveOutputLanguage } from "./lib/language-contract";
import { buildPolishDraftPrompt, buildRefineDraftPrompt } from "./lib/draft-prompt";
import { runProcess, formatElapsedSeconds, formatError, deleteFileIfExists, sanitizeProcessArgs } from "./lib/process-runner";
import { AppDataStore } from "./lib/app-data";
import { DashboardProvider } from "./lib/dashboard-provider";
import { renderWorkbenchHtml } from "./lib/workbench-render";
import { parseMeetingDigest } from "./lib/meeting-digest";
import { emptyMeetingStore, mergeMeetingDigestIntoStore, pruneMeetingStore, type MeetingStore } from "./lib/meeting-store";
import { extractNextActions, mergeNextActions, updateNextActionStatus, type NextActionsStore } from "./lib/next-actions";

type BusyState = {
  label: string;
  detail: string;
  startedAt: string;
  kind: string;
};

type SecurityDecisionMap = Map<string, SecurityGateDecisionResult>;

type LoadedDashboardState = DashboardState & {
  modelInfo?: Record<string, unknown>;
  store?: MailStore;
  index?: MailIndex;
  queue?: ReturnType<typeof buildQueueState>;
  classifications?: ClassificationCache;
  securityDecisions?: SecurityDecisionMap;
  promptConfig?: PromptConfig;
  threadStore?: ThreadStore;
  threadAnalysis?: ThreadAnalysisResult;
  meetingStore?: MeetingStore;
  ignoredIds?: Set<string>;
};

export function buildSidebarRenderInput(
  state: LoadedDashboardState,
  availableModels: AvailableModel[],
  nextActionsStore: NextActionsStore,
  busyKind: string,
  isBusy: boolean
): Parameters<typeof renderSidebarHtml>[0] {
  return {
    state,
    store: state.store || emptyMailStore(),
    index: state.index || emptyMailIndex(),
    queue: state.queue || { pending: [], blocked: [], analysed: [], allowed: [] },
    classifications: state.classifications || normalizeClassificationCache({}),
    securityDecisions: state.securityDecisions || new Map(),
    promptConfig: state.promptConfig || normalizePromptConfig({}),
    threadStore: state.threadStore || emptyThreadStore(),
    threadAnalysis: state.threadAnalysis || { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] },
    meetingStore: state.meetingStore || emptyMeetingStore(),
    ignoredIds: state.ignoredIds,
    nextActionsStore,
    availableModels,
    busyKind,
    isBusy
  };
}

function configuredOutputLanguage(settings: vscode.WorkspaceConfiguration): Locale {
  const inspected = settings.inspect<string>("outputLanguage");
  const explicit = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  return resolveOutputLanguage(explicit, vscode.env.language);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const app = new EasyMailApp(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("easyMail.dashboard", app.dashboardProvider),
    vscode.commands.registerCommand("easyMail.pullMail", () => app.pullMail(false)),
    vscode.commands.registerCommand("easyMail.loadMore", () => app.loadMore()),
    vscode.commands.registerCommand("easyMail.generateSampleDigest", () => app.pullMail(true)),
    vscode.commands.registerCommand("easyMail.analyze", () => app.analyze()),
    vscode.commands.registerCommand("easyMail.analyzeThread", async () => {
      const threadId = await vscode.window.showInputBox({ prompt: "Thread ID to analyze" });
      if (threadId) {
        await app.analyzeThread(threadId);
      }
    }),
    vscode.commands.registerCommand("easyMail.analyzeAllAllowed", () => app.analyzeAllAllowed()),
    vscode.commands.registerCommand("easyMail.openDigest", () => app.openDigest()),
    vscode.commands.registerCommand("easyMail.openSummary", () => app.openSummary()),
    vscode.commands.registerCommand("easyMail.generateReports", () => app.generateReports()),
    vscode.commands.registerCommand("easyMail.loadModels", () => app.loadModels()),
    vscode.commands.registerCommand("easyMail.openDailyBrief", () => app.openDailyBrief()),
    vscode.commands.registerCommand("easyMail.openThreadReport", () => app.openThreadReport()),
    vscode.commands.registerCommand("easyMail.openSingleMailReport", () => app.openSingleMailReport()),
    vscode.commands.registerCommand("easyMail.openSettings", () => app.openSettings()),
    vscode.commands.registerCommand("easyMail.selectFolders", () => app.selectFolders()),
    vscode.commands.registerCommand("easyMail.openPromptConfig", () => app.openPromptConfig()),
    vscode.commands.registerCommand("easyMail.openReplyTemplate", () => app.openReplyTemplate()),
    vscode.commands.registerCommand("easyMail.openGuide", () => app.openGuide()),
    vscode.commands.registerCommand("easyMail.clearLocalCache", () => app.clearLocalCache()),
    vscode.commands.registerCommand("easyMail.openWorkbench", () => app.openWorkbench())
  );

  await app.initialize();
}

export function deactivate(): void {}

function extractDraftText(raw: string): string {
  const text = String(raw || "").trim().replace(/^```(?:json|text)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!text.startsWith("{")) {
    return text;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.draftReply === "string") {
      return parsed.draftReply.trim();
    }
  } catch {
    return text;
  }
  return text;
}

export class EasyMailApp {
  public readonly dashboardProvider: DashboardProvider;
  public readonly data: AppDataStore;
  private readonly llmProvider: LlmProvider;
  private busy: BusyState | null = null;
  private logFilePath = "";
  private availableModelsCache: AvailableModel[] | null = null;
  private availableModelsPending: Promise<AvailableModel[]> | null = null;
  private guidePanel: vscode.WebviewPanel | null = null;
  private workbenchPanel: vscode.WebviewPanel | null = null;
  private workingDrafts: Map<string, string> = new Map();
  private pendingWorkbenchDraftFlush: { requestId: string; done: Promise<void>; resolve: () => void } | null = null;
  private workbenchDraftFlushSequence = 0;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.llmProvider = new CopilotProvider();
    this.data = new AppDataStore({ globalStoragePath: context.globalStorageUri.fsPath, extensionPath: context.extensionPath });
    this.dashboardProvider = new DashboardProvider(() => this.getDashboardHtml(), (message) => this.handleMessage(message));
  }

  public async initialize(): Promise<void> {
    await fs.promises.mkdir(this.data.getDataDir(), { recursive: true });
    await this.initializeLogger();
    await this.data.ensureConfig();
    await this.log("initialize", { extensionPath: this.context.extensionPath, dataDir: this.data.getDataDir() });
    this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("easyMail")) {
        void this.log("settings:changed", {});
        void this.refresh();
      }
    }));
    await this.refresh();
    await this.maybeOpenGuide();
  }

  private async maybeOpenGuide(): Promise<void> {
    const packageJSON = this.context.extension.packageJSON;
    let installSignature = packageJSON?.__metadata?.installedTimestamp;
    if (!installSignature) {
      try {
        installSignature = String((await fs.promises.stat(this.context.extensionPath)).birthtimeMs);
      } catch {
        installSignature = packageJSON?.version || "0.0.0";
      }
    }
    const key = `easyMail.guideShown.${installSignature}`;
    if (this.context.globalState.get<boolean>(key)) {
      return;
    }
    await this.context.globalState.update(key, true);
    await this.openGuide();
  }

  public async openWalkthrough(): Promise<void> {
    const walkthroughId = `${this.context.extension.id}#easyMail.gettingStarted`;
    await vscode.commands.executeCommand("workbench.action.openWalkthrough", walkthroughId, false)
      .then(
        () => this.log("walkthrough:opened", { walkthroughId }),
        (error: unknown) => this.log("walkthrough:error", { walkthroughId, error: formatError(error) })
      );
    await this.openGuide();
  }

  public async openGuide(): Promise<void> {
    if (this.guidePanel) {
      this.guidePanel.reveal(vscode.ViewColumn.One);
      this.guidePanel.webview.html = await this.getGuideHtml();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "easyMail.guide",
      "EasyMail - User Guide",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.guidePanel = panel;
    panel.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, "media", "icon.png"));
    panel.webview.onDidReceiveMessage((message) => {
      void this.handleGuideMessage(message);
    });
    panel.onDidDispose(() => {
      this.guidePanel = null;
    });
    panel.webview.html = await this.getGuideHtml();
    await this.log("guide:opened", {});
  }

  public async openWorkbench(focusId?: string): Promise<void> {
    if (this.workbenchPanel) {
      if (!focusId) {
        this.workbenchPanel.dispose();
        return;
      }
      this.workbenchPanel.reveal(vscode.ViewColumn.One);
      await this.rebuildWorkbenchHtml();
      this.workbenchPanel.webview.postMessage({ type: "focusItem", id: focusId });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "easyMail.workbench",
      "EasyMail",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.workbenchPanel = panel;
    panel.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, "media", "icon.png"));
    panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    panel.onDidDispose(() => {
      this.completeWorkbenchDraftFlush();
      this.workbenchPanel = null;
    });
    panel.webview.html = await this.getWorkbenchHtml();
    if (focusId) {
      panel.webview.postMessage({ type: "focusItem", id: focusId });
    }
    await this.log("workbench:opened", {});
  }

  private async polishDraft(draftText: string, itemId: string): Promise<void> {
    await this.log("draft:polish", { itemId });
    const config = await this.readConfig();
    const language = resolveDraftLanguage(config.draftLanguage, draftText);
    const prompt = buildPolishDraftPrompt(draftText, language);
    try {
      const raw = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Polish draft", cancellable: true },
        async (progress, token) => {
          progress.report({ message: "Polishing reply draft..." });
          return (await sendPromptToModel(this.analysisContext(token), prompt, String(config.modelFamily || ""), "polish")).raw;
        }
      );
      const result = raw.trim();
      this.workingDrafts.set(itemId, result);
      this.workbenchPanel?.webview.postMessage({ type: "updateDraft", text: result, itemId });
      vscode.window.showInformationMessage("Draft polished.");
    } catch (err) {
      vscode.window.showWarningMessage(`Polish failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async refineDraft(draftText: string, instruction: string, itemId: string): Promise<void> {
    await this.log("draft:refine", { itemId });
    const config = await this.readConfig();
    const language = resolveDraftLanguage(config.draftLanguage, draftText);
    const prompt = buildRefineDraftPrompt(draftText, instruction, language);
    try {
      const raw = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refine draft", cancellable: true },
        async (progress, token) => {
          progress.report({ message: "Refining reply draft..." });
          return (await sendPromptToModel(this.analysisContext(token), prompt, String(config.modelFamily || ""), "refine")).raw;
        }
      );
      const result = raw.trim();
      this.workingDrafts.set(itemId, result);
      this.workbenchPanel?.webview.postMessage({ type: "updateDraft", text: result, itemId });
      vscode.window.showInformationMessage("Draft refined.");
    } catch (err) {
      vscode.window.showWarningMessage(`Refine failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async generateDraft(itemId: string, sourceId: string): Promise<void> {
    const targetItemId = String(itemId || "");
    const targetSourceId = String(sourceId || "");
    if (!targetItemId || !targetSourceId) {
      vscode.window.showWarningMessage("No mail or thread is selected for draft generation.");
      return;
    }
    await this.log("draft:generate", { itemId: targetItemId, sourceId: targetSourceId });
    const config = await this.readConfig();
    try {
      const prompt = await this.buildDraftGenerationPrompt(targetItemId, targetSourceId, config.draftLanguage);
      const raw = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Generate draft", cancellable: true },
        async (progress, token) => {
          progress.report({ message: "Generating reply draft..." });
          return (await sendPromptToModel(this.analysisContext(token), prompt, String(config.modelFamily || ""), "draftGenerate")).raw;
        }
      );
      const result = extractDraftText(raw);
      if (!result.trim()) {
        vscode.window.showWarningMessage("No reply draft was generated for this item.");
        return;
      }
      this.workingDrafts.set(targetItemId, result);
      this.workbenchPanel?.webview.postMessage({ type: "updateDraft", text: result, itemId: targetItemId });
      vscode.window.showInformationMessage("Draft generated.");
    } catch (err) {
      vscode.window.showWarningMessage(`Generate draft failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async buildDraftGenerationPrompt(itemId: string, sourceId: string, draftLanguage: unknown): Promise<string> {
    if (itemId.startsWith("thread:")) {
      const threadStore = await this.data.readThreadStore();
      const thread = threadStore.items.find((item) => item.threadId === sourceId);
      if (!thread) {
        throw new Error("Thread not found. Refresh or pull mail first.");
      }
      const threadAnalysis = (await this.data.readThreadAnalysisResult()).items.find((item) => item.threadId === sourceId);
      const language = resolveDraftLanguage(draftLanguage, latestNonSelfThreadText(thread));
      return [
        "You are an email writing assistant. Generate a concise professional reply draft for the selected Outlook thread.",
        "Output only the reply draft text. Do not output JSON, Markdown, analysis, or explanation.",
        draftOutputInstruction(language),
        "If no reply is appropriate, output an empty string.",
        "",
        `Thread subject: ${thread.subject || sourceId}`,
        `Participants: ${(thread.participants || []).join(", ") || "-"}`,
        threadAnalysis ? `Suggested action: ${threadAnalysis.suggestedAction || "-"}` : "",
        threadAnalysis ? `Current status: ${threadAnalysis.currentStatus || threadAnalysis.oneLineSummary || "-"}` : "",
        "",
        "Timeline:",
        ...(thread.timeline || []).map((message) => [
          `- ${message.receivedTime || message.sentTime || ""} ${message.from || message.senderEmail || ""}`,
          message.bodyDelta || message.bodyClean || message.bodyPreview || ""
        ].join("\n"))
      ].filter(Boolean).join("\n");
    }

    const store = await this.data.readMailStore();
    const mail = store.items.find((item) => item.mailId === sourceId);
    const analysis = (await this.data.readAnalysisResult(() => this.readConfig())).items.find((item) => item.mailId === sourceId);
    if (!mail && !analysis) {
      throw new Error("Mail not found. Pull mail again before generating a draft.");
    }
    const language = resolveDraftLanguage(draftLanguage, mail?.bodyExcerpt || analysis?.summary || "");
    return [
      "You are an email writing assistant. Generate a concise professional reply draft for the selected Outlook mail.",
      "Output only the reply draft text. Do not output JSON, Markdown, analysis, or explanation.",
      draftOutputInstruction(language),
      "If no reply is appropriate, output an empty string.",
      "",
      `Subject: ${mail?.subject || analysis?.subject || sourceId}`,
      `From: ${mail?.from || analysis?.sender || "-"}`,
      mail?.to ? `To: ${mail.to}` : "",
      mail?.cc ? `Cc: ${mail.cc}` : "",
      analysis ? `Suggested action: ${analysis.suggestedAction || "-"}` : "",
      analysis ? `Summary: ${analysis.summary || "-"}` : "",
      "",
      "Mail body:",
      mail?.bodyExcerpt || ""
    ].filter(Boolean).join("\n");
  }

  private async getWorkbenchHtml(): Promise<string> {
    const state = await this.loadState();
    const extendedState = state as LoadedDashboardState;
    const availableModels = await this.data.readCachedAvailableModels(this.availableModelsCache, (event, d) => this.log(event, d));
    return renderWorkbenchHtml({
      state,
      store: extendedState.store || emptyMailStore(),
      index: extendedState.index || emptyMailIndex(),
      queue: extendedState.queue || { pending: [], blocked: [], analysed: [], allowed: [] },
      classifications: extendedState.classifications || normalizeClassificationCache({}),
      securityDecisions: extendedState.securityDecisions || new Map(),
      promptConfig: extendedState.promptConfig || normalizePromptConfig({}),
      threadStore: extendedState.threadStore || emptyThreadStore(),
      threadAnalysis: extendedState.threadAnalysis || { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] },
      meetingStore: extendedState.meetingStore || emptyMeetingStore(),
      ignoredIds: extendedState.ignoredIds,
      workingDrafts: this.workingDrafts,
      availableModels,
      busyKind: this.busy?.kind || "",
      isBusy: !!this.busy
    });
  }

  private async getGuideHtml(): Promise<string> {
    const state = await this.loadState();
    const locale = getLocaleFromConfig(state.config as Record<string, unknown>);
    const store = (state as DashboardState & { store?: MailStore }).store || emptyMailStore();
    const queue = (state as DashboardState & { queue?: ReturnType<typeof buildQueueState> }).queue || { pending: [], blocked: [], analysed: [], allowed: [] };
    const threadStore = (state as DashboardState & { threadStore?: ThreadStore }).threadStore || emptyThreadStore();
    const visibleThreadStore = filterVisibleThreadsForDashboard(threadStore);
    return renderEasyMailGuideHtml({
      locale,
      version: String(this.context.extension.packageJSON?.version || "0.3.0"),
      stats: {
        pulled: store.items.length,
        pending: queue.pending.length,
        analysed: state.overview.totalMails,
        threads: visibleThreadStore.items.length
      }
    });
  }

  private async handleGuideMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }
    const typed = message as { type?: string; action?: string };
    if (typed.type !== "guideAction") {
      return;
    }
    await this.log("guide:action", { action: typed.action || "" });
    if (typed.action === "openDashboard") {
      await vscode.commands.executeCommand("workbench.view.extension.easyMail");
      await vscode.commands.executeCommand("easyMail.dashboard.focus");
      return;
    }
    if (typed.action === "pullMail") {
      await this.pullMail(false);
      return;
    }
    if (typed.action === "sampleDigest") {
      await this.pullMail(true);
      return;
    }
    if (typed.action === "loadModels") {
      await this.loadModels();
      if (this.guidePanel) {
        this.guidePanel.webview.html = await this.getGuideHtml();
      }
      return;
    }
    if (typed.action === "openSettings") {
      await this.openSettings();
      return;
    }
    if (typed.action === "selectFolders") {
      await this.selectFolders();
      return;
    }
    if (typed.action === "openPromptConfig") {
      await this.openPromptConfig();
      return;
    }
    if (typed.action === "openReplyTemplate") {
      await this.openReplyTemplate();
    }
  }

  public async pullMail(forceSample: boolean): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    const result = await this.runWithBusy(
      forceSample ? labels.progress.sampleDigest : labels.progress.pullMail,
      labels.progress.detail,
      forceSample ? "sample" : "pullMail",
      async () => await this.pullMailCore(forceSample),
      (r) => `Email digest generated. Added ${r.added}, skipped ${r.skipped}.`
    );
  }

  public async loadMore(): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    await this.runWithBusy(
      labels.progress.loadMore,
      labels.progress.detail,
      "loadMore",
      async () => await this.pullMailCore(false, true),
      (result) => `Email digest generated. Added ${result.added}, skipped ${result.skipped}.`
    );
  }

  private async pullMailCore(forceSample: boolean, loadMore = false): Promise<{ added: number; skipped: number }> {
    const config = await this.readConfig();
    await fs.promises.mkdir(this.data.getDataDir(), { recursive: true });
    if (forceSample) {
      await this.resetSampleState();
    }
    const scriptPath = await this.findCollectorScript();
    const args = ["//nologo", scriptPath];
    const maxItems = Number(config.maxItems || 50);
    const recentHours = Number(config.recentHours || 24);
    const rangeMode = String(config.rangeMode || "recentHours");
    const folders = Array.isArray(config.folders) ? config.folders.map(String) : ["Inbox", "Sent Items"];
    const currentIndex = pruneMailIndex(await this.data.readMailIndex(), Number(config.mailIndexRetentionDays || 7));
    const pullRangeMode = loadMore || rangeMode === "maxItems" ? "maxItems" : "recentHours";
    args.push("--range-mode", pullRangeMode);
    if (pullRangeMode === "recentHours") {
      args.push("--recent-hours", String(recentHours));
    } else {
      args.push("--max-items", String(maxItems));
    }
    args.push("--folders", folders.join(";"));
    args.push("--body-chars", String(config.bodyExcerptChars || 1500));
    args.push("--output", this.data.getDigestPath());
    if (loadMore) {
      const anchors = folderOldestReceivedTimes(currentIndex, folders);
      const olderThanMap = serializeFolderDateMap(anchors);
      if (!olderThanMap) {
        throw new Error("No folder anchors exist yet. Run Pull Mail before Load More.");
      }
      args.push("--older-than-map", olderThanMap);
    }
    if (forceSample || config.sampleMode) {
      args.push("--sample");
    }

    const collectorTimeoutMs = positiveNumber(config.collectorTimeoutSeconds, 120) * 1000;
    await this.log("pullMail:start", { forceSample, loadMore, maxItems, recentHours, rangeMode, folders, collectorTimeoutMs });
    await runProcess("cscript.exe", args, collectorTimeoutMs, (event, data) => void this.log(`process:${event}`, data));
    const digest = parseDigest(await fs.promises.readFile(this.data.getDigestPath(), "utf8"));
    const { failed, partial, folders: failedFolders } = digest.metadata.scanSummary || { failed: 0, partial: 0, folders: [] };
    if (failed > 0 || partial > 0) {
      const folderList = failedFolders.length ? failedFolders.join(", ") : "configured Outlook folders";
      void vscode.window.showWarningMessage(`EasyMail could not fully scan Outlook folders: ${folderList} (${failed} failed, ${partial} partial). Check easyMail.folders or run EasyMail: Select Outlook Folders.`);
    }
    const merge = mergeDigestIntoStore(await this.data.readMailStore(), digest, currentIndex.items.map((item) => item.mailId));
    const nextIndex = pruneMailIndex(mergeDigestIntoIndex(currentIndex, digest), Number(config.mailIndexRetentionDays || 7));
    const prunedStore = pruneMailStore(merge.store, Number(config.mailStoreRetentionDays || 1));
    await this.data.writeMailStore(prunedStore);
    await this.data.writeMailIndex(nextIndex);
    const nextThreadStore = buildThreadStore(prunedStore.items);
    await this.data.writeThreadStore(nextThreadStore);
    const classificationCache = ensureClassifications(prunedStore.items, await this.data.readClassificationCache(), buildClassificationKeywords(config));
    await this.data.writeClassificationCache(classificationCache);
    await this.collectMeetings(config, forceSample);
    await this.log("pullMail:done", {
      digestItems: digest.items.length,
      added: merge.added,
      skipped: merge.skipped,
      storeItems: prunedStore.items.length,
      indexItems: nextIndex.items.length,
      threads: nextThreadStore.items.length
    });
    return { added: merge.added, skipped: merge.skipped };
  }

  private async collectMeetings(config: Record<string, unknown>, forceSample: boolean): Promise<void> {
    try {
      const meetingScript = await this.findScript("collect-outlook-meetings.vbs");
      const daysAhead = Number(config.meetingDaysAhead || 2);
      const meetingArgs = ["//nologo", meetingScript, "--days-ahead", String(daysAhead), "--body-chars", "500", "--output", this.data.getMeetingDigestPath()];
      if (forceSample || config.sampleMode) meetingArgs.push("--sample");
      const collectorTimeoutMs = positiveNumber(config.collectorTimeoutSeconds, 120) * 1000;
      await runProcess("cscript.exe", meetingArgs, collectorTimeoutMs, (event, data) => void this.log(`meeting:${event}`, data));
      const meetingDigest = parseMeetingDigest(await fs.promises.readFile(this.data.getMeetingDigestPath(), "utf8"));
      const meetingStore = pruneMeetingStore(mergeMeetingDigestIntoStore(await this.data.readMeetingStore(), meetingDigest));
      await this.data.writeMeetingStore(meetingStore);
      await this.log("meetings:done", { items: meetingStore.items.length });
    } catch (err) {
      await this.log("meetings:error", { error: formatError(err) });
    }
  }

  public async analyze(batchSize?: number): Promise<void> {
    await this.runAnalysisWithBusy("analyzeNext", batchSize);
  }

  private completeWorkbenchDraftFlush(requestId?: string): void {
    const pending = this.pendingWorkbenchDraftFlush;
    if (!pending || (requestId && pending.requestId !== requestId)) {
      return;
    }
    this.pendingWorkbenchDraftFlush = null;
    pending.resolve();
  }

  private async flushWorkbenchDrafts(): Promise<void> {
    const panel = this.workbenchPanel;
    if (!panel) {
      return;
    }
    if (this.pendingWorkbenchDraftFlush) {
      await this.pendingWorkbenchDraftFlush.done;
      return;
    }
    const requestId = String(++this.workbenchDraftFlushSequence);
    let resolve = () => {};
    const done = new Promise<void>((finish) => { resolve = finish; });
    this.pendingWorkbenchDraftFlush = { requestId, done, resolve };
    const timeout = setTimeout(() => this.completeWorkbenchDraftFlush(requestId), 1500);
    const delivered = await panel.webview.postMessage({ type: "requestWorkingDraftFlush", requestId });
    if (!delivered) {
      this.completeWorkbenchDraftFlush(requestId);
    }
    await done;
    clearTimeout(timeout);
  }

  private async rebuildWorkbenchHtml(): Promise<void> {
    const panel = this.workbenchPanel;
    if (!panel) {
      return;
    }
    await this.flushWorkbenchDrafts();
    const html = await this.getWorkbenchHtml();
    if (this.workbenchPanel === panel) {
      panel.webview.html = html;
    }
  }

  public async analyzeAllAllowed(): Promise<void> {
    await this.runAnalysisWithBusy("analyzeAll", "allAllowed");
  }

  private async analyzeSelected(mailIds: string[]): Promise<void> {
    await this.runAnalysisWithBusy("analyzeSelected", mailIds);
  }

  private async runAnalysisWithBusy(kind: string, selection?: "allAllowed" | string[] | number): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    const isSingleMail = Array.isArray(selection) && selection.length === 1;
    try {
      const result = await this.runWithBusy(
        labels.progress.analyze,
        isSingleMail ? "Analyzing 1 email" : labels.progress.detail,
        kind,
        async (token, reportProgress) => await this.analyzeBatchCore(selection, token, isSingleMail ? undefined : reportProgress, () => this.refreshCancellationSidebar(labels.progress.analyze)),
        (analysis) => `EasyMail analysis completed for ${analysis.batchSize} mail(s).`,
        true,
        labels.progress.cancelling
      );
      this.showAnalysisWarning(result);
    } catch (error) {
      if (error && typeof error === "object") {
        this.showAnalysisWarning(error as Partial<AnalysisBatchResult>);
      }
      throw error;
    }
  }

  private showAnalysisWarning(result: Partial<AnalysisBatchResult>): void {
    const skippedChunks = Number(result.skippedChunks || 0);
    const omittedMails = Number(result.omittedMails || 0);
    if (skippedChunks || omittedMails) {
      void vscode.window.showWarningMessage(`EasyMail analysis incomplete: ${skippedChunks} chunk(s) skipped; ${omittedMails} mail(s) marked Uncertain.`);
    }
  }

  private analysisContext(cancellationToken?: CancellationTokenLike, progress?: (message: string) => void, onChunkPersisted?: () => Promise<void>): AnalysisContext {
    return {
      data: this.data,
      llmProvider: this.llmProvider,
      extensionPath: this.context.extensionPath,
      readConfig: () => this.readConfig(),
      log: (event, data) => this.log(event, data),
      availableModelsCache: this.availableModelsCache,
      cancellationToken,
      progress,
      onChunkPersisted
    };
  }

  private async analyzeBatchCore(selection?: "allAllowed" | string[] | number, cancellationToken?: CancellationTokenLike, progress?: (message: string) => void, onChunkPersisted?: () => Promise<void>): Promise<AnalysisBatchResult> {
    return analyzeBatchCoreImpl(this.analysisContext(cancellationToken, progress, onChunkPersisted), selection);
  }

  public async analyzeThread(threadId: string): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    await this.runWithBusy(
      labels.progress.analyze,
      "Analyzing 1 thread",
      "analyzeThread",
      async (token) => await this.analyzeThreadCore(threadId, token),
      (result) => `Thread analysis completed for ${result.subject}.`,
      true,
      labels.progress.cancelling
    );
  }

  private async analyzeThreadCore(threadId: string, cancellationToken?: CancellationTokenLike): Promise<{ subject: string }> {
    const result = await analyzeThreadCoreImpl(this.analysisContext(cancellationToken), threadId);
    await this.syncNextActionsFromThreadAnalysis();
    return result;
  }

  private async syncNextActionsFromThreadAnalysis(): Promise<void> {
    const threadAnalysis = await this.data.readThreadAnalysisResult();
    const incoming = threadAnalysis.items.flatMap((item) => extractNextActions(item));
    const store = await this.data.readNextActions();
    await this.data.writeNextActions(mergeNextActions(store, incoming));
  }


  private async runWithBusy<T>(
    label: string,
    detail: string,
    kind: string,
    task: (cancellationToken: CancellationTokenLike, reportProgress?: (message: string) => void) => Promise<T>,
    completionMessage?: (result: T) => string,
    cancellable = false,
    cancellingDetail = "Cancelling…"
  ): Promise<T> {
    if (this.busy) {
      throw new Error(`Another EasyMail task is already running: ${this.busy.label}`);
    }
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    await this.log("busy:start", { label });
    this.busy = { label, detail, startedAt, kind };
    await this.refresh();
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: label, cancellable },
        async (progress, token) => {
          progress.report({ message: detail });
          const cancellationSubscription = token.onCancellationRequested(() => {
            if (this.busy) {
              this.busy = { ...this.busy, kind: "cancelling", detail: cancellingDetail };
              progress.report({ message: cancellingDetail });
              if (cancellable) void vscode.window.showInformationMessage("EasyMail: Cancelling… Waiting for the current request to finish.");
              void this.refreshCancellationSidebar(label);
            }
          });
          try {
            const result = await task(token, (message) => progress.report({ message }));
            if (token.isCancellationRequested) {
              throw new Error("EasyMail task cancelled.");
            }
            return result;
          } finally {
            cancellationSubscription.dispose();
          }
        }
      );
      const elapsedMs = Date.now() - startedAtMs;
      if (completionMessage) {
        void vscode.window.showInformationMessage(`${completionMessage(result)} Time: ${formatElapsedSeconds(elapsedMs)}.`);
      }
      await this.log("busy:success", { label, elapsedMs });
      return result;
    } catch (error) {
      await this.log("busy:error", { label, error: formatError(error) });
      throw error;
    } finally {
      this.busy = null;
      await this.refresh();
      await this.log("busy:end", { label, elapsedMs: Date.now() - startedAtMs });
    }
  }

  private async refreshCancellationSidebar(label: string): Promise<void> {
    try {
      await this.dashboardProvider.update();
    } catch (error) {
      await this.log("busy:cancelSidebarError", { label, error: formatError(error) });
    }
  }

  public async refresh(): Promise<void> {
    await this.dashboardProvider.update();
    await this.rebuildWorkbenchHtml();
  }

  public async openDigest(): Promise<void> {
    await openTextDocument(this.data.getDigestPath());
  }

  public async openSummary(): Promise<void> {
    await openTextDocument(this.data.getSummaryPath());
  }

  public async generateReports(): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    await this.runWithBusy(
      labels.progress.reports,
      labels.progress.detail,
      "reports",
      async () => await this.generateReportsCore(),
      () => "EasyMail reports generated."
    );
    await openTextDocument(this.data.getDailyBriefPath());
  }

  public async loadModels(): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    await this.runWithBusy(
      labels.progress.loadModels,
      labels.progress.detail,
      "loadModels",
      async () => await this.loadAvailableModels(),
      () => "EasyMail Copilot models loaded."
    );
  }

  public async changeOutputLanguage(nextLocale: Locale): Promise<void> {
    const config = await this.readConfig();
    const currentLocale = getLocaleFromConfig(config);
    if (nextLocale === currentLocale) {
      await this.refresh();
      return;
    }

    const mail = await this.data.readAnalysisResult(() => this.readConfig());
    const threads = await this.data.readThreadAnalysisResult();
    const mailLanguage = mail.language || currentLocale;
    const threadLanguage = threads.language || currentLocale;
    const needsTranslation = (mail.items.length > 0 && mailLanguage !== nextLocale)
      || (threads.items.length > 0 && threadLanguage !== nextLocale);

    if (!needsTranslation) {
      await this.updateSettings({ ...config, outputLanguage: nextLocale });
      await this.refresh();
      return;
    }

    const labels = getLabels(currentLocale);
    const translateLabel = currentLocale === "zh-CN" ? "翻译已有分析" : "Translate existing analysis";
    const switchOnlyLabel = currentLocale === "zh-CN" ? "只切换界面" : "Switch UI only";
    const message = currentLocale === "zh-CN"
      ? "已有分析结果的语言和目标语言不同。翻译只会处理摘要、原因、建议动作、线程状态等展示字段，不会重新分类，也不会翻译回复草稿。"
      : "Existing analysis results use a different language. Translation only updates display fields such as summaries, reasons, suggested actions, and thread status. It does not reclassify mails or translate draft replies.";
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, translateLabel, switchOnlyLabel);
    if (!choice) {
      await this.refresh();
      return;
    }

    await this.updateSettings({ ...config, outputLanguage: nextLocale });
    if (choice === translateLabel) {
      await this.runWithBusy(
      labels.progress.translate,
      labels.progress.detail,
      "translate",
      async (token) => await this.translateExistingAnalysis(nextLocale, token),
      (result) => `EasyMail translated ${result.mailItems} mail analysis item(s) and ${result.threadItems} thread analysis item(s).`,
      true,
      labels.progress.cancelling
      );
    } else {
      await this.refresh();
    }
  }

  public async openDailyBrief(): Promise<void> {
    await this.ensureReportsExist();
    await openTextDocument(this.data.getDailyBriefPath());
  }

  public async openThreadReport(): Promise<void> {
    await this.ensureReportsExist();
    await openTextDocument(this.data.getThreadReportPath());
  }

  public async openSingleMailReport(): Promise<void> {
    await this.ensureReportsExist();
    await openTextDocument(this.data.getSingleMailReportPath());
  }

  public async openSettings(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Wsr-7.easymail");
  }

  public async selectFolders(): Promise<void> {
    const config = await this.readConfig();
    const currentFolders = normalizeMailFolders(config.folders, ["Inbox", "Sent Items"]).map(String);
    const folderLoadingTip = getLocaleFromConfig(config) === "zh-CN"
      ? "提示：先启动 Outlook 可加快加载。"
      : "Tip: starting Outlook first makes this faster.";
    const scriptPath = await this.findScript("collect-outlook-mails.vbs");
    const outputPath = path.join(this.context.globalStorageUri.fsPath, "outlook-folder-list.txt");
    let folderList;
    await fs.promises.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    await deleteFileIfExists(outputPath);
    try {
      folderList = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Loading Outlook folders…" },
        async (progress) => {
          progress.report({ message: folderLoadingTip });
          await runProcess("cscript.exe", ["//nologo", scriptPath, "--list-folders", "--output", outputPath], 90000, (event, data) => {
            void this.log(`listFolders:${event}`, data);
          });
          return parseOutlookFolderList(await fs.promises.readFile(outputPath, "utf8"));
        }
      );
    } catch (err) {
      await vscode.window.showWarningMessage(`EasyMail could not load Outlook folders: ${err instanceof Error ? err.message : String(err)} Tip: start Outlook first for faster loading.`);
      return;
    } finally {
      await deleteFileIfExists(outputPath).catch((error) => void this.log("listFolders:cleanupFailed", { error: formatError(error) }));
    }

    if (!folderList.folders.length) {
      await vscode.window.showWarningMessage("EasyMail did not find any Outlook mail folders. Existing folder settings were not changed.");
      return;
    }

    const picked = await vscode.window.showQuickPick(buildOutlookFolderPickItems(folderList.folders, currentFolders, folderList.defaults), {
      canPickMany: true,
      placeHolder: "Select Outlook folders for EasyMail to scan"
    });
    if (picked === undefined) {
      return;
    }
    if (picked.length === 0) {
      await vscode.window.showWarningMessage("No folders selected. EasyMail folder settings were not changed.");
      return;
    }
    await this.updateSettings({ folders: normalizeOutlookFolderSelection(picked.map((item) => item.label), folderList.defaults) });
    await vscode.window.showInformationMessage("EasyMail folder settings updated.");
  }

  public async openPromptConfig(): Promise<void> {
    await openTextDocument(this.data.getPromptConfigPath());
  }

  public async openReplyTemplate(): Promise<void> {
    await this.data.ensureConfig();
    await openTextDocument(this.data.getReplyTemplatePath());
  }

  public async openMailInOutlook(mailId: string): Promise<void> {
    const target = await this.findOutlookOpenTarget(mailId);
    if (!target?.entryId) {
      await vscode.window.showWarningMessage("EasyMail cannot open this mail in Outlook because its EntryID is no longer available in the local index.");
      return;
    }

    const scriptPath = await this.findScript("open-outlook-mail.vbs");
    const args = ["//nologo", scriptPath, "--entry-id", target.entryId];
    if (target.storeId) {
      args.push("--store-id", target.storeId);
    }
    await runProcess("cscript.exe", args, 30000, (event, data) => {
      void this.log(`openOutlook:${event}`, data);
    });
    void vscode.window.showInformationMessage("Opened mail in Outlook.");
  }

  public async composeOutlookMail(mode: string, draftText: string, itemId: string): Promise<void> {
    const target = await this.findOutlookOpenTarget(itemId);
    if (!target?.entryId) {
      await vscode.window.showWarningMessage("EasyMail cannot open Outlook compose because the mail EntryID is no longer available.");
      return;
    }
    const scriptPath = await this.findScript("compose-outlook-mail.vbs");
    const args = ["//nologo", scriptPath, "--entry-id", target.entryId];
    if (target.storeId) {
      args.push("--store-id", target.storeId);
    }
    args.push("--mode", mode);

    if (draftText.trim()) {
      const tmpDir = this.context.globalStorageUri.fsPath;
      await fs.promises.mkdir(tmpDir, { recursive: true });
      const bodyPath = path.join(tmpDir, "compose-draft-body.txt");
      await fs.promises.writeFile(bodyPath, draftText, "utf8");
      args.push("--body-file", bodyPath);
    }

    try {
      await runProcess("cscript.exe", args, 30000, (event, data) => {
        void this.log(`compose:${event}`, data);
      });
      void vscode.window.showInformationMessage(`Opened Outlook ${mode} window.`);
    } catch (err) {
      await vscode.window.showWarningMessage(`Outlook compose failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async markNextAction(actionId: string, status: string): Promise<void> {
    if (status !== "open" && status !== "done" && status !== "ignored") return;
    const store = await this.data.readNextActions();
    const updated = updateNextActionStatus(store, actionId, status as "open" | "done" | "ignored");
    await this.data.writeNextActions(updated);
  }

  public async ignoreThread(threadId: string): Promise<void> {
    const threadStore = await this.data.readThreadStore();
    const thread = threadStore.items.find((t) => t.threadId === threadId);
    if (!thread) return;
    const ignoredIds = await this.data.readIgnoredIds();
    const set = new Set(ignoredIds);
    for (const id of thread.sourceMailIds) set.add(id);
    await this.data.writeIgnoredIds([...set]);
  }

  public async unignoreThread(threadId: string): Promise<void> {
    const threadStore = await this.data.readThreadStore();
    const thread = threadStore.items.find((t) => t.threadId === threadId);
    if (!thread) return;
    const ignoredIds = await this.data.readIgnoredIds();
    const remove = new Set(thread.sourceMailIds);
    await this.data.writeIgnoredIds(ignoredIds.filter((id) => !remove.has(id)));
  }

  public async openMeetingInOutlook(meetingId: string): Promise<void> {
    if (!meetingId) return;
    const scriptPath = await this.findScript("open-outlook-mail.vbs");
    const args = ["//nologo", scriptPath, "--entry-id", meetingId];
    await runProcess("cscript.exe", args, 30000, (event, data) => {
      void this.log(`openMeetingOutlook:${event}`, data);
    });
    void vscode.window.showInformationMessage("Opened meeting in Outlook.");
  }

  public async clearLocalCache(): Promise<void> {
    await this.data.writeMailStore(emptyMailStore());
    await this.data.writeMailIndex(emptyMailIndex());
    await this.data.writeThreadStore(emptyThreadStore());
    await this.data.writeClassificationCache(normalizeClassificationCache({}));
    await this.data.writeIgnoredIds([]);
    await fs.promises.writeFile(this.data.getAnalysisPath(), `${JSON.stringify({ generatedAt: "", overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] }, null, 2)}\n`, "utf8");
    await this.data.writeThreadAnalysisResult({ generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] });
    await deleteFileIfExists(this.data.getDailyBriefPath());
    await deleteFileIfExists(this.data.getThreadReportPath());
    await deleteFileIfExists(this.data.getSingleMailReportPath());
    await this.data.writeMeetingStore(emptyMeetingStore());
    this.workingDrafts.clear();
    await this.data.writeNextActions({ items: [] });
    await this.refresh();
    await vscode.window.showInformationMessage("Local email cache cleared.");
  }

  private async resetSampleState(): Promise<void> {
    await this.data.writeMailStore(emptyMailStore());
    await this.data.writeMailIndex(emptyMailIndex());
    await this.data.writeThreadStore(emptyThreadStore());
    await this.data.writeClassificationCache(normalizeClassificationCache({}));
    await this.data.writeIgnoredIds([]);
    await fs.promises.writeFile(this.data.getAnalysisPath(), `${JSON.stringify({ generatedAt: "", overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] }, null, 2)}\n`, "utf8");
    await this.data.writeThreadAnalysisResult({ generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] });
    await this.data.writeMeetingStore(emptyMeetingStore());
    await this.log("sample:reset", {});
  }

  private async generateReportsCore(): Promise<void> {
    await fs.promises.mkdir(this.data.getDataDir(), { recursive: true });
    const mailResult = await this.data.readAnalysisResult(() => this.readConfig());
    const threadResult = await this.data.readThreadAnalysisResult();
    const dateLabel = new Date().toISOString().slice(0, 10);
    await fs.promises.writeFile(this.data.getDailyBriefPath(), buildDailyBrief(mailResult, threadResult, dateLabel), "utf8");
    await fs.promises.writeFile(this.data.getThreadReportPath(), buildThreadReport(threadResult), "utf8");
    await fs.promises.writeFile(this.data.getSingleMailReportPath(), buildSingleMailReport(mailResult), "utf8");
    await this.log("reports:generated", {
      mailItems: mailResult.items.length,
      threadItems: threadResult.items.length
    });
  }

  private async translateExistingAnalysis(targetLocale: Locale, cancellationToken?: CancellationTokenLike): Promise<{ mailItems: number; threadItems: number }> {
    return translateExistingAnalysisImpl(this.analysisContext(cancellationToken), targetLocale);
  }

  private async ensureReportsExist(): Promise<void> {
    if (
      fs.existsSync(this.data.getDailyBriefPath())
      && fs.existsSync(this.data.getThreadReportPath())
      && fs.existsSync(this.data.getSingleMailReportPath())
    ) {
      return;
    }
    await this.generateReportsCore();
  }

  private async readConfig(): Promise<Record<string, any>> {
    const configExisted = fs.existsSync(this.data.getConfigPath());
    await this.data.ensureConfig();
    const defaults = await this.data.readDefaults();
    const storedConfig = await this.data.readConfig();
    const settings = vscode.workspace.getConfiguration("easyMail");
    const defaultFolders = Array.isArray(defaults.folders) ? defaults.folders.map(String) : ["Inbox", "Sent Items"];
    const storedModelFamily = typeof storedConfig.modelFamily === "string" ? storedConfig.modelFamily.trim() : "";
    const legacySettingsModelFamily = settings.get("modelFamily", "");
    const shouldMigrateModelFamily = shouldMigrateLegacyModelFamily(
      storedModelFamily,
      legacySettingsModelFamily,
      defaults.modelFamily,
      configExisted,
      storedConfig.modelFamilyMigrated === true
    );
    const modelFamily = shouldMigrateModelFamily
      ? String(legacySettingsModelFamily || "").trim()
      : resolveModelFamily(legacySettingsModelFamily, storedModelFamily, defaults.modelFamily);
    if (shouldMigrateModelFamily) {
      await this.data.writeConfig({ ...storedConfig, modelFamily, modelFamilyMigrated: true });
    }
    return {
      ...defaults,
      rangeMode: settings.get("rangeMode", defaults.rangeMode),
      recentHours: settings.get("recentHours", defaults.recentHours),
      maxItems: settings.get("maxItems", defaults.maxItems),
      folders: normalizeMailFolders(settings.get("folders", defaultFolders), defaultFolders),
      bodyExcerptChars: settings.get("bodyExcerptChars", defaults.bodyExcerptChars),
      sampleMode: settings.get("sampleMode", defaults.sampleMode),
      modelFamily,
      outputLanguage: configuredOutputLanguage(settings),
      draftLanguage: normalizeDraftLanguage(settings.get("draftLanguage", defaults.draftLanguage || "auto")),
      draftGeneration: settings.get("draftGeneration", defaults.draftGeneration || "auto"),
      autoAnalyzeMaxClassificationLevel: settings.get("autoAnalyzeMaxClassificationLevel", defaults.autoAnalyzeMaxClassificationLevel),
      mailStoreRetentionDays: settings.get("mailStoreRetentionDays", defaults.mailStoreRetentionDays),
      mailIndexRetentionDays: settings.get("mailIndexRetentionDays", defaults.mailIndexRetentionDays),
      analysisRetentionDays: settings.get("analysisRetentionDays", defaults.analysisRetentionDays),
      collectorTimeoutSeconds: settings.get("collectorTimeoutSeconds", defaults.collectorTimeoutSeconds),
      importantSenders: settings.get("importantSenders", defaults.importantSenders),
      ignoredSenders: settings.get("ignoredSenders", defaults.ignoredSenders),
      hardBlockKeywords: settings.get("hardBlockKeywords", defaults.hardBlockKeywords),
      manualConfirmKeywords: settings.get("manualConfirmKeywords", defaults.manualConfirmKeywords),
      classificationLevel3Keywords: settings.get("classificationLevel3Keywords", defaults.classificationLevel3Keywords),
      classificationLevel2Keywords: settings.get("classificationLevel2Keywords", defaults.classificationLevel2Keywords)
    };
  }

  private async readLocale(): Promise<Locale> {
    try {
      return getLocaleFromConfig(await this.readConfig());
    } catch {
      return "zh-CN";
    }
  }

  private async updateSettings(values: Record<string, unknown>): Promise<void> {
    const settings = vscode.workspace.getConfiguration("easyMail");
    if (Object.prototype.hasOwnProperty.call(values, "modelFamily")) {
      const current = await this.data.readConfig();
      await this.data.writeConfig({
        ...current,
        modelFamily: String(values.modelFamily || current.modelFamily || "gpt-5.4").trim()
      });
    }
    for (const [key, value] of Object.entries(values)) {
      await settings.update(key, value, vscode.ConfigurationTarget.Global);
    }
  }

  private async initializeLogger(): Promise<void> {
    const logDir = this.data.getLogDir();
    await fs.promises.mkdir(logDir, { recursive: true });
    this.logFilePath = path.join(logDir, "easy-mail.log");
    await this.log("logger:ready", { logFilePath: this.logFilePath });
  }

  private async log(event: string, data: Record<string, unknown>): Promise<void> {
    if (!this.logFilePath) {
      return;
    }
    const entry = {
      ts: new Date().toISOString(),
      event,
      ...data
    };
    await fs.promises.appendFile(this.logFilePath, `${JSON.stringify(entry)}\n`, "utf8").catch(() => undefined);
  }

  private async loadAvailableModels(): Promise<void> {
    const pending = this.availableModelsPending || this.llmProvider.listModels()
      .then(async (items) => {
        this.availableModelsCache = items;
        await this.data.writeAvailableModels(items);
        await this.log("models:loaded", { count: items.length });
        return items;
      })
      .catch(async (error) => {
        await this.log("models:error", { error: formatError(error) });
        throw error;
      })
      .finally(() => {
        this.availableModelsPending = null;
      });
    this.availableModelsPending = pending;
    await pending;
  }

  private async findCollectorScript(): Promise<string> {
    return await this.findScript("collect-outlook-mails.vbs");
  }

  private async findScript(scriptName: string): Promise<string> {
    const candidate = path.join(this.context.extensionPath, "scripts", scriptName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    throw new Error(`${scriptName} not found in extension package.`);
  }

  private async findOutlookOpenTarget(mailId: string): Promise<{ entryId: string; storeId: string } | null> {
    const targetId = String(mailId || "");
    if (!targetId) {
      return null;
    }

    const index = await this.data.readMailIndex();
    const indexItem = index.items.find((item) => item.mailId === targetId || item.sourceMailId === targetId);
    if (indexItem?.entryId) {
      return { entryId: indexItem.entryId, storeId: String(indexItem.storeId || "") };
    }

    const store = await this.data.readMailStore();
    const storedMail = store.items.find((item) => item.mailId === targetId || item.sourceMailId === targetId);
    if (storedMail?.entryId) {
      return { entryId: storedMail.entryId, storeId: String(storedMail.storeId || "") };
    }

    const analysis = await this.data.readAnalysisResult(() => this.readConfig());
    const analysisItem = analysis.items.find((item) => item.mailId === targetId || item.source?.mailId === targetId);
    if (analysisItem?.source?.entryId) {
      return { entryId: analysisItem.source.entryId, storeId: "" };
    }

    return null;
  }

  private async loadState(): Promise<DashboardState> {
    const config = await this.readConfig();
    const digest: DigestData = fs.existsSync(this.data.getDigestPath())
      ? parseDigest(await fs.promises.readFile(this.data.getDigestPath(), "utf8"))
      : { metadata: { generatedAt: "", rangeMode: "", recentHours: 0, maxItems: 0, folders: [] }, items: [] };
    const promptConfig = await this.data.readPromptConfig();
    const analysis = await this.data.readAnalysisResult(() => this.readConfig());
    const threadAnalysis = await this.data.readThreadAnalysisResult();
    const ignoredIds = await this.data.readIgnoredIds();
    const store = await this.data.readMailStore();
    const index = pruneMailIndex(await this.data.readMailIndex(), Number(config.mailIndexRetentionDays || 7));
    await this.data.writeMailIndex(index);
    const threadStore = buildThreadStore(store.items);
    const classifications = ensureClassifications(store.items, await this.data.readClassificationCache(), buildClassificationKeywords(config));
    await this.data.writeClassificationCache(classifications);
    const securitySettings = buildSecuritySettings(config);
    const securityDecisions = buildMailSecurityDecisionMap(store.items, classifications, securitySettings);
    const securedThreadStore: ThreadStore = {
      ...threadStore,
      items: threadStore.items.map((thread) => ({
        ...thread,
        security: buildThreadGateDecision(thread, classifications.items, securitySettings).summary
      }))
    };
    await this.data.writeThreadStore(securedThreadStore);
    const queue = buildQueueState(
      store.items,
      analysis,
      ignoredIds,
      classifications,
      true,
      config.autoAnalyzeMaxClassificationLevel,
      config.ignoredSenders,
      securityDecisions
    );
    const state = buildDashboardState(config, digest, analysis, ignoredIds, allowedCategoryIds(promptConfig), securedThreadStore) as LoadedDashboardState;
    state.modelInfo = await this.data.readModelInfo();
    state.store = store;
    state.index = index;
    state.queue = queue;
    state.classifications = classifications;
    state.securityDecisions = securityDecisions;
    state.promptConfig = promptConfig;
    state.threadStore = securedThreadStore;
    state.threadAnalysis = threadAnalysis;
    state.meetingStore = pruneMeetingStore(await this.data.readMeetingStore());
    state.ignoredIds = new Set(ignoredIds);
    return state;
  }

  private messageHandlerContext(): MessageHandlerContext {
    return {
      log: (event, data) => this.log(event, data),
      readLocale: () => this.readLocale(),
      readConfig: () => this.readConfig(),
      updateSettings: (next) => this.updateSettings(next),
      refresh: () => this.refresh(),
      focusSidebarQueue: (queueId) => { void this.dashboardProvider.postMessage({ type: "focusQueue", queueId }); },
      focusSidebarItem: (itemId) => { void this.dashboardProvider.postMessage({ type: "focusItem", id: itemId }); },
      copyToClipboard: async (text) => { await vscode.env.clipboard.writeText(text); },
      showInfo: (msg) => void vscode.window.showInformationMessage(msg),
      showWarning: (msg) => void vscode.window.showWarningMessage(msg),
      showConfirm: async (msg, yesLabel) => {
        const result = await vscode.window.showWarningMessage(msg, { modal: true }, yesLabel);
        return result === yesLabel;
      },
      readIgnoredIds: () => this.data.readIgnoredIds(),
      writeIgnoredIds: (ids) => this.data.writeIgnoredIds(ids),
      openMailInOutlook: (mailId) => this.openMailInOutlook(mailId),
      openMeetingInOutlook: (meetingId) => this.openMeetingInOutlook(meetingId),
      openGuide: () => this.openGuide(),
      openDigest: () => this.openDigest(),
      openSummary: () => this.openSummary(),
      generateReports: () => this.generateReports(),
      loadModels: () => this.loadModels(),
      changeOutputLanguage: (locale) => this.changeOutputLanguage(locale as Locale),
      openDailyBrief: () => this.openDailyBrief(),
      openThreadReport: () => this.openThreadReport(),
      openSingleMailReport: () => this.openSingleMailReport(),
      pullMail: (forceSample) => this.pullMail(forceSample),
      loadMore: () => this.loadMore(),
      analyze: (batchSize) => this.analyze(batchSize),
      analyzeAllAllowed: () => this.analyzeAllAllowed(),
      analyzeSelected: (mailIds) => this.analyzeSelected(mailIds),
      analyzeThread: (threadId) => this.analyzeThread(threadId),
      openSettings: () => this.openSettings(),
      openPromptConfig: () => this.openPromptConfig(),
      clearLocalCache: () => this.clearLocalCache(),
      openWorkbench: (focusId) => this.openWorkbench(focusId),
      updateWorkingDraft: (itemId, draftText) => {
        if (draftText || this.workingDrafts.has(itemId)) this.workingDrafts.set(itemId, draftText);
      },
      completeWorkingDraftFlush: (requestId) => this.completeWorkbenchDraftFlush(requestId),
      generateDraft: (itemId, sourceId) => this.generateDraft(itemId, sourceId),
      polishDraft: (draftText, itemId) => this.polishDraft(draftText, itemId),
      refineDraft: (draftText, instruction, itemId) => this.refineDraft(draftText, instruction, itemId),
      composeOutlookMail: (mode, draftText, itemId) => this.composeOutlookMail(mode, draftText, itemId),
      markNextAction: (actionId, status) => this.markNextAction(actionId, status),
      ignoreThread: (threadId) => this.ignoreThread(threadId),
      unignoreThread: (threadId) => this.unignoreThread(threadId)
    };
  }

  private async handleMessage(message: unknown): Promise<void> {
    return handleWebviewMessage(this.messageHandlerContext(), message);
  }

  private async getDashboardHtml(): Promise<string> {
    const state = await this.loadState();
    const extendedState = state as LoadedDashboardState;
    const availableModels = await this.data.readCachedAvailableModels(this.availableModelsCache, (event, d) => this.log(event, d));
    const nextActionsStore = await this.data.readNextActions();
    return renderSidebarHtml(buildSidebarRenderInput(extendedState, availableModels, nextActionsStore, this.busy?.kind || "", !!this.busy));
  }
}

async function openTextDocument(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });
}


