import type { ThreadRecord } from "./thread-schema";

export interface ThreadPromptParts {
  basePrompt: string;
  outputSchemaPrompt: string;
  analysisPrompt: string;
  thread: ThreadRecord;
  outputLanguage: string;
}

export function buildThreadAnalysisPrompt(parts: ThreadPromptParts): string {
  const payload = buildThreadPromptPayload(parts.thread);
  return [
    parts.basePrompt.trim(),
    "",
    parts.analysisPrompt.trim(),
    "",
    "Output language:",
    parts.outputLanguage || "en-US",
    parts.outputLanguage === "en-US"
      ? "Write every natural-language JSON string in English. Translate Chinese source content into English, including questions, statuses, actions, risks, and person-name display text where possible. Keep email addresses and exact IDs unchanged."
      : "用中文输出所有自然语言 JSON 字符串。邮箱地址和精确 ID 保持不变。",
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
