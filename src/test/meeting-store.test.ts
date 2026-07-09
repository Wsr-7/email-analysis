import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyMeetingStore, mergeMeetingDigestIntoStore, pruneMeetingStore, normalizeMeetingStore } from "../lib/meeting-store";
import type { MeetingDigestData } from "../lib/meeting-digest";

function stubDigest(overrides?: Partial<MeetingDigestData["items"][number]>[]): MeetingDigestData {
  return {
    metadata: { generatedAt: "2026-07-01 10:00", daysAhead: 2 },
    items: (overrides || [{ meetingId: "mtg-001", entryId: "e1", subject: "Standup", organizer: "Alice", start: "2026-07-01 09:00", end: "2026-07-01 09:30", location: "Room A", isAllDay: false, isRecurring: false, requiredAttendees: "bob@test.com", optionalAttendees: "", responseStatus: "accepted", meetingSource: "calendar", importance: "Normal", bodyExcerpt: "" }]).map((o) => ({
      meetingId: "mtg-001", entryId: "e1", subject: "Test", organizer: "Org", start: "2026-07-01 09:00", end: "2026-07-01 09:30", location: "", isAllDay: false, isRecurring: false, requiredAttendees: "", optionalAttendees: "", responseStatus: "accepted" as const, meetingSource: "calendar" as const, importance: "Normal", bodyExcerpt: "", ...o
    }))
  };
}

describe("emptyMeetingStore", () => {
  it("returns empty store", () => {
    const store = emptyMeetingStore();
    assert.equal(store.items.length, 0);
    assert.equal(store.generatedAt, "");
  });
});

describe("mergeMeetingDigestIntoStore", () => {
  it("adds new meetings to empty store", () => {
    const result = mergeMeetingDigestIntoStore(emptyMeetingStore(), stubDigest());
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].subject, "Standup");
    assert.ok(result.lastPullAt);
  });

  it("deduplicates by entryId", () => {
    const store = mergeMeetingDigestIntoStore(emptyMeetingStore(), stubDigest());
    const result = mergeMeetingDigestIntoStore(store, stubDigest([{ entryId: "e1", subject: "Updated Standup" }]));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].subject, "Updated Standup");
  });

  it("adds different meetings", () => {
    const store = mergeMeetingDigestIntoStore(emptyMeetingStore(), stubDigest());
    const result = mergeMeetingDigestIntoStore(store, stubDigest([{ meetingId: "mtg-002", entryId: "e2", subject: "Review" }]));
    assert.equal(result.items.length, 2);
  });
});

describe("pruneMeetingStore", () => {
  it("removes past meetings", () => {
    const store = mergeMeetingDigestIntoStore(emptyMeetingStore(), stubDigest([{ entryId: "old", start: "2020-01-01 09:00", responseStatus: "accepted" }]));
    const pruned = pruneMeetingStore(store);
    assert.equal(pruned.items.length, 0);
  });

  it("keeps future meetings", () => {
    const store = mergeMeetingDigestIntoStore(emptyMeetingStore(), stubDigest([{ entryId: "future", start: "2099-01-01 09:00" }]));
    const pruned = pruneMeetingStore(store);
    assert.equal(pruned.items.length, 1);
  });

  it("keeps past notResponded meetings", () => {
    const store = mergeMeetingDigestIntoStore(emptyMeetingStore(), stubDigest([{ entryId: "old-nr", start: "2020-01-01 09:00", responseStatus: "notResponded" }]));
    const pruned = pruneMeetingStore(store);
    assert.equal(pruned.items.length, 1);
  });
});

describe("normalizeMeetingStore", () => {
  it("handles null input", () => {
    const store = normalizeMeetingStore(null);
    assert.equal(store.items.length, 0);
  });

  it("normalizes valid data", () => {
    const store = normalizeMeetingStore({
      generatedAt: "2026-07-01",
      lastPullAt: "2026-07-01",
      items: [{ meetingId: "m1", entryId: "e1", subject: "Test", responseStatus: "accepted", meetingSource: "calendar" }]
    });
    assert.equal(store.items.length, 1);
    assert.equal(store.items[0].subject, "Test");
    assert.equal(store.items[0].responseStatus, "accepted");
  });

  it("defaults invalid responseStatus to notResponded", () => {
    const store = normalizeMeetingStore({
      items: [{ responseStatus: "invalid" }]
    });
    assert.equal(store.items[0].responseStatus, "notResponded");
  });
});
