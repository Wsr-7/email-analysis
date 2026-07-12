import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderWorkbenchHtml } from "../lib/workbench-render";
import { normalizeClassificationCache } from "../lib/classification";
import { normalizePromptConfig } from "../lib/prompt-config";
import { emptyMailStore, emptyMailIndex, type StoredMail } from "../lib/mail-store";
import { emptyThreadStore } from "../lib/thread-store";
import type { StoredMeeting as StoredMeetingItem } from "../lib/meeting-store";
import type { DashboardRenderInput } from "../lib/dashboard-render";
import type { DashboardState } from "../lib/dashboard-state";
import type { AnalysisItem } from "../lib/analysis-schema";
import type { ThreadAnalysisResult } from "../lib/thread-analysis-schema";

function stubMail(overrides?: Partial<StoredMail>): StoredMail {
  return {
    mailId: "m1", sourceMailId: "", internetMessageId: "", entryId: "", subject: "Test",
    from: "test@test.com", receivedTime: "2024-01-01", folder: "Inbox",
    unread: "True", importance: "Normal", toMe: "True", ccMe: "False",
    bodyExcerpt: "", pulledAt: "2024-01-01",
    ...overrides
  };
}

function stubAnalysisItem(overrides?: Partial<AnalysisItem>): AnalysisItem {
  return {
    mailId: "a1", category: "mustHandleToday", priority: "P0", subject: "Urgent",
    sender: "ceo@test.com", receivedTime: "2024-01-01", summary: "Do this",
    reason: "CEO", suggestedAction: "Reply", draftReply: "", confidence: 0.9,
    needsOriginalMailCheck: false,
    ...overrides
  };
}

function stubState(configOverrides?: Record<string, unknown>, categories?: DashboardState["categories"]): DashboardState {
  return {
    config: { rangeMode: "recentHours", recentHours: 24, outputLanguage: "en-US", ...configOverrides },
    digestMetadata: { generatedAt: "", rangeMode: "", recentHours: 0, maxItems: 0, folders: [] },
    overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 },
    categories: categories || []
  };
}

function stubInput(overrides?: Partial<DashboardRenderInput>): DashboardRenderInput {
  return {
    state: stubState(),
    store: emptyMailStore(),
    index: emptyMailIndex(),
    queue: { pending: [], blocked: [], analysed: [], allowed: [], ignoredPending: [] },
    classifications: normalizeClassificationCache({}),
    securityDecisions: new Map(),
    promptConfig: normalizePromptConfig({}),
    threadStore: emptyThreadStore(),
    threadAnalysis: { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] },
    availableModels: [],
    busyKind: "",
    isBusy: false,
    ...overrides
  };
}

describe("renderWorkbenchHtml", () => {
  it("returns valid HTML document", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(html.includes("<!doctype html>"));
    assert.ok(html.includes("</html>"));
  });

  it("renders full-width reading pane without list column", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(html.includes("wb-pane"));
    assert.ok(!html.includes("wb-left"), "no left column");
    assert.ok(!html.includes("wb-cols"), "no two-column layout");
    assert.ok(!html.includes("wb-tabs"), "no tabs");
  });

  it("renders placeholder prompting sidebar selection", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(html.includes("wb-placeholder"));
    assert.ok(html.includes("Select an item from sidebar"));
  });

  it("renders detail panels for pending mails", () => {
    const input = stubInput({
      queue: { pending: [stubMail({ mailId: "m1", subject: "Hello" })], blocked: [], analysed: [], allowed: [stubMail({ mailId: "m1", subject: "Hello" })], ignoredPending: [] }
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes('data-id="m1"'));
    assert.ok(html.includes("Hello"));
    assert.ok(html.includes("wb-detail-card"));
  });

  it("renders confirm analyze action for manual-confirm mail detail only", () => {
    const input = stubInput({
      queue: {
        pending: [],
        blocked: [
          stubMail({ mailId: "manual-1", subject: "Needs review" }),
          stubMail({ mailId: "block-1", subject: "Blocked" })
        ],
        analysed: [],
        allowed: [],
        ignoredPending: []
      },
      securityDecisions: new Map([
        ["manual-1", { decision: "manual_confirm", reasons: ["Requires manual confirmation"] } as any],
        ["block-1", { decision: "block", reasons: ["Hard block"] } as any]
      ])
    });

    const html = renderWorkbenchHtml(input);

    assert.ok(html.includes("Confirm and Analyze"));
    assert.ok(html.includes('data-action="analyzeSelected" data-mail-id="manual-1"'));
    assert.ok(!html.includes('data-action="analyzeSelected" data-mail-id="block-1"'));
    assert.ok(html.includes("Manual Confirmation Required"));
    assert.ok(html.includes("Requires manual confirmation"));
    assert.ok(html.includes("wb-gate-reason"));
    assert.ok(html.includes("post('analyzeSelected', { mailIds: [t.getAttribute('data-mail-id') || ''] })"));
  });

  it("does not render manual-confirm mail as a plain pending reader first", () => {
    const input = stubInput({
      queue: {
        pending: [stubMail({ mailId: "manual-1", subject: "Needs review" })],
        blocked: [stubMail({ mailId: "manual-1", subject: "Needs review" })],
        analysed: [],
        allowed: [],
        ignoredPending: []
      },
      securityDecisions: new Map([
        ["manual-1", { decision: "manual_confirm", reasons: ["Requires manual confirmation"] } as any]
      ])
    });

    const html = renderWorkbenchHtml(input);
    assert.ok(!html.includes('data-id="manual-1" data-queue="pending"'));
    assert.ok(html.includes('data-id="manual-1" data-queue="blocked"'));
    assert.ok(html.includes("Confirm and Analyze"));
  });

  it("renders detail panels for analysis items", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ subject: "Urgent task" })] }
      ])
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes("wb-detail-card"));
    assert.ok(html.includes("Urgent task"));
  });

  it("binds single-mail draft actions to the mail draft key", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1", draftReply: "Reply text" })] }
      ])
    });
    const html = renderWorkbenchHtml(input);

    assert.ok(html.includes('data-item-id="mail:a1"'));
    assert.ok(html.includes('data-source-id="a1"'));
    assert.ok(html.includes("var itemId = box ? box.getAttribute('data-item-id') || '' : '';"));
    assert.ok(html.includes("getAttribute('data-source-id') || ''"));
    assert.ok(!html.includes("itemId: currentId || ''"));
  });

  it("uses the working draft as the escaped textarea initial value", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1", draftReply: "Model draft" })] }
      ]),
      workingDrafts: new Map([["mail:a1", "Saved & <draft>"]])
    });

    const html = renderWorkbenchHtml(input);

    assert.ok(html.includes('<textarea class="draft-textarea">Saved &amp; &lt;draft&gt;</textarea>'));
    assert.ok(!html.includes('<textarea class="draft-textarea">Model draft</textarea>'));
  });

  it("renders generate draft action for empty single-mail drafts", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1", draftReply: "" })] }
      ])
    });
    const html = renderWorkbenchHtml(input);

    assert.ok(html.includes('data-action="generateDraft"'));
    assert.ok(html.includes("post('generateDraft', { itemId: itemId3, sourceId: sourceId })"));
    assert.ok(!html.includes("post(generateAction, { mailIds: [sourceId] })"));
  });

  it("renders thread detail panels", () => {
    const input = stubInput({
      threadStore: {
        generatedAt: "", lastBuiltAt: "",
        items: [{
          threadId: "t1", conversationId: "c1", normalizedSubject: "thread",
          subject: "Thread Subject",
          participants: ["Alice <alice@test.com>"],
          folders: ["Inbox"], startTime: "2024-01-01", lastTime: "2024-01-02",
          messageCount: 2, unreadCount: 0, hasAttachments: false,
          sourceMailIds: ["m1", "m2"], timeline: [],
          contentStatus: "available",
          security: { totalMessages: 2, allowedMessages: 2, manualConfirmMessages: 0, blockedMessages: 0, highestClassificationLevel: 0, partialContext: false, reasons: [] }
        }]
      }
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes("Thread Subject"));
    assert.ok(html.includes('data-id="t1"'));
    assert.ok(html.includes("Participants:</strong> Alice</div>"));
    assert.ok(html.includes('title="Alice &lt;alice@test.com&gt;"'));
  });

  it("renders thread spotlight fields in thread detail", () => {
    const threadAnalysis: ThreadAnalysisResult = {
      generatedAt: "2026-07-02T00:00:00.000Z",
      overview: { totalThreads: 1, mustHandleToday: 0, risks: 1, waitingForMe: 1, notices: 0 },
      items: [{
        threadId: "t1",
        category: "waitingForMe",
        priority: "P1",
        subject: "Thread Subject",
        participants: ["alice@test.com"],
        lastTime: "2024-01-02",
        oneLineSummary: "Waiting for approval.",
        currentStatus: "Approval is not confirmed.",
        keyDecisions: ["Move release to Thursday."],
        openQuestions: [],
        actionItems: [{ owner: "Bob", task: "Confirm approver", deadline: "Today", sourceMailId: "m1", sourceTime: "2024-01-02" }],
        waitingOn: ["Bob"],
        risks: [{ level: "high", description: "Release may miss the window.", sourceMailId: "m2" }],
        needMyReply: true,
        suggestedAction: "Reply asking Bob to confirm.",
        draftReply: "",
        confidence: 0.8,
        evidence: [],
        needsOriginalMailCheck: false,
        partialContext: true
      }]
    };
    const input = stubInput({
      threadStore: {
        generatedAt: "", lastBuiltAt: "",
        items: [{
          threadId: "t1", conversationId: "c1", normalizedSubject: "thread",
          subject: "Thread Subject",
          participants: ["alice@test.com"],
          folders: ["Inbox"], startTime: "2024-01-01", lastTime: "2024-01-02",
          messageCount: 2, unreadCount: 0, hasAttachments: false,
          sourceMailIds: ["m1", "m2"],
          timeline: [{
            mailId: "m1", internetMessageId: "", entryId: "entry-1", conversationId: "c1",
            conversationIndex: "", subject: "Thread Subject", from: "Alice <alice@test.com>", senderName: "Alice",
            senderEmail: "alice@test.com", receivedTime: "2024-01-02", sentTime: "",
            folder: "Inbox", bodyPreview: "Please confirm.", bodyClean: "Please confirm.",
            bodyDelta: "Please confirm.", bodyHash: "", isDuplicateBody: false,
            contentAvailable: true, attachmentCount: 0, attachmentNames: []
          }],
          contentStatus: "available",
          security: { totalMessages: 2, allowedMessages: 2, manualConfirmMessages: 0, blockedMessages: 0, highestClassificationLevel: 0, partialContext: false, reasons: [] }
        }]
      },
      threadAnalysis
    });

    const html = renderWorkbenchHtml(input);

    assert.ok(html.includes("Thread Spotlight"));
    assert.ok(html.includes("Approval is not confirmed."));
    assert.ok(html.includes("Move release to Thursday."));
    assert.ok(!html.includes("Open Questions"));
    assert.ok(html.includes("Bob: Confirm approver: Today"));
    assert.ok(html.includes("Release may miss the window."));
    assert.ok(html.includes("Need My Reply"));
    assert.ok(html.includes("Reply asking Bob to confirm."));
    assert.ok(html.includes("Partial context; verify against original mail"));
    assert.ok(html.includes('data-action="openInOutlook" data-mail-id="m1"'));
    assert.ok(html.includes('title="Alice &lt;alice@test.com&gt;"'), "thread senders should retain full addresses in tooltips");
    assert.ok(html.includes("<strong title=\"Alice &lt;alice@test.com&gt;\">Alice</strong>"), "timeline should show display name only");
  });

  it("handles focusItem message via client-side JS", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(html.includes("focusItem"));
    assert.ok(html.includes("showReader"));
  });

  it("updates workbench focus before ignoring the current item", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1" }), stubAnalysisItem({ mailId: "a2" })] }
      ])
    });
    const html = renderWorkbenchHtml(input);

    assert.ok(html.includes('data-id="a1" data-queue="mustHandleToday"'));
    assert.ok(html.includes("function focusAfterRemoving(id)"));
    assert.ok(html.includes("focusAfterRemoving(removedId); post('ignore'"));
    assert.ok(html.includes("focusAfterRemoving(threadId); post('ignoreThread'"));
    assert.ok(html.includes("focusAfterRemoving(restoredId); post('unignore'"));
    assert.ok(html.includes("focusAfterRemoving(restoredThreadId); post('unignoreThread'"));
  });

  it("switches generated draft controls from Generate to edit actions", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(html.includes("showDraftActionButtons(box)"));
    assert.ok(html.includes("showGenerateDraftButton(box)"));
    assert.ok(html.includes("classList.contains('draft-textarea')"));
    assert.ok(html.includes("data-action=\"polishDraft\""));
    assert.ok(html.includes("data-action=\"composeMail\""));
  });

  it("reports in-progress draft text to the extension after a debounce", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(html.includes("var draftReportTimer"));
    assert.ok(html.includes("clearTimeout(draftReportTimer)"));
    assert.ok(html.includes("post('updateWorkingDraft', { itemId: itemId, draftText: target.value })"));
    assert.ok(html.includes("}, 500)"));
    assert.ok(!html.includes("function restoreDraftState()"));
  });

  it("flushes all current drafts when the extension requests a rebuild", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(html.includes("msg.type === 'requestWorkingDraftFlush'"));
    assert.ok(html.includes("document.querySelectorAll('.draft-box-editable')"));
    assert.ok(html.includes("post('workingDraftsFlushed', { requestId: msg.requestId, drafts: drafts })"));
  });

  it("updates the textarea directly when the extension generates a draft", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(html.includes("msg.type === 'updateDraft'"));
    assert.ok(html.includes("if (box) { var ta = box.querySelector('.draft-textarea'); if (ta) ta.value = msg.text || '';"));
    assert.ok(!html.includes("draftState"));
  });

  it("does not include filterQueue or selectItem (no list column)", () => {
    const html = renderWorkbenchHtml(stubInput());
    assert.ok(!html.includes("filterQueue"));
    assert.ok(!html.includes("selectItem"));
  });

  it("shows restore button for ignored items instead of ignore", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "ignored", items: [stubAnalysisItem({ mailId: "ig1", subject: "Ignored mail" })] }
      ])
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes('data-action="unignore"'));
    assert.ok(html.includes("Restore"));
    assert.ok(!html.includes('data-action="ignore" data-mail-id="ig1"'));
  });

  it("renders recipients and classification in workbench mail detail", () => {
    const input = stubInput({
      queue: {
        pending: [stubMail({ mailId: "m1", subject: "Hello", from: "Alice <alice@test.com>", to: "bob@test.com", cc: "carol@test.com", receivedTime: "2024-01-01 14:30" })],
        blocked: [], analysed: [], allowed: [stubMail({ mailId: "m1", subject: "Hello", from: "Alice <alice@test.com>", to: "bob@test.com", cc: "carol@test.com", receivedTime: "2024-01-01 14:30" })], ignoredPending: []
      },
      classifications: normalizeClassificationCache({ items: [{ mailId: "m1", level: 2, label: "REGISTERED" }] })
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes("bob@test.com"), "should show To recipients");
    assert.ok(html.includes("carol@test.com"), "should show Cc recipients");
    assert.ok(html.includes("REGISTERED"), "should show classification");
    assert.ok(html.includes('title="Alice &lt;alice@test.com&gt;"'), "sender should retain the full address in a tooltip");
    assert.ok(html.includes("From:</strong> Alice</div>"), "should show sender name only");
    assert.ok(html.includes("14:30"), "should show time");
    assert.ok(html.includes(".wb-meta-grid { display: grid;"));
    assert.ok(html.includes("grid-template-columns: 1fr;"));
  });

  it("renders pending and analyzed recipients as names with full-address tooltips", () => {
    const pendingTo = "Bob <bob@test.com>;Carol <carol@test.com>";
    const pendingCc = "Dan <dan@test.com>;Eve <eve@test.com>";
    const analyzedTo = "Frank <frank@test.com>; Grace <grace@test.com>";
    const analyzedCc = "Hank <hank@test.com>; Irene <irene@test.com>";
    const input = stubInput({
      queue: {
        pending: [stubMail({ mailId: "m1", to: pendingTo, cc: pendingCc })],
        blocked: [], analysed: [], allowed: [stubMail({ mailId: "m1", to: pendingTo, cc: pendingCc })], ignoredPending: []
      },
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1" })] }
      ]),
      store: { ...emptyMailStore(), items: [stubMail({ mailId: "a1", to: analyzedTo, cc: analyzedCc })] }
    });

    const html = renderWorkbenchHtml(input);

    assert.ok(html.includes(`title="${pendingTo.replace(/</g, "&lt;").replace(/>/g, "&gt;")}"`));
    assert.ok(html.includes(`title="${analyzedTo.replace(/</g, "&lt;").replace(/>/g, "&gt;")}"`));
    assert.ok(html.includes(`title="${pendingCc.replace(/</g, "&lt;").replace(/>/g, "&gt;")}"`));
    assert.ok(html.includes(`title="${analyzedCc.replace(/</g, "&lt;").replace(/>/g, "&gt;")}"`));
    assert.ok(html.includes("To:</strong> Bob; Carol</div>"));
    assert.ok(html.includes("Cc:</strong> Dan; Eve</div>"));
    assert.ok(html.includes("To:</strong> Frank; Grace</div>"));
    assert.ok(html.includes("Cc:</strong> Hank; Irene</div>"));
  });

  it("renders Outlook actions as a collapsed popover menu", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1", draftReply: "Reply text" })] }
      ])
    });
    const html = renderWorkbenchHtml(input);

    assert.ok(html.includes("<details class=\"draft-outlook-actions\">"));
    assert.ok(html.includes("outlook-chevron"));
    assert.ok(html.includes("menu.removeAttribute('open')"));
    assert.ok(html.includes(".draft-outlook-menu { position: absolute;"));
    assert.ok(html.includes(".draft-outlook-actions:not([open]) .draft-outlook-menu { display: none;"));
    assert.ok(html.includes('data-mode="reply"'));
    assert.ok(html.includes('data-mode="replyAll"'));
    assert.ok(html.includes('data-mode="forward"'));
  });

  it("renders analyzed mail with original body from mail store", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1", subject: "Urgent" })] }
      ]),
      store: { ...emptyMailStore(), items: [stubMail({ mailId: "a1", bodyExcerpt: "Original body text here" })] }
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes("Original body text here"), "analyzed mail should show original body");
  });

  it("places Open in Outlook and Ignore above summary in analyzed detail", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1", subject: "Urgent", summary: "Do this now" })] }
      ])
    });
    const html = renderWorkbenchHtml(input);
    const actionsIdx = html.indexOf('data-action="openInOutlook"');
    const summaryIdx = html.indexOf("Do this now");
    assert.ok(actionsIdx !== -1, "should have Open in Outlook action");
    assert.ok(summaryIdx !== -1, "should have summary");
    assert.ok(actionsIdx < summaryIdx, "actions should come before summary");
  });

  it("renders meeting detail panels", () => {
    const mtg: StoredMeetingItem = {
      meetingId: "mtg-1", entryId: "e-mtg-1", subject: "Standup", organizer: "Alice",
      start: "2026-07-01 09:00", end: "2026-07-01 09:30", location: "Room A",
      isAllDay: false, isRecurring: false, requiredAttendees: "bob@test.com",
      optionalAttendees: "", responseStatus: "notResponded", meetingSource: "calendar",
      importance: "Normal", bodyExcerpt: "", pulledAt: "2026-07-01"
    };
    const input = stubInput({ meetingStore: { generatedAt: "", lastPullAt: "", items: [mtg] } });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes("Standup"));
    assert.ok(html.includes("Alice"));
    assert.ok(html.includes("openMeetingInOutlook"));
    assert.ok(html.includes("wb-mtg-notResponded"));
  });

  it("renders ignore button on thread detail", () => {
    const input = stubInput({
      threadStore: {
        generatedAt: "", lastBuiltAt: "",
        items: [{
          threadId: "t1", conversationId: "c1", normalizedSubject: "thread",
          subject: "Thread Subject", participants: ["alice@test.com"],
          folders: ["Inbox"], startTime: "2024-01-01", lastTime: "2024-01-02",
          messageCount: 2, unreadCount: 0, hasAttachments: false,
          sourceMailIds: ["m1", "m2"], timeline: [],
          contentStatus: "available",
          security: { totalMessages: 2, allowedMessages: 2, manualConfirmMessages: 0, blockedMessages: 0, highestClassificationLevel: 0, partialContext: false, reasons: [] }
        }]
      }
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes('data-action="ignoreThread"'), "thread detail should have ignore action");
    assert.ok(html.includes('data-thread-id="t1"'));
  });

  it("renders restore button on thread detail when all mails are ignored", () => {
    const input = stubInput({
      threadStore: {
        generatedAt: "", lastBuiltAt: "",
        items: [{
          threadId: "t1", conversationId: "c1", normalizedSubject: "thread",
          subject: "Thread Subject", participants: ["alice@test.com"],
          folders: ["Inbox"], startTime: "2024-01-01", lastTime: "2024-01-02",
          messageCount: 2, unreadCount: 0, hasAttachments: false,
          sourceMailIds: ["m1", "m2"], timeline: [],
          contentStatus: "available",
          security: { totalMessages: 2, allowedMessages: 2, manualConfirmMessages: 0, blockedMessages: 0, highestClassificationLevel: 0, partialContext: false, reasons: [] }
        }]
      },
      ignoredIds: new Set(["m1", "m2"])
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes('data-action="unignoreThread"'), "ignored thread should have restore action");
    assert.ok(!html.includes('data-action="ignoreThread"'), "ignored thread should not have ignore action");
  });

  it("marks fully ignored thread readers as ignored queue items", () => {
    const input = stubInput({
      threadStore: {
        generatedAt: "", lastBuiltAt: "",
        items: [{
          threadId: "t1", conversationId: "c1", normalizedSubject: "thread",
          subject: "Thread Subject", participants: ["alice@test.com"],
          folders: ["Inbox"], startTime: "2024-01-01", lastTime: "2024-01-02",
          messageCount: 2, unreadCount: 0, hasAttachments: false,
          sourceMailIds: ["m1", "m2"], timeline: [],
          contentStatus: "available"
        }]
      },
      ignoredIds: new Set(["m1", "m2"])
    });
    const html = renderWorkbenchHtml(input);
    assert.ok(html.includes('data-id="t1" data-queue="ignored"'));
  });
});
