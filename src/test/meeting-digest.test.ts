import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMeetingDigest } from "../lib/meeting-digest";

describe("parseMeetingDigest", () => {
  const sample = `# Outlook Meeting Digest

GeneratedAt: 2026-07-01 10:30
DaysAhead: 2

---

## Meeting: mtg-001

EntryId: entry-abc
Subject: Team Standup
Organizer: Alice
Start: 2026-07-01 09:30
End: 2026-07-01 10:00
Location: Room A
IsAllDay: false
IsRecurring: true
RequiredAttendees: bob@example.com; carol@example.com
OptionalAttendees: dave@example.com
ResponseStatus: accepted
MeetingSource: calendar
Importance: Normal

BodyExcerpt:
Sprint sync.

---

## Meeting: mtg-002

EntryId: entry-def
Subject: Client Review
Organizer: External
Start: 2026-07-02 14:00
End: 2026-07-02 15:30
Location: Teams Meeting
IsAllDay: false
IsRecurring: false
RequiredAttendees: alice@example.com
OptionalAttendees:
ResponseStatus: notResponded
MeetingSource: invite
Importance: High

BodyExcerpt:
Prepare Q3 report.

---
`;

  it("parses metadata", () => {
    const result = parseMeetingDigest(sample);
    assert.equal(result.metadata.generatedAt, "2026-07-01 10:30");
    assert.equal(result.metadata.daysAhead, 2);
  });

  it("parses meeting items", () => {
    const result = parseMeetingDigest(sample);
    assert.equal(result.items.length, 2);
  });

  it("parses first meeting fields", () => {
    const item = parseMeetingDigest(sample).items[0];
    assert.equal(item.meetingId, "mtg-001");
    assert.equal(item.entryId, "entry-abc");
    assert.equal(item.subject, "Team Standup");
    assert.equal(item.organizer, "Alice");
    assert.equal(item.start, "2026-07-01 09:30");
    assert.equal(item.end, "2026-07-01 10:00");
    assert.equal(item.location, "Room A");
    assert.equal(item.isAllDay, false);
    assert.equal(item.isRecurring, true);
    assert.equal(item.requiredAttendees, "bob@example.com; carol@example.com");
    assert.equal(item.optionalAttendees, "dave@example.com");
    assert.equal(item.responseStatus, "accepted");
    assert.equal(item.meetingSource, "calendar");
    assert.equal(item.bodyExcerpt, "Sprint sync.");
  });

  it("parses second meeting with invite source and notResponded", () => {
    const item = parseMeetingDigest(sample).items[1];
    assert.equal(item.meetingId, "mtg-002");
    assert.equal(item.responseStatus, "notResponded");
    assert.equal(item.meetingSource, "invite");
    assert.equal(item.importance, "High");
    assert.equal(item.bodyExcerpt, "Prepare Q3 report.");
  });

  it("handles empty input", () => {
    const result = parseMeetingDigest("");
    assert.equal(result.items.length, 0);
    assert.equal(result.metadata.generatedAt, "");
  });

  it("defaults unknown responseStatus to notResponded", () => {
    const md = `# Outlook Meeting Digest\nGeneratedAt: now\nDaysAhead: 1\n---\n\n## Meeting: mtg-001\n\nResponseStatus: unknown\n\nBodyExcerpt:\n\n---\n`;
    const item = parseMeetingDigest(md).items[0];
    assert.equal(item.responseStatus, "notResponded");
  });
});
