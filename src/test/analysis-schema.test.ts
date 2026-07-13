import test from "node:test";
import assert from "node:assert/strict";
import { parseAnalysisJson } from "../lib/analysis-schema";

test("parseAnalysisJson accepts fenced JSON and normalizes overview", () => {
  const analysis = parseAnalysisJson(`\`\`\`json
{
  "generatedAt": "2026-06-16T10:35:00+08:00",
  "items": [
    {
      "mailId": "mail-001",
      "category": "mustHandleToday",
      "priority": "P0",
      "subject": "Contract approval needed",
      "sender": "Alice",
      "receivedTime": "2026-06-16 09:12:00",
      "summary": "Approval needed today.",
      "reason": "Contains a deadline.",
      "suggestedAction": "Reply today.",
      "draftReply": "I will reply today."
    }
  ]
}
\`\`\``);

  assert.equal(analysis.items.length, 1);
  assert.equal(analysis.overview.mustHandleToday, 1);
  assert.equal(analysis.items[0].priority, "P0");
});

test("parseAnalysisJson preserves optional source and evidence fields", () => {
  const analysis = parseAnalysisJson(JSON.stringify({
    generatedAt: "2026-06-16T10:35:00+08:00",
    items: [
      {
        mailId: "mail-001",
        category: "followUp",
        priority: "P1",
        subject: "Follow-up needed",
        sender: "Alice",
        receivedTime: "2026-06-16 09:12:00",
        summary: "Alice asked for a status update.",
        reason: "Direct request in the mail body.",
        suggestedAction: "Send status update.",
        draftReply: "I will send the status update.",
        draftReplyParts: {
          GREETING: "Hi Alice,",
          MAIN_MESSAGE: "I will send the status update.",
          CLOSING: "Thanks,"
        },
        confidence: 0.9,
        needsOriginalMailCheck: false,
        source: {
          mailId: "mail-001",
          internetMessageId: "<message-001@example.com>",
          entryId: "entry-001",
          folder: "Inbox"
        },
        evidence: [
          {
            sourceMailId: "mail-001",
            quote: "Could you send the current status today?",
            reason: "Shows the requested action and deadline."
          }
        ]
      }
    ]
  }));

  assert.deepEqual(analysis.items[0].source, {
    mailId: "mail-001",
    internetMessageId: "<message-001@example.com>",
    entryId: "entry-001",
    folder: "Inbox"
  });
  assert.equal(analysis.items[0].draftReplyParts?.GREETING, "Hi Alice,");
  assert.equal(analysis.items[0].draftReplyParts?.MAIN_MESSAGE, "I will send the status update.");
  assert.deepEqual(analysis.items[0].evidence, [
    {
      sourceMailId: "mail-001",
      quote: "Could you send the current status today?",
      reason: "Shows the requested action and deadline."
    }
  ]);
});

test("parseAnalysisJson keeps old JSON compatible without source and evidence", () => {
  const analysis = parseAnalysisJson(JSON.stringify({
    items: [
      {
        mailId: "mail-001",
        category: "notice",
        priority: "P3",
        subject: "Notice",
        sender: "System",
        receivedTime: "2026-06-16 09:12:00",
        summary: "Routine notice.",
        reason: "No action required.",
        suggestedAction: "No action.",
        draftReply: "",
        confidence: 0.7,
        needsOriginalMailCheck: false
      }
    ]
  }));

  assert.equal(analysis.items[0].source, undefined);
  assert.equal(analysis.items[0].evidence, undefined);
});

test("parseAnalysisJson downgrades low-confidence non-uncertain categories", () => {
  const analysis = parseAnalysisJson(JSON.stringify({
    items: [
      {
        mailId: "mail-001",
        category: "mustHandleToday",
        priority: "P0",
        subject: "Maybe urgent",
        sender: "Alice",
        receivedTime: "2026-06-16 09:12:00",
        summary: "Possibly needs action.",
        reason: "Ambiguous wording.",
        suggestedAction: "Check original.",
        draftReply: "",
        confidence: 0.5,
        needsOriginalMailCheck: false
      }
    ]
  }));

  assert.equal(analysis.items[0].category, "uncertain");
  assert.equal(analysis.items[0].priority, "P2");
  assert.equal(analysis.items[0].needsOriginalMailCheck, true);
  assert.equal(analysis.overview.mustHandleToday, 0);
});

test("parseAnalysisJson clamps category priority mismatches and lowers confidence", () => {
  const analysis = parseAnalysisJson(JSON.stringify({
    items: [
      {
        mailId: "mail-001",
        category: "notice",
        priority: "P0",
        subject: "Routine notice",
        sender: "System",
        receivedTime: "2026-06-16 09:12:00",
        summary: "Routine notice.",
        reason: "Informational only.",
        suggestedAction: "No action.",
        draftReply: "",
        confidence: 0.95,
        needsOriginalMailCheck: false
      }
    ]
  }));

  assert.equal(analysis.items[0].category, "notice");
  assert.equal(analysis.items[0].priority, "P2");
  assert.equal(analysis.items[0].confidence, 0.7);
});

test("parseAnalysisJson recomputes overview from normalized items", () => {
  const analysis = parseAnalysisJson(JSON.stringify({
    overview: { totalMails: 99, mustHandleToday: 99, risks: 99, waitingForMe: 99, notices: 99 },
    items: [
      {
        mailId: "mail-001",
        category: "notice",
        priority: "P0",
        subject: "Routine notice",
        sender: "System",
        receivedTime: "2026-06-16 09:12:00",
        summary: "Routine notice.",
        reason: "Informational only.",
        suggestedAction: "No action.",
        draftReply: "",
        confidence: 0.95,
        needsOriginalMailCheck: false
      }
    ]
  }));

  assert.equal(analysis.overview.totalMails, 1);
  assert.equal(analysis.overview.mustHandleToday, 0);
  assert.equal(analysis.overview.notices, 1);
});

test("parseAnalysisJson keeps only real YYYY-MM-DD due dates", () => {
  const item = (mailId: string, dueDate: string) => ({
    mailId,
    category: "notice",
    priority: "P3",
    subject: "Notice",
    sender: "System",
    receivedTime: "2026-06-16 09:12:00",
    summary: "Routine notice.",
    reason: "No action required.",
    suggestedAction: "No action.",
    draftReply: "",
    dueDate,
    confidence: 0.9,
    needsOriginalMailCheck: false
  });
  const analysis = parseAnalysisJson(JSON.stringify({
    items: [item("valid", "2028-02-29"), item("invalid-day", "2026-02-30"), item("invalid-shape", "02/28/2026")]
  }));

  assert.deepEqual(analysis.items.map((entry) => entry.dueDate), ["2028-02-29", "", ""]);
});
