import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeAnalysis, parseAnalysisJson, stripCodeFence, mergeAnalysisResults, pruneAnalysisResult } from "./analysis-schema";
import { applyAnalysisTranslation, buildAnalysisTranslationPrompt } from "./analysis-translation";
import { buildQueueState, ensureClassifications } from "./classification";
import { type Locale, mergeStringLists, parseFolders, getLocaleFromConfig, buildSecuritySettings, buildDefaultRedactionPolicy } from "./config-utils";
import { getLabels, buildCategoryLabels } from "./dashboard-labels";
import { selectConfiguredModel, type AvailableModel, type LlmProvider } from "./llm-provider";
import { buildBatchDigestMarkdown, pruneMailIndex, type StoredMail } from "./mail-store";
import { allowedCategoryIds, composeAnalysisPrompt } from "./prompt-config";
import { redactStoredMails, redactThreadForPrompt } from "./redaction";
import { applyReplyTemplateToAnalysis } from "./reply-template";
import { buildThreadGateDecision, buildMailSecurityDecisionMap, canAnalyzeMail } from "./security-gate";
import { buildSummaryMarkdown } from "./summary";
import { normalizeThreadAnalysis, parseThreadAnalysisJson, mergeThreadAnalysisResults } from "./thread-analysis-schema";
import { buildThreadAnalysisPrompt } from "./thread-prompt-builder";
import type { AppDataStore } from "./app-data";

const ANALYSIS_CHUNK_TOKEN_BUDGET = 12000;
const ANALYSIS_OUTPUT_RESERVE_PER_MAIL = 400;

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
  const response = await ctx.llmProvider.sendPrompt(prompt, { modelFamily: configuredModel, model: selectedModel });

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

export function splitByTokenBudget(
  mails: StoredMail[],
  maxInputTokens: number,
  reservePerMail: number
): StoredMail[][] {
  const budget = Math.max(1, Math.floor(maxInputTokens));
  const reserve = Math.max(0, Math.floor(reservePerMail));
  const chunks: StoredMail[][] = [];
  let current: StoredMail[] = [];
  let currentTokens = 0;

  for (const mail of mails) {
    const mailTokens = estimateMailTokens(mail) + reserve;
    if (current.length && currentTokens + mailTokens > budget) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(mail);
    currentTokens += mailTokens;
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

function estimateMailTokens(mail: StoredMail): number {
  const chars = [
    `## Mail: ${mail.mailId}`,
    `Subject: ${mail.subject}`,
    `From: ${mail.from}`,
    `ReceivedTime: ${mail.receivedTime}`,
    `Folder: ${mail.folder}`,
    `Unread: ${mail.unread}`,
    `Importance: ${mail.importance}`,
    `ToMe: ${mail.toMe}`,
    `CcMe: ${mail.ccMe}`,
    "BodyExcerpt:",
    mail.bodyExcerpt
  ].join("\n").length;
  return estimateTextTokens(chars);
}

function estimateTextTokens(textOrLength: string | number): number {
  const chars = typeof textOrLength === "number" ? textOrLength : textOrLength.length;
  return Math.ceil(chars / 4);
}

async function analysisTokenBudget(ctx: AnalysisContext, configuredModel: string): Promise<number> {
  const models = await ctx.data.readCachedAvailableModels(ctx.availableModelsCache, (event, d) => ctx.log(event, d));
  const selectedModel = selectConfiguredModel(models, configuredModel);
  const modelBudget = Number(selectedModel?.maxInputTokens);
  return Number.isFinite(modelBudget) && modelBudget > 0
    ? Math.min(modelBudget, ANALYSIS_CHUNK_TOKEN_BUDGET)
    : ANALYSIS_CHUNK_TOKEN_BUDGET;
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
  const batchSize = typeof selection === "number" ? Math.max(1, Math.floor(selection)) : 5;
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
  const basePrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "base-system.md"), "utf8");
  const outputSchemaPrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "output-schema.md"), "utf8");
  const replyDraftPrompt = await fs.promises.readFile(path.join(ctx.extensionPath, "prompts", "reply-draft-prompt.md"), "utf8");
  const replyTemplate = await ctx.data.readReplyTemplate((event, d) => ctx.log(event, d));
  const configuredModel = typeof config.modelFamily === "string" ? config.modelFamily.trim() : "gpt-5.4";
  const modelInputTokenBudget = await analysisTokenBudget(ctx, configuredModel);
  const promptOverheadTokens = estimateTextTokens(composeAnalysisPrompt({
    basePrompt,
    outputSchemaPrompt,
    replyDraftPrompt,
    replyTemplate,
    digestText: buildBatchDigestMarkdown([]),
    outputLanguage: String(config.outputLanguage || "en-US"),
    promptConfig
  }));
  const chunkInputTokenBudget = Math.max(1, modelInputTokenBudget - promptOverheadTokens);
  const chunks = splitByTokenBudget(batch, chunkInputTokenBudget, ANALYSIS_OUTPUT_RESERVE_PER_MAIL);
  await ctx.log("analyze:start", {
    selection: Array.isArray(selection) ? "selected" : typeof selection === "number" ? "batchSize" : selection || "nextBatch",
    requestedBatchSize: requestedBatch.length,
    batchSize: batch.length,
    chunks: chunks.length,
    maxInputTokens: modelInputTokenBudget,
    promptOverheadTokens,
    chunkInputTokenBudget,
    configuredModel
  });
  let merged = currentAnalysis;
  let analyzedCount = 0;
  let skippedChunks = 0;
  let totalReplacements = 0;
  const summaryLabels = buildCategoryLabels(getLabels(getLocaleFromConfig(config)), promptConfig, getLocaleFromConfig(config));

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const redacted = redactStoredMails(chunk, buildDefaultRedactionPolicy());
    totalReplacements += redacted.totalReplacements;
    const digestText = buildBatchDigestMarkdown(redacted.items);
    const prompt = composeAnalysisPrompt({
      basePrompt,
      outputSchemaPrompt,
      replyDraftPrompt,
      replyTemplate,
      digestText,
      outputLanguage: String(config.outputLanguage || "en-US"),
      promptConfig
    });
    await ctx.log("analyze:chunkStart", { chunk: index + 1, chunks: chunks.length, mails: chunk.length });
    const { raw } = await sendPromptToModel(ctx, prompt, configuredModel, "analyze");
    await ctx.log("analyze:response", { chunk: index + 1, chunks: chunks.length, rawLength: raw.length });
    let analysis: ReturnType<typeof parseAnalysisJson>;
    try {
      analysis = parseAnalysisJson(raw, allowedCategoryIds(promptConfig));
    } catch (error) {
      try {
        const repaired = await repairAnalysisJson(ctx, raw, error, configuredModel);
        analysis = parseAnalysisJson(repaired, allowedCategoryIds(promptConfig));
      } catch (repairError) {
        skippedChunks += 1;
        await ctx.log("analyze:chunkSkipped", {
          chunk: index + 1,
          chunks: chunks.length,
          error: repairError instanceof Error ? repairError.message : String(repairError)
        });
        continue;
      }
    }

    const normalized = applyReplyTemplateToAnalysis(
      normalizeAnalysis(analysis, allowedCategoryIds(promptConfig)),
      replyTemplate
    );
    normalized.language = getLocaleFromConfig(config);
    const draftNormalized = await ensureEnglishDraftReplies(ctx, normalized, configuredModel);
    merged = pruneAnalysisResult(
      mergeAnalysisResults(merged, draftNormalized, allowedCategoryIds(promptConfig)),
      Number(config.analysisRetentionDays || 7),
      allowedCategoryIds(promptConfig)
    );
    analyzedCount += chunk.length;
    await fs.promises.writeFile(ctx.data.getAnalysisPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    await fs.promises.writeFile(ctx.data.getSummaryPath(), buildSummaryMarkdown(merged, summaryLabels), "utf8");
    await ctx.log("analyze:chunkDone", { chunk: index + 1, chunks: chunks.length, mergedItems: merged.items.length });
  }

  if (!analyzedCount) {
    await ctx.log("analyze:failed", { batchSize: batch.length, skippedChunks });
    throw new Error("All analysis chunks failed. Check model output or try a different model.");
  }

  await ctx.log("analyze:done", {
    batchSize: batch.length,
    analyzedCount,
    skippedChunks,
    redactionReplacements: totalReplacements,
    mergedItems: merged.items.length
  });
  return { batchSize: analyzedCount };
}

async function repairAnalysisJson(
  ctx: AnalysisContext,
  raw: string,
  error: unknown,
  configuredModel: string
): Promise<string> {
  const prompt = [
    "Fix this invalid JSON response.",
    "Return strict JSON only. Do not add markdown fences or commentary.",
    `Parser error: ${error instanceof Error ? error.message : String(error)}`,
    "",
    raw
  ].join("\n");
  return (await sendPromptToModel(ctx, prompt, configuredModel, "analyze:repair")).raw;
}

export async function analyzeThreadCore(
  ctx: AnalysisContext,
  threadId: string
): Promise<{ subject: string }> {
  const config = await ctx.readConfig();
  const promptConfig = await ctx.data.readPromptConfig();
  const categoryIds = allowedCategoryIds(promptConfig);
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
  let parsed = parseThreadAnalysisJson(raw, categoryIds);
  parsed.language = getLocaleFromConfig(config);
  if (parsed.language === "en-US" && threadAnalysisContainsCjk(parsed)) {
    try {
      const translatedPrompt = buildAnalysisTranslationPrompt({
        mail: emptyAnalysisResult("en-US"),
        threads: parsed,
        targetLanguage: "en-US"
      });
      const translatedRaw = await sendPromptToModel(ctx, translatedPrompt, configuredModel, "threadTranslate");
      parsed = normalizeThreadAnalysis(applyAnalysisTranslation({
        mail: emptyAnalysisResult("en-US"),
        threads: parsed,
        translated: JSON.parse(stripCodeFence(translatedRaw.raw.trim())),
        targetLanguage: "en-US"
      }).threads, categoryIds);
    } catch (error) {
      await ctx.log("threadAnalyze:translateFallbackFailed", { threadId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const current = await ctx.data.readThreadAnalysisResult();
  const merged = mergeThreadAnalysisResults(current, parsed, categoryIds);
  await ctx.data.writeThreadAnalysisResult(merged);
  await ctx.log("threadAnalyze:done", { threadId, mergedItems: merged.items.length });
  return { subject: thread.subject || thread.threadId };
}

function emptyAnalysisResult(language: Locale) {
  return {
    generatedAt: "",
    language,
    overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 },
    items: []
  };
}

async function ensureEnglishDraftReplies(
  ctx: AnalysisContext,
  analysis: ReturnType<typeof normalizeAnalysis>,
  configuredModel: string
): Promise<ReturnType<typeof normalizeAnalysis>> {
  const items = (analysis.items || []).filter((item) => containsCjk(`${item.draftReply || ""}\n${JSON.stringify(item.draftReplyParts || {})}`));
  if (!items.length) {
    return analysis;
  }
  const prompt = [
    "Translate only the reply draft fields to English.",
    "Return strict JSON only in this shape: {\"items\":[{\"mailId\":\"...\",\"draftReply\":\"...\",\"draftReplyParts\":{\"GREETING\":\"...\",\"MAIN_MESSAGE\":\"...\",\"REQUESTED_ACTION\":\"...\",\"CLOSING\":\"...\"}}]}.",
    "Do not change categories, summaries, reasons, suggested actions, subjects, senders, or mail ids.",
    "The translated draftReply and draftReplyParts must contain English text only and must not contain Chinese characters.",
    "",
    JSON.stringify({
      items: items.map((item) => ({
        mailId: item.mailId,
        draftReply: item.draftReply,
        draftReplyParts: item.draftReplyParts || {}
      }))
    }, null, 2)
  ].join("\n");
  try {
    const { raw } = await sendPromptToModel(ctx, prompt, configuredModel, "draftTranslate");
    return applyDraftReplyTranslations(analysis, JSON.parse(stripCodeFence(raw.trim())));
  } catch (error) {
    await ctx.log("draftTranslate:failed", { error: error instanceof Error ? error.message : String(error), items: items.map((item) => item.mailId) });
    return analysis;
  }
}

function applyDraftReplyTranslations(analysis: ReturnType<typeof normalizeAnalysis>, translated: unknown): ReturnType<typeof normalizeAnalysis> {
  if (!translated || typeof translated !== "object" || !Array.isArray((translated as { items?: unknown[] }).items)) {
    return analysis;
  }
  const byId = new Map((translated as { items: Array<Record<string, unknown>> }).items.map((item) => [String(item.mailId || ""), item]));
  return {
    ...analysis,
    items: analysis.items.map((item) => {
      const translatedItem = byId.get(item.mailId);
      if (!translatedItem) return item;
      const draftReply = typeof translatedItem.draftReply === "string" && translatedItem.draftReply.trim()
        ? translatedItem.draftReply.trim()
        : item.draftReply;
      const rawParts = translatedItem.draftReplyParts;
      const draftReplyParts = rawParts && typeof rawParts === "object" ? {
        ...item.draftReplyParts,
        ...Object.fromEntries(Object.entries(rawParts as Record<string, unknown>).filter(([, value]) => typeof value === "string"))
      } : item.draftReplyParts;
      return { ...item, draftReply, draftReplyParts };
    })
  };
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function threadAnalysisContainsCjk(threads: ReturnType<typeof parseThreadAnalysisJson>): boolean {
  return containsCjk(JSON.stringify((threads.items || []).map((item) => ({
    oneLineSummary: item.oneLineSummary,
    currentStatus: item.currentStatus,
    keyDecisions: item.keyDecisions,
    openQuestions: item.openQuestions,
    actionItems: item.actionItems.map((action) => action.task),
    risks: item.risks.map((risk) => risk.description),
    suggestedAction: item.suggestedAction
  }))));
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
