import test from "node:test";
import assert from "node:assert/strict";
import { buildMailGateDecision, buildThreadGateDecision } from "../lib/security-gate";
import type { MailClassification } from "../lib/classification";
import type { StoredMail } from "../lib/mail-store";
import type { ThreadRecord } from "../lib/thread-schema";

test("buildMailGateDecision allows mail within auto classification threshold", () => {
  const decision = buildMailGateDecision(mail({ mailId: "mail-1", subject: "Public update" }), classification("mail-1", 1), {
    autoAnalyzeEnabled: true,
    maxAutoClassificationLevel: 1,
    maxManualClassificationLevel: 2
  });

  assert.equal(decision.decision, "allow");
  assert.equal(decision.partialContext, false);
  assert.deepEqual(decision.excludedMailIds, []);
});

test("buildMailGateDecision requires manual confirmation above auto threshold", () => {
  const decision = buildMailGateDecision(mail({ mailId: "mail-2", subject: "Budget plan" }), classification("mail-2", 2), {
    autoAnalyzeEnabled: true,
    maxAutoClassificationLevel: 1,
    maxManualClassificationLevel: 2
  });

  assert.equal(decision.decision, "manual_confirm");
  assert.match(decision.reasons.join("\n"), /exceeds automatic maximum/);
});

test("buildMailGateDecision allows threshold mail when obsolete auto analyze config is false", () => {
  const decision = buildMailGateDecision(mail({ mailId: "mail-old-config", subject: "Internal update" }), classification("mail-old-config", 1), {
    autoAnalyzeEnabled: false,
    maxAutoClassificationLevel: 1,
    maxManualClassificationLevel: 2
  });

  assert.equal(decision.decision, "allow");
  assert.ok(!decision.reasons.join("\n").includes("Automatic analysis is disabled"));
});

test("buildMailGateDecision blocks mail above manual threshold", () => {
  const decision = buildMailGateDecision(mail({ mailId: "mail-3", subject: "High registered plan" }), classification("mail-3", 3), {
    autoAnalyzeEnabled: true,
    maxAutoClassificationLevel: 1,
    maxManualClassificationLevel: 2
  });

  assert.equal(decision.decision, "block");
  assert.deepEqual(decision.excludedMailIds, ["mail-3"]);
});

test("buildMailGateDecision blocks hard block keyword regardless of classification", () => {
  const decision = buildMailGateDecision(
    mail({ mailId: "mail-4", bodyExcerpt: "The password is attached for reference." }),
    classification("mail-4", 1),
    {
      autoAnalyzeEnabled: true,
      maxAutoClassificationLevel: 1,
      maxManualClassificationLevel: 2,
      hardBlockKeywords: ["password"]
    }
  );

  assert.equal(decision.decision, "block");
  assert.deepEqual(decision.matchedHardBlockKeywords, ["password"]);
});

test("buildMailGateDecision requires manual confirmation for configured keywords", () => {
  const decision = buildMailGateDecision(
    mail({ mailId: "mail-5", subject: "Contract renewal" }),
    classification("mail-5", 1),
    {
      autoAnalyzeEnabled: true,
      maxAutoClassificationLevel: 1,
      maxManualClassificationLevel: 2,
      manualConfirmKeywords: ["contract"]
    }
  );

  assert.equal(decision.decision, "manual_confirm");
  assert.deepEqual(decision.matchedManualConfirmKeywords, ["contract"]);
});

test("buildThreadGateDecision summarizes message gate decisions", () => {
  const thread = threadRecord([
    threadMessage({ mailId: "mail-1", bodyDelta: "Normal update." }),
    threadMessage({ mailId: "mail-2", bodyDelta: "Budget plan." }),
    threadMessage({ mailId: "mail-3", bodyDelta: "Password is included." })
  ]);
  const decision = buildThreadGateDecision(
    thread,
    [classification("mail-1", 1), classification("mail-2", 2), classification("mail-3", 1)],
    {
      autoAnalyzeEnabled: true,
      maxAutoClassificationLevel: 1,
      maxManualClassificationLevel: 2,
      hardBlockKeywords: ["password"]
    }
  );

  assert.equal(decision.decision, "block");
  assert.equal(decision.summary.totalMessages, 3);
  assert.equal(decision.summary.allowedMessages, 1);
  assert.equal(decision.summary.manualConfirmMessages, 1);
  assert.equal(decision.summary.blockedMessages, 1);
  assert.equal(decision.summary.highestClassificationLevel, 2);
  assert.deepEqual(decision.excludedMailIds, ["mail-3"]);
});

test("buildThreadGateDecision marks partial context when thread content is partial", () => {
  const decision = buildThreadGateDecision(
    {
      threadId: "thread-2",
      subject: "Partial thread",
      partialContext: true,
      messages: [
        {
          mailId: "mail-1",
          bodyPreview: "Only a preview is available.",
          contentAvailable: false,
          classification: classification("mail-1", 1)
        }
      ]
    },
    [],
    {
      autoAnalyzeEnabled: true,
      maxAutoClassificationLevel: 1,
      maxManualClassificationLevel: 2
    }
  );

  assert.equal(decision.decision, "allow");
  assert.equal(decision.partialContext, true);
  assert.equal(decision.summary.partialContext, true);
  assert.deepEqual(decision.excludedMailIds, ["mail-1"]);
});

function mail(overrides: Partial<StoredMail>): StoredMail {
  return {
    mailId: "mail-default",
    sourceMailId: "source-default",
    internetMessageId: "",
    entryId: "",
    subject: "Default subject",
    from: "Sender <sender@example.com>",
    receivedTime: "2026-06-16 09:00:00",
    folder: "Inbox",
    unread: "false",
    importance: "normal",
    toMe: "true",
    ccMe: "false",
    bodyExcerpt: "",
    pulledAt: "",
    ...overrides
  };
}

function classification(mailId: string, level: number): MailClassification {
  return {
    mailId,
    level,
    label: level >= 3 ? "HIGH REGISTERED" : level === 2 ? "REGISTERED" : "INTERNAL",
    source: "test",
    reason: "test classification",
    updatedAt: "2026-06-16T00:00:00.000Z"
  };
}

function threadRecord(timeline: ThreadRecord["timeline"]): ThreadRecord {
  return {
    threadId: "thread-1",
    conversationId: "conversation-1",
    normalizedSubject: "project",
    subject: "Project",
    participants: ["Sender <sender@example.com>"],
    folders: ["Inbox"],
    startTime: "2026-06-16 09:00:00",
    lastTime: "2026-06-16 11:00:00",
    messageCount: timeline.length,
    unreadCount: 0,
    hasAttachments: false,
    sourceMailIds: timeline.map((item) => item.mailId),
    timeline,
    contentStatus: "available"
  };
}

function threadMessage(overrides: Partial<ThreadRecord["timeline"][number]>): ThreadRecord["timeline"][number] {
  return {
    mailId: "mail-default",
    internetMessageId: "",
    entryId: "",
    conversationId: "conversation-1",
    conversationIndex: "",
    subject: "Project",
    from: "Sender <sender@example.com>",
    senderName: "Sender",
    senderEmail: "sender@example.com",
    receivedTime: "2026-06-16 09:00:00",
    sentTime: "",
    folder: "Inbox",
    bodyPreview: "",
    bodyClean: "",
    bodyDelta: "",
    bodyHash: "",
    isDuplicateBody: false,
    contentAvailable: true,
    attachmentCount: 0,
    attachmentNames: [],
    ...overrides
  };
}
