import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardState } from "../lib/ui/dashboard-state";

test("buildDashboardState filters ignored ids and groups categories", () => {
  const state = buildDashboardState(
    {},
    { metadata: { generatedAt: "", rangeMode: "", recentHours: 24, maxItems: 50, folders: ["Inbox"] }, items: [] },
    {
      generatedAt: "2026-06-16T10:35:00+08:00",
      overview: { totalMails: 2, mustHandleToday: 1, risks: 0, waitingForMe: 0, notices: 1 },
      items: [
        {
          mailId: "mail-001",
          category: "mustHandleToday",
          priority: "P0",
          subject: "",
          sender: "",
          receivedTime: "2026-06-16 09:00:00",
          summary: "",
          reason: "",
          suggestedAction: "",
          draftReply: "",
          confidence: 0,
          needsOriginalMailCheck: false
        },
        {
          mailId: "mail-002",
          category: "notice",
          priority: "P3",
          subject: "",
          sender: "",
          receivedTime: "2026-06-16 08:00:00",
          summary: "",
          reason: "",
          suggestedAction: "",
          draftReply: "",
          confidence: 0,
          needsOriginalMailCheck: false
        }
      ]
    },
    ["mail-002"]
  );

  const mustDo = state.categories.find((entry) => entry.id === "mustHandleToday");
  const notice = state.categories.find((entry) => entry.id === "notice");
  const ignored = state.categories.find((entry) => entry.id === "ignored");
  assert.equal(mustDo?.items.length, 1);
  assert.equal(notice?.items.length, 0);
  assert.equal(ignored?.items.length, 1);
  assert.equal(state.overview.totalMails, 1);
  assert.equal(state.overview.mustHandleToday, 1);
  assert.equal(state.overview.notices, 0);
});

test("buildDashboardState puts model and manually ignored mail into the ignored category once", () => {
  const state = buildDashboardState(
    {},
    { metadata: { generatedAt: "", rangeMode: "", recentHours: 24, maxItems: 50, folders: ["Inbox"] }, items: [] },
    {
      generatedAt: "2026-07-13T10:00:00+08:00",
      overview: { totalMails: 3, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 },
      items: [
        {
          mailId: "model-ignored", category: "ignored", priority: "P3", subject: "Model ignored", sender: "",
          receivedTime: "2026-07-13 09:00:00", summary: "", reason: "", suggestedAction: "", draftReply: "", confidence: 0,
          needsOriginalMailCheck: false
        },
        {
          mailId: "manual-ignored", category: "notice", priority: "P3", subject: "Manual ignored", sender: "",
          receivedTime: "2026-07-13 08:00:00", summary: "", reason: "", suggestedAction: "", draftReply: "", confidence: 0,
          needsOriginalMailCheck: false
        },
        {
          mailId: "both-ignored", category: "ignored", priority: "P3", subject: "Both ignored", sender: "",
          receivedTime: "2026-07-13 07:00:00", summary: "", reason: "", suggestedAction: "", draftReply: "", confidence: 0,
          needsOriginalMailCheck: false
        }
      ]
    },
    ["manual-ignored", "both-ignored"]
  );

  const ignored = state.categories.find((entry) => entry.id === "ignored");
  assert.deepEqual(ignored?.items.map((item) => item.mailId), ["model-ignored", "manual-ignored", "both-ignored"]);
});

test("buildDashboardState can carry thread store without changing mail categories", () => {
  const state = buildDashboardState(
    {},
    { metadata: { generatedAt: "", rangeMode: "", recentHours: 24, maxItems: 50, folders: ["Inbox"] }, items: [] },
    {
      generatedAt: "2026-06-16T10:35:00+08:00",
      overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 },
      items: []
    },
    [],
    undefined,
    {
      generatedAt: "2026-06-16T10:36:00+08:00",
      lastBuiltAt: "2026-06-16T10:36:00+08:00",
      items: [
        {
          threadId: "conversation:conv-1",
          conversationId: "conv-1",
          normalizedSubject: "project",
          subject: "Project",
          participants: ["Alice"],
          folders: ["Inbox"],
          startTime: "2026-06-16 09:00:00",
          lastTime: "2026-06-16 10:00:00",
          messageCount: 2,
          unreadCount: 1,
          hasAttachments: false,
          sourceMailIds: ["mail-1", "mail-2"],
          timeline: [],
          contentStatus: "available"
        }
      ]
    }
  );

  assert.equal(state.threadStore?.items.length, 1);
  assert.ok(state.categories.find((entry) => entry.id === "mustHandleToday"));
});

test("buildDashboardState sorts due dates only inside actionable buckets", () => {
  const item = (mailId: string, category: string, dueDate: string, receivedTime: string) => ({
    mailId, category, priority: "P1" as const, subject: mailId, sender: "", receivedTime,
    summary: "", reason: "", suggestedAction: "", draftReply: "", dueDate,
    confidence: 0.9, needsOriginalMailCheck: false
  });
  const state = buildDashboardState(
    {},
    { metadata: { generatedAt: "", rangeMode: "", recentHours: 24, maxItems: 50, folders: [] }, items: [] },
    {
      generatedAt: "",
      overview: { totalMails: 7, mustHandleToday: 3, risks: 0, waitingForMe: 2, notices: 2 },
      items: [
        item("must-none", "mustHandleToday", "", "2026-07-03"),
        item("must-later", "mustHandleToday", "2026-07-20", "2026-07-02"),
        item("must-sooner", "mustHandleToday", "2026-07-15", "2026-07-01"),
        item("wait-none", "waitingForMe", "", "2026-07-03"),
        item("wait-due", "waitingForMe", "2026-07-16", "2026-07-01"),
        item("notice-new", "notice", "2026-07-30", "2026-07-03"),
        item("notice-old", "notice", "2026-07-10", "2026-07-01")
      ]
    },
    []
  );

  assert.deepEqual(state.categories.find((entry) => entry.id === "mustHandleToday")?.items.map((entry) => entry.mailId), ["must-sooner", "must-later", "must-none"]);
  assert.deepEqual(state.categories.find((entry) => entry.id === "waitingForMe")?.items.map((entry) => entry.mailId), ["wait-due", "wait-none"]);
  assert.deepEqual(state.categories.find((entry) => entry.id === "notice")?.items.map((entry) => entry.mailId), ["notice-new", "notice-old"]);
});
