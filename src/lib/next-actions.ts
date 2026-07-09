import type { ThreadAnalysisItem, ThreadActionItem } from "./thread-analysis-schema";

export type NextActionStatus = "open" | "done" | "ignored";

export interface NextActionItem {
  id: string;
  sourceType: "thread";
  sourceId: string;
  sourceMailId: string;
  sourceTime: string;
  owner: string;
  task: string;
  deadline: string;
  status: NextActionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NextActionsStore {
  items: NextActionItem[];
}

export function nextActionDedupeKey(sourceType: string, sourceId: string, task: string): string {
  return `${sourceType}:${sourceId}:${normalizeTask(task)}`;
}

function normalizeTask(task: string): string {
  return task.trim().toLowerCase().replace(/\s+/g, " ");
}

export function extractNextActions(threadAnalysis: ThreadAnalysisItem): NextActionItem[] {
  const now = new Date().toISOString();
  return threadAnalysis.actionItems
    .filter((a) => a.task.trim())
    .map((a) => ({
      id: nextActionDedupeKey("thread", threadAnalysis.threadId, a.task),
      sourceType: "thread" as const,
      sourceId: threadAnalysis.threadId,
      sourceMailId: a.sourceMailId,
      sourceTime: a.sourceTime,
      owner: a.owner,
      task: a.task,
      deadline: a.deadline,
      status: "open" as NextActionStatus,
      createdAt: now,
      updatedAt: now,
    }));
}

export function mergeNextActions(existing: NextActionsStore, incoming: NextActionItem[]): NextActionsStore {
  const byId = new Map<string, NextActionItem>();
  for (const item of existing.items) {
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    const prev = byId.get(item.id);
    if (prev) {
      // preserve user-set status; update source fields
      byId.set(item.id, {
        ...item,
        status: prev.status,
        createdAt: prev.createdAt,
        updatedAt: prev.updatedAt,
      });
    } else {
      byId.set(item.id, item);
    }
  }
  return { items: [...byId.values()] };
}

export function updateNextActionStatus(store: NextActionsStore, id: string, status: NextActionStatus): NextActionsStore {
  return {
    items: store.items.map((item) =>
      item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item
    ),
  };
}

export function getOpenNextActions(store: NextActionsStore): NextActionItem[] {
  return store.items.filter((item) => item.status === "open");
}

export function normalizeNextActionsStore(input: unknown): NextActionsStore {
  if (!input || typeof input !== "object") {
    return { items: [] };
  }
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.items)) {
    return { items: [] };
  }
  return {
    items: raw.items.filter((item): item is NextActionItem =>
      !!item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
    ),
  };
}
