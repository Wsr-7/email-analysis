import { formatTodayLine } from "./config-utils";
import { buildLanguageContract, normalizeDraftLanguage, type DraftLanguage } from "./language-contract";
import type { ThreadRecord } from "./thread-schema";

export interface ThreadPromptParts {
  basePrompt: string;
  outputSchemaPrompt: string;
  analysisPrompt: string;
  thread: ThreadRecord;
  outputLanguage: string;
  draftLanguage?: DraftLanguage;
  now?: Date;
}

export function buildThreadAnalysisPrompt(parts: ThreadPromptParts): string {
  const payload = buildThreadPromptPayload(parts.thread);
  return [
    parts.basePrompt.trim(),
    formatTodayLine(parts.now),
    buildLanguageContract({
      outputLanguage: parts.outputLanguage,
      draftLanguage: normalizeDraftLanguage(parts.draftLanguage),
      draftAutoDescription: "the source thread language",
      analysisFields: "all natural-language thread analysis fields, including oneLineSummary, currentStatus, keyDecisions, questions, actions, risks, waitingOn, suggestedAction, and evidence.reason"
    }),
    parts.analysisPrompt.trim(),
    "",
    parts.outputSchemaPrompt.trim(),
    "",
    "Thread timeline JSON:",
    "```json",
    JSON.stringify(payload, null, 2),
    "```"
  ].join("\n");
}

export function buildThreadPromptPayload(thread: ThreadRecord): Record<string, unknown> {
  return {
    threadId: thread.threadId,
    subject: thread.subject,
    participants: thread.participants || [],
    partialContext: Boolean(thread.security?.partialContext || thread.contentStatus !== "available"),
    security: thread.security ? {
      allowedMessages: thread.security.allowedMessages,
      manualConfirmMessages: thread.security.manualConfirmMessages,
      blockedMessages: thread.security.blockedMessages,
      reasons: thread.security.reasons
    } : undefined,
    timeline: (thread.timeline || []).map((message) => ({
      mailId: message.mailId,
      time: message.receivedTime || message.sentTime,
      from: message.from || message.senderEmail || message.senderName,
      subject: message.subject,
      folder: message.folder,
      bodyDelta: message.bodyDelta || message.bodyClean || message.bodyPreview,
      attachmentCount: message.attachmentCount,
      attachmentNames: message.attachmentNames
    }))
  };
}
