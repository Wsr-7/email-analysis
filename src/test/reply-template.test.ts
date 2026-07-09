import test from "node:test";
import assert from "node:assert/strict";
import { applyReplyTemplateToAnalysis, defaultReplyTemplate, renderReplyDraftFromTemplate, validateReplyTemplate } from "../lib/reply-template";
import type { AnalysisResult } from "../lib/analysis-schema";

test("renderReplyDraftFromTemplate replaces fixed placeholders", () => {
  const draft = renderReplyDraftFromTemplate(defaultReplyTemplate(), {
    GREETING: "Hi Alice,",
    MAIN_MESSAGE: "I reviewed the contract.",
    REQUESTED_ACTION: "Please send the final copy.",
    CLOSING: "Thanks,"
  });

  assert.equal(draft, "Hi Alice,\n\nI reviewed the contract.\n\nPlease send the final copy.\n\nThanks,");
});

test("renderReplyDraftFromTemplate falls back when model provided no parts", () => {
  assert.equal(renderReplyDraftFromTemplate(defaultReplyTemplate(), {}, "Fallback draft."), "Fallback draft.");
});

test("validateReplyTemplate reports missing required placeholders", () => {
  assert.deepEqual(validateReplyTemplate("{{GREETING}}\n{{MAIN_MESSAGE}}"), ["REQUESTED_ACTION", "CLOSING"]);
});

test("applyReplyTemplateToAnalysis updates only items with draft parts", () => {
  const analysis: AnalysisResult = {
    generatedAt: "2026-06-18T00:00:00.000Z",
    overview: { totalMails: 2, mustHandleToday: 0, risks: 0, waitingForMe: 1, notices: 1 },
    items: [
      {
        mailId: "mail-1",
        category: "waitingForMe",
        priority: "P1",
        subject: "Question",
        sender: "Alice",
        receivedTime: "2026-06-18 09:00:00",
        summary: "",
        reason: "",
        suggestedAction: "",
        draftReply: "",
        draftReplyParts: {
          GREETING: "Hi Alice,",
          MAIN_MESSAGE: "Confirmed.",
          REQUESTED_ACTION: "",
          CLOSING: "Thanks,"
        },
        confidence: 0.8,
        needsOriginalMailCheck: false
      },
      {
        mailId: "mail-2",
        category: "notice",
        priority: "P3",
        subject: "Notice",
        sender: "System",
        receivedTime: "2026-06-18 10:00:00",
        summary: "",
        reason: "",
        suggestedAction: "",
        draftReply: "",
        confidence: 0.9,
        needsOriginalMailCheck: false
      }
    ]
  };

  const result = applyReplyTemplateToAnalysis(analysis, defaultReplyTemplate());
  assert.match(result.items[0].draftReply, /Hi Alice,/);
  assert.equal(result.items[1].draftReply, "");
});
