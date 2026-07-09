import { stripCodeFence, VALID_CATEGORIES, VALID_PRIORITIES, type Priority } from "./analysis-schema";

export interface ThreadAnalysisResult {
  generatedAt: string;
  language?: string;
  overview: ThreadAnalysisOverview;
  items: ThreadAnalysisItem[];
}

export interface ThreadAnalysisOverview {
  totalThreads: number;
  mustHandleToday: number;
  risks: number;
  waitingForMe: number;
  notices: number;
}

export interface ThreadAnalysisItem {
  threadId: string;
  category: string;
  priority: Priority;
  subject: string;
  participants: string[];
  lastTime: string;
  oneLineSummary: string;
  currentStatus: string;
  keyDecisions: string[];
  openQuestions: string[];
  actionItems: ThreadActionItem[];
  waitingOn: string[];
  risks: ThreadRisk[];
  needMyReply: boolean;
  suggestedAction: string;
  draftReply: string;
  confidence: number;
  evidence: ThreadEvidence[];
  needsOriginalMailCheck: boolean;
  partialContext: boolean;
}

export interface ThreadActionItem {
  owner: string;
  task: string;
  deadline: string;
  sourceMailId: string;
  sourceTime: string;
}

export interface ThreadRisk {
  level: "low" | "medium" | "high";
  description: string;
  sourceMailId: string;
}

export interface ThreadEvidence {
  sourceMailId: string;
  quote: string;
  reason: string;
}

export function parseThreadAnalysisJson(raw: string, allowedCategories?: string[]): ThreadAnalysisResult {
  return normalizeThreadAnalysis(JSON.parse(stripCodeFence(String(raw || "").trim())), allowedCategories);
}

export function normalizeThreadAnalysis(input: unknown, allowedCategories?: string[]): ThreadAnalysisResult {
  const analysis = isObject(input) ? input : {};
  const allowed = new Set(allowedCategories && allowedCategories.length ? allowedCategories : [...VALID_CATEGORIES]);
  const items = Array.isArray(analysis.items)
    ? analysis.items.map((item, index) => normalizeThreadItem(item, index, allowed))
    : [];

  return {
    generatedAt: String(analysis.generatedAt || new Date().toISOString()),
    language: String(analysis.language || ""),
    overview: normalizeOverview(analysis.overview, items),
    items
  };
}

function normalizeOverview(overview: unknown, items: ThreadAnalysisItem[]): ThreadAnalysisOverview {
  const base = isObject(overview) ? overview : {};
  const grouped = groupCounts(items);
  return {
    totalThreads: numberOr(base.totalThreads, items.length),
    mustHandleToday: numberOr(base.mustHandleToday, grouped.mustHandleToday),
    risks: numberOr(base.risks, grouped.risk),
    waitingForMe: numberOr(base.waitingForMe, grouped.waitingForMe),
    notices: numberOr(base.notices, grouped.notice)
  };
}

function normalizeThreadItem(input: unknown, index: number, allowedCategories: Set<string>): ThreadAnalysisItem {
  const item = isObject(input) ? input : {};
  const category = allowedCategories.has(String(item.category)) ? String(item.category) : "uncertain";
  const priority = VALID_PRIORITIES.has(item.priority as Priority) ? item.priority as Priority : "P2";

  return {
    threadId: String(item.threadId || `thread-${String(index + 1).padStart(3, "0")}`),
    category,
    priority,
    subject: String(item.subject || ""),
    participants: stringArray(item.participants),
    lastTime: String(item.lastTime || ""),
    oneLineSummary: String(item.oneLineSummary || ""),
    currentStatus: String(item.currentStatus || ""),
    keyDecisions: stringArray(item.keyDecisions),
    openQuestions: stringArray(item.openQuestions),
    actionItems: normalizeActionItems(item.actionItems),
    waitingOn: stringArray(item.waitingOn),
    risks: normalizeRisks(item.risks),
    needMyReply: Boolean(item.needMyReply),
    suggestedAction: String(item.suggestedAction || ""),
    draftReply: String(item.draftReply || ""),
    confidence: numberOr(item.confidence, 0),
    evidence: normalizeEvidence(item.evidence),
    needsOriginalMailCheck: Boolean(item.needsOriginalMailCheck),
    partialContext: Boolean(item.partialContext)
  };
}

function normalizeActionItems(input: unknown): ThreadActionItem[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter(isObject).map((item) => ({
    owner: String(item.owner || ""),
    task: String(item.task || ""),
    deadline: String(item.deadline || ""),
    sourceMailId: String(item.sourceMailId || ""),
    sourceTime: String(item.sourceTime || "")
  })).filter((item) => item.owner || item.task || item.deadline || item.sourceMailId || item.sourceTime);
}

function normalizeRisks(input: unknown): ThreadRisk[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter(isObject).map((item) => ({
    level: normalizeRiskLevel(item.level),
    description: String(item.description || ""),
    sourceMailId: String(item.sourceMailId || "")
  })).filter((item) => item.description || item.sourceMailId);
}

function normalizeRiskLevel(input: unknown): ThreadRisk["level"] {
  return input === "high" || input === "medium" || input === "low" ? input : "medium";
}

function normalizeEvidence(input: unknown): ThreadEvidence[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter(isObject).map((item) => ({
    sourceMailId: String(item.sourceMailId || ""),
    quote: String(item.quote || ""),
    reason: String(item.reason || "")
  })).filter((item) => item.sourceMailId || item.quote || item.reason);
}

function groupCounts(items: ThreadAnalysisItem[]): Record<string, number> {
  const counts: Record<string, number> = {
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

function stringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function numberOr(value: unknown, fallback: number): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function mergeThreadAnalysisResults(current: ThreadAnalysisResult, next: ThreadAnalysisResult, allowedCategories?: string[]): ThreadAnalysisResult {
  const byId = new Map<string, ThreadAnalysisResult["items"][number]>();
  for (const item of current.items || []) {
    byId.set(item.threadId, item);
  }
  for (const item of next.items || []) {
    byId.set(item.threadId, item);
  }
  return normalizeThreadAnalysis({
    generatedAt: new Date().toISOString(),
    language: next.language || current.language || "",
    overview: {},
    items: [...byId.values()]
  }, allowedCategories);
}
