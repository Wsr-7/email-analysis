export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export function domIdForMail(mailId: string): string {
  return `mail-${safeDomId(mailId)}`;
}

export function domIdForThread(threadId: string): string {
  return `thread-${safeDomId(threadId)}`;
}

export function domIdForThreadMessage(threadId: string, mailId: string): string {
  return `thread-message-${safeDomId(threadId)}-${safeDomId(mailId)}`;
}

export function domIdForCategory(category: string): string {
  return `category-${safeDomId(category)}`;
}

export function safeDomId(value: string): string {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "-");
}

export function selected(current: unknown, expected: unknown): string {
  return String(current ?? "") === String(expected) ? "selected" : "";
}

export function toJsLiteral(value: string): string {
  return JSON.stringify(String(value || ""))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/'/g, "\\u0027");
}
