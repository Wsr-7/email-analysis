import type { ThreadMessage, ThreadRecord, ThreadSecuritySummary, ThreadStore } from "../domain/thread-schema";

export type { ThreadContentStatus, ThreadMessage, ThreadRecord, ThreadSecuritySummary, ThreadStore } from "../domain/thread-schema";

export function emptyThreadStore(): ThreadStore {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    lastBuiltAt: "",
    items: []
  };
}

export function normalizeThreadStore(input: unknown): ThreadStore {
  const base = isObject(input) ? input : {};
  const items = Array.isArray(base.items)
    ? base.items.map(normalizeThreadRecord).filter(Boolean) as ThreadRecord[]
    : [];
  return {
    generatedAt: String(base.generatedAt || new Date().toISOString()),
    lastBuiltAt: String(base.lastBuiltAt || ""),
    items
  };
}

export function pruneThreadStore(store: ThreadStore, retentionDays: number, now: Date = new Date()): ThreadStore {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return store;
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return {
    ...store,
    items: store.items.filter((item) => {
      const last = parseDate(item.lastTime) || latestTimelineTime(item.timeline);
      return !Number.isFinite(last) || last >= cutoff;
    })
  };
}

export function mergeThreadStores(existing: ThreadStore, incoming: ThreadStore): ThreadStore {
  const byId = new Map<string, ThreadRecord>();
  for (const item of existing.items || []) {
    byId.set(item.threadId, item);
  }
  for (const item of incoming.items || []) {
    byId.set(item.threadId, mergeThreadRecord(byId.get(item.threadId), item));
  }

  return {
    generatedAt: existing.generatedAt || incoming.generatedAt || new Date().toISOString(),
    lastBuiltAt: incoming.lastBuiltAt || existing.lastBuiltAt || "",
    items: [...byId.values()].sort(compareThreadRecords)
  };
}

function mergeThreadRecord(existing: ThreadRecord | undefined, incoming: ThreadRecord): ThreadRecord {
  if (!existing) {
    return incoming;
  }
  const timelineById = new Map<string, ThreadMessage>();
  for (const item of existing.timeline || []) {
    timelineById.set(item.mailId, item);
  }
  for (const item of incoming.timeline || []) {
    timelineById.set(item.mailId, item);
  }
  const timeline = [...timelineById.values()].sort(compareThreadMessages);
  return normalizeThreadRecord({
    ...existing,
    ...incoming,
    participants: unique([...(existing.participants || []), ...(incoming.participants || [])]),
    folders: unique([...(existing.folders || []), ...(incoming.folders || [])]),
    sourceMailIds: unique([...(existing.sourceMailIds || []), ...(incoming.sourceMailIds || [])]),
    timeline,
    messageCount: timeline.length,
    unreadCount: Math.max(existing.unreadCount || 0, incoming.unreadCount || 0),
    hasAttachments: existing.hasAttachments || incoming.hasAttachments,
    startTime: firstTimelineTime(timeline),
    lastTime: latestTimelineTimeString(timeline),
    contentStatus: normalizeContentStatus("", timeline)
  }) as ThreadRecord;
}

function normalizeThreadRecord(input: unknown): ThreadRecord | null {
  if (!isObject(input)) {
    return null;
  }
  const threadId = String(input.threadId || "");
  if (!threadId) {
    return null;
  }
  const timeline = Array.isArray(input.timeline)
    ? input.timeline.map(normalizeThreadMessage).filter(Boolean) as ThreadMessage[]
    : [];
  timeline.sort(compareThreadMessages);
  const messageCount = positiveNumber(input.messageCount, timeline.length);
  return {
    threadId,
    conversationId: String(input.conversationId || ""),
    normalizedSubject: String(input.normalizedSubject || normalizeSubjectValue(String(input.subject || ""))),
    subject: String(input.subject || ""),
    participants: stringArray(input.participants),
    folders: stringArray(input.folders),
    startTime: String(input.startTime || firstTimelineTime(timeline)),
    lastTime: String(input.lastTime || lastTimelineTime(timeline)),
    messageCount,
    unreadCount: positiveNumber(input.unreadCount, 0),
    hasAttachments: Boolean(input.hasAttachments),
    sourceMailIds: stringArray(input.sourceMailIds),
    timeline,
    contentStatus: normalizeContentStatus(input.contentStatus, timeline),
    security: normalizeSecurity(input.security)
  };
}

function normalizeThreadMessage(input: unknown): ThreadMessage | null {
  if (!isObject(input)) {
    return null;
  }
  const mailId = String(input.mailId || "");
  if (!mailId) {
    return null;
  }
  const bodyPreview = String(input.bodyPreview || input.bodyDelta || input.bodyClean || "");
  return {
    mailId,
    internetMessageId: String(input.internetMessageId || ""),
    entryId: String(input.entryId || ""),
    conversationId: String(input.conversationId || ""),
    conversationIndex: String(input.conversationIndex || ""),
    subject: String(input.subject || ""),
    from: String(input.from || ""),
    senderName: String(input.senderName || ""),
    senderEmail: String(input.senderEmail || ""),
    receivedTime: String(input.receivedTime || ""),
    sentTime: String(input.sentTime || ""),
    folder: String(input.folder || ""),
    bodyPreview,
    bodyClean: String(input.bodyClean || bodyPreview),
    bodyDelta: String(input.bodyDelta || bodyPreview),
    bodyHash: String(input.bodyHash || ""),
    isDuplicateBody: Boolean(input.isDuplicateBody),
    duplicateOfId: input.duplicateOfId ? String(input.duplicateOfId) : undefined,
    contentAvailable: Boolean(input.contentAvailable || bodyPreview),
    attachmentCount: positiveNumber(input.attachmentCount, 0),
    attachmentNames: stringArray(input.attachmentNames)
  };
}

function normalizeSecurity(input: unknown): ThreadSecuritySummary | undefined {
  if (!isObject(input)) {
    return undefined;
  }
  return {
    totalMessages: positiveNumber(input.totalMessages, 0),
    allowedMessages: positiveNumber(input.allowedMessages, 0),
    manualConfirmMessages: positiveNumber(input.manualConfirmMessages, 0),
    blockedMessages: positiveNumber(input.blockedMessages, 0),
    highestClassificationLevel: positiveNumber(input.highestClassificationLevel, 0),
    partialContext: Boolean(input.partialContext),
    reasons: stringArray(input.reasons)
  };
}

function normalizeContentStatus(input: unknown, timeline: ThreadMessage[]): "available" | "partial" | "metadataOnly" {
  if (input === "available" || input === "partial" || input === "metadataOnly") {
    return input;
  }
  const available = timeline.filter((item) => item.contentAvailable).length;
  if (available === 0) {
    return "metadataOnly";
  }
  return available === timeline.length ? "available" : "partial";
}

function firstTimelineTime(timeline: ThreadMessage[]): string {
  return timeline[0]?.receivedTime || timeline[0]?.sentTime || "";
}

function lastTimelineTime(timeline: ThreadMessage[]): string {
  const last = timeline[timeline.length - 1];
  return last?.receivedTime || last?.sentTime || "";
}

function latestTimelineTime(timeline: ThreadMessage[]): number {
  let latest = NaN;
  for (const item of timeline) {
    const value = parseDate(item.receivedTime) || parseDate(item.sentTime);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (!Number.isFinite(latest) || value > latest) {
      latest = value;
    }
  }
  return latest;
}

function latestTimelineTimeString(timeline: ThreadMessage[]): string {
  let latest = "";
  let latestValue = NaN;
  for (const item of timeline) {
    const value = parseDate(item.receivedTime) || parseDate(item.sentTime);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (!Number.isFinite(latestValue) || value > latestValue) {
      latestValue = value;
      latest = item.receivedTime || item.sentTime;
    }
  }
  return latest || lastTimelineTime(timeline);
}

function compareThreadRecords(a: ThreadRecord, b: ThreadRecord): number {
  const byTime = String(b.lastTime || "").localeCompare(String(a.lastTime || ""));
  return byTime || a.threadId.localeCompare(b.threadId);
}

function compareThreadMessages(a: ThreadMessage, b: ThreadMessage): number {
  if (a.conversationIndex && b.conversationIndex && a.conversationIndex !== b.conversationIndex) {
    return a.conversationIndex.localeCompare(b.conversationIndex);
  }
  const byTime = String(a.receivedTime || a.sentTime || "").localeCompare(String(b.receivedTime || b.sentTime || ""));
  return byTime || a.mailId.localeCompare(b.mailId);
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function positiveNumber(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeSubjectValue(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function parseDate(value: string): number {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
