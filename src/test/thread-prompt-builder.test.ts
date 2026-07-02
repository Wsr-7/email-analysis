import test from "node:test";
import assert from "node:assert/strict";
import { buildThreadAnalysisPrompt, buildThreadPromptPayload } from "../lib/thread-prompt-builder";
import type { ThreadRecord } from "../lib/thread-schema";

test("buildThreadPromptPayload emits JSON-like timeline without markdown digest shape", () => {
  const payload = buildThreadPromptPayload(thread());

  assert.equal(payload.threadId, "conversation:conv-1");
  assert.equal(payload.partialContext, false);
  assert.deepEqual((payload.timeline as Record<string, unknown>[])[0], {
    mailId: "mail-1",
    time: "2026-06-17 09:00:00",
    from: "Alice <alice@example.com>",
    subject: "Release window",
    folder: "Inbox",
    bodyDelta: "Can we move the release window to Thursday?",
    attachmentCount: 0,
    attachmentNames: []
  });
});

test("buildThreadAnalysisPrompt includes prompts, output language, and strict JSON payload", () => {
  const prompt = buildThreadAnalysisPrompt({
    basePrompt: "Base rules",
    analysisPrompt: "Analyze thread",
    outputSchemaPrompt: "Return JSON",
    outputLanguage: "zh-CN",
    thread: thread()
  });

  assert.match(prompt, /Base rules/);
  assert.match(prompt, /Analyze thread/);
  assert.match(prompt, /Return JSON/);
  assert.match(prompt, /Output language:\nzh-CN/);
  assert.match(prompt, /用中文输出所有自然语言 JSON 字符串/);
  assert.match(prompt, /"threadId": "conversation:conv-1"/);
  assert.doesNotMatch(prompt, /## Mail:/);
});

test("buildThreadAnalysisPrompt instructs English translation for natural-language thread fields", () => {
  const prompt = buildThreadAnalysisPrompt({
    basePrompt: "Base rules",
    analysisPrompt: "Analyze thread",
    outputSchemaPrompt: "Return JSON",
    outputLanguage: "en-US",
    thread: thread()
  });

  assert.match(prompt, /Write every natural-language JSON string in English/);
  assert.match(prompt, /Translate Chinese source content into English/);
});

function thread(): ThreadRecord {
  return {
    threadId: "conversation:conv-1",
    conversationId: "conv-1",
    normalizedSubject: "release window",
    subject: "Release window",
    participants: ["Alice <alice@example.com>", "Bob <bob@example.com>"],
    folders: ["Inbox"],
    startTime: "2026-06-17 09:00:00",
    lastTime: "2026-06-17 09:00:00",
    messageCount: 1,
    unreadCount: 1,
    hasAttachments: false,
    sourceMailIds: ["mail-1"],
    contentStatus: "available",
    timeline: [
      {
        mailId: "mail-1",
        internetMessageId: "",
        entryId: "",
        conversationId: "conv-1",
        conversationIndex: "",
        subject: "Release window",
        from: "Alice <alice@example.com>",
        senderName: "Alice",
        senderEmail: "alice@example.com",
        receivedTime: "2026-06-17 09:00:00",
        sentTime: "",
        folder: "Inbox",
        bodyPreview: "Can we move the release window to Thursday?",
        bodyClean: "Can we move the release window to Thursday?",
        bodyDelta: "Can we move the release window to Thursday?",
        bodyHash: "hash",
        isDuplicateBody: false,
        contentAvailable: true,
        attachmentCount: 0,
        attachmentNames: []
      }
    ]
  };
}
