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
    draftLanguage: "auto",
    thread: thread()
  });

  assert.match(prompt, /Base rules/);
  assert.match(prompt, /Analyze thread/);
  assert.match(prompt, /Return JSON/);
  assert.match(prompt, /Language Contract/);
  assert.match(prompt, /all natural-language thread analysis fields.*keyDecisions.*waitingOn.*evidence\.reason.*Simplified Chinese/s);
  assert.match(prompt, /draftReply.*source thread language/s);
  assert.match(prompt, /"threadId": "conversation:conv-1"/);
  assert.doesNotMatch(prompt, /## Mail:/);
});

test("buildThreadAnalysisPrompt can pin draft replies to English", () => {
  const prompt = buildThreadAnalysisPrompt({
    basePrompt: "Base rules",
    analysisPrompt: "Analyze thread",
    outputSchemaPrompt: "Return JSON",
    outputLanguage: "en-US",
    draftLanguage: "en",
    thread: thread()
  });

  assert.match(prompt, /all natural-language thread analysis fields.*suggestedAction.*English/s);
  assert.match(prompt, /draftReply.*English/s);
});

test("buildThreadAnalysisPrompt injects today's date in the local timezone", () => {
  const prompt = buildThreadAnalysisPrompt({
    basePrompt: "Base rules",
    analysisPrompt: "Analyze thread",
    outputSchemaPrompt: "Return JSON",
    outputLanguage: "en-US",
    draftLanguage: "auto",
    thread: thread(),
    now: new Date(2026, 6, 8, 23, 30, 0)
  });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.match(prompt, new RegExp(`Today is 2026-07-08 \\(${timeZone.replace(/\//g, "\\/")}\\)\\.`));
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
