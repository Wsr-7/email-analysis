import type { AnalysisResult } from "./analysis-schema";

export const REPLY_TEMPLATE_FILE_NAME = "reply-template.md";
export const LEGACY_REPLY_TEMPLATE_FILE_NAME = "reply-模板.md";

export const REPLY_TEMPLATE_PLACEHOLDERS = [
  "GREETING",
  "MAIN_MESSAGE",
  "REQUESTED_ACTION",
  "CLOSING"
] as const;

export type ReplyTemplatePlaceholder = typeof REPLY_TEMPLATE_PLACEHOLDERS[number];

export type ReplyDraftParts = Partial<Record<ReplyTemplatePlaceholder, string>>;

export function renderReplyDraftFromTemplate(template: string, parts: ReplyDraftParts, fallbackDraft = ""): string {
  const normalizedParts = normalizeReplyDraftParts(parts);
  const hasParts = Object.values(normalizedParts).some((value) => value.trim());
  if (!hasParts) {
    return fallbackDraft;
  }

  let rendered = String(template || defaultReplyTemplate());
  for (const key of REPLY_TEMPLATE_PLACEHOLDERS) {
    rendered = rendered.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), normalizedParts[key]);
  }
  return rendered
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function applyReplyTemplateToAnalysis(analysis: AnalysisResult, template: string): AnalysisResult {
  return {
    ...analysis,
    items: analysis.items.map((item) => {
      if (!item.draftReplyParts) {
        return item;
      }
      const draftReply = renderReplyDraftFromTemplate(template, item.draftReplyParts, item.draftReply);
      return {
        ...item,
        draftReply
      };
    })
  };
}

export function validateReplyTemplate(template: string): string[] {
  const text = String(template || "");
  return REPLY_TEMPLATE_PLACEHOLDERS.filter((key) => !new RegExp(`{{\\s*${key}\\s*}}`).test(text));
}

export function defaultReplyTemplate(): string {
  return [
    "{{GREETING}}",
    "",
    "{{MAIN_MESSAGE}}",
    "",
    "{{REQUESTED_ACTION}}",
    "",
    "{{CLOSING}}"
  ].join("\n");
}

function normalizeReplyDraftParts(parts: ReplyDraftParts): Record<ReplyTemplatePlaceholder, string> {
  return {
    GREETING: String(parts.GREETING || ""),
    MAIN_MESSAGE: String(parts.MAIN_MESSAGE || ""),
    REQUESTED_ACTION: String(parts.REQUESTED_ACTION || ""),
    CLOSING: String(parts.CLOSING || "")
  };
}
