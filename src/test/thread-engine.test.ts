import test from "node:test";
import assert from "node:assert/strict";
import { buildThreadRecords, buildThreadStore } from "../lib/domain/thread-engine";
import { mergeThreadStores, normalizeThreadStore, pruneThreadStore } from "../lib/storage/thread-store";
import type { StoredMail } from "../lib/storage/mail-store";

type ThreadCapableStoredMail = StoredMail & {
  conversationId?: string;
  conversationIndex?: string;
  sentTime?: string;
  senderName?: string;
  senderEmail?: string;
  to?: string;
  cc?: string;
  attachmentCount?: number;
  attachmentNames?: string[];
  bodyHash?: string;
};

test("buildThreadRecords creates a thread for a single mail", () => {
  const records = buildThreadRecords([
    mail({
      mailId: "mail-1",
      sourceMailId: "source-1",
      conversationId: "conv-1",
      subject: "Project Alpha update",
      from: "Alice <alice@example.com>",
      receivedTime: "2026-06-16 09:00:00",
      unread: "true",
      bodyExcerpt: "Status is green."
    })
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].threadId, "conversation:conv-1");
  assert.equal(records[0].subject, "Project Alpha update");
  assert.deepEqual(records[0].participants, ["Alice <alice@example.com>"]);
  assert.deepEqual(records[0].folders, ["Inbox"]);
  assert.equal(records[0].startTime, "2026-06-16 09:00:00");
  assert.equal(records[0].lastTime, "2026-06-16 09:00:00");
  assert.equal(records[0].messageCount, 1);
  assert.equal(records[0].unreadCount, 1);
  assert.deepEqual(records[0].sourceMailIds, ["source-1"]);
  assert.equal(records[0].timeline[0].mailId, "mail-1");
  assert.equal(records[0].timeline[0].bodyPreview, "Status is green.");
});

test("buildThreadRecords groups mails by conversationId when present", () => {
  const records = buildThreadRecords([
    mail({
      mailId: "mail-1",
      sourceMailId: "source-1",
      conversationId: "conv-1",
      subject: "Project Alpha",
      from: "Alice <alice@example.com>",
      receivedTime: "2026-06-16 09:00:00",
      unread: "false",
      folder: "Inbox"
    }),
    mail({
      mailId: "mail-2",
      sourceMailId: "source-2",
      conversationId: "conv-1",
      subject: "RE: Project Alpha",
      from: "Bob <bob@example.com>",
      receivedTime: "2026-06-16 10:00:00",
      unread: "true",
      folder: "Sent Items"
    }),
    mail({
      mailId: "mail-3",
      sourceMailId: "source-3",
      conversationId: "conv-2",
      subject: "Separate topic",
      from: "Carol <carol@example.com>",
      receivedTime: "2026-06-16 11:00:00"
    })
  ]);

  const alpha = records.find((record) => record.threadId === "conversation:conv-1");
  assert.equal(records.length, 2);
  assert.ok(alpha);
  assert.equal(alpha.messageCount, 2);
  assert.equal(alpha.unreadCount, 1);
  assert.deepEqual(alpha.participants, ["Alice <alice@example.com>", "Bob <bob@example.com>"]);
  assert.deepEqual(alpha.folders, ["Inbox", "Sent Items"]);
  assert.deepEqual(alpha.sourceMailIds, ["source-1", "source-2"]);
});

test("buildThreadRecords keeps collected self replies as separate timeline messages", () => {
  const [thread] = buildThreadRecords([
    mail({
      mailId: "from-b-1",
      sourceMailId: "source-b-1",
      conversationId: "conv-self-reply",
      conversationIndex: "0001",
      subject: "Contract review",
      from: "Bob <bob@example.com>",
      receivedTime: "2026-06-16 09:00:00",
      folder: "Inbox"
    }),
    mail({
      mailId: "from-me",
      sourceMailId: "source-me",
      conversationId: "conv-self-reply",
      conversationIndex: "0002",
      subject: "RE: Contract review",
      from: "Me <me@example.com>",
      receivedTime: "2026-06-16 09:30:00",
      sentTime: "2026-06-16 09:30:00",
      folder: "Sent Items"
    }),
    mail({
      mailId: "from-b-2",
      sourceMailId: "source-b-2",
      conversationId: "conv-self-reply",
      conversationIndex: "0003",
      subject: "RE: Contract review",
      from: "Bob <bob@example.com>",
      receivedTime: "2026-06-16 10:00:00",
      folder: "Inbox"
    })
  ]);

  assert.equal(thread.messageCount, 3);
  assert.deepEqual(thread.timeline.map((item) => item.mailId), ["from-b-1", "from-me", "from-b-2"]);
  assert.deepEqual(thread.folders, ["Inbox", "Sent Items"]);
});

test("buildThreadRecords falls back to normalized subject when conversationId is missing", () => {
  const records = buildThreadRecords([
    mail({
      mailId: "mail-1",
      sourceMailId: "source-1",
      subject: "Re: FW: Budget Approval",
      from: "Alice <alice@example.com>",
      receivedTime: "2026-06-16 09:00:00"
    }),
    mail({
      mailId: "mail-2",
      sourceMailId: "source-2",
      subject: "Budget approval",
      from: "Bob <bob@example.com>",
      receivedTime: "2026-06-16 10:00:00"
    })
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].threadId, "subject:budget approval");
  assert.equal(records[0].conversationId, "");
  assert.equal(records[0].normalizedSubject, "budget approval");
  assert.deepEqual(records[0].timeline.map((item) => item.mailId), ["mail-1", "mail-2"]);
});

test("buildThreadRecords sorts timeline by conversationIndex before receivedTime fallback", () => {
  const [indexed] = buildThreadRecords([
    mail({
      mailId: "mail-later",
      conversationId: "conv-indexed",
      conversationIndex: "B",
      receivedTime: "2026-06-16 09:00:00"
    }),
    mail({
      mailId: "mail-earlier",
      conversationId: "conv-indexed",
      conversationIndex: "A",
      receivedTime: "2026-06-16 10:00:00"
    })
  ]);
  assert.deepEqual(indexed.timeline.map((item) => item.mailId), ["mail-earlier", "mail-later"]);

  const [fallback] = buildThreadRecords([
    mail({
      mailId: "mail-new",
      subject: "No index",
      receivedTime: "2026-06-16 10:00:00"
    }),
    mail({
      mailId: "mail-old",
      subject: "No index",
      receivedTime: "2026-06-16 09:00:00"
    })
  ]);
  assert.deepEqual(fallback.timeline.map((item) => item.mailId), ["mail-old", "mail-new"]);
});

test("buildThreadStore and normalizeThreadStore keep thread store shape stable", () => {
  const store = buildThreadStore([
    mail({ mailId: "mail-1", conversationId: "conv-1", receivedTime: "2026-06-16 09:00:00" })
  ], "2026-06-16T12:00:00.000Z");
  const normalized = normalizeThreadStore({ ...store, items: [{ ...store.items[0], messageCount: "bad" }] });

  assert.equal(store.generatedAt, "2026-06-16T12:00:00.000Z");
  assert.equal(store.lastBuiltAt, "2026-06-16T12:00:00.000Z");
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0].messageCount, 1);
});

test("normalizeThreadStore keeps timeline in ascending conversation order", () => {
  const normalized = normalizeThreadStore({
    generatedAt: "",
    lastBuiltAt: "",
    items: [
      {
        threadId: "conversation:conv-1",
        subject: "Thread",
        timeline: [
          { mailId: "mail-new", conversationIndex: "0002", receivedTime: "2026-06-16 10:00:00" },
          { mailId: "mail-old", conversationIndex: "0001", receivedTime: "2026-06-16 09:00:00" }
        ]
      }
    ]
  });

  assert.deepEqual(normalized.items[0].timeline.map((item) => item.mailId), ["mail-old", "mail-new"]);
});

test("pruneThreadStore removes threads older than retention days", () => {
  const store = normalizeThreadStore({
    generatedAt: "",
    lastBuiltAt: "",
    items: [
      { threadId: "old", subject: "Old", lastTime: "2026-05-01 09:00:00", timeline: [] },
      { threadId: "new", subject: "New", lastTime: "2026-06-16 09:00:00", timeline: [] }
    ]
  });

  const pruned = pruneThreadStore(store, 7, new Date("2026-06-17T00:00:00"));
  assert.deepEqual(pruned.items.map((item) => item.threadId), ["new"]);
});

test("pruneThreadStore can fall back to timeline time", () => {
  const store = normalizeThreadStore({
    generatedAt: "",
    lastBuiltAt: "",
    items: [
      {
        threadId: "old",
        subject: "Old",
        timeline: [{ mailId: "old-mail", receivedTime: "2026-05-01 09:00:00" }]
      },
      {
        threadId: "new",
        subject: "New",
        timeline: [{ mailId: "new-mail", receivedTime: "2026-06-16 09:00:00" }]
      }
    ]
  });

  const pruned = pruneThreadStore(store, 7, new Date("2026-06-17T00:00:00"));
  assert.deepEqual(pruned.items.map((item) => item.threadId), ["new"]);
});

test("mergeThreadStores preserves existing thread messages when new pulls add to the same thread", () => {
  const existing = buildThreadStore([
    mail({
      mailId: "mail-1",
      conversationId: "conv-1",
      conversationIndex: "0001",
      receivedTime: "2026-06-16 09:00:00"
    })
  ], "2026-06-16T10:00:00.000Z");
  const incoming = buildThreadStore([
    mail({
      mailId: "mail-2",
      conversationId: "conv-1",
      conversationIndex: "0002",
      receivedTime: "2026-06-16 10:00:00"
    })
  ], "2026-06-16T11:00:00.000Z");

  const merged = mergeThreadStores(existing, incoming);

  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].messageCount, 2);
  assert.deepEqual(merged.items[0].timeline.map((item) => item.mailId), ["mail-1", "mail-2"]);
  assert.equal(merged.lastBuiltAt, "2026-06-16T11:00:00.000Z");
});

test("wires reply-delta trimming into thread timeline bodyDelta", () => {
  const englishBody = `Please use version 2 of the proposal.

Thanks,
Me

From: Alice <alice@example.com>
Sent: Tuesday, June 16, 2026 9:00 AM
To: Me <me@example.com>
Subject: Proposal review

Please review version 1 of the proposal.`;

  const chineseBody = `请以第二版报价为准。

谢谢。

发件人: 张三 <zhangsan@example.com>
发送时间: 2026年6月16日 09:00
收件人: 我 <me@example.com>
主题: 报价确认

请确认第一版报价。`;

  const [thread] = buildThreadRecords([
    mail({
      mailId: "mail-en",
      sourceMailId: "source-en",
      conversationId: "conv-delta",
      receivedTime: "2026-06-16 09:00:00",
      bodyExcerpt: englishBody
    }),
    mail({
      mailId: "mail-zh",
      sourceMailId: "source-zh",
      conversationId: "conv-delta",
      receivedTime: "2026-06-16 10:00:00",
      bodyExcerpt: chineseBody
    })
  ]);

  const [en, zh] = thread.timeline;
  assert.equal(en.bodyDelta, "Please use version 2 of the proposal.\n\nThanks,\nMe");
  assert.ok(!en.bodyDelta.includes("Please review version 1"));
  assert.equal(en.bodyPreview, englishBody);
  assert.equal(zh.bodyDelta, "请以第二版报价为准。\n\n谢谢。");
  assert.ok(!zh.bodyDelta.includes("请确认第一版报价"));
  assert.equal(zh.bodyPreview, chineseBody);
});

test("marks duplicate thread messages by cleaned body content", () => {
  const [thread] = buildThreadRecords([
    mail({
      mailId: "mail-1",
      sourceMailId: "source-1",
      conversationId: "conv-dup",
      receivedTime: "2026-06-16 09:00:00",
      bodyExcerpt: "Status update.\r\n\r\nReady."
    }),
    mail({
      mailId: "mail-2",
      sourceMailId: "source-2",
      conversationId: "conv-dup",
      receivedTime: "2026-06-16 10:00:00",
      bodyExcerpt: "Status update.\n\nReady."
    }),
    mail({
      mailId: "mail-3",
      sourceMailId: "source-3",
      conversationId: "conv-dup",
      receivedTime: "2026-06-16 11:00:00",
      bodyExcerpt: "Different content."
    })
  ]);

  const [first, second, third] = thread.timeline;
  assert.equal(first.isDuplicateBody, false);
  assert.equal(second.isDuplicateBody, true);
  assert.equal(second.duplicateOfId, "mail-1");
  assert.equal(third.isDuplicateBody, false);
  assert.equal(third.duplicateOfId, undefined);
});

function mail(overrides: Partial<ThreadCapableStoredMail>): ThreadCapableStoredMail {
  return {
    mailId: "mail-default",
    sourceMailId: "source-default",
    internetMessageId: "",
    entryId: "",
    subject: "Default subject",
    from: "Sender <sender@example.com>",
    receivedTime: "2026-06-16 09:00:00",
    folder: "Inbox",
    unread: "false",
    importance: "normal",
    toMe: "true",
    ccMe: "false",
    bodyExcerpt: "",
    pulledAt: "",
    ...overrides
  };
}
