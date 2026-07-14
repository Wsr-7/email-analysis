import type { AnalysisResult } from "./analysis-schema";
import { createHash } from "node:crypto";
import { buildClassificationKeywords, parseClassificationLevel, parseFolders, type ClassificationKeywords } from "./config-utils";
import type { StoredMail } from "./mail-store";
import type { SecurityGateDecisionResult } from "./security-types";

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
  keywordsHash?: string;
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
    keywordsHash: String(base.keywordsHash || ""),
    items
  };
}

export function ensureClassifications(
  storeItems: StoredMail[],
  cache: ClassificationCache,
  keywords: ClassificationKeywords = buildClassificationKeywords({})
): ClassificationCache {
  const keywordsHash = createHash("sha256").update(JSON.stringify(keywords)).digest("hex");
  if (cache.keywordsHash !== keywordsHash) {
    return {
      generatedAt: new Date().toISOString(),
      keywordsHash,
      items: storeItems.map((mail) => classifyMail(mail, keywords))
    };
  }
  const byId = new Map(cache.items.map((item) => [item.mailId, item]));
  const next = [...cache.items];
  for (const mail of storeItems) {
    const existing = byId.get(mail.mailId);
    if (!existing) {
      const classification = classifyMail(mail, keywords);
      next.push(classification);
      byId.set(mail.mailId, classification);
    } else if (existing.source === "default" && existing.reason === "keyword match") {
      const refreshed = classifyMail(mail, keywords);
      const index = next.findIndex((item) => item.mailId === mail.mailId);
      if (index >= 0) {
        next[index] = refreshed;
      }
      byId.set(mail.mailId, refreshed);
    }
  }
  return {
    ...cache,
    keywordsHash,
    items: next.filter((item) => storeItems.some((mail) => mail.mailId === item.mailId))
  };
}

export function classifyMail(mail: StoredMail, keywords: ClassificationKeywords = buildClassificationKeywords({})): MailClassification {
  const text = `${mail.folder}\n${mail.subject}\n${mail.bodyExcerpt}`.toLowerCase();
  const highKeyword = keywords[3].find((keyword) => text.includes(keyword.toLowerCase()));
  if (highKeyword) {
    return buildClassification(mail.mailId, 3, "HIGH REGISTERED", `keyword match: ${highKeyword}`);
  }
  const registeredKeyword = keywords[2].find((keyword) => text.includes(keyword.toLowerCase()));
  if (registeredKeyword) {
    return buildClassification(mail.mailId, 2, "REGISTERED", `keyword match: ${registeredKeyword}`);
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
  maxAutoLevel: unknown,
  ignoredSenders: unknown = [],
  securityDecisions: ReadonlyMap<string, SecurityGateDecisionResult> = new Map()
): AnalysisQueueState {
  const analysedIds = new Set((analysis.items || []).map((item) => item.mailId));
  const ignored = new Set(ignoredIds || []);
  const ignoredBySender = new Set(
    storeItems.filter((item) => matchesIgnoredSender(item.from, ignoredSenders)).map((item) => item.mailId)
  );
  const classificationById = new Map(classifications.items.map((item) => [item.mailId, item]));
  const allowedMaxLevel = parseClassificationLevel(maxAutoLevel, 2);
  const pending = storeItems.filter((item) => !analysedIds.has(item.mailId) && !ignored.has(item.mailId) && !ignoredBySender.has(item.mailId));
  const allowed = pending.filter((item) => {
    const classification = classificationById.get(item.mailId);
    const securityDecision = securityDecisions.get(item.mailId)?.decision;
    return Number(classification?.level || 0) <= allowedMaxLevel && securityDecision !== "block" && securityDecision !== "manual_confirm";
  });
  const blocked = pending.filter((item) => !allowed.includes(item));
  const analysed = storeItems.filter((item) => analysedIds.has(item.mailId) && !ignored.has(item.mailId));
  const ignoredPending = storeItems.filter((item) => !analysedIds.has(item.mailId) && (ignored.has(item.mailId) || ignoredBySender.has(item.mailId)));
  return { pending, blocked, analysed, allowed, ignoredPending };
}

export function matchesIgnoredSender(sender: string, ignoredSenders: unknown): boolean {
  const normalizedSender = String(sender || "").toLowerCase();
  return parseFolders(ignoredSenders, []).some((item) => normalizedSender.includes(item.toLowerCase()));
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
