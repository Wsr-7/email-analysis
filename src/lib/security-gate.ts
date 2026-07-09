import { classificationFor, type ClassificationCache, type MailClassification } from "./classification";
import type { StoredMail } from "./mail-store";
import type { ThreadRecord, ThreadSecuritySummary } from "./thread-schema";
import type {
  MailSecurityGateInput,
  SecurityGateDecision,
  SecurityGateDecisionResult,
  SecurityGateSettings,
  ThreadSecurityGateDecisionResult,
  ThreadSecurityGateInput,
  ThreadSecurityGateMessageInput
} from "./security-types";

const DEFAULT_MAX_AUTO_CLASSIFICATION_LEVEL = 1;
const DEFAULT_MAX_MANUAL_CLASSIFICATION_LEVEL = 3;

export function buildMailGateDecision(
  mail: StoredMail | MailSecurityGateInput,
  classification: MailClassification,
  settings: SecurityGateSettings = {}
): SecurityGateDecisionResult {
  return decideMail(toMailInput(mail, classification), settings);
}

export function buildThreadGateDecision(
  thread: ThreadRecord | ThreadSecurityGateInput,
  classifications: MailClassification[] | Record<string, MailClassification>,
  settings: SecurityGateSettings = {}
): ThreadSecurityGateDecisionResult {
  const input = toThreadInput(thread, classifications);
  const messageDecisions = input.messages.map((message) => decideMail(messageToMailInput(message), settings));
  const highestClassificationLevel = messageDecisions.reduce(
    (highest, item) => Math.max(highest, item.classification.level),
    0
  );
  const allowedMessages = messageDecisions.filter((item) => item.decision === "allow").length;
  const manualConfirmMessages = messageDecisions.filter((item) => item.decision === "manual_confirm").length;
  const blockedMessages = messageDecisions.filter((item) => item.decision === "block").length;
  const unavailableMailIds = new Set(input.messages
    .filter((message) => message.contentAvailable === false)
    .map((message) => message.mailId));
  const excludedMailIds = messageDecisions
    .filter((item) => item.decision === "block" || unavailableMailIds.has(item.targetId))
    .map((item) => item.targetId);
  const partialContext = Boolean(input.partialContext)
    || input.messages.some((message) => message.contentAvailable === false)
    || blockedMessages > 0;
  const decision = combineThreadDecision(messageDecisions);
  const reasons = unique([
    ...messageDecisions.flatMap((item) => item.reasons),
    ...(partialContext ? ["Thread has partial context."] : [])
  ]);
  const classification = {
    mailId: input.threadId,
    level: highestClassificationLevel,
    label: highestLabel(messageDecisions, highestClassificationLevel),
    source: "security-gate",
    reason: reasons.join("; "),
    updatedAt: new Date().toISOString()
  };
  const summary: ThreadSecuritySummary = {
    totalMessages: messageDecisions.length,
    allowedMessages,
    manualConfirmMessages,
    blockedMessages,
    highestClassificationLevel,
    partialContext,
    reasons
  };

  return {
    targetType: "thread",
    targetId: input.threadId,
    decision,
    classification,
    reasons,
    matchedHardBlockKeywords: unique(messageDecisions.flatMap((item) => item.matchedHardBlockKeywords)),
    matchedManualConfirmKeywords: unique(messageDecisions.flatMap((item) => item.matchedManualConfirmKeywords)),
    partialContext,
    excludedMailIds,
    redaction: input.redaction,
    messageDecisions,
    summary
  };
}

function decideMail(input: MailSecurityGateInput, settings: SecurityGateSettings): SecurityGateDecisionResult {
  const matchedHardBlockKeywords = matchKeywords(mailText(input), settings.hardBlockKeywords || []);
  const matchedManualConfirmKeywords = matchKeywords(mailText(input), settings.manualConfirmKeywords || []);
  const reasons: string[] = [];
  let decision: SecurityGateDecision = "allow";

  if (settings.enabled === false) {
    reasons.push("Security gate disabled.");
  } else if (matchedHardBlockKeywords.length > 0) {
    decision = "block";
    reasons.push(`Hard block keyword matched: ${matchedHardBlockKeywords.join(", ")}.`);
  } else if (input.classification.level > maxManualLevel(settings)) {
    decision = "block";
    reasons.push(`Classification level ${input.classification.level} exceeds manual maximum ${maxManualLevel(settings)}.`);
  } else if (input.classification.level > maxAutoLevel(settings)) {
    decision = "manual_confirm";
    reasons.push(`Classification level ${input.classification.level} exceeds automatic maximum ${maxAutoLevel(settings)}.`);
  } else if (matchedManualConfirmKeywords.length > 0) {
    decision = "manual_confirm";
    reasons.push(`Manual confirm keyword matched: ${matchedManualConfirmKeywords.join(", ")}.`);
  } else {
    reasons.push(`Classification level ${input.classification.level} is allowed for automatic analysis.`);
  }

  if (input.classification.reason && !reasons.includes(input.classification.reason)) {
    reasons.push(input.classification.reason);
  }

  return {
    targetType: "mail",
    targetId: input.mailId,
    decision,
    classification: input.classification,
    reasons,
    matchedHardBlockKeywords,
    matchedManualConfirmKeywords,
    partialContext: false,
    excludedMailIds: decision === "block" ? [input.mailId] : [],
    redaction: input.redaction
  };
}

function toMailInput(mail: StoredMail | MailSecurityGateInput, classification: MailClassification): MailSecurityGateInput {
  if ("classification" in mail) {
    return mail;
  }
  return {
    mailId: mail.mailId,
    subject: mail.subject,
    from: mail.from,
    folder: mail.folder,
    bodyExcerpt: mail.bodyExcerpt,
    classification
  };
}

function toThreadInput(
  thread: ThreadRecord | ThreadSecurityGateInput,
  classifications: MailClassification[] | Record<string, MailClassification>
): ThreadSecurityGateInput {
  if ("messages" in thread) {
    return thread;
  }
  const byId = classificationLookup(classifications);
  return {
    threadId: thread.threadId,
    subject: thread.subject,
    partialContext: thread.contentStatus !== "available" || Boolean(thread.security?.partialContext),
    messages: thread.timeline.map((message) => ({
      mailId: message.mailId,
      subject: message.subject,
      from: message.from,
      folder: message.folder,
      bodyPreview: message.bodyPreview,
      bodyClean: message.bodyClean,
      bodyDelta: message.bodyDelta,
      contentAvailable: message.contentAvailable,
      classification: byId.get(message.mailId) || defaultClassification(message.mailId)
    }))
  };
}

function messageToMailInput(message: ThreadSecurityGateMessageInput): MailSecurityGateInput {
  return {
    mailId: message.mailId,
    subject: message.subject,
    from: message.from,
    folder: message.folder,
    bodyExcerpt: [message.bodyDelta, message.bodyClean, message.bodyPreview].filter(Boolean).join("\n"),
    classification: message.classification
  };
}

function classificationLookup(classifications: MailClassification[] | Record<string, MailClassification>): Map<string, MailClassification> {
  if (Array.isArray(classifications)) {
    return new Map(classifications.map((item) => [item.mailId, item]));
  }
  return new Map(Object.entries(classifications));
}

function combineThreadDecision(messageDecisions: SecurityGateDecisionResult[]): SecurityGateDecision {
  if (messageDecisions.some((item) => item.decision === "block")) {
    return "block";
  }
  if (messageDecisions.some((item) => item.decision === "manual_confirm")) {
    return "manual_confirm";
  }
  return "allow";
}

function matchKeywords(text: string, keywords: string[]): string[] {
  const normalizedText = text.toLowerCase();
  return unique(
    keywords
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .filter((keyword) => normalizedText.includes(keyword.toLowerCase()))
  );
}

function mailText(input: MailSecurityGateInput): string {
  return [
    input.subject,
    input.from,
    input.folder,
    input.bodyExcerpt
  ].filter(Boolean).join("\n");
}

function maxAutoLevel(settings: SecurityGateSettings): number {
  return numberOrDefault(settings.maxAutoClassificationLevel, DEFAULT_MAX_AUTO_CLASSIFICATION_LEVEL);
}

function maxManualLevel(settings: SecurityGateSettings): number {
  return numberOrDefault(settings.maxManualClassificationLevel, DEFAULT_MAX_MANUAL_CLASSIFICATION_LEVEL);
}

function numberOrDefault(value: unknown, fallback: number): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function highestLabel(messageDecisions: SecurityGateDecisionResult[], highestLevel: number): string {
  return messageDecisions.find((item) => item.classification.level === highestLevel)?.classification.label || "PUBLIC";
}

function defaultClassification(mailId: string): MailClassification {
  return {
    mailId,
    level: 1,
    label: "INTERNAL",
    source: "security-gate",
    reason: "Missing classification defaulted to INTERNAL.",
    updatedAt: new Date().toISOString()
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function buildMailSecurityDecisionMap(
  mails: StoredMail[],
  classifications: ClassificationCache,
  settings: SecurityGateSettings
): Map<string, SecurityGateDecisionResult> {
  const decisions = new Map<string, SecurityGateDecisionResult>();
  for (const mail of mails) {
    decisions.set(mail.mailId, buildMailGateDecision(mail, classificationFor(mail.mailId, classifications) || defaultClassification(mail.mailId), settings));
  }
  return decisions;
}

export function canAnalyzeMail(mail: StoredMail, decisions: Map<string, SecurityGateDecisionResult>, explicitSelection: boolean): boolean {
  const decision = decisions.get(mail.mailId);
  if (!decision) {
    return true;
  }
  if (decision.decision === "block") {
    return false;
  }
  return explicitSelection || decision.decision === "allow";
}

export function fallbackClassification(mailId: string): MailClassification {
  return defaultClassification(mailId);
}
