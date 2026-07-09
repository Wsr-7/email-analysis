import type { AnalysisResult } from "./analysis-schema";
import type { ThreadAnalysisResult } from "./thread-analysis-schema";

export type AnalysisTranslationPayload = {
  targetLanguage: string;
  mail: Array<{
    mailId: string;
    summary: string;
    reason: string;
    suggestedAction: string;
  }>;
  threads: Array<{
    threadId: string;
    oneLineSummary: string;
    currentStatus: string;
    keyDecisions: string[];
    openQuestions: string[];
    actionItems: Array<{ index: number; task: string }>;
    risks: Array<{ index: number; description: string }>;
    suggestedAction: string;
  }>;
};

export function buildAnalysisTranslationPrompt(input: {
  mail: AnalysisResult;
  threads: ThreadAnalysisResult;
  targetLanguage: "zh-CN" | "en-US";
}): string {
  const targetLanguage = input.targetLanguage === "zh-CN" ? "Simplified Chinese" : "English";
  const payload = buildAnalysisTranslationPayload(input.mail, input.threads, targetLanguage);
  return [
    "You are translating existing email analysis results.",
    `Translate only the text fields in the JSON payload to ${targetLanguage}.`,
    "Do not reclassify, reprioritize, summarize again, add new facts, or change ids.",
    "Do not translate original mail content, evidence quotes, source metadata, draftReply, or reply draft parts.",
    "Return valid JSON only with the same shape: {\"mail\": [...], \"threads\": [...]}",
    JSON.stringify(payload, null, 2)
  ].join("\n\n");
}

export function applyAnalysisTranslation(input: {
  mail: AnalysisResult;
  threads: ThreadAnalysisResult;
  translated: unknown;
  targetLanguage: "zh-CN" | "en-US";
}): { mail: AnalysisResult; threads: ThreadAnalysisResult } {
  const translated = isObject(input.translated) ? input.translated : {};
  const mailById = new Map(
    Array.isArray(translated.mail)
      ? translated.mail.filter(isObject).map((item) => [String(item.mailId || ""), item])
      : []
  );
  const threadById = new Map(
    Array.isArray(translated.threads)
      ? translated.threads.filter(isObject).map((item) => [String(item.threadId || ""), item])
      : []
  );

  const mail: AnalysisResult = {
    ...input.mail,
    language: input.targetLanguage,
    items: input.mail.items.map((item) => {
      const translatedItem = mailById.get(item.mailId);
      if (!translatedItem) {
        return item;
      }
      return {
        ...item,
        summary: stringOr(translatedItem.summary, item.summary),
        reason: stringOr(translatedItem.reason, item.reason),
        suggestedAction: stringOr(translatedItem.suggestedAction, item.suggestedAction)
      };
    })
  };

  const threads: ThreadAnalysisResult = {
    ...input.threads,
    language: input.targetLanguage,
    items: input.threads.items.map((item) => {
      const translatedThread = threadById.get(item.threadId);
      if (!translatedThread) {
        return item;
      }
      const actionTasks = indexedTextMap(translatedThread.actionItems, "task");
      const riskDescriptions = indexedTextMap(translatedThread.risks, "description");
      return {
        ...item,
        oneLineSummary: stringOr(translatedThread.oneLineSummary, item.oneLineSummary),
        currentStatus: stringOr(translatedThread.currentStatus, item.currentStatus),
        keyDecisions: stringArrayOr(translatedThread.keyDecisions, item.keyDecisions),
        openQuestions: stringArrayOr(translatedThread.openQuestions, item.openQuestions),
        suggestedAction: stringOr(translatedThread.suggestedAction, item.suggestedAction),
        actionItems: item.actionItems.map((actionItem, index) => ({
          ...actionItem,
          task: actionTasks.get(index) || actionItem.task
        })),
        risks: item.risks.map((risk, index) => ({
          ...risk,
          description: riskDescriptions.get(index) || risk.description
        }))
      };
    })
  };

  return { mail, threads };
}

function buildAnalysisTranslationPayload(mail: AnalysisResult, threads: ThreadAnalysisResult, targetLanguage: string): AnalysisTranslationPayload {
  return {
    targetLanguage,
    mail: mail.items.map((item) => ({
      mailId: item.mailId,
      summary: item.summary,
      reason: item.reason,
      suggestedAction: item.suggestedAction
    })),
    threads: threads.items.map((item) => ({
      threadId: item.threadId,
      oneLineSummary: item.oneLineSummary,
      currentStatus: item.currentStatus,
      keyDecisions: item.keyDecisions,
      openQuestions: item.openQuestions,
      actionItems: item.actionItems.map((actionItem, index) => ({ index, task: actionItem.task })),
      risks: item.risks.map((risk, index) => ({ index, description: risk.description })),
      suggestedAction: item.suggestedAction
    }))
  };
}

function indexedTextMap(input: unknown, field: string): Map<number, string> {
  const result = new Map<number, string>();
  if (!Array.isArray(input)) {
    return result;
  }
  for (const item of input) {
    if (!isObject(item)) {
      continue;
    }
    const index = Number(item.index);
    const value = String(item[field] || "");
    if (Number.isInteger(index) && value) {
      result.set(index, value);
    }
  }
  return result;
}

function stringArrayOr(input: unknown, fallback: string[]): string[] {
  if (!Array.isArray(input)) {
    return fallback;
  }
  const values = input.map((item) => String(item || "").trim()).filter(Boolean);
  return values.length ? values : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  const text = String(value || "");
  return text ? text : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
