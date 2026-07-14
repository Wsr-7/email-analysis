import test from "node:test";
import assert from "node:assert/strict";
import { buildSingleMailReport } from "../lib/reports/report-single-mail";
import type { AnalysisResult } from "../lib/analysis/analysis-schema";

test("buildSingleMailReport renders analyzed fields and security review signals", () => {
  const result: AnalysisResult = {
    generatedAt: "2026-06-17T09:00:00.000Z",
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
        subject: "Contract approval",
        sender: "Alice",
        receivedTime: "2026-06-17 08:30:00",
        summary: "Alice needs approval today.",
        reason: "The analyzed summary indicates a same-day approval deadline.",
        suggestedAction: "Reply with approval status.",
        draftReply: "I can approve this today.",
        confidence: 0.82,
        needsOriginalMailCheck: true,
        evidence: [
          {
            sourceMailId: "mail-001",
            quote: "[REDACTED_EMAIL_1] requested approval today.",
            reason: "Shows requested action."
          }
        ]
      }
    ]
  };

  const report = buildSingleMailReport(result);

  assert.match(report, /^# Single Mail Report/m);
  assert.match(report, /Generated: 2026-06-17T09:00:00.000Z/);
  assert.match(report, /## P0 Contract approval/);
  assert.match(report, /- Needs original mail check: Yes/);
  assert.match(report, /### Evidence/);
  assert.match(report, /\[mail-001\] \[REDACTED_EMAIL_1\] requested approval today\. — Shows requested action\./);
  assert.match(report, /### Draft Reply/);
  assert.match(report, /I can approve this today\./);
});

test("buildSingleMailReport omits empty optional sections", () => {
  const result: AnalysisResult = {
    generatedAt: "2026-06-17T09:00:00.000Z",
    overview: {
      totalMails: 1,
      mustHandleToday: 0,
      risks: 0,
      waitingForMe: 0,
      notices: 1
    },
    items: [
      {
        mailId: "mail-002",
        category: "notice",
        priority: "P3",
        subject: "FYI",
        sender: "System",
        receivedTime: "2026-06-17 08:40:00",
        summary: "Routine notice.",
        reason: "No action requested.",
        suggestedAction: "No action.",
        draftReply: "",
        confidence: 0.7,
        needsOriginalMailCheck: false
      }
    ]
  };

  const report = buildSingleMailReport(result);

  assert.doesNotMatch(report, /### Evidence/);
  assert.doesNotMatch(report, /### Draft Reply/);
  assert.match(report, /- Needs original mail check: No/);
});
