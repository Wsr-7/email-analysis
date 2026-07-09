import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  nextActionDedupeKey,
  extractNextActions,
  mergeNextActions,
  updateNextActionStatus,
  getOpenNextActions,
  normalizeNextActionsStore,
  type NextActionsStore,
  type NextActionItem,
} from "../lib/next-actions";
import type { ThreadAnalysisItem } from "../lib/thread-analysis-schema";

function stubThreadAnalysis(overrides?: Partial<ThreadAnalysisItem>): ThreadAnalysisItem {
  return {
    threadId: "thread-001",
    category: "followUp",
    priority: "P1",
    subject: "Q3 Review",
    participants: ["Alice", "Bob"],
    lastTime: "2026-07-01",
    oneLineSummary: "Review summary",
    currentStatus: "Waiting for input",
    keyDecisions: [],
    openQuestions: [],
    actionItems: [
      { owner: "Bob", task: "Confirm approval", deadline: "2026-07-05", sourceMailId: "mail-1", sourceTime: "2026-07-01 09:00" },
      { owner: "Alice", task: "Send updated doc", deadline: "", sourceMailId: "mail-2", sourceTime: "2026-07-01 10:00" },
    ],
    waitingOn: [],
    risks: [],
    needMyReply: false,
    suggestedAction: "Follow up",
    draftReply: "",
    confidence: 0.8,
    evidence: [],
    needsOriginalMailCheck: false,
    partialContext: false,
    ...overrides,
  };
}

describe("nextActionDedupeKey", () => {
  it("produces stable key from source and task", () => {
    const key = nextActionDedupeKey("thread", "t1", "Confirm approval");
    assert.equal(key, "thread:t1:confirm approval");
  });

  it("normalizes whitespace", () => {
    const a = nextActionDedupeKey("thread", "t1", "  Confirm   approval  ");
    const b = nextActionDedupeKey("thread", "t1", "confirm approval");
    assert.equal(a, b);
  });
});

describe("extractNextActions", () => {
  it("extracts action items from thread analysis", () => {
    const items = extractNextActions(stubThreadAnalysis());
    assert.equal(items.length, 2);
    assert.equal(items[0].sourceType, "thread");
    assert.equal(items[0].sourceId, "thread-001");
    assert.equal(items[0].owner, "Bob");
    assert.equal(items[0].task, "Confirm approval");
    assert.equal(items[0].deadline, "2026-07-05");
    assert.equal(items[0].status, "open");
  });

  it("skips empty tasks", () => {
    const items = extractNextActions(stubThreadAnalysis({
      actionItems: [
        { owner: "Bob", task: "", deadline: "", sourceMailId: "", sourceTime: "" },
        { owner: "Alice", task: "Real task", deadline: "", sourceMailId: "", sourceTime: "" },
      ],
    }));
    assert.equal(items.length, 1);
    assert.equal(items[0].task, "Real task");
  });

  it("returns empty for no action items", () => {
    const items = extractNextActions(stubThreadAnalysis({ actionItems: [] }));
    assert.equal(items.length, 0);
  });
});

describe("mergeNextActions", () => {
  it("adds new items", () => {
    const existing: NextActionsStore = { items: [] };
    const incoming = extractNextActions(stubThreadAnalysis());
    const merged = mergeNextActions(existing, incoming);
    assert.equal(merged.items.length, 2);
  });

  it("preserves user-set status on re-extraction", () => {
    const items = extractNextActions(stubThreadAnalysis());
    const existing: NextActionsStore = {
      items: [{ ...items[0], status: "done", updatedAt: "2026-07-02" }],
    };
    const merged = mergeNextActions(existing, items);
    assert.equal(merged.items.length, 2);
    const first = merged.items.find((i) => i.task === "Confirm approval")!;
    assert.equal(first.status, "done");
  });

  it("does not duplicate same action from same source", () => {
    const items = extractNextActions(stubThreadAnalysis());
    const merged = mergeNextActions({ items }, items);
    assert.equal(merged.items.length, 2);
  });
});

describe("updateNextActionStatus", () => {
  it("marks item done", () => {
    const items = extractNextActions(stubThreadAnalysis());
    const store: NextActionsStore = { items };
    const updated = updateNextActionStatus(store, items[0].id, "done");
    assert.equal(updated.items[0].status, "done");
    assert.equal(updated.items[1].status, "open");
  });

  it("marks item ignored", () => {
    const items = extractNextActions(stubThreadAnalysis());
    const store: NextActionsStore = { items };
    const updated = updateNextActionStatus(store, items[1].id, "ignored");
    assert.equal(updated.items[1].status, "ignored");
  });
});

describe("getOpenNextActions", () => {
  it("filters to open items only", () => {
    const items = extractNextActions(stubThreadAnalysis());
    items[0].status = "done";
    const open = getOpenNextActions({ items });
    assert.equal(open.length, 1);
    assert.equal(open[0].task, "Send updated doc");
  });
});

describe("normalizeNextActionsStore", () => {
  it("returns empty store for null", () => {
    assert.deepEqual(normalizeNextActionsStore(null), { items: [] });
  });

  it("returns empty store for non-object", () => {
    assert.deepEqual(normalizeNextActionsStore("bad"), { items: [] });
  });

  it("filters invalid items", () => {
    const store = normalizeNextActionsStore({ items: [{ id: "valid" }, null, "bad", {}] });
    assert.equal(store.items.length, 1);
  });
});
