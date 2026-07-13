import assert from "node:assert/strict";
import * as fs from "node:fs";
import Module from "node:module";
import test from "node:test";

let cancellationListener: (() => void) | undefined;
let disposed = 0;
let cancellationRequested = false;
const informationMessages: string[] = [];
const vscodeMock = {
  ProgressLocation: { Notification: 15 },
  LanguageModelChatMessage: { User: (prompt: string) => ({ prompt }) },
  CancellationTokenSource: class { public token = { isCancellationRequested: false }; },
  lm: { selectChatModels: async () => [] as unknown[] },
  window: {
    withProgress: async <T>(_options: unknown, task: (progress: { report: (value: unknown) => void }, token: unknown) => Promise<T>) => task({ report: () => {} }, {
      get isCancellationRequested() { return cancellationRequested; },
      onCancellationRequested: (listener: () => void) => {
        cancellationListener = listener;
        return { dispose: () => { disposed += 1; cancellationListener = undefined; } };
      }
    }),
    showInformationMessage: (message: string) => { informationMessages.push(message); return undefined; }
  }
};

const internalModule = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = internalModule._load;
internalModule._load = (request, parent, isMain) => request === "vscode" ? vscodeMock : originalLoad(request, parent, isMain);
const { EasyMailApp, buildSidebarRenderInput } = require("../extension") as {
  EasyMailApp: new (context: unknown) => object;
  buildSidebarRenderInput: (state: any, availableModels: unknown[], nextActionsStore: unknown, busyKind: string, isBusy: boolean) => any;
};
const { CopilotProvider } = require("../lib/copilot-provider") as { CopilotProvider: new () => { listModels: () => Promise<unknown[]>; sendPrompt: (prompt: string, options: unknown) => Promise<{ rawText: string }> } };
internalModule._load = originalLoad;

async function renderWorkbenchDraft(app: any, draftReply: string): Promise<string> {
  app.loadState = async () => ({
    config: { outputLanguage: "en-US" },
    digestMetadata: { generatedAt: "", rangeMode: "", recentHours: 0, maxItems: 0, folders: [] },
    overview: { totalMails: 1, mustHandleToday: 1, risks: 0, waitingForMe: 0, notices: 0 },
    categories: [{
      id: "mustHandleToday",
      items: [{
        mailId: "m1", category: "mustHandleToday", priority: "P0", subject: "Test", sender: "sender@test.com",
        receivedTime: "", summary: "", reason: "", suggestedAction: "", draftReply, confidence: 1,
        needsOriginalMailCheck: false
      }]
    }]
  });
  app.data.readCachedAvailableModels = async () => [];
  return await app.getWorkbenchHtml();
}

test("runWithBusy reports cancellation immediately without changing cancellation completion semantics", async () => {
  cancellationListener = undefined;
  disposed = 0;
  cancellationRequested = false;
  informationMessages.length = 0;
  let resolveTask!: () => void;
  const task = new Promise<void>((resolve) => { resolveTask = resolve; });
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });
  let refreshes = 0;
  let sidebarUpdates = 0;
  const logs: string[] = [];
  (app as any).log = async (event: string) => { logs.push(event); };
  (app as any).refresh = async () => { refreshes += 1; };
  (app as any).dashboardProvider.update = async () => { sidebarUpdates += 1; };

  const pending = (app as any).runWithBusy("Analyze", "Running", "analyzeNext", async () => await task, () => "Completed.", true, "Cancelling…");
  await new Promise((resolve) => setImmediate(resolve));
  const cancel = cancellationListener as (() => void) | undefined;
  assert.ok(cancel);
  cancellationRequested = true;
  cancel();
  assert.deepEqual(informationMessages, ["EasyMail: Cancelling… Waiting for the current request to finish."]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal((app as any).busy.kind, "cancelling");
  assert.equal(sidebarUpdates, 1);
  assert.equal(refreshes, 1, "cancellation must not rebuild the workbench");

  resolveTask();
  await assert.rejects(() => pending, /cancelled/i);
  assert.equal((app as any).busy, null);
  assert.equal(disposed, 1);
  assert.ok(!logs.includes("busy:success"));
  assert.deepEqual(informationMessages, ["EasyMail: Cancelling… Waiting for the current request to finish."], "a cancelled task must not show its completion toast");
});

test("runWithBusy does not show cancellation feedback for a non-cancellable task", async () => {
  cancellationListener = undefined;
  disposed = 0;
  cancellationRequested = false;
  informationMessages.length = 0;
  let resolveTask!: () => void;
  const task = new Promise<void>((resolve) => { resolveTask = resolve; });
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });
  (app as any).log = async () => {};
  (app as any).refresh = async () => {};
  (app as any).dashboardProvider.update = async () => {};

  const pending = (app as any).runWithBusy("Analyze", "Running", "analyzeNext", async () => await task);
  await new Promise((resolve) => setImmediate(resolve));
  const cancel = cancellationListener as (() => void) | undefined;
  assert.ok(cancel);
  cancellationRequested = true;
  cancel();

  assert.deepEqual(informationMessages, []);
  resolveTask();
  await assert.rejects(() => pending, /cancelled/i);
  assert.equal(disposed, 1);
});

test("runWithBusy records a failed cancellation sidebar update", async () => {
  cancellationListener = undefined;
  disposed = 0;
  cancellationRequested = false;
  let resolveTask!: () => void;
  const task = new Promise<void>((resolve) => { resolveTask = resolve; });
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });
  const logs: string[] = [];
  (app as any).log = async (event: string) => { logs.push(event); };
  (app as any).refresh = async () => {};
  (app as any).dashboardProvider.update = async () => { throw new Error("sidebar unavailable"); };

  const pending = (app as any).runWithBusy("Analyze", "Running", "analyzeNext", async () => await task, undefined, true, "Cancelling…");
  await new Promise((resolve) => setImmediate(resolve));
  const cancel = cancellationListener as (() => void) | undefined;
  assert.ok(cancel);
  cancellationRequested = true;
  cancel();
  await new Promise((resolve) => setImmediate(resolve));

  resolveTask();
  await assert.rejects(() => pending, /cancelled/i);

  assert.ok(logs.includes("busy:cancelSidebarError"));
});

test("CopilotProvider passes the same cancellation token to sendRequest and streaming response", async () => {
  let receivedToken: unknown;
  const token = { isCancellationRequested: false };
  vscodeMock.lm.selectChatModels = async () => [{
    id: "test", family: "test", name: "Test", vendor: "copilot",
    sendRequest: async (_messages: unknown[], _options: unknown, requestToken: unknown) => {
      receivedToken = requestToken;
      return { text: (async function* () { yield { value: "ok" }; })() };
    }
  }];
  const provider = new CopilotProvider();
  await provider.listModels();
  const response = await provider.sendPrompt("prompt", { modelFamily: "test", cancellationToken: token });

  assert.equal(receivedToken, token);
  assert.equal(response.rawText, "ok");
});

test("maybeOpenGuide uses install metadata, directory birth time, then version as its install signature", async () => {
  const shown = new Map<string, boolean>();
  let opened = 0;
  const openGuide = async () => { opened += 1; };
  const createApp = (packageJSON: unknown, extensionPath: string) => {
    const app = new EasyMailApp({
      globalStorageUri: { fsPath: "" },
      extensionPath,
      extension: { packageJSON },
      globalState: {
        get: (key: string) => shown.get(key),
        update: async (key: string, value: boolean) => { shown.set(key, value); }
      },
      subscriptions: []
    });
    (app as any).openGuide = openGuide;
    return app;
  };

  const originalStat = fs.promises.stat;
  const statPaths: string[] = [];
  (fs.promises as any).stat = async (extensionPath: string) => {
    statPaths.push(extensionPath);
    if (extensionPath === "broken-install") {
      throw new Error("stat failed");
    }
    return { birthtimeMs: extensionPath === "vsix-a" ? 100 : 200 };
  };

  try {
    await (createApp({ version: "0.3.0", __metadata: { installedTimestamp: "2026-07-12T00:00:00Z" } }, "marketplace") as any).maybeOpenGuide();
    await (createApp({ version: "0.3.0", __metadata: { installedTimestamp: "2026-07-12T00:00:00Z" } }, "marketplace") as any).maybeOpenGuide();
    await (createApp({ version: "0.3.0" }, "vsix-a") as any).maybeOpenGuide();
    await (createApp({ version: "0.3.0", __metadata: { installedTimestamp: "" } }, "vsix-a") as any).maybeOpenGuide();
    await (createApp({ version: "0.3.0", __metadata: null }, "vsix-b") as any).maybeOpenGuide();
    await (createApp({ version: "0.3.0" }, "broken-install") as any).maybeOpenGuide();
    await (createApp({ version: "0.3.0" }, "broken-install") as any).maybeOpenGuide();
  } finally {
    (fs.promises as any).stat = originalStat;
  }

  assert.equal(shown.get("easyMail.guideShown.2026-07-12T00:00:00Z"), true, "Marketplace metadata takes priority");
  assert.equal(shown.get("easyMail.guideShown.100"), true, "the local vsix install uses its directory birth time");
  assert.equal(shown.get("easyMail.guideShown.200"), true, "a reinstall with a different directory birth time opens the guide");
  assert.equal(shown.get("easyMail.guideShown.0.3.0"), true, "a stat failure falls back to package version");
  assert.deepEqual(statPaths, ["vsix-a", "vsix-a", "vsix-b", "broken-install", "broken-install"], "metadata must avoid an unnecessary filesystem fallback");
  assert.equal(opened, 4, "each installation signature opens the guide only once");
});

test("getDashboardHtml forwards the meeting store attached by loadState", async () => {
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });
  (app as any).loadState = async () => ({
    config: { rangeMode: "recentHours", recentHours: 24, outputLanguage: "en-US", folders: [] },
    digestMetadata: { generatedAt: "", rangeMode: "", recentHours: 0, maxItems: 0, folders: [] },
    overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 },
    categories: [],
    store: { generatedAt: "", lastPullAt: "", items: [] },
    index: { generatedAt: "", items: [] },
    queue: { pending: [], blocked: [], analysed: [], allowed: [] },
    classifications: { items: [] },
    securityDecisions: new Map(),
    promptConfig: { categories: [], importantSenders: [] },
    threadStore: { generatedAt: "", lastBuiltAt: "", items: [] },
    threadAnalysis: { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] },
    meetingStore: {
      generatedAt: "", lastPullAt: "", items: [{
        meetingId: "meeting-1", entryId: "entry-1", subject: "F4.1 Meeting",
        organizer: "Alice", start: "2026-07-13 09:00", end: "2026-07-13 09:30",
        location: "", isAllDay: false, isRecurring: false, requiredAttendees: "",
        optionalAttendees: "", responseStatus: "notResponded", meetingSource: "calendar",
        importance: "Normal", bodyExcerpt: "", pulledAt: "2026-07-13"
      }]
    },
    ignoredIds: new Set()
  });
  ((app as any).data as any).readCachedAvailableModels = async () => [];
  ((app as any).data as any).readNextActions = async () => ({ items: [] });

  const html = await (app as any).getDashboardHtml();

  assert.ok(html.includes("F4.1 Meeting"));
});

test("buildSidebarRenderInput forwards every render field attached by loadState", () => {
  const store = { marker: "store" };
  const index = { marker: "index" };
  const queue = { marker: "queue" };
  const classifications = { marker: "classifications" };
  const securityDecisions = new Map([["mail-1", { marker: "security" }]]);
  const promptConfig = { marker: "prompt" };
  const threadStore = { marker: "threads" };
  const threadAnalysis = { marker: "thread-analysis" };
  const meetingStore = { marker: "meetings" };
  const ignoredIds = new Set(["mail-1"]);
  const state = {
    config: {}, digestMetadata: {}, overview: {}, categories: [],
    store, index, queue, classifications, securityDecisions, promptConfig,
    threadStore, threadAnalysis, meetingStore, ignoredIds
  };

  const input = buildSidebarRenderInput(state, [], { items: [] }, "", false);

  assert.equal(input.store, store);
  assert.equal(input.index, index);
  assert.equal(input.queue, queue);
  assert.equal(input.classifications, classifications);
  assert.equal(input.securityDecisions, securityDecisions);
  assert.equal(input.promptConfig, promptConfig);
  assert.equal(input.threadStore, threadStore);
  assert.equal(input.threadAnalysis, threadAnalysis);
  assert.equal(input.meetingStore, meetingStore);
  assert.equal(input.ignoredIds, ignoredIds);
});

test("a flush with an untouched empty textarea does not create a working draft", async () => {
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });

  await (app as any).handleMessage({
    type: "workingDraftsFlushed",
    requestId: "1",
    drafts: [{ itemId: "mail:m1", draftText: "" }]
  });

  assert.equal((app as any).workingDrafts.has("mail:m1"), false, "the model draft fallback must remain available");
  assert.ok((await renderWorkbenchDraft(app, "Model draft")).includes("Model draft"));
});

test("a user-cleared working draft remains an explicit empty value", async () => {
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });

  await (app as any).handleMessage({ type: "updateWorkingDraft", itemId: "mail:m1", draftText: "Typed draft" });
  await (app as any).handleMessage({ type: "updateWorkingDraft", itemId: "mail:m1", draftText: "" });

  assert.equal((app as any).workingDrafts.has("mail:m1"), true);
  assert.equal((app as any).workingDrafts.get("mail:m1"), "");
  const html = await renderWorkbenchDraft(app, "Model draft");
  assert.ok(html.includes('<textarea class="draft-textarea"></textarea>'));
  assert.ok(!html.includes('<textarea class="draft-textarea">Model draft</textarea>'));
});

test("Generate and Polish keep their non-empty working drafts", async () => {
  cancellationRequested = false;
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });
  const warnings: string[] = [];
  (vscodeMock.window as any).showWarningMessage = (message: string) => { warnings.push(message); };
  (app as any).log = async () => {};
  (app as any).readConfig = async () => ({ modelFamily: "test" });
  ((app as any).data as any).readCachedAvailableModels = async () => [{ id: "test", family: "test", name: "Test", vendor: "test" }];
  ((app as any).data as any).writeModelInfo = async () => {};
  (app as any).buildDraftGenerationPrompt = async () => "draft prompt";
  const model = { id: "test", family: "test", name: "Test", vendor: "test" };
  (app as any).llmProvider = { sendPrompt: async () => ({ rawText: '{"draftReply":"Generated draft"}', model, usedFallback: false }) };

  await (app as any).generateDraft("mail:m1", "m1");
  assert.deepEqual(warnings, []);
  assert.equal((app as any).workingDrafts.get("mail:m1"), "Generated draft");

  (app as any).llmProvider = { sendPrompt: async () => ({ rawText: " Polished draft ", model, usedFallback: false }) };
  await (app as any).polishDraft("Generated draft", "mail:m1");
  assert.deepEqual(warnings, []);
  assert.equal((app as any).workingDrafts.get("mail:m1"), "Polished draft");
  assert.ok((await renderWorkbenchDraft(app, "Model draft")).includes('<textarea class="draft-textarea">Polished draft</textarea>'));
});

test("flushWorkbenchDrafts times out a missing webview response and permits the next flush", async () => {
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });
  let requests = 0;
  (app as any).workbenchPanel = {
    webview: {
      postMessage: async () => ++requests > 1 ? false : true
    }
  };

  const firstFlush = (app as any).flushWorkbenchDrafts().then(() => true);
  const completed = await Promise.race([
    firstFlush,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2200))
  ]);

  assert.equal(completed, true, "a missing webview response must not stall the refresh pipeline");
  assert.equal((app as any).pendingWorkbenchDraftFlush, null);
  await (app as any).flushWorkbenchDrafts();
  assert.equal(requests, 2, "a completed timeout must allow a new flush request");
});

test("a late draft flush response cannot complete a newer request", async () => {
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });
  const requestIds: string[] = [];
  (app as any).workbenchPanel = {
    webview: {
      postMessage: async (message: { requestId: string }) => {
        requestIds.push(message.requestId);
        return true;
      }
    }
  };

  await (app as any).flushWorkbenchDrafts();
  const nextFlush = (app as any).flushWorkbenchDrafts();
  await new Promise((resolve) => setImmediate(resolve));
  const [timedOutRequestId, currentRequestId] = requestIds;

  (app as any).completeWorkbenchDraftFlush(timedOutRequestId);
  assert.equal((app as any).pendingWorkbenchDraftFlush.requestId, currentRequestId);
  (app as any).completeWorkbenchDraftFlush(currentRequestId);
  await nextFlush;
  assert.equal((app as any).pendingWorkbenchDraftFlush, null);
});
