export const VALID_CATEGORIES = new Set([
  "mustHandleToday",
  "risk",
  "waitingForMe",
  "followUp",
  "notice",
  "ignored",
  "uncertain"
] as const);

export const VALID_PRIORITIES = new Set(["P0", "P1", "P2", "P3"] as const);

export type Category = string;
export type Priority = "P0" | "P1" | "P2" | "P3";

const PRIORITY_RANK: Record<Priority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};

const CATEGORY_PRIORITY_RANGE: Record<string, Priority[]> = {
  importantSender: ["P0", "P1"],
  mustHandleToday: ["P0", "P1"],
  risk: ["P0", "P1"],
  waitingForMe: ["P1", "P2"],
  followUp: ["P2"],
  notice: ["P2", "P3"],
  ignored: ["P3"],
  uncertain: ["P2", "P3"]
};

export interface AnalysisSource {
  mailId?: string;
  internetMessageId?: string;
  entryId?: string;
  folder?: string;
}

export interface AnalysisEvidence {
  sourceMailId: string;
  quote: string;
  reason: string;
}

export interface DraftReplyParts {
  GREETING?: string;
  MAIN_MESSAGE?: string;
  REQUESTED_ACTION?: string;
  CLOSING?: string;
}

export interface AnalysisItem {
  mailId: string;
  category: Category;
  priority: Priority;
  subject: string;
  sender: string;
  receivedTime: string;
  summary: string;
  reason: string;
  suggestedAction: string;
  draftReply: string;
  dueDate?: string;
  draftReplyParts?: DraftReplyParts;
  confidence: number;
  needsOriginalMailCheck: boolean;
  source?: AnalysisSource;
  evidence?: AnalysisEvidence[];
}

export interface AnalysisOverview {
  totalMails: number;
  mustHandleToday: number;
  risks: number;
  waitingForMe: number;
  notices: number;
}

export interface AnalysisResult {
  generatedAt: string;
  language?: string;
  overview: AnalysisOverview;
  items: AnalysisItem[];
}

export function parseAnalysisJson(raw: string, allowedCategories?: string[]): AnalysisResult {
  const cleaned = stripCodeFence(String(raw || "").trim());
  const parsed = JSON.parse(cleaned);
  return normalizeAnalysis(parsed, allowedCategories);
}

export function stripCodeFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export function normalizeAnalysis(input: unknown, allowedCategories?: string[]): AnalysisResult {
  const analysis = isObject(input) ? input : {};
  const allowed = new Set(allowedCategories && allowedCategories.length ? allowedCategories : [...VALID_CATEGORIES]);
  const items = Array.isArray((analysis as Record<string, unknown>).items)
    ? ((analysis as Record<string, unknown>).items as unknown[]).map((item, index) => normalizeItem(item, index, allowed))
    : [];

  return {
    generatedAt: String((analysis as Record<string, unknown>).generatedAt || new Date().toISOString()),
    language: String((analysis as Record<string, unknown>).language || ""),
    overview: normalizeOverview((analysis as Record<string, unknown>).overview, items),
    items
  };
}

function normalizeOverview(overview: unknown, items: AnalysisItem[]): AnalysisOverview {
  const grouped = groupCounts(items);
  return {
    totalMails: items.length,
    mustHandleToday: grouped.mustHandleToday,
    risks: grouped.risk,
    waitingForMe: grouped.waitingForMe,
    notices: grouped.notice
  };
}

function normalizeItem(item: unknown, index: number, allowedCategories: Set<string>): AnalysisItem {
  const base = isObject(item) ? item : {};
  let category = allowedCategories.has((base as Record<string, unknown>).category as Category)
    ? ((base as Record<string, unknown>).category as Category)
    : "uncertain";
  let priority = VALID_PRIORITIES.has((base as Record<string, unknown>).priority as Priority)
    ? ((base as Record<string, unknown>).priority as Priority)
    : "P2";
  const hasNumericConfidence = typeof (base as Record<string, unknown>).confidence === "number";
  let confidence = hasNumericConfidence ? ((base as Record<string, unknown>).confidence as number) : 0;
  let needsOriginalMailCheck = Boolean((base as Record<string, unknown>).needsOriginalMailCheck);
  if (hasNumericConfidence && confidence < 0.7 && category !== "uncertain") {
    category = "uncertain";
    needsOriginalMailCheck = true;
  }
  const clampedPriority = clampPriorityForCategory(category, priority);
  if (clampedPriority !== priority) {
    priority = clampedPriority;
    if (hasNumericConfidence) {
      confidence = Math.min(confidence, 0.7);
    }
  }

  const normalized: AnalysisItem = {
    mailId: String((base as Record<string, unknown>).mailId || `mail-${String(index + 1).padStart(3, "0")}`),
    category,
    priority,
    subject: String((base as Record<string, unknown>).subject || ""),
    sender: String((base as Record<string, unknown>).sender || ""),
    receivedTime: String((base as Record<string, unknown>).receivedTime || ""),
    summary: String((base as Record<string, unknown>).summary || ""),
    reason: String((base as Record<string, unknown>).reason || ""),
    suggestedAction: String((base as Record<string, unknown>).suggestedAction || ""),
    draftReply: String((base as Record<string, unknown>).draftReply || ""),
    dueDate: normalizeDueDate((base as Record<string, unknown>).dueDate),
    confidence,
    needsOriginalMailCheck
  };

  const source = normalizeSource((base as Record<string, unknown>).source);
  if (source) {
    normalized.source = source;
  }

  const evidence = normalizeEvidence((base as Record<string, unknown>).evidence);
  if (evidence.length) {
    normalized.evidence = evidence;
  }

  const draftReplyParts = normalizeDraftReplyParts((base as Record<string, unknown>).draftReplyParts);
  if (draftReplyParts) {
    normalized.draftReplyParts = draftReplyParts;
  }

  return normalized;
}

function normalizeDueDate(value: unknown): string {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! ? text : "";
}

function clampPriorityForCategory(category: Category, priority: Priority): Priority {
  const allowed = CATEGORY_PRIORITY_RANGE[category];
  if (!allowed || allowed.includes(priority)) {
    return priority;
  }
  return allowed.reduce((best, candidate) => {
    const bestDistance = Math.abs(PRIORITY_RANK[best] - PRIORITY_RANK[priority]);
    const candidateDistance = Math.abs(PRIORITY_RANK[candidate] - PRIORITY_RANK[priority]);
    return candidateDistance < bestDistance ? candidate : best;
  }, allowed[0]);
}

function normalizeDraftReplyParts(input: unknown): DraftReplyParts | undefined {
  if (!isObject(input)) {
    return undefined;
  }

  const result: DraftReplyParts = {};
  for (const key of ["GREETING", "MAIN_MESSAGE", "REQUESTED_ACTION", "CLOSING"] as const) {
    const value = input[key];
    if (value !== undefined && value !== null && String(value)) {
      result[key] = String(value);
    }
  }

  return Object.keys(result).length ? result : undefined;
}

function normalizeSource(source: unknown): AnalysisSource | undefined {
  if (!isObject(source)) {
    return undefined;
  }

  const normalized: AnalysisSource = {};
  for (const key of ["mailId", "internetMessageId", "entryId", "folder"] as const) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value)) {
      normalized[key] = String(value);
    }
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeEvidence(evidence: unknown): AnalysisEvidence[] {
  if (!Array.isArray(evidence)) {
    return [];
  }

  return evidence
    .filter(isObject)
    .map((item) => ({
      sourceMailId: String(item.sourceMailId || ""),
      quote: String(item.quote || ""),
      reason: String(item.reason || "")
    }))
    .filter((item) => item.sourceMailId || item.quote || item.reason);
}

function groupCounts(items: AnalysisItem[]): Record<Category, number> {
  const counts: Record<Category, number> = {
    mustHandleToday: 0,
    risk: 0,
    waitingForMe: 0,
    followUp: 0,
    notice: 0,
    ignored: 0,
    uncertain: 0
  };
  for (const item of items) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  return counts;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function mergeAnalysisResults(current: AnalysisResult, next: AnalysisResult, allowedCategories?: string[]): AnalysisResult {
  const byId = new Map<string, AnalysisResult["items"][number]>();
  for (const item of current.items || []) {
    byId.set(item.mailId, item);
  }
  for (const item of next.items || []) {
    byId.set(item.mailId, item);
  }
  const items = [...byId.values()];
  return normalizeAnalysis({
    generatedAt: new Date().toISOString(),
    language: next.language || current.language || "",
    overview: {},
    items
  }, allowedCategories);
}

export function pruneAnalysisResult(analysis: AnalysisResult, retentionDays: number, allowedCategories?: string[], now: Date = new Date()): AnalysisResult {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return analysis;
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return normalizeAnalysis({
    ...analysis,
    items: analysis.items.filter((item) => {
      const received = Date.parse(String(item.receivedTime || "").replace(" ", "T"));
      return !Number.isFinite(received) || received >= cutoff;
    })
  }, allowedCategories);
}
