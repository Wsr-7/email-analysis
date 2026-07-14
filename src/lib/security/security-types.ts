import type { MailClassification } from "./classification";
import type { RedactionFinding, RedactionPolicy, RedactionStats } from "./redaction";

export type SecurityGateDecision = "allow" | "manual_confirm" | "block";

export type SecurityGateTargetType = "mail" | "thread";

export interface SecurityGateSettings {
  enabled?: boolean;
  autoAnalyzeEnabled?: boolean;
  maxAutoClassificationLevel?: number;
  maxManualClassificationLevel?: number;
  hardBlockKeywords?: string[];
  manualConfirmKeywords?: string[];
  redaction?: RedactionPolicy;
}

export interface SecurityGateRedactionInfo {
  enabled?: boolean;
  findings?: RedactionFinding[];
  stats?: RedactionStats;
}

export interface SecurityGateDecisionResult {
  targetType: SecurityGateTargetType;
  targetId: string;
  decision: SecurityGateDecision;
  classification: MailClassification;
  reasons: string[];
  matchedHardBlockKeywords: string[];
  matchedManualConfirmKeywords: string[];
  partialContext: boolean;
  excludedMailIds: string[];
  redaction?: SecurityGateRedactionInfo;
}

export interface MailSecurityGateInput {
  mailId: string;
  subject?: string;
  from?: string;
  folder?: string;
  bodyExcerpt?: string;
  classification: MailClassification;
  redaction?: SecurityGateRedactionInfo;
}

export interface ThreadSecurityGateInput {
  threadId: string;
  subject?: string;
  messages: ThreadSecurityGateMessageInput[];
  partialContext?: boolean;
  redaction?: SecurityGateRedactionInfo;
}

export interface ThreadSecurityGateMessageInput {
  mailId: string;
  subject?: string;
  from?: string;
  folder?: string;
  bodyPreview?: string;
  bodyClean?: string;
  bodyDelta?: string;
  contentAvailable?: boolean;
  classification: MailClassification;
}

export interface ThreadSecurityGateDecisionResult extends SecurityGateDecisionResult {
  messageDecisions: SecurityGateDecisionResult[];
  summary: {
    totalMessages: number;
    allowedMessages: number;
    manualConfirmMessages: number;
    blockedMessages: number;
    highestClassificationLevel: number;
    partialContext: boolean;
    reasons: string[];
  };
}
