import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AppDataStore } from "../lib/app-data";
import { analyzeBatchCore, analyzeThreadCore } from "../lib/app-analysis";
import { emptyMailIndex, type StoredMail } from "../lib/mail-store";
import { MockProvider } from "../lib/mock-provider";

function mail(index: number): StoredMail {
  const id = `mail-${String(index).padStart(3, "0")}`;
  return {
    mailId: id,
    sourceMailId: id,
    internetMessageId: "",
    entryId: id,
    subject: `Subject ${index}`,
    from: `sender${index}@example.com`,
    receivedTime: `2026-07-02 09:${String(index % 60).padStart(2, "0")}:00`,
    folder: "Inbox",
    unread: "true",
    importance: "normal",
    toMe: "true",
    ccMe: "false",
    bodyExcerpt: `Body ${index}`,
    pulledAt: "2026-07-02T00:00:00.000Z"
  };
}

describe("analyzeBatchCore", () => {
  it("uses explicit batch size instead of saved config batch size", async () => {
    const globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "easy-mail-test-"));
    try {
      const data = new AppDataStore({ globalStoragePath, extensionPath: process.cwd() });
      await data.ensureConfig();
      await fs.mkdir(data.getDataDir(), { recursive: true });
      await data.writeMailStore({
        generatedAt: "2026-07-02T00:00:00.000Z",
        lastPullAt: "2026-07-02T00:00:00.000Z",
        items: Array.from({ length: 60 }, (_, i) => mail(i + 1))
      });
      await data.writeMailIndex(emptyMailIndex());
      await data.writeIgnoredIds([]);
      await data.writeAvailableModels([{ vendor: "mock", family: "mock-model", id: "mock-model", name: "Mock Model" }]);

      const provider = new MockProvider({
        responses: [JSON.stringify({ generatedAt: "", overview: {}, items: [] })]
      });

      const result = await analyzeBatchCore({
        data,
        llmProvider: provider,
        extensionPath: process.cwd(),
        readConfig: async () => ({
          analysisBatchSize: 5,
          autoAnalyzeEnabled: true,
          autoAnalyzeMaxClassificationLevel: 2,
          modelFamily: "mock-model",
          outputLanguage: "en-US"
        }),
        log: async () => {},
        availableModelsCache: null
      }, 50);

      assert.equal(result.batchSize, 50);
      assert.match(provider.prompts[0], /MaxItems: 50/);
      assert.match(provider.prompts[0], /## Mail: mail-050/);
      assert.doesNotMatch(provider.prompts[0], /## Mail: mail-051/);
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });

  it("keeps analyzed mails in the mail store for body, draft, and thread context", async () => {
    const globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "easy-mail-test-"));
    try {
      const data = new AppDataStore({ globalStoragePath, extensionPath: process.cwd() });
      await data.ensureConfig();
      await fs.mkdir(data.getDataDir(), { recursive: true });
      await data.writeMailStore({
        generatedAt: "2026-07-02T00:00:00.000Z",
        lastPullAt: "2026-07-02T00:00:00.000Z",
        items: [mail(1)]
      });
      await data.writeMailIndex(emptyMailIndex());
      await data.writeIgnoredIds([]);
      await data.writeAvailableModels([{ vendor: "mock", family: "mock-model", id: "mock-model", name: "Mock Model" }]);

      const provider = new MockProvider({
        responses: [JSON.stringify({
          generatedAt: "",
          overview: {},
          items: [{
            mailId: "mail-001",
            category: "notice",
            priority: "P3",
            subject: "Subject 1",
            sender: "sender1@example.com",
            receivedTime: "2026-07-02 09:01:00",
            summary: "Informational update.",
            reason: "No action needed.",
            suggestedAction: "No action.",
            draftReply: "",
            confidence: 0.9,
            needsOriginalMailCheck: false
          }]
        })]
      });

      await analyzeBatchCore({
        data,
        llmProvider: provider,
        extensionPath: process.cwd(),
        readConfig: async () => ({
          analysisBatchSize: 5,
          autoAnalyzeMaxClassificationLevel: 2,
          modelFamily: "mock-model",
          outputLanguage: "en-US"
        }),
        log: async () => {},
        availableModelsCache: null
      });

      const store = await data.readMailStore();
      assert.equal(store.items.length, 1);
      assert.equal(store.items[0].mailId, "mail-001");
      assert.equal(store.items[0].bodyExcerpt, "Body 1");
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });

  it("translates English thread analysis fallback when model returns Chinese fields", async () => {
    const globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "easy-mail-test-"));
    try {
      const data = new AppDataStore({ globalStoragePath, extensionPath: process.cwd() });
      await data.ensureConfig();
      await fs.mkdir(data.getDataDir(), { recursive: true });
      await data.writeMailStore({
        generatedAt: "2026-07-02T00:00:00.000Z",
        lastPullAt: "2026-07-02T00:00:00.000Z",
        items: [mail(1)]
      });
      await data.writeThreadStore({
        generatedAt: "",
        lastBuiltAt: "",
        items: [{
          threadId: "thread-1",
          conversationId: "thread-1",
          normalizedSubject: "contract",
          subject: "Contract",
          participants: ["Alice <alice@example.com>"],
          folders: ["Inbox"],
          startTime: "2026-07-02 09:00:00",
          lastTime: "2026-07-02 09:00:00",
          messageCount: 1,
          unreadCount: 1,
          hasAttachments: false,
          sourceMailIds: ["mail-001"],
          contentStatus: "available",
          timeline: [{
            mailId: "mail-001",
            internetMessageId: "",
            entryId: "mail-001",
            conversationId: "thread-1",
            conversationIndex: "",
            subject: "Contract",
            from: "Alice <alice@example.com>",
            senderName: "Alice",
            senderEmail: "alice@example.com",
            receivedTime: "2026-07-02 09:00:00",
            sentTime: "",
            folder: "Inbox",
            bodyPreview: "请确认合同。",
            bodyClean: "请确认合同。",
            bodyDelta: "请确认合同。",
            bodyHash: "",
            isDuplicateBody: false,
            contentAvailable: true,
            attachmentCount: 0,
            attachmentNames: []
          }],
          security: { totalMessages: 1, allowedMessages: 1, manualConfirmMessages: 0, blockedMessages: 0, highestClassificationLevel: 1, partialContext: false, reasons: [] }
        }]
      });
      await data.writeClassificationCache({ generatedAt: "", items: [{ mailId: "mail-001", level: 1, label: "INTERNAL", source: "test", reason: "", updatedAt: "" }] });
      await data.writeAvailableModels([{ vendor: "mock", family: "mock-model", id: "mock-model", name: "Mock Model" }]);

      const provider = new MockProvider({
        responses: [
          JSON.stringify({
            generatedAt: "",
            overview: {},
            items: [{
              threadId: "thread-1",
              category: "waitingForMe",
              priority: "P1",
              subject: "Contract",
              oneLineSummary: "需要确认合同。",
              currentStatus: "等待确认。",
              keyDecisions: [],
              openQuestions: ["是否批准？"],
              actionItems: [],
              waitingOn: [],
              risks: [],
              needMyReply: true,
              suggestedAction: "回复确认。",
              draftReply: "",
              confidence: 0.9,
              partialContext: false
            }]
          }),
          JSON.stringify({
            mail: [],
            threads: [{
              threadId: "thread-1",
              oneLineSummary: "Contract confirmation is needed.",
              currentStatus: "Waiting for confirmation.",
              keyDecisions: [],
              openQuestions: ["Can it be approved?"],
              actionItems: [],
              risks: [],
              suggestedAction: "Reply with confirmation."
            }]
          })
        ]
      });

      await analyzeThreadCore({
        data,
        llmProvider: provider,
        extensionPath: process.cwd(),
        readConfig: async () => ({ modelFamily: "mock-model", outputLanguage: "en-US", autoAnalyzeMaxClassificationLevel: 2 }),
        log: async () => {},
        availableModelsCache: null
      }, "thread-1");

      const result = await data.readThreadAnalysisResult();
      assert.equal(result.items[0].currentStatus, "Waiting for confirmation.");
      assert.equal(result.items[0].openQuestions[0], "Can it be approved?");
      assert.equal(provider.prompts.length, 2);
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });
});
