import * as crypto from "node:crypto";
import type { DigestData, DigestItem } from "./digest";

export interface StoredMail {
  mailId: string;
  sourceMailId: string;
  internetMessageId: string;
  entryId: string;
  storeId?: string;
  conversationId?: string;
  conversationIndex?: string;
  subject: string;
  from: string;
  senderName?: string;
  senderEmail?: string;
  receivedTime: string;
  sentTime?: string;
  folder: string;
  unread: string;
  importance: string;
  toMe: string;
  ccMe: string;
  to?: string;
  cc?: string;
  attachmentCount?: number;
  attachmentNames?: string[];
  bodyExcerpt: string;
  bodyHash?: string;
  pulledAt: string;
}

export interface MailStore {
  generatedAt: string;
  lastPullAt: string;
  items: StoredMail[];
}

export interface MailIndexItem {
  mailId: string;
  sourceMailId: string;
  internetMessageId: string;
  entryId: string;
  storeId?: string;
  receivedTime: string;
  folder: string;
  lastSeenAt: string;
}

export interface MailFolderAnchor {
  folder: string;
  newestReceivedTime: string;
  oldestReceivedTime: string;
  lastSeenAt: string;
}

export interface MailIndex {
  generatedAt: string;
  lastPullAt: string;
  folderAnchors: Record<string, MailFolderAnchor>;
  items: MailIndexItem[];
}

export interface MailStoreMergeResult {
  store: MailStore;
  added: number;
  skipped: number;
}

export function emptyMailStore(): MailStore {
  return {
    generatedAt: new Date().toISOString(),
    lastPullAt: "",
    items: []
  };
}

export function normalizeMailStore(input: unknown): MailStore {
  const base = isObject(input) ? input : {};
  const items = Array.isArray(base.items) ? base.items.map(normalizeStoredMail).filter(Boolean) as StoredMail[] : [];
  return {
    generatedAt: String(base.generatedAt || new Date().toISOString()),
    lastPullAt: String(base.lastPullAt || ""),
    items
  };
}

export function emptyMailIndex(): MailIndex {
  return {
    generatedAt: new Date().toISOString(),
    lastPullAt: "",
    folderAnchors: {},
    items: []
  };
}

export function normalizeMailIndex(input: unknown): MailIndex {
  const base = isObject(input) ? input : {};
  const items = Array.isArray(base.items) ? base.items.map(normalizeMailIndexItem).filter(Boolean) as MailIndexItem[] : [];
  const folderAnchors = normalizeFolderAnchors(base.folderAnchors, items);
  return {
    generatedAt: String(base.generatedAt || new Date().toISOString()),
    lastPullAt: String(base.lastPullAt || ""),
    folderAnchors,
    items
  };
}

export function mergeDigestIntoStore(store: MailStore, digest: DigestData, knownMailIds: string[] = []): MailStoreMergeResult {
  const existing = new Set([...store.items.map((item) => item.mailId), ...knownMailIds]);
  const nextItems = [...store.items];
  let added = 0;
  let skipped = 0;
  const pulledAt = digest.metadata.generatedAt || new Date().toISOString();

  for (const digestItem of digest.items) {
    if (!isAcceptableMailDate(String(digestItem.receivedTime || digestItem.sentTime || ""))) {
      skipped += 1;
      continue;
    }
    const mail = digestItemToStoredMail(digestItem, pulledAt);
    if (existing.has(mail.mailId)) {
      skipped += 1;
      continue;
    }
    existing.add(mail.mailId);
    nextItems.push(mail);
    added += 1;
  }

  nextItems.sort(compareStoredMail);
  return {
    store: {
      ...store,
      lastPullAt: pulledAt,
      items: nextItems
    },
    added,
    skipped
  };
}

export function mergeDigestIntoIndex(index: MailIndex, digest: DigestData): MailIndex {
  const byId = new Map(index.items.map((item) => [item.mailId, item]));
  const seenAt = digest.metadata.generatedAt || new Date().toISOString();
  for (const digestItem of digest.items) {
    if (!isAcceptableMailDate(String(digestItem.receivedTime || digestItem.sentTime || ""))) {
      continue;
    }
    const mail = digestItemToStoredMail(digestItem, seenAt);
    byId.set(mail.mailId, {
      mailId: mail.mailId,
      sourceMailId: mail.sourceMailId,
      internetMessageId: mail.internetMessageId,
      entryId: mail.entryId,
      storeId: mail.storeId,
      receivedTime: mail.receivedTime,
      folder: mail.folder,
      lastSeenAt: seenAt
    });
  }
  return {
    ...index,
    lastPullAt: seenAt,
    folderAnchors: buildFolderAnchors([...byId.values()], index.folderAnchors, seenAt),
    items: [...byId.values()].sort(compareMailIndexItems)
  };
}

export function isAcceptableMailDate(value: string): boolean {
  const year = Number(String(value || "").slice(0, 4));
  return Number.isFinite(year) && year >= 1990 && year <= 2100;
}

export function digestItemToStoredMail(item: DigestItem, pulledAt: string): StoredMail {
  return {
    mailId: stableMailId(item),
    sourceMailId: item.mailId,
    internetMessageId: item.internetMessageId,
    entryId: item.entryId,
    storeId: stringValue(item.storeId),
    conversationId: stringValue(item.conversationId),
    conversationIndex: stringValue(item.conversationIndex),
    subject: item.subject,
    from: item.from,
    senderName: stringValue(item.senderName),
    senderEmail: stringValue(item.senderEmail),
    receivedTime: item.receivedTime,
    sentTime: stringValue(item.sentTime),
    folder: item.folder,
    unread: item.unread,
    importance: item.importance,
    toMe: item.toMe,
    ccMe: item.ccMe,
    to: stringValue(item.to),
    cc: stringValue(item.cc),
    attachmentCount: numberValue(item.attachmentCount),
    attachmentNames: arrayValue(item.attachmentNames),
    bodyExcerpt: item.bodyExcerpt,
    bodyHash: hashText(item.bodyExcerpt),
    pulledAt
  };
}

export function stableMailId(item: DigestItem): string {
  if (item.internetMessageId.trim()) {
    return `internet:${item.internetMessageId.trim()}`;
  }
  if (item.entryId.trim()) {
    return `entry:${item.entryId.trim()}`;
  }
  const source = [
    item.folder,
    item.receivedTime,
    item.from,
    item.subject,
    item.bodyExcerpt
  ].join("\n");
  return `mail-${crypto.createHash("sha256").update(source).digest("hex").slice(0, 16)}`;
}

export function pruneMailStore(store: MailStore, retentionDays: number, now: Date = new Date()): MailStore {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return store;
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return {
    ...store,
    items: store.items.filter((item) => {
      const pulled = parseDate(item.pulledAt) || parseDate(item.receivedTime);
      return !Number.isFinite(pulled) || pulled >= cutoff;
    })
  };
}

export function pruneMailIndex(index: MailIndex, retentionDays: number, now: Date = new Date()): MailIndex {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return index;
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const items = index.items.filter((item) => {
    const seen = parseDate(item.lastSeenAt) || parseDate(item.receivedTime);
    return !Number.isFinite(seen) || seen >= cutoff;
  });
  return {
    ...index,
    folderAnchors: buildFolderAnchors(items, {}, index.lastPullAt),
    items
  };
}

export function folderOldestReceivedTimes(index: MailIndex, folders: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const folder of folders) {
    const key = normalizeFolderName(folder);
    const anchor = index.folderAnchors[key];
    if (anchor?.oldestReceivedTime) {
      result[folder] = anchor.oldestReceivedTime;
    }
  }
  return result;
}

export function removeStoredMailByIds(store: MailStore, mailIds: string[]): MailStore {
  const remove = new Set(mailIds);
  return {
    ...store,
    items: store.items.filter((item) => !remove.has(item.mailId))
  };
}

export function buildBatchDigestMarkdown(items: StoredMail[]): string {
  const lines: string[] = ["# Outlook Mail Digest", ""];
  lines.push(`GeneratedAt: ${new Date().toISOString()}`);
  lines.push("RangeMode: batch");
  lines.push("RecentHours: 0");
  lines.push(`MaxItems: ${items.length}`);
  lines.push("Folders:");
  for (const folder of unique(items.map((item) => item.folder).filter(Boolean))) {
    lines.push(`- ${folder}`);
  }
  lines.push("");
  lines.push("---");

  for (const item of items) {
    lines.push("");
    lines.push(`## Mail: ${item.mailId}`);
    lines.push("");
    lines.push(`Subject: ${item.subject}`);
    lines.push(`From: ${item.from}`);
    lines.push(`ReceivedTime: ${item.receivedTime}`);
    lines.push(`Folder: ${item.folder}`);
    lines.push(`Unread: ${item.unread}`);
    lines.push(`Importance: ${item.importance}`);
    lines.push(`ToMe: ${item.toMe}`);
    lines.push(`CcMe: ${item.ccMe}`);
    lines.push("");
    lines.push("BodyExcerpt:");
    lines.push(item.bodyExcerpt);
    lines.push("");
    lines.push("---");
  }

  return lines.join("\n");
}

function normalizeStoredMail(input: unknown): StoredMail | null {
  if (!isObject(input)) {
    return null;
  }
  const mailId = String(input.mailId || "");
  if (!mailId) {
    return null;
  }
  return {
    mailId,
    sourceMailId: String(input.sourceMailId || ""),
    internetMessageId: String(input.internetMessageId || ""),
    entryId: String(input.entryId || ""),
    storeId: String(input.storeId || ""),
    conversationId: String(input.conversationId || ""),
    conversationIndex: String(input.conversationIndex || ""),
    subject: String(input.subject || ""),
    from: String(input.from || ""),
    senderName: String(input.senderName || ""),
    senderEmail: String(input.senderEmail || ""),
    receivedTime: String(input.receivedTime || ""),
    sentTime: String(input.sentTime || ""),
    folder: String(input.folder || ""),
    unread: String(input.unread || ""),
    importance: String(input.importance || ""),
    toMe: String(input.toMe || ""),
    ccMe: String(input.ccMe || ""),
    to: String(input.to || ""),
    cc: String(input.cc || ""),
    attachmentCount: numberValue(input.attachmentCount),
    attachmentNames: arrayValue(input.attachmentNames),
    bodyExcerpt: String(input.bodyExcerpt || ""),
    bodyHash: String(input.bodyHash || hashText(String(input.bodyExcerpt || ""))),
    pulledAt: String(input.pulledAt || "")
  };
}

function normalizeMailIndexItem(input: unknown): MailIndexItem | null {
  if (!isObject(input)) {
    return null;
  }
  const mailId = String(input.mailId || "");
  if (!mailId) {
    return null;
  }
  return {
    mailId,
    sourceMailId: String(input.sourceMailId || ""),
    internetMessageId: String(input.internetMessageId || ""),
    entryId: String(input.entryId || ""),
    storeId: String(input.storeId || ""),
    receivedTime: String(input.receivedTime || ""),
    folder: String(input.folder || ""),
    lastSeenAt: String(input.lastSeenAt || "")
  };
}

function normalizeFolderAnchors(input: unknown, items: MailIndexItem[]): Record<string, MailFolderAnchor> {
  if (!isObject(input)) {
    return buildFolderAnchors(items, {}, "");
  }
  const anchors: Record<string, MailFolderAnchor> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isObject(value)) {
      continue;
    }
    const folder = String(value.folder || key).trim();
    if (!folder) {
      continue;
    }
    anchors[normalizeFolderName(folder)] = {
      folder,
      newestReceivedTime: String(value.newestReceivedTime || ""),
      oldestReceivedTime: String(value.oldestReceivedTime || ""),
      lastSeenAt: String(value.lastSeenAt || "")
    };
  }
  return buildFolderAnchors(items, anchors, "");
}

function buildFolderAnchors(items: MailIndexItem[], previous: Record<string, MailFolderAnchor>, seenAt: string): Record<string, MailFolderAnchor> {
  const byFolder = new Map<string, MailIndexItem[]>();
  for (const item of items) {
    const key = normalizeFolderName(item.folder);
    if (!key) {
      continue;
    }
    byFolder.set(key, [...(byFolder.get(key) || []), item]);
  }

  const anchors: Record<string, MailFolderAnchor> = {};
  for (const [key, folderItems] of byFolder) {
    const sorted = [...folderItems].sort(compareMailIndexItems);
    const previousAnchor = previous[key];
    anchors[key] = {
      folder: sorted[0]?.folder || previousAnchor?.folder || key,
      newestReceivedTime: sorted[0]?.receivedTime || previousAnchor?.newestReceivedTime || "",
      oldestReceivedTime: sorted[sorted.length - 1]?.receivedTime || previousAnchor?.oldestReceivedTime || "",
      lastSeenAt: seenAt || previousAnchor?.lastSeenAt || sorted[0]?.lastSeenAt || ""
    };
  }
  return anchors;
}

function normalizeFolderName(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function compareStoredMail(a: StoredMail, b: StoredMail): number {
  return String(b.receivedTime || "").localeCompare(String(a.receivedTime || ""));
}

function compareMailIndexItems(a: MailIndexItem, b: MailIndexItem): number {
  return String(b.receivedTime || "").localeCompare(String(a.receivedTime || ""));
}

function parseDate(value: string): number {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stringValue(value: unknown): string {
  return String(value || "");
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function arrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
