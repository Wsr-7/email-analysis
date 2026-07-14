import test from "node:test";
import assert from "node:assert/strict";
import { buildThreadReport } from "../lib/reports/report-thread";
import type { ThreadAnalysisResult } from "../lib/analysis/thread-analysis-schema";

test("buildThreadReport renders thread analysis and partial context signals", () => {
  const result: ThreadAnalysisResult = {
    generatedAt: "2026-06-17T10:00:00.000Z",
    overview: {
      totalThreads: 1,
      mustHandleToday: 0,
      risks: 1,
      waitingForMe: 1,
      notices: 0
    },
    items: [
      {
        threadId: "conversation-001",
        category: "risk",
        priority: "P1",
        subject: "Release approval",
        participants: ["Alice", "Bob"],
        lastTime: "2026-06-17 09:50:00",
        oneLineSummary: "Release is waiting on approval.",
        currentStatus: "Approval is not confirmed.",
        keyDecisions: ["Move release to Thursday."],
        openQuestions: ["Who can approve the release?"],
        actionItems: [
          {
            owner: "Bob",
            task: "Confirm release approver",
            deadline: "Today",
            sourceMailId: "mail-010",
            sourceTime: "2026-06-17 09:45:00"
          }
        ],
        waitingOn: ["Bob"],
        risks: [
          {
            level: "high",
            description: "Release may miss the window.",
            sourceMailId: "mail-011"
          }
        ],
        needMyReply: true,
        suggestedAction: "Reply asking Bob to confirm.",
        draftReply: "Can you confirm who approves this release?",
        confidence: 0.78,
        evidence: [
          {
            sourceMailId: "mail-010",
            quote: "approval still pending",
            reason: "Shows blocker."
          }
        ],
        needsOriginalMailCheck: true,
        partialContext: true
      }
    ]
  };

  const report = buildThreadReport(result);

  assert.match(report, /^# Thread Report/m);
  assert.match(report, /## P1 Release approval/);
  assert.match(report, /- Partial context: Yes/);
  assert.match(report, /- Needs original mail check: Yes/);
  assert.match(report, /### Current Status/);
  assert.match(report, /Approval is not confirmed\./);
  assert.match(report, /### Action Items/);
  assert.match(report, /- Bob: Confirm release approver \(deadline: Today, source: mail-010, time: 2026-06-17 09:45:00\)/);
  assert.match(report, /### Risks/);
  assert.match(report, /- high: Release may miss the window\. \(source: mail-011\)/);
  assert.match(report, /### Draft Reply/);
  assert.match(report, /Can you confirm who approves this release\?/);
});

test("buildThreadReport handles empty collections without placeholder noise", () => {
  const result: ThreadAnalysisResult = {
    generatedAt: "2026-06-17T10:00:00.000Z",
    overview: {
      totalThreads: 1,
      mustHandleToday: 0,
      risks: 0,
      waitingForMe: 0,
      notices: 1
    },
    items: [
      {
        threadId: "conversation-002",
        category: "notice",
        priority: "P3",
        subject: "Newsletter",
        participants: [],
        lastTime: "",
        oneLineSummary: "Routine update.",
        currentStatus: "",
        keyDecisions: [],
        openQuestions: [],
        actionItems: [],
        waitingOn: [],
        risks: [],
        needMyReply: false,
        suggestedAction: "Read later.",
        draftReply: "",
        confidence: 0.6,
        evidence: [],
        needsOriginalMailCheck: false,
        partialContext: false
      }
    ]
  };

  const report = buildThreadReport(result);

  assert.doesNotMatch(report, /### Action Items/);
  assert.doesNotMatch(report, /### Risks/);
  assert.doesNotMatch(report, /### Draft Reply/);
  assert.match(report, /- Partial context: No/);
});
