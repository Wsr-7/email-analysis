import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyBrief } from "../lib/reports/report-daily";
import type { AnalysisResult } from "../lib/analysis/analysis-schema";
import type { ThreadAnalysisResult } from "../lib/analysis/thread-analysis-schema";

test("buildDailyBrief combines high-level single mail and thread analysis", () => {
  const mailResult: AnalysisResult = {
    generatedAt: "2026-06-17T08:00:00.000Z",
    overview: {
      totalMails: 2,
      mustHandleToday: 1,
      risks: 0,
      waitingForMe: 0,
      notices: 1
    },
    items: [
      {
        mailId: "mail-001",
        category: "mustHandleToday",
        priority: "P0",
        subject: "Approve budget",
        sender: "Alice",
        receivedTime: "2026-06-17 07:30:00",
        summary: "Budget approval is due today.",
        reason: "Same-day deadline.",
        suggestedAction: "Reply with approval.",
        draftReply: "Approved.",
        confidence: 0.9,
        needsOriginalMailCheck: false
      },
      {
        mailId: "mail-002",
        category: "notice",
        priority: "P3",
        subject: "Office notice",
        sender: "Admin",
        receivedTime: "2026-06-17 07:40:00",
        summary: "Routine office notice.",
        reason: "No action.",
        suggestedAction: "Read later.",
        draftReply: "",
        confidence: 0.8,
        needsOriginalMailCheck: false
      }
    ]
  };
  const threadResult: ThreadAnalysisResult = {
    generatedAt: "2026-06-17T08:10:00.000Z",
    overview: {
      totalThreads: 1,
      mustHandleToday: 0,
      risks: 1,
      waitingForMe: 0,
      notices: 0
    },
    items: [
      {
        threadId: "thread-001",
        category: "risk",
        priority: "P1",
        subject: "Release window",
        participants: ["Bob"],
        lastTime: "2026-06-17 08:05:00",
        oneLineSummary: "Release window has a blocker.",
        currentStatus: "Waiting for risk owner.",
        keyDecisions: [],
        openQuestions: [],
        actionItems: [],
        waitingOn: [],
        risks: [],
        needMyReply: false,
        suggestedAction: "Track the risk owner.",
        draftReply: "",
        confidence: 0.72,
        evidence: [],
        needsOriginalMailCheck: true,
        partialContext: true
      }
    ]
  };

  const report = buildDailyBrief(mailResult, threadResult, "2026-06-17");

  assert.match(report, /^# Daily Brief - 2026-06-17/m);
  assert.match(report, /## Overview/);
  assert.match(report, /- Single mails: 2/);
  assert.match(report, /- Threads: 1/);
  assert.match(report, /## Top Single Mails/);
  assert.match(report, /- P0 Approve budget — Budget approval is due today\. \(action: Reply with approval\.\)/);
  assert.match(report, /## Top Threads/);
  assert.match(report, /- P1 Release window — Release window has a blocker\. \(action: Track the risk owner\.\)/);
  assert.match(report, /## Review Flags/);
  assert.match(report, /- thread thread-001: partial context; needs original mail check/);
});

test("buildDailyBrief accepts missing thread result", () => {
  const mailResult: AnalysisResult = {
    generatedAt: "2026-06-17T08:00:00.000Z",
    overview: {
      totalMails: 0,
      mustHandleToday: 0,
      risks: 0,
      waitingForMe: 0,
      notices: 0
    },
    items: []
  };

  const report = buildDailyBrief(mailResult);

  assert.match(report, /- Single mails: 0/);
  assert.match(report, /- Threads: 0/);
  assert.doesNotMatch(report, /## Top Threads/);
});
