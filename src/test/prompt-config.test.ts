import test from "node:test";
import assert from "node:assert/strict";
import { composeAnalysisPrompt, normalizePromptConfig } from "../lib/prompt-config";

test("composeAnalysisPrompt includes custom categories and language instruction", () => {
  const config = normalizePromptConfig({
    categories: [
      { id: "vipCustomer", labelZh: "VIP 客户", labelEn: "VIP Customer", description: "Important customer mail" }
    ],
    replyDraftInstruction: "Keep replies short."
  });
  const prompt = composeAnalysisPrompt({
    basePrompt: "Base",
    outputSchemaPrompt: "Schema",
    replyDraftPrompt: "Fill draftReplyParts.",
    replyTemplate: "{{GREETING}}\n{{MAIN_MESSAGE}}\n{{REQUESTED_ACTION}}\n{{CLOSING}}",
    digestText: "Digest",
    outputLanguage: "zh-CN",
    promptConfig: config
  });
  assert.match(prompt, /vipCustomer/);
  assert.match(prompt, /Keep replies short/);
  assert.match(prompt, /Fill draftReplyParts/);
  assert.match(prompt, /{{GREETING}}/);
  assert.match(prompt, /Simplified Chinese/);
});

test("composeAnalysisPrompt injects today's date in the local timezone", () => {
  const config = normalizePromptConfig({});
  const prompt = composeAnalysisPrompt({
    basePrompt: "Base",
    outputSchemaPrompt: "Schema",
    digestText: "Digest",
    outputLanguage: "en-US",
    promptConfig: config,
    now: new Date(2026, 6, 8, 23, 30, 0)
  });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.match(prompt, new RegExp(`Today is 2026-07-08 \\(${timeZone.replace(/\//g, "\\/")}\\)\\.`));
});
