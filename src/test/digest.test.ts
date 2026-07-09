import test from "node:test";
import assert from "node:assert/strict";
import { parseDigest } from "../lib/digest";

test("parseDigest extracts metadata and mail items", () => {
  const result = parseDigest(`# Outlook Mail Digest

GeneratedAt: 2026-06-16 10:30:00
RangeMode: RecentHours
RecentHours: 24
MaxItems: 50
Folders:
- Inbox
- Inbox/Customer

---

## Mail: mail-001

Subject: Contract approval needed
InternetMessageId: <mail-001@example.com>
EntryId: entry-001
StoreId: store-001
From: Alice <alice@example.com>
ReceivedTime: 2026-06-16 09:12:00
Folder: Inbox/Customer
Unread: true
Importance: high
ToMe: true
CcMe: false

BodyExcerpt:
Please review and approve the contract.

---`);

  assert.equal(result.metadata.recentHours, 24);
  assert.deepEqual(result.metadata.folders, ["Inbox", "Inbox/Customer"]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].mailId, "mail-001");
  assert.equal(result.items[0].internetMessageId, "<mail-001@example.com>");
  assert.equal(result.items[0].entryId, "entry-001");
  assert.equal(result.items[0].storeId, "store-001");
  assert.equal(result.items[0].subject, "Contract approval needed");
  assert.equal(result.items[0].conversationId, "");
  assert.equal(result.items[0].conversationIndex, "");
  assert.equal(result.items[0].sentTime, "");
  assert.equal(result.items[0].to, "");
  assert.equal(result.items[0].cc, "");
  assert.equal(result.items[0].attachmentCount, 0);
  assert.deepEqual(result.items[0].attachmentNames, []);
});

test("parseDigest extracts thread metadata and attachment fields", () => {
  const result = parseDigest(`# Outlook Mail Digest

GeneratedAt: 2026-06-16 10:30:00
RangeMode: RecentHours
RecentHours: 24
MaxItems: 50
Folders:
- Inbox

---

## Mail: mail-001

InternetMessageId: <mail-001@example.com>
EntryId: entry-001
ConversationId: conv-123
ConversationIndex: 01ABCDEF
Subject: Re: Contract approval needed
From: Alice <alice@example.com>
ReceivedTime: 2026-06-16 09:12:00
SentTime: 2026-06-16 09:10:00
Folder: Inbox
Unread: true
Importance: high
ToMe: true
CcMe: false
To: Me <me@example.com>; Team <team@example.com>
Cc: Legal <legal@example.com>
AttachmentCount: 2
AttachmentNames: contract.pdf; budget.xlsx

BodyExcerpt:
Please review and approve the contract.

---`);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].conversationId, "conv-123");
  assert.equal(result.items[0].storeId, "");
  assert.equal(result.items[0].conversationIndex, "01ABCDEF");
  assert.equal(result.items[0].sentTime, "2026-06-16 09:10:00");
  assert.equal(result.items[0].to, "Me <me@example.com>; Team <team@example.com>");
  assert.equal(result.items[0].cc, "Legal <legal@example.com>");
  assert.equal(result.items[0].attachmentCount, 2);
  assert.deepEqual(result.items[0].attachmentNames, ["contract.pdf", "budget.xlsx"]);
});
