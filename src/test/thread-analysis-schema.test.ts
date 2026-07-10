import test from "node:test";
import assert from "node:assert/strict";
import { normalizeThreadAnalysis, parseThreadAnalysisJson } from "../lib/thread-analysis-schema";

test("parseThreadAnalysisJson accepts fenced JSON and preserves thread evidence", () => {
  const result = parseThreadAnalysisJson(`\`\`\`json
{
  "generatedAt": "2026-06-17T00:00:00.000Z",
  "items": [
    {
      "threadId": "conversation:1",
      "category": "risk",
      "priority": "P1",
      "subject": "Release",
      "participants": ["Alice", "Bob"],
      "lastTime": "2026-06-17 09:00:00",
      "oneLineSummary": "Release window has a blocker.",
      "currentStatus": "Waiting for approval.",
      "keyDecisions": ["Move release to Thursday."],
      "openQuestions": ["Who approves?"],
      "actionItems": [{"owner": "Bob", "task": "Confirm approval", "deadline": "Today", "sourceMailId": "mail-1", "sourceTime": "2026-06-17 09:00:00"}],
      "waitingOn": ["Bob"],
      "risks": [{"level": "high", "description": "Approval missing", "sourceMailId": "mail-1"}],
      "needMyReply": true,
      "suggestedAction": "Reply with approval request.",
      "draftReply": "Could you confirm approval?",
      "confidence": 0.8,
      "evidence": [{"sourceMailId": "mail-1", "quote": "need approval", "reason": "approval blocker"}],
      "needsOriginalMailCheck": true,
      "partialContext": true
    }
  ]
}
\`\`\``);

  assert.equal(result.items.length, 1);
  assert.equal(result.overview.totalThreads, 1);
  assert.equal(result.overview.risks, 1);
  assert.equal(result.items[0].threadId, "conversation:1");
  assert.equal(result.items[0].risks[0].level, "high");
  assert.equal(result.items[0].evidence[0].sourceMailId, "mail-1");
  assert.equal(result.items[0].partialContext, true);
});

test("normalizeThreadAnalysis keeps old or partial JSON compatible", () => {
  const result = normalizeThreadAnalysis({
    items: [
      {
        threadId: "thread-1",
        category: "not-real",
        priority: "urgent",
        participants: "Alice",
        risks: [{ level: "critical", description: "Unknown", sourceMailId: "mail-1" }]
      }
    ]
  });

  assert.equal(result.items[0].category, "uncertain");
  assert.equal(result.items[0].priority, "P2");
  assert.deepEqual(result.items[0].participants, []);
  assert.equal(result.items[0].risks[0].level, "medium");
  assert.equal(result.overview.totalThreads, 1);
});

test("normalizeThreadAnalysis recomputes overview from items", () => {
  const result = normalizeThreadAnalysis({
    overview: { totalThreads: 99, mustHandleToday: 99, risks: 99, waitingForMe: 99, notices: 99 },
    items: [
      {
        threadId: "thread-1",
        category: "risk",
        priority: "P1",
        participants: []
      }
    ]
  });

  assert.equal(result.overview.totalThreads, 1);
  assert.equal(result.overview.risks, 1);
  assert.equal(result.overview.notices, 0);
});
