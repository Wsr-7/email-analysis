export type DraftLanguage = "auto" | "en" | "zh-CN";
export type ResolvedDraftLanguage = Exclude<DraftLanguage, "auto">;
export type OutputLanguage = "en-US" | "zh-CN";

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
  return String(text || "").split(/\r?\n\s*\r?\n|\r?\n/).map((part) => part.trim()).find(Boolean) || "";
}
