import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderSidebarHtml } from "../lib/sidebar-render";
import { normalizeClassificationCache } from "../lib/classification";
import { normalizePromptConfig } from "../lib/prompt-config";
import { emptyMailStore, emptyMailIndex, type StoredMail } from "../lib/mail-store";
import { emptyThreadStore } from "../lib/thread-store";
import { emptyMeetingStore, type StoredMeeting as StoredMeetingItem } from "../lib/meeting-store";
import type { DashboardRenderInput } from "../lib/dashboard-render";
import type { DashboardState } from "../lib/dashboard-state";
import type { AnalysisItem } from "../lib/analysis-schema";
import { buildDashboardState } from "../lib/dashboard-state";

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

describe("renderSidebarHtml", () => {
  it("returns valid HTML document", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("<!doctype html>"));
    assert.ok(html.includes("</html>"));
  });

  it("uses VS Code CSS variables", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("--vscode-sideBar-background"));
    assert.ok(html.includes("--vscode-button-background"));
    assert.ok(html.includes("--vscode-badge-background"));
  });

  it("renders action buttons", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("post('pullMail')"));
    assert.ok(html.includes("post('analyze', { batchSize: Number(sel) })"));
  });

  it("disables buttons when busy", () => {
    const html = renderSidebarHtml(stubInput({ isBusy: true, busyKind: "pullMail" }));
    assert.ok(html.includes("disabled"));
    assert.ok(html.includes("button-spinner"));
  });

  it("renders queue navigation for pending items", () => {
    const input = stubInput({
      queue: { pending: [stubMail()], blocked: [], analysed: [], allowed: [stubMail()], ignoredPending: [] }
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('data-queue-id="pending"'));
  });

  it("renders mail rows with data-queue attributes", () => {
    const input = stubInput({
      queue: { pending: [stubMail({ mailId: "m1", from: "bob@test.com", subject: "Hello" })], blocked: [], analysed: [], allowed: [stubMail({ mailId: "m1", from: "bob@test.com", subject: "Hello" })], ignoredPending: [] }
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('data-queue="pending"'));
    assert.ok(html.includes("Hello"));
    assert.ok(html.includes("bob@test.com"));
  });

  it("groups pending mail by configured folder, including empty and legacy folders", () => {
    const input = stubInput({
      state: stubState({ folders: ["Inbox", "Sent Items", "Archive"] }),
      queue: {
        pending: [],
        allowed: [
          stubMail({ mailId: "inbox-1", folder: "Inbox", subject: "Inbox mail" }),
          stubMail({ mailId: "sent-1", folder: "Sent Items", subject: "Sent mail" }),
          stubMail({ mailId: "legacy-1", folder: "Legacy Folder", subject: "Legacy mail" })
        ],
        blocked: [], analysed: [], ignoredPending: []
      }
    });

    const html = renderSidebarHtml(input);

    assert.ok(html.includes('data-pending-folder="Inbox"'));
    assert.ok(html.includes('>Inbox (1)</button>'));
    assert.ok(html.includes('>Sent Items (1)</button>'));
    assert.ok(html.includes('>Archive (0)</button>'));
    assert.ok(html.includes('>Legacy Folder (1)</button>'));
  });

  it("renders blocked items with reason", () => {
    const input = stubInput({
      queue: { pending: [], blocked: [stubMail({ mailId: "b1", subject: "Classified" })], analysed: [], allowed: [], ignoredPending: [] },
      securityDecisions: new Map([["b1", { decision: "block", reasons: ["HIGH classification"] } as any]])
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('data-queue="blocked"'));
    assert.ok(html.includes("Classified"));
  });

  it("does not render confirm analyze action inside compact sidebar rows", () => {
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

    const html = renderSidebarHtml(input);

    assert.ok(!html.includes("Confirm and Analyze"));
    assert.ok(!html.includes("post('analyzeSelected',{mailIds:['manual-1']})"));
    assert.ok(!html.includes("post('analyzeSelected',{mailIds:['block-1']})"));
  });

  it("shows immediate cancelling feedback while a task is still winding down", () => {
    const html = renderSidebarHtml(stubInput({ isBusy: true, busyKind: "cancelling" }));
    assert.ok(html.includes("Cancelling…"));
  });

  it("renders analyzed items in category queues", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ subject: "Urgent task" })] },
        { id: "notice", items: [] }
      ])
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('data-queue="mustHandleToday"'));
    assert.ok(html.includes("Urgent task"));
  });

  it("renders compact thread rows without detail", () => {
    const input = stubInput({
      threadStore: {
        generatedAt: "", lastBuiltAt: "",
        items: [{
          threadId: "t1", conversationId: "c1", normalizedSubject: "thread subject",
          subject: "Thread Subject",
          participants: ["alice@test.com", "bob@test.com"],
          folders: ["Inbox"], startTime: "2024-01-01", lastTime: "2024-01-02",
          messageCount: 3, unreadCount: 0, hasAttachments: false,
          sourceMailIds: ["m1", "m2", "m3"], timeline: [],
          contentStatus: "available",
          security: { totalMessages: 3, allowedMessages: 3, manualConfirmMessages: 0, blockedMessages: 0, highestClassificationLevel: 0, partialContext: false, reasons: [] }
        }]
      }
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('data-queue="threads"'));
    assert.ok(html.includes("Thread Subject"));
    assert.ok(!html.includes("sb-detail"), "compact rows should not have detail sections");
  });

  it("renders fully ignored threads in the ignored queue", () => {
    const input = stubInput({
      threadStore: {
        generatedAt: "", lastBuiltAt: "",
        items: [{
          threadId: "t1", conversationId: "c1", normalizedSubject: "thread subject",
          subject: "Thread Subject",
          participants: ["alice@test.com", "bob@test.com"],
          folders: ["Inbox"], startTime: "2024-01-01", lastTime: "2024-01-02",
          messageCount: 2, unreadCount: 0, hasAttachments: false,
          sourceMailIds: ["m1", "m2"], timeline: [],
          contentStatus: "available"
        }]
      },
      ignoredIds: new Set(["m1", "m2"])
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('data-queue="ignored" data-thread-id="t1"'));
    assert.ok(html.includes(">Thread</span>"), "ignored thread row should identify itself as a thread");
    assert.ok(!html.includes('data-queue="threads" data-thread-id="t1"'));
  });

  it("renders bottom bar with reports and settings", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("post('generateReports')"));
    assert.ok(html.includes("toggleSettings"));
    assert.ok(html.includes("confirmClear"));
  });

  it("includes queue filter JavaScript", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("showQueue"));
    assert.ok(html.includes("applyQueue"));
    assert.ok(html.includes("openItem"));
  });

  it("renders settings panel hidden by default", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes('id="settingsPanel"'));
    assert.ok(html.includes("hidden"));
  });

  it("keeps sidebar settings to range and model controls without a no-op refresh", () => {
    const html = renderSidebarHtml(stubInput());

    assert.ok(html.includes(".sb-settings-grid { display: grid; grid-template-columns: 1fr;"));
    assert.ok(html.includes('id="rangeMode"'));
    assert.ok(html.includes('id="rangeValue"'));
    assert.ok(html.includes('id="modelFamily"'));
    assert.ok(!html.includes('id="autoAnalyzeMaxClassificationLevel"'));
    assert.ok(!html.includes("post('openPromptConfig')"));
    assert.ok(!html.includes("post('refresh')"));
    assert.ok(html.includes("post('openSettings')"));
  });

  it("registers the sidebar-selected model as a free-text fallback setting", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const properties = manifest.contributes.configuration.properties;

    assert.equal(properties["easyMail.modelFamily"].type, "string");
    assert.equal(properties["easyMail.modelFamily"].enum, undefined);
    assert.equal(properties["easyMail.modelFamily"].enumItemLabels, undefined);
    assert.match(properties["easyMail.modelFamily"].description, /Load Copilot Models.*dashboard.*Settings.*fallback/i);
    assert.ok(properties["easyMail.collectorTimeoutSeconds"].order < properties["easyMail.modelFamily"].order);
    assert.ok(properties["easyMail.modelFamily"].order < properties["easyMail.outputLanguage"].order);
    assert.ok(properties["easyMail.outputLanguage"].order < properties["easyMail.autoAnalyzeMaxClassificationLevel"].order);
    assert.ok(properties["easyMail.autoAnalyzeMaxClassificationLevel"].order < properties["easyMail.mailStoreRetentionDays"].order);
    assert.ok(!manifest.contributes.commands.some((command: { command: string }) => command.command === "easyMail.refreshDashboard"));
  });

  it("renders language globe icon with dropdown", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("toggleLangMenu"));
    assert.ok(html.includes('id="langToggle"'));
    assert.ok(html.includes('id="langDropdown"'));
    assert.ok(html.includes("sb-lang-dropdown"));
    assert.ok(html.includes("English"));
    assert.ok(html.includes("中文"));
  });

  it("marks active language in dropdown", () => {
    const inputEn = stubInput({ state: stubState({ outputLanguage: "en-US" }) });
    const htmlEn = renderSidebarHtml(inputEn);
    assert.ok(htmlEn.includes('setLanguage(\'en-US\')'));

    const inputZh = stubInput({ state: stubState({ outputLanguage: "zh-CN" }) });
    const htmlZh = renderSidebarHtml(inputZh);
    assert.ok(htmlZh.includes('setLanguage(\'zh-CN\')'));
  });

  it("renders empty state element", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes('id="emptyState"'));
  });

  it("includes config auto-save debounce script", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("debounce"));
    assert.ok(html.includes("saveConfig"));
    assert.ok(html.includes("autoSave"));
    assert.ok(html.includes("rangeValueLabel"));
    assert.ok(html.includes("rangeValues"));
    assert.ok(!html.includes('id="folders"'));
  });

  it("can highlight the selected sidebar row from extension messages", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("setActiveRow(msg.id)"));
    assert.ok(html.includes(".sb-row.active"));
  });

  it("renders compact rows for ignored items without action buttons", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "ignored", items: [stubAnalysisItem({ mailId: "ig1", subject: "Old mail" })] },
        { id: "mustHandleToday", items: [] }
      ])
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('data-queue="ignored"'));
    assert.ok(html.includes("Old mail"));
    assert.ok(!html.includes('data-action="unignore"'), "compact sidebar should not have action buttons");
  });

  it("shows model-ignored analysis in the ignored queue and count", () => {
    const state = buildDashboardState(
      {},
      { metadata: { generatedAt: "", rangeMode: "", recentHours: 24, maxItems: 50, folders: ["Inbox"] }, items: [] },
      {
        generatedAt: "2026-07-13T10:00:00+08:00",
        overview: { totalMails: 1, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 },
        items: [stubAnalysisItem({ mailId: "model-ignored", category: "ignored", subject: "Model ignored mail" })]
      },
      []
    );

    const html = renderSidebarHtml(stubInput({ state }));
    assert.match(html, /data-queue-id="ignored"[\s\S]*?<span class="sb-queue-count">1<\/span>/);
    assert.ok(html.includes('data-queue="ignored" data-mail-id="model-ignored"'));
  });

  it("can focus the ignored queue from extension messages", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("focusQueue"));
    assert.ok(html.includes("showQueue(msg.queueId)"));
  });

  it("renders batch size selector in action bar", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes('id="batchSelect"'));
    assert.ok(html.includes("runAnalyze"));
    assert.ok(html.includes('<option value="5"'));
    assert.ok(html.includes('<option value="10"'));
    assert.ok(html.includes('<option value="20"'));
    assert.ok(html.includes('<option value="all"'));
  });

  it("posts selected batch size directly when analyzing", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("post('analyze', { batchSize: Number(sel) })"));
    assert.ok(html.includes("batchSelect: sel"));
  });

  it("uses local webview state for batch size instead of persisted settings", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes('<option value="5" selected'));
    assert.ok(html.includes("prev.batchSelect"));
  });

  it("keeps manual-confirm mails out of the pending compact queue", () => {
    const input = stubInput({
      queue: {
        pending: [stubMail({ mailId: "manual-1", subject: "Needs review" })],
        blocked: [stubMail({ mailId: "manual-1", subject: "Needs review" })],
        analysed: [],
        allowed: [],
        ignoredPending: []
      }
    });
    const html = renderSidebarHtml(input);
    assert.ok(!html.includes('data-queue="pending" data-mail-id="manual-1"'));
    assert.ok(html.includes('data-queue="blocked" data-mail-id="manual-1"'));
  });

  it("shows all stable queues even when empty", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes('data-queue-id="pending"'));
    assert.ok(html.includes('data-queue-id="mustHandleToday"'));
    assert.ok(html.includes('data-queue-id="risk"'));
    assert.ok(html.includes('data-queue-id="ignored"'));
  });

  it("dims empty queues with sb-queue-dim class", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("sb-queue-dim"));
  });

  it("renders separator between pending/blocked and analysis categories", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes("sb-queue-separator"));
  });

  it("places pending queue first in navigation", () => {
    const html = renderSidebarHtml(stubInput());
    const pendingIdx = html.indexOf('data-queue-id="pending"');
    const mustHandleIdx = html.indexOf('data-queue-id="mustHandleToday"');
    assert.ok(pendingIdx < mustHandleIdx, "pending should come before mustHandleToday");
  });

  it("places important senders after must-handle and ignored after uncertain", () => {
    const html = renderSidebarHtml(stubInput());
    const mustHandleIdx = html.indexOf('data-queue-id="mustHandleToday"');
    const importantIdx = html.indexOf('data-queue-id="importantSender"');
    const riskIdx = html.indexOf('data-queue-id="risk"');
    const uncertainIdx = html.indexOf('data-queue-id="uncertain"');
    const ignoredIdx = html.indexOf('data-queue-id="ignored"');

    assert.ok(mustHandleIdx < importantIdx && importantIdx < riskIdx);
    assert.ok(uncertainIdx < ignoredIdx);
  });

  it("renders compact meeting rows in meetings queue", () => {
    const mtg: StoredMeetingItem = {
      meetingId: "mtg-1", entryId: "e-mtg-1", subject: "Standup", organizer: "Alice",
      start: "2026-07-01 09:00", end: "2026-07-01 09:30", location: "Room A",
      isAllDay: false, isRecurring: true, requiredAttendees: "bob@test.com",
      optionalAttendees: "", responseStatus: "notResponded", meetingSource: "calendar",
      importance: "Normal", bodyExcerpt: "", pulledAt: "2026-07-01"
    };
    const input = stubInput({ meetingStore: { generatedAt: "", lastPullAt: "", items: [mtg] } });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('data-queue="meetings"'));
    assert.ok(html.includes('data-queue-id="meetings"'));
    assert.ok(html.includes("Standup"));
    assert.ok(html.includes("sb-mtg-warn"), "should show status badge");
    assert.ok(!html.includes("sb-detail"), "compact row should not have detail section");
  });

  it("orders meetings with unanswered invitations first, then newest start time", () => {
    const meeting = (entryId: string, start: string, responseStatus: StoredMeetingItem["responseStatus"]): StoredMeetingItem => ({
      meetingId: entryId, entryId, subject: entryId, organizer: "Alice", start, end: start,
      location: "", isAllDay: false, isRecurring: false, requiredAttendees: "", optionalAttendees: "",
      responseStatus, meetingSource: "calendar", importance: "Normal", bodyExcerpt: "", pulledAt: "2026-07-01"
    });
    const html = renderSidebarHtml(stubInput({ meetingStore: {
      generatedAt: "", lastPullAt: "", items: [
        meeting("accepted-old", "2026-07-01 09:00", "accepted"),
        meeting("unanswered", "2026-07-02 09:00", "notResponded"),
        meeting("accepted-new", "2026-07-03 09:00", "accepted")
      ]
    } }));

    assert.ok(html.indexOf('data-meeting-id="unanswered"') < html.indexOf('data-meeting-id="accepted-new"'));
    assert.ok(html.indexOf('data-meeting-id="accepted-new"') < html.indexOf('data-meeting-id="accepted-old"'));
  });

  it("shows meetings queue in nav even when empty", () => {
    const html = renderSidebarHtml(stubInput());
    assert.ok(html.includes('data-queue-id="meetings"'));
  });

  it("renders only the sender display name and keeps the full address in a tooltip", () => {
    const input = stubInput({
      queue: { pending: [stubMail({ mailId: "m1", subject: "Long subject line for testing", from: "Alice <alice@test.com>", receivedTime: "2024-01-01 14:30:45" })], blocked: [], analysed: [], allowed: [stubMail({ mailId: "m1", subject: "Long subject line for testing", from: "Alice <alice@test.com>", receivedTime: "2024-01-01 14:30:45" })], ignoredPending: [] }
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes('title="Long subject line for testing"'), "subject should have tooltip");
    assert.ok(html.includes("sb-line2"), "should have second line");
    assert.ok(html.includes('title="Alice &lt;alice@test.com&gt; · 2024-01-01 14:30:45"'), "tooltip should retain the full address and time");
    assert.ok(html.includes("Alice ·"), "second line should show the sender name only");
    assert.ok(html.includes("2024-01-01 14:30:45"), "second line should show the full time");
  });

  it("renders analysis rows with sender and priority on second line", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ subject: "Urgent", sender: "ceo@test.com", receivedTime: "2024-01-01 09:15:30" })] }
      ])
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes("sb-line2"), "should have second line");
    assert.ok(html.includes("ceo@test.com"), "second line should show sender");
    assert.ok(html.includes("2024-01-01 09:15:30"), "second line should show the full time");
    assert.ok(html.includes("sb-badge"), "second line should show priority badge");
  });

  it("renders classification badge on analyzed rows when classification is known", () => {
    const input = stubInput({
      state: stubState({}, [
        { id: "mustHandleToday", items: [stubAnalysisItem({ mailId: "a1", subject: "Urgent" })] }
      ]),
      classifications: normalizeClassificationCache({ items: [{ mailId: "a1", level: 1 }] })
    });
    const html = renderSidebarHtml(input);
    assert.ok(html.includes("sb-cls-badge"), "analyzed row should show classification badge");
    assert.ok(html.includes("INTERNAL"), "badge should show classification level name");
  });

  it("uses the renamed important senders label in both locales", () => {
    const categories = [{ id: "importantSender", items: [stubAnalysisItem()] }];
    const oldPromptLabel = normalizePromptConfig({
      categories: [{ id: "importantSender", labelZh: "重点发件人/邮件组", labelEn: "Important Sender or Group", description: "" }]
    });
    const htmlEn = renderSidebarHtml(stubInput({ state: stubState({ outputLanguage: "en-US" }, categories), promptConfig: oldPromptLabel }));
    const htmlZh = renderSidebarHtml(stubInput({ state: stubState({ outputLanguage: "zh-CN" }, categories), promptConfig: oldPromptLabel }));

    assert.ok(htmlEn.includes("Important Senders"));
    assert.ok(htmlZh.includes("重点发件人"));
  });
});
