import test from "node:test";
import assert from "node:assert/strict";
import { redactStoredMails, redactText, redactThreadForPrompt } from "../lib/redaction";
import type { RedactionPolicy } from "../lib/redaction";
import type { StoredMail } from "../lib/mail-store";
import type { ThreadRecord } from "../lib/thread-store";

const basePolicy: RedactionPolicy = {
  enabled: true,
  redactEmail: false,
  redactPhone: false,
  redactUrl: false,
  redactIp: false,
  redactToken: false,
  redactMoney: false,
  redactIdLike: false,
  customPatterns: []
};

test("redactText replaces email addresses without exposing original values in findings", () => {
  const result = redactText("Contact alice@example.com and bob@example.org.", {
    ...basePolicy,
    redactEmail: true
  });

  assert.equal(result.text, "Contact [EMAIL_1] and [EMAIL_2].");
  assert.equal(result.stats.totalReplacements, 2);
  assert.equal(result.stats.byType.email, 2);
  assert.deepEqual(result.findings, [{ type: "email", replacement: "[EMAIL_1]", count: 2 }]);
  assert.equal(JSON.stringify(result.findings).includes("alice@example.com"), false);
});

test("redactText replaces URLs", () => {
  const result = redactText("Open https://example.com/path?token=abc for details.", {
    ...basePolicy,
    redactUrl: true
  });

  assert.equal(result.text, "Open [URL_1] for details.");
  assert.equal(result.stats.byType.url, 1);
});

test("redactText replaces token assignments", () => {
  const result = redactText("Use access_token=abc123 and password: hunter2.", {
    ...basePolicy,
    redactToken: true
  });

  assert.equal(result.text, "Use [SECRET_1] and [SECRET_2].");
  assert.equal(result.stats.byType.secret, 2);
});

test("redactText replaces IPv4 addresses", () => {
  const result = redactText("Server 10.20.30.40 failed, 999.20.30.40 did not match.", {
    ...basePolicy,
    redactIp: true
  });

  assert.equal(result.text, "Server [IP_1] failed, 999.20.30.40 did not match.");
  assert.equal(result.stats.byType.ip, 1);
});

test("redactText replaces money amounts", () => {
  const result = redactText("Budget is USD 12,500.00 plus $300.", {
    ...basePolicy,
    redactMoney: true
  });

  assert.equal(result.text, "Budget is [MONEY_1] plus [MONEY_2].");
  assert.equal(result.stats.byType.money, 2);
});

test("redactText replaces phone numbers", () => {
  const result = redactText("Call +1 (415) 555-0100 or 021-55556666.", {
    ...basePolicy,
    redactPhone: true
  });

  assert.equal(result.text, "Call [PHONE_1] or [PHONE_2].");
  assert.equal(result.stats.byType.phone, 2);
});

test("redactText returns input unchanged when policy is disabled", () => {
  const text = "alice@example.com has access_token=abc123.";
  const result = redactText(text, {
    ...basePolicy,
    enabled: false,
    redactEmail: true,
    redactToken: true
  });

  assert.equal(result.text, text);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.stats, { totalReplacements: 0, byType: {} });
});

test("redactText applies custom patterns", () => {
  const result = redactText("Project Phoenix and Project Atlas are confidential.", {
    ...basePolicy,
    customPatterns: [
      {
        id: "projectName",
        pattern: "Project\\s+[A-Z][a-z]+",
        replacement: "[PROJECT]"
      }
    ]
  });

  assert.equal(result.text, "[PROJECT] and [PROJECT] are confidential.");
  assert.equal(result.stats.byType.projectName, 2);
  assert.deepEqual(result.findings, [{ type: "projectName", replacement: "[PROJECT]", count: 2 }]);
});

test("redactStoredMails redacts body content and attachment names", () => {
  const mail: StoredMail = {
    mailId: "mail-1",
    sourceMailId: "source-1",
    internetMessageId: "<mail-1@example.com>",
    entryId: "entry-1",
    conversationId: "conversation-1",
    conversationIndex: "index-1",
    subject: "Contract from alice@example.com",
    from: "Alice <alice@example.com>",
    senderName: "Alice",
    senderEmail: "alice@example.com",
    receivedTime: "2026-07-02T01:00:00.000Z",
    sentTime: "2026-07-02T00:55:00.000Z",
    folder: "Inbox",
    unread: "false",
    importance: "Normal",
    toMe: "true",
    ccMe: "false",
    to: "Bob <bob@example.com>",
    cc: "Carol <carol@example.com>",
    attachmentCount: 1,
    attachmentNames: ["contract-alice@example.com"],
    bodyExcerpt: "Please call alice@example.com at +1 (415) 555-0100.",
    bodyHash: "hash-1",
    pulledAt: "2026-07-02T01:01:00.000Z"
  };

  const result = redactStoredMails([mail], {
    ...basePolicy,
    redactEmail: true,
    redactPhone: true
  });

  assert.equal(result.items[0].subject, mail.subject);
  assert.equal(result.items[0].from, mail.from);
  assert.equal(result.items[0].senderEmail, mail.senderEmail);
  assert.equal(result.items[0].to, mail.to);
  assert.deepEqual(result.items[0].attachmentNames, ["[EMAIL_1]"]);
  assert.equal(result.items[0].bodyExcerpt, "Please call [EMAIL_1] at [PHONE_1].");
  assert.equal(result.totalReplacements, 3);
});

test("redactThreadForPrompt preserves thread metadata and redacts only body content", () => {
  const thread: ThreadRecord = {
    threadId: "thread-1",
    conversationId: "conversation-1",
    normalizedSubject: "contract from alice@example.com",
    subject: "Contract from alice@example.com",
    participants: ["Alice <alice@example.com>", "Bob <bob@example.com>"],
    folders: ["Inbox"],
    startTime: "2026-07-02T01:00:00.000Z",
    lastTime: "2026-07-02T01:00:00.000Z",
    messageCount: 1,
    unreadCount: 1,
    hasAttachments: true,
    sourceMailIds: ["source-1"],
    contentStatus: "available",
    timeline: [
      {
        mailId: "mail-1",
        internetMessageId: "<mail-1@example.com>",
        entryId: "entry-1",
        conversationId: "conversation-1",
        conversationIndex: "index-1",
        subject: "Contract from alice@example.com",
        from: "Alice <alice@example.com>",
        senderName: "Alice",
        senderEmail: "alice@example.com",
        receivedTime: "2026-07-02T01:00:00.000Z",
        sentTime: "2026-07-02T00:55:00.000Z",
        folder: "Inbox",
        bodyPreview: "Email alice@example.com for details.",
        bodyClean: "Email alice@example.com or call +1 (415) 555-0100.",
        bodyDelta: "Call +1 (415) 555-0100.",
        bodyHash: "hash-1",
        isDuplicateBody: false,
        contentAvailable: true,
        attachmentCount: 1,
        attachmentNames: ["alice-contract.pdf"]
      }
    ]
  };

  const result = redactThreadForPrompt(thread, {
    ...basePolicy,
    redactEmail: true,
    redactPhone: true
  });

  assert.equal(result.subject, thread.subject);
  assert.deepEqual(result.participants, thread.participants);
  assert.equal(result.timeline[0].subject, thread.timeline[0].subject);
  assert.equal(result.timeline[0].from, thread.timeline[0].from);
  assert.equal(result.timeline[0].senderEmail, thread.timeline[0].senderEmail);
  assert.deepEqual(result.timeline[0].attachmentNames, thread.timeline[0].attachmentNames);
  assert.equal(result.timeline[0].bodyPreview, "Email [EMAIL_1] for details.");
  assert.equal(result.timeline[0].bodyClean, "Email [EMAIL_1] or call [PHONE_1].");
  assert.equal(result.timeline[0].bodyDelta, "Call [PHONE_1].");
});
