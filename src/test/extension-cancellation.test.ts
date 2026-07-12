import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

let cancellationListener: (() => void) | undefined;
let disposed = 0;
let cancellationRequested = false;
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
    showInformationMessage: () => undefined
  }
};

const internalModule = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = internalModule._load;
internalModule._load = (request, parent, isMain) => request === "vscode" ? vscodeMock : originalLoad(request, parent, isMain);
const { EasyMailApp } = require("../extension") as { EasyMailApp: new (context: unknown) => object };
const { CopilotProvider } = require("../lib/copilot-provider") as { CopilotProvider: new () => { listModels: () => Promise<unknown[]>; sendPrompt: (prompt: string, options: unknown) => Promise<{ rawText: string }> } };
internalModule._load = originalLoad;

test("runWithBusy cancels through the sidebar only and clears busy state after the task", async () => {
  cancellationListener = undefined;
  disposed = 0;
  cancellationRequested = false;
  let resolveTask!: () => void;
  const task = new Promise<void>((resolve) => { resolveTask = resolve; });
  const app = new EasyMailApp({ globalStorageUri: { fsPath: "" }, extensionPath: "", subscriptions: [] });
  let refreshes = 0;
  let sidebarUpdates = 0;
  const logs: string[] = [];
  (app as any).log = async (event: string) => { logs.push(event); };
  (app as any).refresh = async () => { refreshes += 1; };
  (app as any).dashboardProvider.update = async () => { sidebarUpdates += 1; };

  const pending = (app as any).runWithBusy("Analyze", "Running", "analyzeNext", async () => await task, undefined, true, "Cancelling…");
  await new Promise((resolve) => setImmediate(resolve));
  const cancel = cancellationListener as (() => void) | undefined;
  assert.ok(cancel);
  cancellationRequested = true;
  cancel();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal((app as any).busy.kind, "cancelling");
  assert.equal(sidebarUpdates, 1);
  assert.equal(refreshes, 1, "cancellation must not rebuild the workbench");

  resolveTask();
  await assert.rejects(() => pending, /cancelled/i);
  assert.equal((app as any).busy, null);
  assert.equal(disposed, 1);
  assert.ok(!logs.includes("busy:success"));
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
