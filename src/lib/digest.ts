export interface DigestMetadata {
  generatedAt: string;
  rangeMode: string;
  recentHours: number;
  maxItems: number;
  folders: string[];
  scanSummary?: {
    failed: number;
    partial: number;
    folders: string[];
  };
}

export interface DigestItem {
  mailId: string;
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
}

export interface DigestData {
  metadata: DigestMetadata;
  items: DigestItem[];
}

export function parseDigest(markdown: string): DigestData {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const metadata: DigestMetadata = {
    generatedAt: "",
    rangeMode: "",
    recentHours: 0,
    maxItems: 0,
    folders: [],
    scanSummary: { failed: 0, partial: 0, folders: [] }
  };

  const headerLines = (text.split(/\n---/, 1)[0] || "").split("\n");
  let readingFolders = false;
  for (const line of headerLines) {
    if (line.startsWith("GeneratedAt: ")) metadata.generatedAt = line.slice("GeneratedAt: ".length).trim();
    if (line.startsWith("RangeMode: ")) metadata.rangeMode = line.slice("RangeMode: ".length).trim();
    if (line.startsWith("RecentHours: ")) metadata.recentHours = Number(line.slice("RecentHours: ".length).trim()) || 0;
    if (line.startsWith("MaxItems: ")) metadata.maxItems = Number(line.slice("MaxItems: ".length).trim()) || 0;
    if (line === "Folders:") {
      readingFolders = true;
      continue;
    }
    if (line.startsWith("ScanSummary: ")) {
      metadata.scanSummary = parseScanSummary(line.slice("ScanSummary: ".length));
      readingFolders = false;
      continue;
    }
    if (readingFolders && line.startsWith("- ")) metadata.folders.push(line.slice(2).trim());
  }

  const sections = text.split(/\n## Mail:\s+/).slice(1);
  const items = sections.map((section) => parseMailSection(section)).filter(Boolean) as DigestItem[];
  return { metadata, items };
}

function parseScanSummary(value: string): DigestMetadata["scanSummary"] {
  if (value.trim().toLowerCase() === "ok") return { failed: 0, partial: 0, folders: [] };
  const fields = Object.fromEntries(value.split(";").map((field) => field.trim().split(/=(.*)/, 2)));
  return {
    failed: Number(fields.failed) || 0,
    partial: Number(fields.partial) || 0,
    folders: String(fields.folders || "").split(",").map((folder) => folder.trim()).filter(Boolean)
  };
}

function parseMailSection(section: string): DigestItem | null {
  const text = String(section || "");
  const bodyParts = text.split(/\nBodyExcerpt:\n/);
  const headerText = bodyParts[0] || "";
  const bodyText = (bodyParts[1] || "").replace(/\n---\s*$/, "").trim();
  const lines = headerText.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return null;
  }

  const result: DigestItem = {
    mailId: lines[0],
    internetMessageId: "",
    entryId: "",
    storeId: "",
    conversationId: "",
    conversationIndex: "",
    subject: "",
    from: "",
    senderName: "",
    senderEmail: "",
    receivedTime: "",
    sentTime: "",
    folder: "",
    unread: "",
    importance: "",
    toMe: "",
    ccMe: "",
    to: "",
    cc: "",
    attachmentCount: 0,
    attachmentNames: [],
    bodyExcerpt: bodyText
  };

  for (const line of lines.slice(1)) {
    assignIfPrefix(result, line, "Subject: ", "subject");
    assignIfPrefix(result, line, "InternetMessageId: ", "internetMessageId");
    assignIfPrefix(result, line, "EntryId: ", "entryId");
    assignIfPrefix(result, line, "StoreId: ", "storeId");
    assignIfPrefix(result, line, "ConversationId: ", "conversationId");
    assignIfPrefix(result, line, "ConversationIndex: ", "conversationIndex");
    assignIfPrefix(result, line, "From: ", "from");
    assignIfPrefix(result, line, "ReceivedTime: ", "receivedTime");
    assignIfPrefix(result, line, "SentTime: ", "sentTime");
    assignIfPrefix(result, line, "Folder: ", "folder");
    assignIfPrefix(result, line, "Unread: ", "unread");
    assignIfPrefix(result, line, "Importance: ", "importance");
    assignIfPrefix(result, line, "ToMe: ", "toMe");
    assignIfPrefix(result, line, "CcMe: ", "ccMe");
    assignIfPrefix(result, line, "To: ", "to");
    assignIfPrefix(result, line, "Cc: ", "cc");
    if (line.startsWith("AttachmentCount: ")) {
      result.attachmentCount = Number(line.slice("AttachmentCount: ".length).trim()) || 0;
    }
    if (line.startsWith("AttachmentNames: ")) {
      result.attachmentNames = splitList(line.slice("AttachmentNames: ".length));
    }
  }

  const sender = parseSender(result.from);
  result.senderName = result.senderName || sender.name;
  result.senderEmail = result.senderEmail || sender.email;

  return result;
}

function assignIfPrefix(target: DigestItem, line: string, prefix: string, key: keyof DigestItem): void {
  if (line.startsWith(prefix)) {
    (target as unknown as Record<string, unknown>)[key] = line.slice(prefix.length).trim();
  }
}

function splitList(value: string): string[] {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSender(value: string): { name: string; email: string } {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)\s*<([^<>]+)>$/);
  if (!match) {
    return { name: text, email: "" };
  }
  return {
    name: match[1].trim(),
    email: match[2].trim()
  };
}
