import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { handleWebviewMessage, saveConfigFromMessage, type MessageHandlerContext } from "../lib/ui/message-handler";

function stubContext(overrides?: Partial<MessageHandlerContext>): MessageHandlerContext {
  return {
    log: mock.fn(async () => {}),
    readLocale: mock.fn(async () => "en-US"),
    readConfig: mock.fn(async () => ({ rangeMode: "recentHours", recentHours: 24 })),
    updateSettings: mock.fn(async () => {}),
    refresh: mock.fn(async () => {}),
    focusSidebarQueue: mock.fn(() => {}),
    focusSidebarItem: mock.fn(() => {}),
    copyToClipboard: mock.fn(async () => {}),
    showInfo: mock.fn(() => {}),
    showWarning: mock.fn(() => {}),
    showConfirm: mock.fn(async () => true),
    readIgnoredIds: mock.fn(async () => []),
    writeIgnoredIds: mock.fn(async () => {}),
    openMailInOutlook: mock.fn(async () => {}),
    openMeetingInOutlook: mock.fn(async () => {}),
    openGuide: mock.fn(async () => {}),
    openDigest: mock.fn(async () => {}),
    openSummary: mock.fn(async () => {}),
    generateReports: mock.fn(async () => {}),
    loadModels: mock.fn(async () => {}),
    changeOutputLanguage: mock.fn(async () => {}),
    openDailyBrief: mock.fn(async () => {}),
    openThreadReport: mock.fn(async () => {}),
    openSingleMailReport: mock.fn(async () => {}),
    pullMail: mock.fn(async () => {}),
    loadMore: mock.fn(async () => {}),
    analyze: mock.fn(async (_batchSize?: number) => {}),
    analyzeAllAllowed: mock.fn(async () => {}),
    analyzeSelected: mock.fn(async () => {}),
    analyzeThread: mock.fn(async () => {}),
    openSettings: mock.fn(async () => {}),
    openPromptConfig: mock.fn(async () => {}),
    clearLocalCache: mock.fn(async () => {}),
    openWorkbench: mock.fn(async () => {}),
    updateWorkingDraft: mock.fn(),
    completeWorkingDraftFlush: mock.fn(),
    generateDraft: mock.fn(async () => {}),
    polishDraft: mock.fn(async () => {}),
    refineDraft: mock.fn(async () => {}),
    composeOutlookMail: mock.fn(async () => {}),
    markNextAction: mock.fn(async () => {}),
    ignoreThread: mock.fn(async () => {}),
    unignoreThread: mock.fn(async () => {}),
    ...overrides
  };
}

describe("handleWebviewMessage", () => {
  it("ignores null message", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, null);
    assert.equal((ctx.log as any).mock.callCount(), 0);
  });

  it("ignores removed refresh messages", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "refresh" });
    assert.equal((ctx.refresh as any).mock.callCount(), 0);
  });

  it("dispatches pullMail", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "pullMail" });
    assert.equal((ctx.pullMail as any).mock.callCount(), 1);
    assert.deepEqual((ctx.pullMail as any).mock.calls[0].arguments, [false]);
  });

  it("dispatches sampleDigest as pullMail(true)", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "sampleDigest" });
    assert.equal((ctx.pullMail as any).mock.callCount(), 1);
    assert.deepEqual((ctx.pullMail as any).mock.calls[0].arguments, [true]);
  });

  it("dispatches analyze", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "analyze" });
    assert.equal((ctx.analyze as any).mock.callCount(), 1);
  });

  it("dispatches analyze with requested batch size", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "analyze", batchSize: "50" });
    assert.equal((ctx.analyze as any).mock.callCount(), 1);
    assert.deepEqual((ctx.analyze as any).mock.calls[0].arguments, [50]);
  });

  it("dispatches analyzeThread with threadId", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "analyzeThread", threadId: "t-123" });
    assert.equal((ctx.analyzeThread as any).mock.callCount(), 1);
    assert.deepEqual((ctx.analyzeThread as any).mock.calls[0].arguments, ["t-123"]);
  });

  it("copies draft to clipboard", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "copyDraft", draftReply: "Hello!" });
    assert.equal((ctx.copyToClipboard as any).mock.callCount(), 1);
    assert.deepEqual((ctx.copyToClipboard as any).mock.calls[0].arguments, ["Hello!"]);
    assert.equal((ctx.showInfo as any).mock.callCount(), 1);
  });

  it("warns when draft is empty", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "copyDraft", draftReply: "  " });
    assert.equal((ctx.copyToClipboard as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });

  it("dispatches ignore and refreshes", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "ignore", mailId: "m-1" });
    assert.equal((ctx.writeIgnoredIds as any).mock.callCount(), 1);
    assert.equal((ctx.refresh as any).mock.callCount(), 1);
    assert.equal((ctx.focusSidebarQueue as any).mock.callCount(), 0);
  });

  it("dispatches sidebar item focus without changing queue", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "focusSidebarItem", mailId: "m-1" });
    assert.deepEqual((ctx.focusSidebarItem as any).mock.calls[0].arguments, ["m-1"]);
    assert.equal((ctx.focusSidebarQueue as any).mock.callCount(), 0);
  });

  it("dispatches unignore and refreshes", async () => {
    const ctx = stubContext({
      readIgnoredIds: mock.fn(async () => ["m-1", "m-2", "m-3"])
    });
    await handleWebviewMessage(ctx, { type: "unignore", mailId: "m-2" });
    assert.equal((ctx.writeIgnoredIds as any).mock.callCount(), 1);
    const written = (ctx.writeIgnoredIds as any).mock.calls[0].arguments[0];
    assert.deepEqual(written, ["m-1", "m-3"]);
    assert.equal((ctx.refresh as any).mock.callCount(), 1);
  });

  it("dispatches openInWorkbench with mailId", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "openInWorkbench", mailId: "m-42" });
    assert.equal((ctx.openWorkbench as any).mock.callCount(), 1);
    assert.deepEqual((ctx.openWorkbench as any).mock.calls[0].arguments, ["m-42"]);
  });

  it("dispatches openMeetingInOutlook with meetingId", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "openMeetingInOutlook", meetingId: "mtg-99" });
    assert.equal((ctx.openMeetingInOutlook as any).mock.callCount(), 1);
    assert.deepEqual((ctx.openMeetingInOutlook as any).mock.calls[0].arguments, ["mtg-99"]);
  });

  it("dispatches requestLanguageChange", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "requestLanguageChange", config: { outputLanguage: "zh-CN" } });
    assert.equal((ctx.changeOutputLanguage as any).mock.callCount(), 1);
    assert.deepEqual((ctx.changeOutputLanguage as any).mock.calls[0].arguments, ["zh-CN"]);
  });
});

describe("saveConfigFromMessage", () => {
  it("merges patch into current config", async () => {
    const ctx = stubContext();
    await saveConfigFromMessage(ctx, { config: { recentHours: "48" } });
    assert.equal((ctx.updateSettings as any).mock.callCount(), 1);
    const saved = (ctx.updateSettings as any).mock.calls[0].arguments[0];
    assert.equal(saved.recentHours, 48);
  });

  it("does not persist language settings omitted from the patch", async () => {
    const ctx = stubContext({
      readConfig: mock.fn(async () => ({ rangeMode: "recentHours", recentHours: 24, outputLanguage: "zh-CN", draftLanguage: "zh-CN" }))
    });
    await saveConfigFromMessage(ctx, { config: { recentHours: "48" } });
    const saved = (ctx.updateSettings as any).mock.calls[0].arguments[0];
    assert.equal(Object.prototype.hasOwnProperty.call(saved, "outputLanguage"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(saved, "draftLanguage"), false);
  });

  it("saves language settings when they are patched", async () => {
    const ctx = stubContext();
    await saveConfigFromMessage(ctx, { config: { outputLanguage: "zh-CN", draftLanguage: "invalid" } });
    const saved = (ctx.updateSettings as any).mock.calls[0].arguments[0];
    assert.equal(saved.outputLanguage, "zh-CN");
    assert.equal(saved.draftLanguage, "auto");
  });

  it("does not write obsolete autoAnalyzeEnabled setting", async () => {
    const ctx = stubContext({
      readConfig: mock.fn(async () => ({ rangeMode: "recentHours", recentHours: 24, autoAnalyzeEnabled: false }))
    });
    await saveConfigFromMessage(ctx, { config: { recentHours: "48" } });
    const saved = (ctx.updateSettings as any).mock.calls[0].arguments[0];
    assert.equal(Object.prototype.hasOwnProperty.call(saved, "autoAnalyzeEnabled"), false);
  });

  it("skips when config is missing", async () => {
    const ctx = stubContext();
    await saveConfigFromMessage(ctx, {});
    assert.equal((ctx.updateSettings as any).mock.callCount(), 0);
  });

  it("suppresses info message when silent", async () => {
    const ctx = stubContext();
    await saveConfigFromMessage(ctx, { config: { folders: "Inbox" }, silent: true });
    assert.equal((ctx.showInfo as any).mock.callCount(), 0);
  });

  it("preserves an explicit Inbox-only folder setting when saving", async () => {
    const ctx = stubContext();
    await saveConfigFromMessage(ctx, { config: { folders: "Inbox" }, silent: true });
    const saved = (ctx.updateSettings as any).mock.calls[0].arguments[0];
    assert.deepEqual(saved.folders, ["Inbox"]);
    assert.equal(Object.prototype.hasOwnProperty.call(saved, "fetchFolders"), false);
  });

  it("saves classification threshold labels as levels", async () => {
    const ctx = stubContext();
    await saveConfigFromMessage(ctx, { config: { autoAnalyzeMaxClassificationLevel: "REGISTERED" }, silent: true });
    const saved = (ctx.updateSettings as any).mock.calls[0].arguments[0];
    assert.equal(saved.autoAnalyzeMaxClassificationLevel, 2);
  });
});

describe("polishDraft", () => {
  it("updates the working draft reported by the workbench", async () => {
    const updateWorkingDraft = mock.fn();
    const ctx = stubContext({ updateWorkingDraft } as any);

    await handleWebviewMessage(ctx, { type: "updateWorkingDraft", itemId: "mail:m1", draftText: "Handwritten draft" });

    assert.equal(updateWorkingDraft.mock.callCount(), 1);
    assert.deepEqual(updateWorkingDraft.mock.calls[0].arguments, ["mail:m1", "Handwritten draft"]);
  });

  it("dispatches generate draft with item and source ids", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "generateDraft", itemId: "mail:m1", sourceId: "m1" } as any);
    assert.equal((ctx.generateDraft as any).mock.callCount(), 1);
    assert.deepEqual((ctx.generateDraft as any).mock.calls[0].arguments, ["mail:m1", "m1"]);
  });

  it("dispatches polish with draft text and itemId", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "polishDraft", draftText: "Hello", itemId: "mail:m1" });
    assert.equal((ctx.polishDraft as any).mock.callCount(), 1);
    assert.deepEqual((ctx.polishDraft as any).mock.calls[0].arguments, ["Hello", "mail:m1"]);
  });

  it("warns on empty draft", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "polishDraft", draftText: "  ", itemId: "mail:m1" });
    assert.equal((ctx.polishDraft as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });
});

describe("refineDraft", () => {
  it("dispatches refine with draft text, instruction, and itemId", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "refineDraft", draftText: "Hello", instruction: "make shorter", itemId: "mail:m1" });
    assert.equal((ctx.refineDraft as any).mock.callCount(), 1);
    assert.deepEqual((ctx.refineDraft as any).mock.calls[0].arguments, ["Hello", "make shorter", "mail:m1"]);
  });

  it("warns on empty draft", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "refineDraft", draftText: "", instruction: "make shorter", itemId: "mail:m1" });
    assert.equal((ctx.refineDraft as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });

  it("warns on empty instruction", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "refineDraft", draftText: "Hello", instruction: "", itemId: "mail:m1" });
    assert.equal((ctx.refineDraft as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });
});

describe("markNextAction", () => {
  it("dispatches with valid status and refreshes", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "markNextAction", actionId: "act-1", status: "done" });
    assert.equal((ctx.markNextAction as any).mock.callCount(), 1);
    assert.deepEqual((ctx.markNextAction as any).mock.calls[0].arguments, ["act-1", "done"]);
    assert.equal((ctx.refresh as any).mock.callCount(), 1);
  });

  it("warns on invalid status", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "markNextAction", actionId: "act-1", status: "invalid" });
    assert.equal((ctx.markNextAction as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });

  it("warns on empty actionId", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "markNextAction", actionId: "", status: "done" });
    assert.equal((ctx.markNextAction as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });
});

describe("composeMail", () => {
  it("dispatches reply mode", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "composeMail", mode: "reply", draftText: "Hi", itemId: "m1" });
    assert.equal((ctx.composeOutlookMail as any).mock.callCount(), 1);
    assert.deepEqual((ctx.composeOutlookMail as any).mock.calls[0].arguments, ["reply", "Hi", "m1"]);
  });

  it("dispatches replyAll mode", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "composeMail", mode: "replyAll", draftText: "Hi", itemId: "m1" });
    assert.equal((ctx.composeOutlookMail as any).mock.callCount(), 1);
    assert.deepEqual((ctx.composeOutlookMail as any).mock.calls[0].arguments, ["replyAll", "Hi", "m1"]);
  });

  it("dispatches forward mode", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "composeMail", mode: "forward", draftText: "Hi", itemId: "m1" });
    assert.equal((ctx.composeOutlookMail as any).mock.callCount(), 1);
    assert.deepEqual((ctx.composeOutlookMail as any).mock.calls[0].arguments, ["forward", "Hi", "m1"]);
  });

  it("warns on empty draft", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "composeMail", mode: "forward", draftText: "  ", itemId: "m1" });
    assert.equal((ctx.composeOutlookMail as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });

  it("warns on unsupported mode", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "composeMail", mode: "invalid", draftText: "", itemId: "m1" });
    assert.equal((ctx.composeOutlookMail as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });
});

describe("ignoreThread", () => {
  it("dispatches ignoreThread with threadId and refreshes", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "ignoreThread", threadId: "t1" });
    assert.equal((ctx.ignoreThread as any).mock.callCount(), 1);
    assert.deepEqual((ctx.ignoreThread as any).mock.calls[0].arguments, ["t1"]);
    assert.equal((ctx.refresh as any).mock.callCount(), 1);
  });

  it("warns on empty threadId", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "ignoreThread", threadId: "" });
    assert.equal((ctx.ignoreThread as any).mock.callCount(), 0);
    assert.equal((ctx.showWarning as any).mock.callCount(), 1);
  });
});

describe("unignoreThread", () => {
  it("dispatches unignoreThread with threadId and refreshes", async () => {
    const ctx = stubContext();
    await handleWebviewMessage(ctx, { type: "unignoreThread", threadId: "t1" });
    assert.equal((ctx.unignoreThread as any).mock.callCount(), 1);
    assert.deepEqual((ctx.unignoreThread as any).mock.calls[0].arguments, ["t1"]);
    assert.equal((ctx.refresh as any).mock.callCount(), 1);
  });
});
