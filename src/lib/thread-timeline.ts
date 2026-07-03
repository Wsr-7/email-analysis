import { createHash } from "node:crypto";

export interface DuplicateBodyInput {
  id: string;
  body: string;
}

export interface DuplicateBodyMark {
  bodyHash: string;
  isDuplicateBody: boolean;
  duplicateOfId?: string;
}

export function cleanMailBody(body: string): string {
  const normalized = String(body || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();

  return normalized.replace(/\n{3,}/g, "\n\n");
}

export function extractReplyDelta(body: string): string {
  const cleaned = cleanMailBody(body);
  if (!cleaned) {
    return "";
  }

  const lines = cleaned.split("\n");
  const quoteStart = findQuoteStart(lines);
  if (quoteStart < 0) {
    return cleaned;
  }

  return cleanMailBody(lines.slice(0, quoteStart).join("\n"));
}

export function hashBody(body: string): string {
  return createHash("sha256").update(cleanMailBody(body), "utf8").digest("hex").slice(0, 16);
}

export function markDuplicateBodies<T extends DuplicateBodyInput>(items: T[]): Array<T & DuplicateBodyMark> {
  const firstByHash = new Map<string, string>();

  return items.map((item) => {
    const bodyHash = hashBody(item.body);
    const duplicateOfId = firstByHash.get(bodyHash);

    if (!duplicateOfId && cleanMailBody(item.body)) {
      firstByHash.set(bodyHash, item.id);
    }

    return {
      ...item,
      bodyHash,
      isDuplicateBody: Boolean(duplicateOfId),
      duplicateOfId
    };
  });
}

function findQuoteStart(lines: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    if (isOriginalMessageSeparator(lines[index]) || startsOutlookHeaderBlock(lines, index)) {
      return index;
    }
  }

  return -1;
}

function isOriginalMessageSeparator(line: string): boolean {
  const value = line.trim();
  return /^-+\s*Original Message\s*-+$/i.test(value)
    || /^-+\s*原始邮件\s*-+$/.test(value)
    || /^-+\s*邮件原件\s*-+$/.test(value)
    || /^_{5,}$/.test(value)
    || /^On .+ wrote:$/i.test(value)
    || /^在 .+ 写道[:：]$/.test(value);
}

function startsOutlookHeaderBlock(lines: string[], startIndex: number): boolean {
  const firstLabel = headerLabel(lines[startIndex]);
  if (firstLabel !== "from") {
    return false;
  }

  const labels = new Set<string>([firstLabel]);
  for (let index = startIndex + 1; index < Math.min(lines.length, startIndex + 8); index += 1) {
    const line = lines[index].trim();
    if (!line) {
      break;
    }

    const label = headerLabel(line);
    if (!label) {
      break;
    }

    labels.add(label);
  }

  return labels.has("sent") || labels.has("to") || labels.has("subject");
}

function headerLabel(line: string): string {
  if (/^From\s*:/i.test(line) || /^发件人\s*[:：]/.test(line)) {
    return "from";
  }

  if (/^Sent\s*:/i.test(line) || /^发送时间\s*[:：]/.test(line)) {
    return "sent";
  }

  if (/^To\s*:/i.test(line) || /^收件人\s*[:：]/.test(line)) {
    return "to";
  }

  if (/^Cc\s*:/i.test(line) || /^抄送\s*[:：]/.test(line)) {
    return "cc";
  }

  if (/^Subject\s*:/i.test(line) || /^主题\s*[:：]/.test(line)) {
    return "subject";
  }

  return "";
}
