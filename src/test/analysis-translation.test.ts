import test from "node:test";
import assert from "node:assert/strict";
import { applyAnalysisTranslation, buildAnalysisTranslationPrompt } from "../lib/analysis-translation";
import type { AnalysisResult } from "../lib/analysis-schema";
import type { ThreadAnalysisResult } from "../lib/thread-analysis-schema";

const mail: AnalysisResult = {
  generatedAt: "2026-06-18T00:00:00.000Z",
  language: "en-US",
  overview: { totalMails: 1, mustHandleToday: 0, risks: 0, waitingForMe: 1, notices: 0 },
  items: [
    {
      mailId: "mail-1",
      category: "waitingForMe",
      priority: "P1",
      subject: "Question",
      sender: "Alice",
      receivedTime: "2026-06-18 09:00:00",
      summary: "Alice needs confirmation.",
      reason: "The mail asks for confirmation.",
      suggestedAction: "Reply today.",
      draftReply: "Hi Alice,\n\nConfirmed.\n\nThanks,",
      confidence: 0.9,
      needsOriginalMailCheck: false
    }
  ]
};

const threads: ThreadAnalysisResult = {
  generatedAt: "2026-06-18T00:00:00.000Z",
  language: "en-US",
  overview: { totalThreads: 1, mustHandleToday: 0, risks: 1, waitingForMe: 0, notices: 0 },
  items: [
    {
      threadId: "thread-1",
      category: "risk",
      priority: "P1",
      subject: "Approval",
      participants: ["Alice"],
      lastTime: "2026-06-18 09:00:00",
      oneLineSummary: "Approval is pending.",
      currentStatus: "Waiting for approval.",
      keyDecisions: ["No decision yet."],
      openQuestions: ["Who approves?"],
      actionItems: [{ owner: "me", task: "Confirm owner", deadline: "today", sourceMailId: "mail-1", sourceTime: "09:00" }],
      waitingOn: [],
      risks: [{ level: "medium", description: "Delay risk.", sourceMailId: "mail-1" }],
      needMyReply: true,
      suggestedAction: "Reply today.",
      draftReply: "Hi Alice,\n\nI will confirm.\n\nThanks,",
      confidence: 0.8,
      evidence: [],
      needsOriginalMailCheck: false,
      partialContext: false
    }
  ]
};

test("buildAnalysisTranslationPrompt excludes draft reply translation instructions", () => {
  const prompt = buildAnalysisTranslationPrompt({ mail, threads, targetLanguage: "zh-CN" });
  assert.match(prompt, /Simplified Chinese/);
  assert.match(prompt, /Do not translate original mail content/);
  assert.doesNotMatch(prompt, /Hi Alice,\\n\\nConfirmed/);
});

test("applyAnalysisTranslation updates display fields and preserves draft replies", () => {
  const result = applyAnalysisTranslation({
    mail,
    threads,
    targetLanguage: "zh-CN",
    translated: {
      mail: [
        {
          mailId: "mail-1",
          summary: "Alice 需要确认。",
          reason: "邮件要求确认。",
          suggestedAction: "今天回复。"
        }
      ],
      threads: [
        {
          threadId: "thread-1",
          oneLineSummary: "审批待处理。",
          currentStatus: "正在等待审批。",
          keyDecisions: ["尚未决策。"],
          openQuestions: ["谁来审批？"],
          actionItems: [{ index: 0, task: "确认负责人" }],
          risks: [{ index: 0, description: "存在延迟风险。" }],
          suggestedAction: "今天回复。"
        }
      ]
    }
  });

  assert.equal(result.mail.language, "zh-CN");
  assert.equal(result.mail.items[0].summary, "Alice 需要确认。");
  assert.equal(result.mail.items[0].draftReply, mail.items[0].draftReply);
  assert.equal(result.threads.language, "zh-CN");
  assert.equal(result.threads.items[0].actionItems[0].task, "确认负责人");
  assert.equal(result.threads.items[0].risks[0].description, "存在延迟风险。");
  assert.equal(result.threads.items[0].draftReply, threads.items[0].draftReply);
});
