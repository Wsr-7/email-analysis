import { positiveNumber, parseFolders } from "./config-utils";

export interface MessageHandlerContext {
  log: (event: string, data: Record<string, unknown>) => Promise<void>;
  readLocale: () => Promise<string>;
  readConfig: () => Promise<Record<string, any>>;
  updateSettings: (next: Record<string, unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  showInfo: (message: string) => void;
  showWarning: (message: string) => void;
  showConfirm: (message: string, yesLabel: string) => Promise<boolean>;
  readIgnoredIds: () => Promise<string[]>;
  writeIgnoredIds: (ids: string[]) => Promise<void>;
  openMailInOutlook: (mailId: string) => Promise<void>;
  openMeetingInOutlook: (meetingId: string) => Promise<void>;
  openGuide: () => Promise<void>;
  openDigest: () => Promise<void>;
  openSummary: () => Promise<void>;
  generateReports: () => Promise<void>;
  loadModels: () => Promise<void>;
  changeOutputLanguage: (locale: string) => Promise<void>;
  openDailyBrief: () => Promise<void>;
  openThreadReport: () => Promise<void>;
  openSingleMailReport: () => Promise<void>;
  pullMail: (forceSample: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  analyze: (batchSize?: number) => Promise<void>;
  analyzeAllAllowed: () => Promise<void>;
  analyzeSelected: (mailIds: string[]) => Promise<void>;
  analyzeThread: (threadId: string) => Promise<void>;
  openSettings: () => Promise<void>;
  openPromptConfig: () => Promise<void>;
  clearLocalCache: () => Promise<void>;
  openWorkbench: (focusId?: string) => Promise<void>;
  polishDraft: (draftText: string, itemId: string) => Promise<void>;
  refineDraft: (draftText: string, instruction: string, itemId: string) => Promise<void>;
  composeOutlookMail: (mode: string, draftText: string, itemId: string) => Promise<void>;
  markNextAction: (actionId: string, status: string) => Promise<void>;
  ignoreThread: (threadId: string) => Promise<void>;
  unignoreThread: (threadId: string) => Promise<void>;
}

export async function handleWebviewMessage(ctx: MessageHandlerContext, message: unknown): Promise<void> {
  if (!message || typeof message !== "object") {
    return;
  }

  const typed = message as { type?: string; draftReply?: string; draftText?: string; instruction?: string; itemId?: string; mode?: string; actionId?: string; status?: string; mailId?: string; mailIds?: string[]; threadId?: string; meetingId?: string; batchSize?: unknown; config?: unknown; silent?: boolean };
  await ctx.log("message:received", {
    type: typed.type || "",
    mailId: typed.mailId || "",
    mailIds: Array.isArray(typed.mailIds) ? typed.mailIds.length : 0,
    threadId: typed.threadId || ""
  });
  if (typed.type === "copyDraft") {
    const draftReply = String(typed.draftReply || "");
    if (!draftReply.trim()) {
      ctx.showWarning("No draft reply is available for this mail.");
      return;
    }
    await ctx.copyToClipboard(draftReply);
    ctx.showInfo("Draft reply copied.");
    return;
  }

  if (typed.type === "polishDraft") {
    const draftText = String(typed.draftText || "").trim();
    if (!draftText) {
      ctx.showWarning("Draft is empty. Write or generate a draft first.");
      return;
    }
    await ctx.polishDraft(draftText, String(typed.itemId || ""));
    return;
  }

  if (typed.type === "refineDraft") {
    const draftText = String(typed.draftText || "").trim();
    if (!draftText) {
      ctx.showWarning("Draft is empty. Write or generate a draft first.");
      return;
    }
    const instruction = String(typed.instruction || "").trim();
    if (!instruction) {
      ctx.showWarning("Please enter an instruction for refine, or use Polish instead.");
      return;
    }
    await ctx.refineDraft(draftText, instruction, String(typed.itemId || ""));
    return;
  }

  if (typed.type === "composeMail") {
    const mode = String(typed.mode || "");
    if (mode !== "reply" && mode !== "replyAll" && mode !== "forward") {
      ctx.showWarning("Unsupported compose mode.");
      return;
    }
    const draftText = String(typed.draftText || "");
    if (!draftText.trim()) {
      ctx.showWarning("Draft is empty. Write or generate a draft first.");
      return;
    }
    await ctx.composeOutlookMail(mode, draftText, String(typed.itemId || ""));
    return;
  }

  if (typed.type === "markNextAction") {
    const actionId = String(typed.actionId || "");
    const status = String(typed.status || "");
    if (!actionId || (status !== "open" && status !== "done" && status !== "ignored")) {
      ctx.showWarning("Invalid action or status.");
      return;
    }
    await ctx.markNextAction(actionId, status);
    await ctx.refresh();
    return;
  }

  if (typed.type === "ignoreThread") {
    const threadId = String(typed.threadId || "");
    if (!threadId) {
      ctx.showWarning("No thread selected.");
      return;
    }
    await ctx.ignoreThread(threadId);
    await ctx.refresh();
    return;
  }

  if (typed.type === "unignoreThread") {
    const threadId = String(typed.threadId || "");
    if (!threadId) {
      ctx.showWarning("No thread selected.");
      return;
    }
    await ctx.unignoreThread(threadId);
    await ctx.refresh();
    return;
  }

  if (typed.type === "ignore") {
    const ignoredIds = await ctx.readIgnoredIds();
    if (typed.mailId && !ignoredIds.includes(typed.mailId)) {
      ignoredIds.push(typed.mailId);
      await ctx.writeIgnoredIds(ignoredIds);
    }
    await ctx.log("ignore:done", { mailId: typed.mailId || "", ignoredCount: ignoredIds.length });
    const locale = await ctx.readLocale();
    ctx.showInfo(locale === "zh-CN" ? "邮件已忽略。" : "Mail ignored.");
    await ctx.refresh();
    return;
  }

  if (typed.type === "unignore") {
    const ignoredIds = await ctx.readIgnoredIds();
    const updated = ignoredIds.filter((id) => id !== typed.mailId);
    await ctx.writeIgnoredIds(updated);
    await ctx.log("unignore:done", { mailId: typed.mailId || "", ignoredCount: updated.length });
    const locale = await ctx.readLocale();
    ctx.showInfo(locale === "zh-CN" ? "邮件已恢复。" : "Mail restored.");
    await ctx.refresh();
    return;
  }

  if (typed.type === "openInOutlook" && typed.mailId) {
    await ctx.openMailInOutlook(String(typed.mailId));
    return;
  }

  if (typed.type === "openMeetingInOutlook" && typed.meetingId) {
    await ctx.openMeetingInOutlook(String(typed.meetingId));
    return;
  }

  if (typed.type === "refresh") {
    await ctx.refresh();
    return;
  }

  if (typed.type === "openGuide") {
    await ctx.openGuide();
    return;
  }

  if (typed.type === "openWalkthrough") {
    await ctx.openGuide();
    return;
  }

  if (typed.type === "openDigest") {
    await ctx.openDigest();
    return;
  }

  if (typed.type === "openSummary") {
    await ctx.openSummary();
    return;
  }

  if (typed.type === "generateReports") {
    await ctx.generateReports();
    return;
  }

  if (typed.type === "loadModels") {
    await ctx.loadModels();
    return;
  }

  if (typed.type === "requestLanguageChange") {
    const requested = (typed.config && typeof typed.config === "object" && (typed.config as Record<string, unknown>).outputLanguage === "zh-CN") ? "zh-CN" : "en-US";
    await ctx.changeOutputLanguage(requested);
    return;
  }

  if (typed.type === "openDailyBrief") {
    await ctx.openDailyBrief();
    return;
  }

  if (typed.type === "openThreadReport") {
    await ctx.openThreadReport();
    return;
  }

  if (typed.type === "openSingleMailReport") {
    await ctx.openSingleMailReport();
    return;
  }

  if (typed.type === "pullMail") {
    await ctx.pullMail(false);
    return;
  }

  if (typed.type === "loadMore") {
    await ctx.loadMore();
    return;
  }

  if (typed.type === "sampleDigest") {
    await ctx.pullMail(true);
    return;
  }

  if (typed.type === "analyze") {
    const batchSize = positiveNumber(typed.batchSize, 0);
    await ctx.analyze(batchSize || undefined);
    return;
  }

  if (typed.type === "analyzeAllAllowed") {
    await ctx.analyzeAllAllowed();
    return;
  }

  if (typed.type === "analyzeSelected") {
    await ctx.analyzeSelected(Array.isArray(typed.mailIds) ? typed.mailIds.map(String) : []);
    return;
  }

  if (typed.type === "analyzeThread" && typed.threadId) {
    await ctx.analyzeThread(String(typed.threadId));
    return;
  }

  if (typed.type === "openSettings") {
    await ctx.openSettings();
    return;
  }

  if (typed.type === "openPromptConfig") {
    await ctx.openPromptConfig();
    return;
  }

  if (typed.type === "clearLocalCache") {
    await ctx.clearLocalCache();
    return;
  }

  if (typed.type === "confirmClearLocalCache") {
    const locale = await ctx.readLocale();
    const msg = locale === "zh-CN" ? "确定要清空所有邮件和分析数据吗？此操作不可撤销。" : "Clear all mail and analysis data? This cannot be undone.";
    const yesLabel = locale === "zh-CN" ? "确定清空" : "Clear All";
    const confirmed = await ctx.showConfirm(msg, yesLabel);
    if (confirmed) {
      await ctx.clearLocalCache();
    }
    return;
  }

  if (typed.type === "openWorkbench") {
    await ctx.openWorkbench();
    return;
  }

  if (typed.type === "openInWorkbench") {
    const focusId = typed.mailId || typed.threadId || "";
    await ctx.openWorkbench(focusId);
    return;
  }

  if (typed.type === "saveConfig") {
    await saveConfigFromMessage(ctx, typed);
    await ctx.refresh();
  }
}

export async function saveConfigFromMessage(
  ctx: Pick<MessageHandlerContext, "readConfig" | "updateSettings" | "showInfo">,
  message: { config?: unknown; silent?: boolean }
): Promise<void> {
  if (!message.config || typeof message.config !== "object") {
    return;
  }

  const current = await ctx.readConfig();
  const patch = message.config as Record<string, unknown>;
  const next = {
    rangeMode: Object.prototype.hasOwnProperty.call(patch, "rangeMode") ? (patch.rangeMode === "maxItems" ? "maxItems" : "recentHours") : current.rangeMode,
    recentHours: Object.prototype.hasOwnProperty.call(patch, "recentHours") ? positiveNumber(patch.recentHours, current.recentHours || 24) : current.recentHours,
    maxItems: Object.prototype.hasOwnProperty.call(patch, "maxItems") ? positiveNumber(patch.maxItems, current.maxItems || 50) : current.maxItems,
    folders: Object.prototype.hasOwnProperty.call(patch, "folders") ? parseFolders(patch.folders, current.folders || ["Inbox"]) : current.folders,
    bodyExcerptChars: Object.prototype.hasOwnProperty.call(patch, "bodyExcerptChars") ? positiveNumber(patch.bodyExcerptChars, current.bodyExcerptChars || 1500) : current.bodyExcerptChars,
    outputLanguage: Object.prototype.hasOwnProperty.call(patch, "outputLanguage") ? (patch.outputLanguage === "zh-CN" ? "zh-CN" : "en-US") : current.outputLanguage,
    modelFamily: Object.prototype.hasOwnProperty.call(patch, "modelFamily") ? String(patch.modelFamily || current.modelFamily || "gpt-5.4").trim() : current.modelFamily,
    analysisBatchSize: Object.prototype.hasOwnProperty.call(patch, "analysisBatchSize") ? positiveNumber(patch.analysisBatchSize, current.analysisBatchSize || 5) : current.analysisBatchSize,
    autoAnalyzeMaxClassificationLevel: Object.prototype.hasOwnProperty.call(patch, "autoAnalyzeMaxClassificationLevel") ? positiveNumber(patch.autoAnalyzeMaxClassificationLevel, current.autoAnalyzeMaxClassificationLevel || 2) : current.autoAnalyzeMaxClassificationLevel,
    mailStoreRetentionDays: Object.prototype.hasOwnProperty.call(patch, "mailStoreRetentionDays") ? positiveNumber(patch.mailStoreRetentionDays, current.mailStoreRetentionDays || 1) : current.mailStoreRetentionDays,
    mailIndexRetentionDays: Object.prototype.hasOwnProperty.call(patch, "mailIndexRetentionDays") ? positiveNumber(patch.mailIndexRetentionDays, current.mailIndexRetentionDays || 7) : current.mailIndexRetentionDays,
    analysisRetentionDays: Object.prototype.hasOwnProperty.call(patch, "analysisRetentionDays") ? positiveNumber(patch.analysisRetentionDays, current.analysisRetentionDays || 7) : current.analysisRetentionDays,
    importantSenders: Object.prototype.hasOwnProperty.call(patch, "importantSenders") ? parseFolders(patch.importantSenders, current.importantSenders || []) : current.importantSenders
  };
  await ctx.updateSettings(next);
  if (!message.silent) {
    ctx.showInfo("Easy Mail settings saved to VS Code Settings.");
  }
}
