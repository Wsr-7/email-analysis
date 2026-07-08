import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AppDataStore } from "../lib/app-data";
import { analyzeBatchCore, analyzeThreadCore, sendPromptToModel, splitByTokenBudget } from "../lib/app-analysis";
import { emptyMailIndex, type StoredMail } from "../lib/mail-store";
import { MockProvider } from "../lib/mock-provider";
import type { LlmProvider, LlmRequestOptions } from "../lib/llm-provider";

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

function analysisResponse(mailId: string): string {
  return JSON.stringify({
    generatedAt: "",
    overview: {},
    items: [{
      mailId,
      category: "notice",
      priority: "P3",
      subject: `Subject ${mailId}`,
      sender: "sender@example.com",
      receivedTime: "2026-07-02 09:00:00",
      summary: "Informational update.",
      reason: "No action needed.",
      suggestedAction: "No action.",
      draftReply: "",
      confidence: 0.9,
      needsOriginalMailCheck: false
    }]
  });
}

describe("analyzeBatchCore", () => {
  it("splits mails by token budget without looping on oversized mails", () => {
    const mails = Array.from({ length: 5 }, (_, index) => ({ ...mail(index + 1), bodyExcerpt: "x".repeat(100) }));
    const chunks = splitByTokenBudget(mails, 1100, 400);

    assert.deepEqual(chunks.map((chunk) => chunk.map((item) => item.mailId)), [
      ["mail-001", "mail-002"],
      ["mail-003", "mail-004"],
      ["mail-005"]
    ]);

    const hugeChunks = splitByTokenBudget([{ ...mail(99), bodyExcerpt: "x".repeat(10000) }, mail(100)], 900, 400);
    assert.equal(hugeChunks[0].length, 1);
    assert.equal(hugeChunks[0][0].mailId, "mail-099");
    assert.equal(hugeChunks[1][0].mailId, "mail-100");
  });

  it("passes the selected model to the provider", async () => {
    const selectedModel = { vendor: "mock", family: "mock-model", id: "mock-model", name: "Mock Model" };
    let capturedOptions: LlmRequestOptions | undefined;
    const provider: LlmProvider = {
      listModels: async () => [selectedModel],
      sendPrompt: async (_prompt, options) => {
        capturedOptions = options;
        return { rawText: "{}", model: selectedModel, usedFallback: false };
      }
    };

    await sendPromptToModel({
      data: {
        readCachedAvailableModels: async () => [selectedModel],
        writeModelInfo: async () => {}
      } as unknown as AppDataStore,
      llmProvider: provider,
      extensionPath: process.cwd(),
      readConfig: async () => ({}),
      log: async () => {},
      availableModelsCache: null
    }, "prompt", "mock-model", "test");

    assert.deepEqual(capturedOptions?.model, selectedModel);
  });

  it("keeps successful chunks when one chunk fails JSON parsing and repair", async () => {
    const globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "easy-mail-test-"));
    try {
      const data = new AppDataStore({ globalStoragePath, extensionPath: process.cwd() });
      await data.ensureConfig();
      await fs.mkdir(data.getDataDir(), { recursive: true });
      await data.writeMailStore({
        generatedAt: "2026-07-02T00:00:00.000Z",
        lastPullAt: "2026-07-02T00:00:00.000Z",
        items: [1, 2, 3].map((index) => ({ ...mail(index), bodyExcerpt: "x".repeat(2400) }))
      });
      await data.writeMailIndex(emptyMailIndex());
      await data.writeIgnoredIds([]);
      await data.writeAvailableModels([{ vendor: "mock", family: "mock-model", id: "mock-model", name: "Mock Model", maxInputTokens: 1000 }]);

      const provider = new MockProvider({
        responses: [
          analysisResponse("mail-001"),
          "{not json",
          "{still not json",
          analysisResponse("mail-003")
        ]
      });

      await analyzeBatchCore({
        data,
        llmProvider: provider,
        extensionPath: process.cwd(),
        readConfig: async () => ({
          autoAnalyzeMaxClassificationLevel: 2,
          modelFamily: "mock-model",
          outputLanguage: "en-US"
        }),
        log: async () => {},
        availableModelsCache: null
      }, "allAllowed");

      const result = await data.readAnalysisResult(async () => ({ outputLanguage: "en-US" }));
      assert.deepEqual(result.items.map((item) => item.mailId).sort(), ["mail-001", "mail-003"]);
      assert.equal(provider.prompts.length, 4);
      assert.match(provider.prompts[2], /Fix this invalid JSON response/);
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });

  it("fails when every chunk fails JSON parsing and repair", async () => {
    const globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "easy-mail-test-"));
    try {
      const data = new AppDataStore({ globalStoragePath, extensionPath: process.cwd() });
      await data.ensureConfig();
      await fs.mkdir(data.getDataDir(), { recursive: true });
      await data.writeMailStore({
        generatedAt: "2026-07-02T00:00:00.000Z",
        lastPullAt: "2026-07-02T00:00:00.000Z",
        items: [1, 2].map((index) => ({ ...mail(index), bodyExcerpt: "x".repeat(2400) }))
      });
      await data.writeMailIndex(emptyMailIndex());
      await data.writeIgnoredIds([]);
      await data.writeAvailableModels([{ vendor: "mock", family: "mock-model", id: "mock-model", name: "Mock Model", maxInputTokens: 1000 }]);

      const provider = new MockProvider({
        responses: ["{not json", "{still not json", "{not json either", "{still not json either"]
      });

      await assert.rejects(
        () => analyzeBatchCore({
          data,
          llmProvider: provider,
          extensionPath: process.cwd(),
          readConfig: async () => ({
            autoAnalyzeMaxClassificationLevel: 2,
            modelFamily: "mock-model",
            outputLanguage: "en-US"
          }),
          log: async () => {},
          availableModelsCache: null
        }, "allAllowed"),
        /All analysis chunks failed/
      );
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });

  it("accounts for fixed prompt overhead when chunking by model token budget", async () => {
    const globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "easy-mail-test-"));
    try {
      const data = new AppDataStore({ globalStoragePath, extensionPath: process.cwd() });
      await data.ensureConfig();
      await fs.mkdir(data.getDataDir(), { recursive: true });
      await data.writeMailStore({
        generatedAt: "2026-07-02T00:00:00.000Z",
        lastPullAt: "2026-07-02T00:00:00.000Z",
        items: [1, 2].map((index) => ({ ...mail(index), bodyExcerpt: "x".repeat(3500) }))
      });
      await data.writeMailIndex(emptyMailIndex());
      await data.writeIgnoredIds([]);
      await data.writeAvailableModels([{ vendor: "mock", family: "mock-model", id: "mock-model", name: "Mock Model", maxInputTokens: 3000 }]);

      const provider = new MockProvider({
        responses: [analysisResponse("mail-001"), analysisResponse("mail-002")]
      });

      const result = await analyzeBatchCore({
        data,
        llmProvider: provider,
        extensionPath: process.cwd(),
        readConfig: async () => ({
          autoAnalyzeMaxClassificationLevel: 2,
          modelFamily: "mock-model",
          outputLanguage: "en-US"
        }),
        log: async () => {},
        availableModelsCache: null
      }, "allAllowed");

      assert.equal(result.batchSize, 2);
      assert.equal(provider.prompts.length, 2);
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });

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
          autoAnalyzeEnabled: true,
          autoAnalyzeMaxClassificationLevel: 2,
          modelFamily: "mock-model",
          outputLanguage: "en-US"
        }),
        log: async () => {},
        availableModelsCache: null
      }, 50);

      assert.equal(result.batchSize, 50);
      const sentPrompts = provider.prompts.join("\n");
      assert.match(sentPrompts, /## Mail: mail-050/);
      assert.doesNotMatch(sentPrompts, /## Mail: mail-051/);
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });

  it("injects today's date into the sent prompt", async () => {
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
        responses: [JSON.stringify({ generatedAt: "", overview: {}, items: [] })]
      });

      await analyzeBatchCore({
        data,
        llmProvider: provider,
        extensionPath: process.cwd(),
        readConfig: async () => ({
          autoAnalyzeEnabled: true,
          autoAnalyzeMaxClassificationLevel: 2,
          modelFamily: "mock-model",
          outputLanguage: "en-US"
        }),
        log: async () => {},
        availableModelsCache: null
      });

      const today = new Date();
      const expectedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      assert.match(provider.prompts[0], new RegExp(`Today is ${expectedDate} \\(.+\\)\\.`));
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

  it("translates generated draft replies to English when analysis returns Chinese draft fields", async () => {
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
        responses: [
          JSON.stringify({
            generatedAt: "",
            overview: {},
            items: [{
              mailId: "mail-001",
              category: "waitingForMe",
              priority: "P1",
              subject: "Subject 1",
              sender: "sender1@example.com",
              receivedTime: "2026-07-02 09:01:00",
              summary: "Needs reply.",
              reason: "Asked for confirmation.",
              suggestedAction: "Reply.",
              draftReply: "您好，我会确认。",
              draftReplyParts: { GREETING: "您好", MAIN_MESSAGE: "我会确认。" },
              confidence: 0.9,
              needsOriginalMailCheck: false
            }]
          }),
          JSON.stringify({
            items: [{
              mailId: "mail-001",
              draftReply: "Hi, I will confirm.",
              draftReplyParts: { GREETING: "Hi,", MAIN_MESSAGE: "I will confirm." }
            }]
          })
        ]
      });

      await analyzeBatchCore({
        data,
        llmProvider: provider,
        extensionPath: process.cwd(),
        readConfig: async () => ({
          autoAnalyzeMaxClassificationLevel: 2,
          modelFamily: "mock-model",
          outputLanguage: "en-US"
        }),
        log: async () => {},
        availableModelsCache: null
      });

      const result = await data.readAnalysisResult(async () => ({ outputLanguage: "en-US" }));
      assert.equal(result.items[0].draftReply, "Hi, I will confirm.");
      assert.equal(result.items[0].draftReplyParts?.MAIN_MESSAGE, "I will confirm.");
      assert.equal(provider.prompts.length, 2);
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

  it("injects today's date into the sent thread analysis prompt", async () => {
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
            bodyPreview: "Please confirm the contract.",
            bodyClean: "Please confirm the contract.",
            bodyDelta: "Please confirm the contract.",
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
        responses: [JSON.stringify({
          generatedAt: "",
          overview: {},
          items: [{
            threadId: "thread-1",
            category: "waitingForMe",
            priority: "P1",
            subject: "Contract",
            oneLineSummary: "Confirmation needed.",
            currentStatus: "Waiting.",
            keyDecisions: [],
            openQuestions: [],
            actionItems: [],
            waitingOn: [],
            risks: [],
            needMyReply: true,
            suggestedAction: "Reply.",
            draftReply: "",
            confidence: 0.9,
            partialContext: false
          }]
        })]
      });

      await analyzeThreadCore({
        data,
        llmProvider: provider,
        extensionPath: process.cwd(),
        readConfig: async () => ({ modelFamily: "mock-model", outputLanguage: "en-US", autoAnalyzeMaxClassificationLevel: 2 }),
        log: async () => {},
        availableModelsCache: null
      }, "thread-1");

      const today = new Date();
      const expectedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      assert.match(provider.prompts[0], new RegExp(`Today is ${expectedDate} \\(.+\\)\\.`));
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });
});
