import test from "node:test";
import assert from "node:assert/strict";
import { buildSummaryMarkdown } from "../lib/analysis/summary";

test("buildSummaryMarkdown renders categories and draft blocks", () => {
  const markdown = buildSummaryMarkdown({
    generatedAt: "2026-06-16T10:35:00+08:00",
    overview: {
      totalMails: 1,
      mustHandleToday: 1,
      risks: 0,
      waitingForMe: 0,
      notices: 0
    },
    items: [
      {
        mailId: "mail-001",
        category: "mustHandleToday",
        priority: "P0",
        subject: "Contract approval needed",
        sender: "Alice",
        receivedTime: "2026-06-16 09:12:00",
        summary: "Approval needed.",
        reason: "Deadline today.",
        suggestedAction: "Reply now.",
        draftReply: "I will review today.",
        confidence: 0.8,
        needsOriginalMailCheck: false
      }
    ]
  });

  assert.match(markdown, /## Must Handle Today/);
  assert.match(markdown, /```text/);
  assert.match(markdown, /I will review today/);
  assert.doesNotMatch(markdown, /Evidence/);
});

test("buildSummaryMarkdown renders optional evidence when present", () => {
  const markdown = buildSummaryMarkdown({
    generatedAt: "2026-06-16T10:35:00+08:00",
    overview: {
      totalMails: 1,
      mustHandleToday: 0,
      risks: 0,
      waitingForMe: 0,
      notices: 0
    },
    items: [
      {
        mailId: "mail-001",
        category: "followUp",
        priority: "P1",
        subject: "Status update",
        sender: "Alice",
        receivedTime: "2026-06-16 09:12:00",
        summary: "Alice asked for a status update.",
        reason: "Direct request.",
        suggestedAction: "Reply today.",
        draftReply: "I will send the update today.",
        confidence: 0.9,
        needsOriginalMailCheck: false,
        evidence: [
          {
            sourceMailId: "mail-001",
            quote: "Could you send the current status today?",
            reason: "Shows the requested action."
          }
        ]
      }
    ]
  });

  assert.match(markdown, /- Evidence:/);
  assert.match(markdown, /source: mail-001/);
  assert.match(markdown, /Could you send the current status today\?/);
  assert.match(markdown, /Shows the requested action\./);
});
