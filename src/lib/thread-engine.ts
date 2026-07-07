import type { StoredMail } from "./mail-store";
import type { ThreadContentStatus, ThreadMessage, ThreadRecord, ThreadStore } from "./thread-schema";
import { cleanMailBody, extractReplyDelta, markDuplicateBodies } from "./thread-timeline";

type InternalThreadMessage = ThreadMessage & {
  normalizedSubject: string;
  sourceMailId: string;
  unread: string;
};

export function buildThreadStore(mails: StoredMail[], builtAt: string = new Date().toISOString()): ThreadStore {
  return {
    generatedAt: builtAt,
    lastBuiltAt: builtAt,
    items: buildThreadRecords(mails)
  };
}

export function buildThreadRecords(mails: StoredMail[]): ThreadRecord[] {
  const groups = new Map<string, InternalThreadMessage[]>();

  for (const mail of mails) {
    const message = toThreadMessage(mail);
    const key = threadGroupKey(message);
    groups.set(key, [...(groups.get(key) || []), message]);
  }

  return [...groups.entries()]
    .map(([key, timeline]) => buildThreadRecord(key, timeline))
    .sort(compareThreadRecords);
}

export function normalizeThreadSubject(subject: string): string {
  let value = String(subject || "").trim();
  let previous = "";
  while (value && value !== previous) {
    previous = value;
    value = value.replace(/^(re|fw|fwd|答复|回复|转发)\s*[:：]\s*/i, "").trim();
  }
  return value.replace(/\s+/g, " ").toLowerCase();
}

function buildThreadRecord(key: string, messages: InternalThreadMessage[]): ThreadRecord {
  const sorted = [...messages].sort(compareThreadMessages);
  const timeline = markDuplicateBodies(
    sorted.map((item) => ({ ...item, id: item.mailId, body: item.bodyClean }))
  ).map(({ id, body, ...message }) => message);
  const first = timeline[0];
  const conversationId = first?.conversationId || "";
  const normalizedSubject = first?.normalizedSubject || normalizeThreadSubject(first?.subject || "");
  const contentStatus = getContentStatus(timeline);
  return {
    threadId: stableThreadId(key),
    conversationId,
    normalizedSubject,
    subject: first?.subject || normalizedSubject,
    participants: unique(timeline.map(participantName).filter(Boolean)),
    folders: unique(timeline.map((item) => item.folder).filter(Boolean)),
    startTime: first?.receivedTime || first?.sentTime || "",
    lastTime: lastTime(timeline),
    messageCount: timeline.length,
    unreadCount: timeline.filter((item) => isUnread(item)).length,
    hasAttachments: timeline.some((item) => item.attachmentCount > 0 || item.attachmentNames.length > 0),
    sourceMailIds: timeline.map((item) => sourceMailId(item)).filter(Boolean),
    timeline,
    contentStatus
  };
}

function toThreadMessage(mail: StoredMail): InternalThreadMessage {
  const subject = stringField(mail, "subject");
  const body = stringField(mail, "bodyExcerpt");
  const senderName = stringField(mail, "senderName");
  const senderEmail = stringField(mail, "senderEmail");
  return {
    mailId: stringField(mail, "mailId"),
    internetMessageId: stringField(mail, "internetMessageId"),
    entryId: stringField(mail, "entryId"),
    conversationId: stringField(mail, "conversationId"),
    conversationIndex: stringField(mail, "conversationIndex"),
    subject,
    from: stringField(mail, "from"),
    senderName,
    senderEmail,
    receivedTime: stringField(mail, "receivedTime"),
    sentTime: stringField(mail, "sentTime"),
    folder: stringField(mail, "folder"),
    bodyPreview: body,
    bodyClean: cleanMailBody(body),
    bodyDelta: extractReplyDelta(body),
    bodyHash: stringField(mail, "bodyHash"),
    isDuplicateBody: false,
    contentAvailable: Boolean(body.trim()),
    attachmentCount: numberField(mail, "attachmentCount"),
    attachmentNames: stringArrayField(mail, "attachmentNames"),
    normalizedSubject: normalizeThreadSubject(subject),
    sourceMailId: stringField(mail, "sourceMailId") || stringField(mail, "mailId"),
    unread: stringField(mail, "unread")
  };
}

function threadGroupKey(message: InternalThreadMessage): string {
  if (message.conversationId.trim()) {
    return `conversation:${message.conversationId.trim()}`;
  }
  if (message.normalizedSubject) {
    return `subject:${message.normalizedSubject}`;
  }
  return `mail:${message.mailId}`;
}

function stableThreadId(groupKey: string): string {
  return groupKey;
}

function compareThreadMessages(a: ThreadMessage, b: ThreadMessage): number {
  if (a.conversationIndex && b.conversationIndex && a.conversationIndex !== b.conversationIndex) {
    return a.conversationIndex.localeCompare(b.conversationIndex);
  }
  const timeCompare = compareTime(a.receivedTime || a.sentTime, b.receivedTime || b.sentTime);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return a.mailId.localeCompare(b.mailId);
}

function compareThreadRecords(a: ThreadRecord, b: ThreadRecord): number {
  const timeCompare = compareTime(b.lastTime, a.lastTime);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return a.threadId.localeCompare(b.threadId);
}

function compareTime(a: string, b: string): number {
  const left = parseDate(a);
  const right = parseDate(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) {
    return left - right;
  }
  return String(a || "").localeCompare(String(b || ""));
}

function lastTime(timeline: ThreadMessage[]): string {
  let latestTime = "";
  let latestValue = NaN;
  for (const item of timeline) {
    const value = parseDate(item.receivedTime) || parseDate(item.sentTime);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (!Number.isFinite(latestValue) || value > latestValue) {
      latestValue = value;
      latestTime = item.receivedTime || item.sentTime;
    }
  }
  return latestTime || timeline[timeline.length - 1]?.receivedTime || timeline[timeline.length - 1]?.sentTime || "";
}

function getContentStatus(timeline: ThreadMessage[]): ThreadContentStatus {
  const available = timeline.filter((item) => item.contentAvailable).length;
  if (available === 0) {
    return "metadataOnly";
  }
  return available === timeline.length ? "available" : "partial";
}

function participantName(message: ThreadMessage): string {
  if (message.senderName && message.senderEmail) {
    return `${message.senderName} <${message.senderEmail}>`;
  }
  return message.senderEmail || message.senderName || message.from;
}

function sourceMailId(message: InternalThreadMessage): string {
  return message.sourceMailId || message.mailId;
}

function isUnread(message: InternalThreadMessage): boolean {
  const value = message.unread.toLowerCase();
  return value === "true" || value === "yes" || value === "1";
}

function stringField(input: object, key: string): string {
  const value = (input as unknown as Record<string, unknown>)[key];
  return String(value ?? "");
}

function numberField(input: object, key: string): number {
  const value = Number((input as unknown as Record<string, unknown>)[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function stringArrayField(input: object, key: string): string[] {
  const value = (input as unknown as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function parseDate(value: string): number {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : NaN;
}
