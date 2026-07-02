import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeAnalysis, parseAnalysisJson, stripCodeFence, mergeAnalysisResults, pruneAnalysisResult } from "./analysis-schema";
import { applyAnalysisTranslation, buildAnalysisTranslationPrompt } from "./analysis-translation";
import { buildQueueState, ensureClassifications } from "./classification";
import { type Locale, mergeStringLists, parseFolders, getLocaleFromConfig, buildSecuritySettings, buildDefaultRedactionPolicy } from "./config-utils";
import { getLabels, buildCategoryLabels } from "./dashboard-labels";
import { selectConfiguredModel, type AvailableModel, type LlmProvider } from "./llm-provider";
import { buildBatchDigestMarkdown } from "./mail-store";
import { allowedCategoryIds, composeAnalysisPrompt } from "./prompt-config";
import { redactStoredMails, redactThreadForPrompt } from "./redaction";
import { applyReplyTemplateToAnalysis } from "./reply-template";
import { buildThreadGateDecision, buildMailSecurityDecisionMap, canAnalyzeMail } from "./security-gate";
import { buildSummaryMarkdown } from "./summary";
import { normalizeThreadAnalysis, parseThreadAnalysisJson, mergeThreadAnalysisResults } from "./thread-analysis-schema";
import { buildThreadAnalysisPrompt } from "./thread-prompt-builder";
import { pruneMailIndex } from "./mail-store";
import type { AppDataStore } from "./app-data";

export interface AnalysisContext {
  data: AppDataStore;
  llmProvider: LlmProvider;
  extensionPath: string;
  readConfig: () => Promise<Record<string, any>>;
  log: (event: string, data: Record<string, unknown>) => Promise<void>;
  availableModelsCache: AvailableModel[] | null;
}

export async function sendPromptToModel(
  ctx: AnalysisContext,
  prompt: string,
  configuredModel: string,
  eventPrefix: string
): Promise<{ raw: string }> {
  const models = await ctx.data.readCachedAvailableModels(ctx.availableModelsCache, (event, d) => ctx.log(event, d));
  const selectedModel = selectConfiguredModel(models, configuredModel);
  await ctx.log(`${eventPrefix}:models`, {
    availableCount: models.length,
    selected: selectedModel ? { id: selectedModel.id, family: selectedModel.family, name: selectedModel.name, vendor: selectedModel.vendor } : null
  });
  if (!selectedModel) {
    throw new Error("Load GitHub Copilot models first, then select a model before analyzing.");
  }
  const response = await ctx.llmProvider.sendPrompt(prompt, { modelFamily: configuredModel });

  await ctx.data.writeModelInfo({
    requestedFamily: configuredModel || "auto",
    usedFallback: response.usedFallback,
    actualFamily: response.model.family,
    actualId: response.model.id,
    actualName: response.model.name,
    actualVendor: response.model.vendor,
    analyzedAt: new Date().toISOString()
  });

  return { raw: response.rawText };
}

export async function analyzeBatchCore(
  ctx: AnalysisContext,
  selection?: "allAllowed" | string[] | number
): Promise<{ batchSize: number }> {
  const config = await ctx.readConfig();
  await ctx.data.importDigestIfStoreMissing();
  const store = await ctx.data.readMailStore();
  const index = pruneMailIndex(await ctx.data.readMailIndex(), Number(config.mailIndexRetentionDays || 7));
  await ctx.data.writeMailIndex(index);
  if (!store.items.length) {
    await ctx.log("analyze:noStoreItems", { indexItems: index.items.length });
    throw new Error("No pulled mail exists. Run Pull Mail first.");
  }
  const classificationCache = ensureClassifications(store.items, await ctx.data.readClassificationCache());
  await ctx.data.writeClassificationCache(classificationCache);
  const currentAnalysis = await ctx.data.readAnalysisResult(() => ctx.readConfig());
  const ignoredIds = await ctx.data.readIgnoredIds();
  const securitySettings = buildSecuritySettings(config);
  const securityDecisions = buildMailSecurityDecisionMap(store.items, classificationCache, securitySettings);
  const queue = buildQueueState(
    store.items,
    currentAnalysis,
    ignoredIds,
    classificationCache,
    true,
    config.autoAnalyzeMaxClassificationLevel
  );
  const batchSize = typeof selection === "number" ? Math.max(1, Math.floor(selection)) : Number(config.analysisBatchSize || 5);
  const requestedBatch = Array.isArray(selection)
    ? store.items.filter((item) => selection.includes(item.mailId) && !ignoredIds.includes(item.mailId))
    : selection === "allAllowed"
      ? queue.allowed
      : queue.allowed.slice(0, batchSize);
  const batch = requestedBatch.filter((item) => canAnalyzeMail(item, securityDecisions, Array.isArray(selection)));
  if (!batch.length) {
    await ctx.log("analyze:noBatch", {
      pending: queue.pending.length,
      allowed: queue.allowed.length,
      blocked: queue.blocked.length,
      requested: requestedBatch.length,
      securityBlocked: requestedBatch.filter((item) => securityDecisions.get(item.mailId)?.decision === "block").length
    });
    throw new Error("No mail is available for analysis. Check pending mail or security gates.");
  }

  const promptConfig = await ctx.data.readPromptConfig();
  promptConfig.importantSenders = mergeStringLists(promptConfig.importantSenders, parseFolders(config.importantSenders, []));
  const redacted = redactStoredMails(batch, buildDefaultRedactionPolicy());
  const digestText = buildBatchDigestMarkdown(redacted.items);
  const basePrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "base-system.md"), "utf8");
  const outputSchemaPrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "output-schema.md"), "utf8");
  const replyDraftPrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "reply-draft-prompt.md"), "utf8");
  const replyTemplate = await ctx.data.readReplyTemplate((event, d) => ctx.log(event, d));
  const configuredModel = typeof config.modelFamily === "string" ? config.modelFamily.trim() : "gpt-5.4";
  await ctx.log("analyze:start", {
    selection: Array.isArray(selection) ? "selected" : typeof selection === "number" ? "batchSize" : selection || "nextBatch",
    requestedBatchSize: requestedBatch.length,
    batchSize: batch.length,
    redactionReplacements: redacted.totalReplacements,
    configuredModel
  });
  const prompt = composeAnalysisPrompt({
    basePrompt,
    outputSchemaPrompt,
    replyDraftPrompt,
    replyTemplate,
    digestText,
    outputLanguage: String(config.outputLanguage || "en-US"),
    promptConfig
  });
  const { raw } = await sendPromptToModel(ctx, prompt, configuredModel, "analyze");
  await ctx.log("analyze:response", { rawLength: raw.length });
  const analysis = parseAnalysisJson(raw, allowedCategoryIds(promptConfig));

  const normalized = applyReplyTemplateToAnalysis(
    normalizeAnalysis(analysis, allowedCategoryIds(promptConfig)),
    replyTemplate
  );
  normalized.language = getLocaleFromConfig(config);
  const merged = pruneAnalysisResult(
    mergeAnalysisResults(currentAnalysis, normalized, allowedCategoryIds(promptConfig)),
    Number(config.analysisRetentionDays || 7),
    allowedCategoryIds(promptConfig)
  );
  const summaryLabels = buildCategoryLabels(getLabels(getLocaleFromConfig(config)), promptConfig, getLocaleFromConfig(config));
  await fs.promises.writeFile(ctx.data.getAnalysisPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(ctx.data.getSummaryPath(), buildSummaryMarkdown(merged, summaryLabels), "utf8");
  await ctx.log("analyze:done", { batchSize: batch.length, mergedItems: merged.items.length });
  return { batchSize: batch.length };
}

export async function analyzeThreadCore(
  ctx: AnalysisContext,
  threadId: string
): Promise<{ subject: string }> {
  const config = await ctx.readConfig();
  const threadStore = await ctx.data.readThreadStore();
  const thread = threadStore.items.find((item) => item.threadId === threadId);
  if (!thread) {
    throw new Error("Thread not found. Refresh or pull mail first.");
  }
  if ((thread.security?.blockedMessages || 0) > 0) {
    await ctx.log("threadAnalyze:block", { threadId, reasons: thread.security?.reasons || [] });
    throw new Error("Thread has blocked messages and cannot be analyzed.");
  }
  const gate = buildThreadGateDecision(thread, ensureClassifications(await ctx.data.readMailStore().then((store) => store.items), await ctx.data.readClassificationCache()).items, buildSecuritySettings(config));
  if (gate.decision === "block") {
    await ctx.log("threadAnalyze:block", { threadId, reasons: gate.reasons });
    throw new Error("Thread is blocked by the security gate.");
  }

  const redactedThread = redactThreadForPrompt(thread, buildDefaultRedactionPolicy());
  const basePrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "thread-base-system.md"), "utf8");
  const analysisPrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "thread-analysis-prompt.md"), "utf8");
  const outputSchemaPrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "thread-output-schema.md"), "utf8");
  const prompt = buildThreadAnalysisPrompt({
    basePrompt,
    analysisPrompt,
    outputSchemaPrompt,
    outputLanguage: String(config.outputLanguage || "en-US"),
    thread: redactedThread
  });
  const configuredModel = typeof config.modelFamily === "string" ? config.modelFamily.trim() : "gpt-5.4";
  await ctx.log("threadAnalyze:start", { threadId, configuredModel, partialContext: gate.partialContext });
  const { raw } = await sendPromptToModel(ctx, prompt, configuredModel, "threadAnalyze");
  const parsed = parseThreadAnalysisJson(raw, allowedCategoryIds(await ctx.data.readPromptConfig()));
  parsed.language = getLocaleFromConfig(config);
  const current = await ctx.data.readThreadAnalysisResult();
  const merged = mergeThreadAnalysisResults(current, parsed, allowedCategoryIds(await ctx.data.readPromptConfig()));
  await ctx.data.writeThreadAnalysisResult(merged);
  await ctx.log("threadAnalyze:done", { threadId, mergedItems: merged.items.length });
  return { subject: thread.subject || thread.threadId };
}

export async function translateExistingAnalysis(
  ctx: AnalysisContext,
  targetLocale: Locale
): Promise<{ mailItems: number; threadItems: number }> {
  const config = await ctx.readConfig();
  const promptConfig = await ctx.data.readPromptConfig();
  const mail = await ctx.data.readAnalysisResult(() => ctx.readConfig());
  const threads = await ctx.data.readThreadAnalysisResult();
  if (!mail.items.length && !threads.items.length) {
    return { mailItems: 0, threadItems: 0 };
  }

  const configuredModel = typeof config.modelFamily === "string" ? config.modelFamily.trim() : "gpt-5.4";
  const prompt = buildAnalysisTranslationPrompt({ mail, threads, targetLanguage: targetLocale });
  const { raw } = await sendPromptToModel(ctx, prompt, configuredModel, "translate");
  const translated = applyAnalysisTranslation({
    mail,
    threads,
    translated: JSON.parse(stripCodeFence(raw.trim())),
    targetLanguage: targetLocale
  });
  const mailResult = normalizeAnalysis(translated.mail, allowedCategoryIds(promptConfig));
  const threadResult = normalizeThreadAnalysis(translated.threads, allowedCategoryIds(promptConfig));
  const summaryLabels = buildCategoryLabels(getLabels(targetLocale), promptConfig, targetLocale);
  await fs.promises.writeFile(ctx.data.getAnalysisPath(), `${JSON.stringify(mailResult, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(ctx.data.getSummaryPath(), buildSummaryMarkdown(mailResult, summaryLabels), "utf8");
  await ctx.data.writeThreadAnalysisResult(threadResult);
  await ctx.log("translate:done", {
    targetLocale,
    mailItems: mailResult.items.length,
    threadItems: threadResult.items.length
  });
  return { mailItems: mailResult.items.length, threadItems: threadResult.items.length };
}
