export type DraftLanguage = "auto" | "en" | "zh-CN";
export type ResolvedDraftLanguage = Exclude<DraftLanguage, "auto">;
export type OutputLanguage = "en-US" | "zh-CN";
export type DraftLanguageSource = {
  folder?: string;
  toMe?: string;
  ccMe?: string;
  bodyDelta?: string;
  bodyClean?: string;
  bodyPreview?: string;
  bodyExcerpt?: string;
};

export function resolveOutputLanguage(value: unknown, envLanguage: string): OutputLanguage {
  if (value === "en-US" || value === "zh-CN") {
    return value;
  }
  return String(envLanguage || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function normalizeDraftLanguage(value: unknown): DraftLanguage {
  return value === "en" || value === "zh-CN" ? value : "auto";
}

export function detectDraftLanguageFromText(text: string): ResolvedDraftLanguage {
  const paragraph = firstParagraph(text);
  const cjk = (paragraph.match(/[\u3400-\u9fff]/g) || []).length;
  const visible = (paragraph.match(/\S/g) || []).length || 1;
  return cjk / visible >= 0.15 ? "zh-CN" : "en";
}

export function resolveDraftLanguage(value: unknown, text: string): ResolvedDraftLanguage {
  const language = normalizeDraftLanguage(value);
  return language === "auto" ? detectDraftLanguageFromText(text) : language;
}

export function draftOutputInstruction(language: ResolvedDraftLanguage): string {
  return language === "zh-CN"
    ? "Output Simplified Chinese only, except source quotes, email addresses, exact IDs, and proper nouns."
    : "Output English only, except source quotes, email addresses, exact IDs, and proper nouns.";
}

export function latestNonSelfThreadText(thread: { timeline?: DraftLanguageSource[] }): string {
  const timeline = [...(thread.timeline || [])].reverse();
  const message = timeline.find(isIncomingMessage) || timeline[0];
  return [message?.bodyDelta, message?.bodyClean, message?.bodyPreview, message?.bodyExcerpt]
    .find((value) => String(value || "").trim()) || "";
}

export function buildLanguageContract(input: {
  outputLanguage: string;
  draftLanguage: DraftLanguage;
  draftAutoDescription: string;
  analysisFields: string;
}): string {
  return [
    "Language Contract:",
    `- ${input.analysisFields} must use ${languageName(input.outputLanguage === "zh-CN" ? "zh-CN" : "en")}.`,
    `- draftReply and draftReplyParts must use ${draftLanguageName(input.draftLanguage, input.draftAutoDescription)}.`,
    "- Keep source quotes, email addresses, exact IDs, and proper nouns unchanged."
  ].join("\n");
}

function draftLanguageName(language: DraftLanguage, autoDescription: string): string {
  return language === "auto" ? autoDescription : languageName(language);
}

function languageName(language: ResolvedDraftLanguage): string {
  return language === "zh-CN" ? "Simplified Chinese" : "English";
}

function firstParagraph(text: string): string {
  return String(text || "").split(/\r?\n\s*\r?\n/).map((part) => part.trim()).find(Boolean) || "";
}

function isIncomingMessage(message: DraftLanguageSource): boolean {
  const toMe = booleanText(message.toMe);
  const ccMe = booleanText(message.ccMe);
  if (toMe || ccMe) {
    return true;
  }
  return !isSentFolderName(message.folder);
}

function booleanText(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

const SENT_FOLDER_NAMES = new Set([
  "sent",
  "sent items",
  "sent mail",
  "sent messages",
  "已发送",
  "已发送邮件",
  "已发送项目",
  "已傳送",
  "已傳送郵件",
  "已傳送的郵件",
  "寄件备份",
  "寄件備份",
  "寄件匣"
]);

function isSentFolderName(value: unknown): boolean {
  const parts = String(value || "")
    .split(/[\\/]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return parts.some((part) => SENT_FOLDER_NAMES.has(part) || /\bsent\b/.test(part));
}
