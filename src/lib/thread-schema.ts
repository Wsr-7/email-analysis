export interface ThreadStore {
  generatedAt: string;
  lastBuiltAt: string;
  items: ThreadRecord[];
}

export interface ThreadRecord {
  threadId: string;
  conversationId: string;
  normalizedSubject: string;
  subject: string;
  participants: string[];
  folders: string[];
  startTime: string;
  lastTime: string;
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  sourceMailIds: string[];
  timeline: ThreadMessage[];
  contentStatus: ThreadContentStatus;
  security?: ThreadSecuritySummary;
}

export interface ThreadMessage {
  mailId: string;
  internetMessageId: string;
  entryId: string;
  conversationId: string;
  conversationIndex: string;
  subject: string;
  from: string;
  senderName: string;
  senderEmail: string;
  receivedTime: string;
  sentTime: string;
  folder: string;
  toMe?: string;
  ccMe?: string;
  bodyPreview: string;
  bodyClean: string;
  bodyDelta: string;
  bodyHash: string;
  isDuplicateBody: boolean;
  duplicateOfId?: string;
  contentAvailable: boolean;
  attachmentCount: number;
  attachmentNames: string[];
}

export type ThreadContentStatus = "available" | "partial" | "metadataOnly";

export interface ThreadSecuritySummary {
  totalMessages: number;
  allowedMessages: number;
  manualConfirmMessages: number;
  blockedMessages: number;
  highestClassificationLevel: number;
  partialContext: boolean;
  reasons: string[];
}
