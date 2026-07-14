import type { StoredMail } from "../storage/mail-store";
import type { ThreadStore } from "../storage/thread-store";

export interface RedactionPolicy {
  enabled: boolean;
  redactEmail: boolean;
  redactPhone: boolean;
  redactUrl: boolean;
  redactIp: boolean;
  redactToken: boolean;
  redactMoney: boolean;
  redactIdLike: boolean;
  customPatterns: RedactionPattern[];
}

export interface RedactionPattern {
  id: string;
  pattern: string;
  replacement: string;
}

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
  stats: RedactionStats;
}

export interface RedactionFinding {
  type: string;
  replacement: string;
  count: number;
}

export interface RedactionStats {
  totalReplacements: number;
  byType: Record<string, number>;
}

interface RedactionRule {
  type: string;
  replacementPrefix: string;
  pattern: RegExp;
  shouldRedact?: (match: string) => boolean;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi;
const IP_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
const TOKEN_PATTERN = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer|secret|password)\s*[:=]\s*["']?[^"'\s,;.]+/gi;
const MONEY_PATTERN = /\b(?:USD|EUR|GBP|CNY|RMB)\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b|\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/gi;
const ID_LIKE_PATTERN = /\b(?:[A-Z]{2,10}-\d{3,}|[A-Z0-9]{8,}-[A-Z0-9-]{4,}|[A-F0-9]{16,})\b/g;
const PHONE_PATTERN = /(?<![\w.])\+?\d(?:[\s().-]*\d){6,}(?!\w)/g;

export function redactText(text: string, policy: RedactionPolicy): RedactionResult {
  if (!policy.enabled) {
    return {
      text,
      findings: [],
      stats: {
        totalReplacements: 0,
        byType: {}
      }
    };
  }

  const findings = new Map<string, RedactionFinding>();
  let redacted = text;

  const rules: RedactionRule[] = [];
  if (policy.redactEmail) {
    rules.push({ type: "email", replacementPrefix: "EMAIL", pattern: EMAIL_PATTERN });
  }
  if (policy.redactUrl) {
    rules.push({ type: "url", replacementPrefix: "URL", pattern: URL_PATTERN });
  }
  if (policy.redactIp) {
    rules.push({ type: "ip", replacementPrefix: "IP", pattern: IP_PATTERN });
  }
  if (policy.redactToken) {
    rules.push({ type: "secret", replacementPrefix: "SECRET", pattern: TOKEN_PATTERN });
  }
  if (policy.redactMoney) {
    rules.push({ type: "money", replacementPrefix: "MONEY", pattern: MONEY_PATTERN });
  }
  if (policy.redactIdLike) {
    rules.push({ type: "idLike", replacementPrefix: "ID", pattern: ID_LIKE_PATTERN });
  }
  if (policy.redactPhone) {
    rules.push({
      type: "phone",
      replacementPrefix: "PHONE",
      pattern: PHONE_PATTERN,
      shouldRedact: (match) => countDigits(match) >= 7 && !isIpv4(match)
    });
  }

  for (const rule of rules) {
    redacted = applyGeneratedReplacement(redacted, rule, findings);
  }

  for (const customPattern of policy.customPatterns) {
    redacted = applyCustomReplacement(redacted, customPattern, findings);
  }

  const byType: Record<string, number> = {};
  let totalReplacements = 0;
  for (const finding of findings.values()) {
    byType[finding.type] = finding.count;
    totalReplacements += finding.count;
  }

  return {
    text: redacted,
    findings: [...findings.values()],
    stats: {
      totalReplacements,
      byType
    }
  };
}

function applyGeneratedReplacement(text: string, rule: RedactionRule, findings: Map<string, RedactionFinding>): string {
  let index = 0;

  return text.replace(rule.pattern, (match) => {
    if (rule.shouldRedact && !rule.shouldRedact(match)) {
      return match;
    }

    index += 1;
    const replacement = `[${rule.replacementPrefix}_${index}]`;
    recordFinding(findings, rule.type, replacement);
    return replacement;
  });
}

function applyCustomReplacement(text: string, customPattern: RedactionPattern, findings: Map<string, RedactionFinding>): string {
  const pattern = toGlobalPattern(customPattern.pattern);

  return text.replace(pattern, () => {
    recordFinding(findings, customPattern.id, customPattern.replacement);
    return customPattern.replacement;
  });
}

function toGlobalPattern(pattern: string): RegExp {
  const regex = new RegExp(pattern, "g");
  return regex;
}

function recordFinding(findings: Map<string, RedactionFinding>, type: string, replacement: string): void {
  const current = findings.get(type);
  if (current) {
    current.count += 1;
    return;
  }

  findings.set(type, {
    type,
    replacement,
    count: 1
  });
}

function countDigits(value: string): number {
  let count = 0;
  for (const char of value) {
    if (char >= "0" && char <= "9") {
      count += 1;
    }
  }

  return count;
}

function isIpv4(value: string): boolean {
  return /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(value);
}

export function redactStoredMails(items: StoredMail[], policy: RedactionPolicy): { items: StoredMail[]; totalReplacements: number } {
  let totalReplacements = 0;
  return {
    items: items.map((item) => {
      const bodyExcerpt = redactText(item.bodyExcerpt, policy);
      totalReplacements += bodyExcerpt.stats.totalReplacements;
      const attachmentNames = (item.attachmentNames || []).map((name) => {
        const redactedName = redactText(name, policy);
        totalReplacements += redactedName.stats.totalReplacements;
        return redactedName.text;
      });
      return {
        ...item,
        bodyExcerpt: bodyExcerpt.text,
        attachmentNames
      };
    }),
    totalReplacements
  };
}

export function redactThreadForPrompt(thread: ThreadStore["items"][number], policy: RedactionPolicy): ThreadStore["items"][number] {
  return {
    ...thread,
    timeline: thread.timeline.map((message) => ({
      ...message,
      bodyPreview: redactText(message.bodyPreview, policy).text,
      bodyClean: redactText(message.bodyClean, policy).text,
      bodyDelta: redactText(message.bodyDelta, policy).text
    }))
  };
}
