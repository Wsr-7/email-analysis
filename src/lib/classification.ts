import type { AnalysisResult } from "./analysis-schema";
import type { StoredMail } from "./mail-store";

export interface MailClassification {
  mailId: string;
  level: number;
  label: string;
  source: string;
  reason: string;
  updatedAt: string;
}

export interface ClassificationCache {
  generatedAt: string;
  items: MailClassification[];
}

export interface AnalysisQueueState {
  pending: StoredMail[];
  blocked: StoredMail[];
  analysed: StoredMail[];
  allowed: StoredMail[];
  ignoredPending: StoredMail[];
}

export function normalizeClassificationCache(input: unknown): ClassificationCache {
  const base = isObject(input) ? input : {};
  const items = Array.isArray(base.items) ? base.items.map(normalizeClassification).filter(Boolean) as MailClassification[] : [];
  return {
    generatedAt: String(base.generatedAt || new Date().toISOString()),
    items
  };
}

export function ensureClassifications(storeItems: StoredMail[], cache: ClassificationCache): ClassificationCache {
  const byId = new Map(cache.items.map((item) => [item.mailId, item]));
  const next = [...cache.items];
  for (const mail of storeItems) {
    if (!byId.has(mail.mailId)) {
      const classification = classifyMail(mail);
      next.push(classification);
      byId.set(mail.mailId, classification);
    }
  }
  return {
    ...cache,
    items: next.filter((item) => storeItems.some((mail) => mail.mailId === item.mailId))
  };
}

export function classifyMail(mail: StoredMail): MailClassification {
  const text = `${mail.folder}\n${mail.subject}\n${mail.bodyExcerpt}`.toLowerCase();
  if (text.includes("high registered") || text.includes("highly restricted") || text.includes("secret")) {
    return buildClassification(mail.mailId, 3, "HIGH REGISTERED", "keyword match");
  }
  if (text.includes("registered") || text.includes("restricted") || text.includes("confidential") || text.includes("contract") || text.includes("budget")) {
    return buildClassification(mail.mailId, 2, "REGISTERED", "keyword match");
  }
  if (mail.from.toLowerCase().includes("@") || mail.folder.toLowerCase().includes("inbox")) {
    return buildClassification(mail.mailId, 1, "INTERNAL", "default mail classification");
  }
  return buildClassification(mail.mailId, 0, "PUBLIC", "default mail classification");
}

export function buildQueueState(
  storeItems: StoredMail[],
  analysis: AnalysisResult,
  ignoredIds: string[],
  classifications: ClassificationCache,
  autoAnalyzeEnabled: boolean,
  maxAutoLevel: number
): AnalysisQueueState {
  const analysedIds = new Set((analysis.items || []).map((item) => item.mailId));
  const ignored = new Set(ignoredIds || []);
  const classificationById = new Map(classifications.items.map((item) => [item.mailId, item]));
  const pending = storeItems.filter((item) => !analysedIds.has(item.mailId) && !ignored.has(item.mailId));
  const allowed = pending.filter((item) => {
    const classification = classificationById.get(item.mailId);
    return Number(classification?.level || 0) <= maxAutoLevel;
  });
  const blocked = pending.filter((item) => !allowed.includes(item));
  const analysed = storeItems.filter((item) => analysedIds.has(item.mailId) && !ignored.has(item.mailId));
  const ignoredPending = storeItems.filter((item) => !analysedIds.has(item.mailId) && ignored.has(item.mailId));
  return { pending, blocked, analysed, allowed, ignoredPending };
}

export function classificationFor(mailId: string, cache: ClassificationCache): MailClassification | undefined {
  return cache.items.find((item) => item.mailId === mailId);
}

function buildClassification(mailId: string, level: number, label: string, reason: string): MailClassification {
  return {
    mailId,
    level,
    label,
    source: "default",
    reason,
    updatedAt: new Date().toISOString()
  };
}

function normalizeClassification(input: unknown): MailClassification | null {
  if (!isObject(input)) {
    return null;
  }
  const mailId = String(input.mailId || "");
  if (!mailId) {
    return null;
  }
  return {
    mailId,
    level: Number.isFinite(Number(input.level)) ? Number(input.level) : 1,
    label: String(input.label || "INTERNAL"),
    source: String(input.source || "default"),
    reason: String(input.reason || ""),
    updatedAt: String(input.updatedAt || "")
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
