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
import { type AvailableModel, type LlmProvider } from "./lib/llm-provider";
import { renderEasyMailGuideHtml } from "./lib/guide-webview";
import { type Locale, serializeFolderDateMap, getLocaleFromConfig, buildSecuritySettings } from "./lib/config-utils";
import { getLabels, buildCategoryLabels } from "./lib/dashboard-labels";
import { renderSidebarHtml } from "./lib/sidebar-render";
import { analyzeBatchCore as analyzeBatchCoreImpl, analyzeThreadCore as analyzeThreadCoreImpl, translateExistingAnalysis as translateExistingAnalysisImpl, sendPromptToModel, type AnalysisContext } from "./lib/app-analysis";
import { handleWebviewMessage, type MessageHandlerContext } from "./lib/message-handler";
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
    vscode.commands.registerCommand("easyMail.refreshDashboard", () => app.refresh()),
    vscode.commands.registerCommand("easyMail.openDigest", () => app.openDigest()),
    vscode.commands.registerCommand("easyMail.openSummary", () => app.openSummary()),
    vscode.commands.registerCommand("easyMail.generateReports", () => app.generateReports()),
    vscode.commands.registerCommand("easyMail.loadModels", () => app.loadModels()),
    vscode.commands.registerCommand("easyMail.openDailyBrief", () => app.openDailyBrief()),
    vscode.commands.registerCommand("easyMail.openThreadReport", () => app.openThreadReport()),
    vscode.commands.registerCommand("easyMail.openSingleMailReport", () => app.openSingleMailReport()),
    vscode.commands.registerCommand("easyMail.openSettings", () => app.openSettings()),
    vscode.commands.registerCommand("easyMail.openPromptConfig", () => app.openPromptConfig()),
    vscode.commands.registerCommand("easyMail.openReplyTemplate", () => app.openReplyTemplate()),
    vscode.commands.registerCommand("easyMail.openGuide", () => app.openGuide()),
    vscode.commands.registerCommand("easyMail.clearLocalCache", () => app.clearLocalCache()),
    vscode.commands.registerCommand("easyMail.openWorkbench", () => app.openWorkbench())
  );

  await app.initialize();
}

export function deactivate(): void {}

class EasyMailApp {
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
    const key = "easyMail.guideShown.0.2.0";
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
      "Easy Mail - User Guide",
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
      this.workbenchPanel.webview.html = await this.getWorkbenchHtml();
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
    const prompt = `You are an email writing assistant. Polish the following draft reply: improve grammar, clarity, and tone while preserving the original intent and meaning. Keep the style concise, professional, and appropriate for internal workplace communication. Output only the improved reply text, nothing else.\n\nDraft:\n${draftText}`;
    try {
      const { raw } = await sendPromptToModel(this.analysisContext(), prompt, String(config.modelFamily || ""), "polish");
      const result = raw.trim();
      this.workingDrafts.set(itemId, result);
      this.workbenchPanel?.webview.postMessage({ type: "updateDraft", text: result, itemId });
    } catch (err) {
      vscode.window.showWarningMessage(`Polish failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async refineDraft(draftText: string, instruction: string, itemId: string): Promise<void> {
    await this.log("draft:refine", { itemId });
    const config = await this.readConfig();
    const prompt = `You are an email writing assistant. Rewrite the following draft reply according to the user's instruction. Keep the style concise, professional, and appropriate for internal workplace communication unless the instruction says otherwise. Output only the rewritten reply text, nothing else.\n\nInstruction: ${instruction}\n\nDraft:\n${draftText}`;
    try {
      const { raw } = await sendPromptToModel(this.analysisContext(), prompt, String(config.modelFamily || ""), "refine");
      const result = raw.trim();
      this.workingDrafts.set(itemId, result);
      this.workbenchPanel?.webview.postMessage({ type: "updateDraft", text: result, itemId });
    } catch (err) {
      vscode.window.showWarningMessage(`Refine failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async getWorkbenchHtml(): Promise<string> {
    const state = await this.loadState();
    const extendedState = state as DashboardState & {
      store?: MailStore;
      index?: MailIndex;
      queue?: ReturnType<typeof buildQueueState>;
      classifications?: ClassificationCache;
      securityDecisions?: SecurityDecisionMap;
      promptConfig?: PromptConfig;
      threadStore?: ThreadStore;
      threadAnalysis?: ThreadAnalysisResult;
    };
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
      version: String(this.context.extension.packageJSON?.version || "0.2.0"),
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
    const folders = Array.isArray(config.folders) ? config.folders.map(String) : ["Inbox"];
    const currentIndex = pruneMailIndex(await this.data.readMailIndex(), Number(config.mailIndexRetentionDays || 7));
    args.push("--max-items", String(maxItems));
    args.push("--recent-hours", String(loadMore || rangeMode === "maxItems" ? 0 : recentHours));
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

    await this.log("pullMail:start", { forceSample, loadMore, maxItems, recentHours, rangeMode, folders });
    await runProcess("cscript.exe", args, 30000, (event, data) => void this.log(`process:${event}`, data));
    const digest = parseDigest(await fs.promises.readFile(this.data.getDigestPath(), "utf8"));
    const merge = mergeDigestIntoStore(await this.data.readMailStore(), digest, currentIndex.items.map((item) => item.mailId));
    const nextIndex = pruneMailIndex(mergeDigestIntoIndex(currentIndex, digest), Number(config.mailIndexRetentionDays || 7));
    const prunedStore = pruneMailStore(merge.store, Number(config.mailStoreRetentionDays || 1));
    await this.data.writeMailStore(prunedStore);
    await this.data.writeMailIndex(nextIndex);
    const builtThreadStore = buildThreadStore(prunedStore.items);
    const nextThreadStore = pruneThreadStore(
      mergeThreadStores(await this.data.readThreadStore(), builtThreadStore),
      Number(config.mailStoreRetentionDays || 1)
    );
    await this.data.writeThreadStore(nextThreadStore);
    const classificationCache = ensureClassifications(prunedStore.items, await this.data.readClassificationCache());
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
      await runProcess("cscript.exe", meetingArgs, 30000, (event, data) => void this.log(`meeting:${event}`, data));
      const meetingDigest = parseMeetingDigest(await fs.promises.readFile(this.data.getMeetingDigestPath(), "utf8"));
      const meetingStore = pruneMeetingStore(mergeMeetingDigestIntoStore(await this.data.readMeetingStore(), meetingDigest));
      await this.data.writeMeetingStore(meetingStore);
      await this.log("meetings:done", { items: meetingStore.items.length });
    } catch (err) {
      await this.log("meetings:error", { error: formatError(err) });
    }
  }

  public async analyze(batchSize?: number): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    await this.runWithBusy(
      labels.progress.analyze,
      labels.progress.detail,
      "analyzeNext",
      async () => await this.analyzeBatchCore(batchSize),
      (result) => `Easy Mail analysis completed for ${result.batchSize} mail(s).`
    );
  }

  public async analyzeAllAllowed(): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    await this.runWithBusy(
      labels.progress.analyze,
      labels.progress.detail,
      "analyzeAll",
      async () => await this.analyzeBatchCore("allAllowed"),
      (result) => `Easy Mail analysis completed for ${result.batchSize} mail(s).`
    );
  }

  private async analyzeSelected(mailIds: string[]): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    await this.runWithBusy(
      labels.progress.analyze,
      labels.progress.detail,
      "analyzeSelected",
      async () => await this.analyzeBatchCore(mailIds),
      (result) => `Easy Mail analysis completed for ${result.batchSize} mail(s).`
    );
  }

  private analysisContext(): AnalysisContext {
    return {
      data: this.data,
      llmProvider: this.llmProvider,
      extensionPath: this.context.extensionPath,
      readConfig: () => this.readConfig(),
      log: (event, data) => this.log(event, data),
      availableModelsCache: this.availableModelsCache
    };
  }

  private async analyzeBatchCore(selection?: "allAllowed" | string[] | number): Promise<{ batchSize: number }> {
    return analyzeBatchCoreImpl(this.analysisContext(), selection);
  }

  public async analyzeThread(threadId: string): Promise<void> {
    const locale = await this.readLocale();
    const labels = getLabels(locale);
    await this.runWithBusy(
      labels.progress.analyze,
      labels.progress.detail,
      "analyzeThread",
      async () => await this.analyzeThreadCore(threadId),
      (result) => `Thread analysis completed for ${result.subject}.`
    );
  }

  private async analyzeThreadCore(threadId: string): Promise<{ subject: string }> {
    const result = await analyzeThreadCoreImpl(this.analysisContext(), threadId);
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
    task: () => Promise<T>,
    completionMessage?: (result: T) => string
  ): Promise<T> {
    if (this.busy) {
      throw new Error(`Another Easy Mail task is already running: ${this.busy.label}`);
    }
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    await this.log("busy:start", { label });
    this.busy = { label, detail, startedAt, kind };
    await this.refresh();
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: label, cancellable: false },
        async (progress) => {
          progress.report({ message: detail });
          return await task();
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

  public async refresh(): Promise<void> {
    await this.dashboardProvider.update();
    if (this.workbenchPanel) {
      this.workbenchPanel.webview.html = await this.getWorkbenchHtml();
    }
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
      () => "Easy Mail reports generated."
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
      () => "Easy Mail Copilot models loaded."
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
        async () => await this.translateExistingAnalysis(nextLocale),
        (result) => `Easy Mail translated ${result.mailItems} mail analysis item(s) and ${result.threadItems} thread analysis item(s).`
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
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Wsr-7.easy-mail");
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
      await vscode.window.showWarningMessage("Easy Mail cannot open this mail in Outlook because its EntryID is no longer available in the local index.");
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
      await vscode.window.showWarningMessage("Easy Mail cannot open Outlook compose because the mail EntryID is no longer available.");
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

  private async translateExistingAnalysis(targetLocale: Locale): Promise<{ mailItems: number; threadItems: number }> {
    return translateExistingAnalysisImpl(this.analysisContext(), targetLocale);
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
    await this.data.ensureConfig();
    const defaults = await this.data.readDefaults();
    const settings = vscode.workspace.getConfiguration("easyMail");
    return {
      ...defaults,
      rangeMode: settings.get("rangeMode", defaults.rangeMode),
      recentHours: settings.get("recentHours", defaults.recentHours),
      maxItems: settings.get("maxItems", defaults.maxItems),
      folders: settings.get("folders", defaults.folders),
      bodyExcerptChars: settings.get("bodyExcerptChars", defaults.bodyExcerptChars),
      sampleMode: settings.get("sampleMode", defaults.sampleMode),
      modelFamily: settings.get("modelFamily", defaults.modelFamily),
      outputLanguage: settings.get("outputLanguage", defaults.outputLanguage || "en-US"),
      analysisBatchSize: settings.get("analysisBatchSize", defaults.analysisBatchSize),
      autoAnalyzeEnabled: settings.get("autoAnalyzeEnabled", defaults.autoAnalyzeEnabled),
      autoAnalyzeMaxClassificationLevel: settings.get("autoAnalyzeMaxClassificationLevel", defaults.autoAnalyzeMaxClassificationLevel),
      mailStoreRetentionDays: settings.get("mailStoreRetentionDays", defaults.mailStoreRetentionDays),
      mailIndexRetentionDays: settings.get("mailIndexRetentionDays", defaults.mailIndexRetentionDays),
      analysisRetentionDays: settings.get("analysisRetentionDays", defaults.analysisRetentionDays),
      importantSenders: settings.get("importantSenders", defaults.importantSenders)
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
    const threadStore = pruneThreadStore(await this.data.readThreadStore(), Number(config.mailStoreRetentionDays || 1));
    const classifications = ensureClassifications(store.items, await this.data.readClassificationCache());
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
      config.autoAnalyzeEnabled !== false,
      Number(config.autoAnalyzeMaxClassificationLevel || 2)
    );
    const state = buildDashboardState(config, digest, analysis, ignoredIds, allowedCategoryIds(promptConfig), securedThreadStore) as DashboardState & {
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
    };
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
    return state;
  }

  private messageHandlerContext(): MessageHandlerContext {
    return {
      log: (event, data) => this.log(event, data),
      readLocale: () => this.readLocale(),
      readConfig: () => this.readConfig(),
      updateSettings: (next) => this.updateSettings(next),
      refresh: () => this.refresh(),
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
      polishDraft: (draftText, itemId) => this.polishDraft(draftText, itemId),
      refineDraft: (draftText, instruction, itemId) => this.refineDraft(draftText, instruction, itemId),
      composeOutlookMail: (mode, draftText, itemId) => this.composeOutlookMail(mode, draftText, itemId),
      markNextAction: (actionId, status) => this.markNextAction(actionId, status)
    };
  }

  private async handleMessage(message: unknown): Promise<void> {
    return handleWebviewMessage(this.messageHandlerContext(), message);
  }

  private async getDashboardHtml(): Promise<string> {
    const state = await this.loadState();
    const extendedState = state as DashboardState & {
      store?: MailStore;
      index?: MailIndex;
      queue?: ReturnType<typeof buildQueueState>;
      classifications?: ClassificationCache;
      securityDecisions?: SecurityDecisionMap;
      promptConfig?: PromptConfig;
      threadStore?: ThreadStore;
      threadAnalysis?: ThreadAnalysisResult;
    };
    const availableModels = await this.data.readCachedAvailableModels(this.availableModelsCache, (event, d) => this.log(event, d));
    const nextActionsStore = await this.data.readNextActions();
    return renderSidebarHtml({
      state,
      store: extendedState.store || emptyMailStore(),
      index: extendedState.index || emptyMailIndex(),
      queue: extendedState.queue || { pending: [], blocked: [], analysed: [], allowed: [] },
      classifications: extendedState.classifications || normalizeClassificationCache({}),
      securityDecisions: extendedState.securityDecisions || new Map(),
      promptConfig: extendedState.promptConfig || normalizePromptConfig({}),
      threadStore: extendedState.threadStore || emptyThreadStore(),
      threadAnalysis: extendedState.threadAnalysis || { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] },
      nextActionsStore,
      availableModels,
      busyKind: this.busy?.kind || "",
      isBusy: !!this.busy
    });
  }
}

async function openTextDocument(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });
}


