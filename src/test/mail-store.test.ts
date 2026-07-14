import test from "node:test";
import assert from "node:assert/strict";
import { buildBatchDigestMarkdown, emptyMailIndex, emptyMailStore, folderOldestReceivedTimes, mergeDigestIntoIndex, mergeDigestIntoStore, normalizeMailStore, pruneMailIndex, pruneMailStore, stableMailId } from "../lib/storage/mail-store";

test("mergeDigestIntoStore adds new mail and skips duplicates by stable id", () => {
  const digest = {
    metadata: { generatedAt: "2026-06-16 10:00:00", rangeMode: "recentHours", recentHours: 24, maxItems: 2, folders: ["Inbox"] },
    items: [
      {
        mailId: "mail-001",
        internetMessageId: "<mail-001@example.com>",
        entryId: "entry-001",
        storeId: "store-001",
        conversationId: "conv-001",
        conversationIndex: "01ABCDEF",
        subject: "Contract approval needed",
        from: "Alice <alice@example.com>",
        senderName: "Alice",
        senderEmail: "alice@example.com",
        receivedTime: "2026-06-16 09:00:00",
        sentTime: "2026-06-16 08:58:00",
        folder: "Inbox",
        unread: "true",
        importance: "high",
        toMe: "true",
        ccMe: "false",
        to: "Me <me@example.com>",
        cc: "Legal <legal@example.com>",
        attachmentCount: 2,
        attachmentNames: ["contract.pdf", "budget.xlsx"],
        bodyExcerpt: "Please approve the contract."
      }
    ]
  };

  const first = mergeDigestIntoStore(emptyMailStore(), digest);
  const second = mergeDigestIntoStore(first.store, digest);
  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.store.items.length, 1);
  assert.equal(second.store.items[0].mailId, "internet:<mail-001@example.com>");
  assert.equal(second.store.items[0].storeId, "store-001");
  assert.equal(second.store.items[0].conversationId, "conv-001");
  assert.equal(second.store.items[0].conversationIndex, "01ABCDEF");
  assert.equal(second.store.items[0].senderName, "Alice");
  assert.equal(second.store.items[0].senderEmail, "alice@example.com");
  assert.equal(second.store.items[0].sentTime, "2026-06-16 08:58:00");
  assert.equal(second.store.items[0].to, "Me <me@example.com>");
  assert.equal(second.store.items[0].cc, "Legal <legal@example.com>");
  assert.equal(second.store.items[0].attachmentCount, 2);
  assert.deepEqual(second.store.items[0].attachmentNames, ["contract.pdf", "budget.xlsx"]);
});

test("buildBatchDigestMarkdown includes attachment metadata without empty name fields", () => {
  const store = normalizeMailStore({
    items: [
      { mailId: "with-attachments", subject: "Files", attachmentCount: 2, attachmentNames: ["contract.pdf", "budget.xlsx"] },
      { mailId: "without-attachments", subject: "No files", attachmentCount: 0, attachmentNames: [] }
    ]
  });

  const markdown = buildBatchDigestMarkdown(store.items);
  assert.match(markdown, /## Mail: with-attachments[\s\S]*AttachmentCount: 2[\s\S]*AttachmentNames: contract\.pdf; budget\.xlsx/);
  assert.match(markdown, /## Mail: without-attachments[\s\S]*AttachmentCount: 0/);
  assert.doesNotMatch(markdown, /AttachmentNames:\s*(?:\r?\n|$)/);
});

test("mergeDigestIntoStore skips mail with impossible Outlook dates", () => {
  const digest = {
    metadata: { generatedAt: "2026-06-16 10:00:00", rangeMode: "recentHours", recentHours: 24, maxItems: 2, folders: ["Inbox"] },
    items: [{
      mailId: "mail-001",
      internetMessageId: "<mail-001@example.com>",
      entryId: "entry-001",
      storeId: "",
      conversationId: "",
      conversationIndex: "",
      subject: "Microsoft Outlook test message",
      from: "Microsoft Outlook <test@example.com>",
      senderName: "Microsoft Outlook",
      senderEmail: "test@example.com",
      receivedTime: "4501-01-01 00:00:00",
      sentTime: "",
      folder: "Inbox",
      unread: "false",
      importance: "normal",
      toMe: "true",
      ccMe: "false",
      to: "Me <me@example.com>",
      cc: "",
      attachmentCount: 0,
      attachmentNames: [],
      bodyExcerpt: "Test"
    }]
  };

  const merge = mergeDigestIntoStore(emptyMailStore(), digest);
  const index = mergeDigestIntoIndex(emptyMailIndex(), digest);
  assert.equal(merge.added, 0);
  assert.equal(merge.skipped, 1);
  assert.equal(merge.store.items.length, 0);
  assert.equal(index.items.length, 0);
});

test("stableMailId fallback ignores body excerpt length changes", () => {
  const base = {
    mailId: "mail-001",
    internetMessageId: "",
    entryId: "",
    storeId: "",
    conversationId: "",
    conversationIndex: "",
    subject: "No ids edge case",
    from: "Alice <alice@example.com>",
    senderName: "Alice",
    senderEmail: "alice@example.com",
    receivedTime: "2026-06-16 09:00:00",
    sentTime: "",
    folder: "Inbox",
    unread: "false",
    importance: "normal",
    toMe: "true",
    ccMe: "false",
    to: "Me <me@example.com>",
    cc: "",
    attachmentCount: 0,
    attachmentNames: []
  };

  assert.equal(
    stableMailId({ ...base, bodyExcerpt: "Short body" }),
    stableMailId({ ...base, bodyExcerpt: "Short body with a longer pull because --body-chars changed" })
  );
});

test("normalizeMailStore fills thread fields for old store json", () => {
  const store = normalizeMailStore({
    generatedAt: "2026-06-16T10:00:00.000Z",
    lastPullAt: "2026-06-16 10:00:00",
    items: [
      {
        mailId: "mail-old",
        sourceMailId: "mail-old",
        internetMessageId: "",
        entryId: "",
        subject: "Old mail",
        from: "Alice <alice@example.com>",
        receivedTime: "2026-06-16 09:00:00",
        folder: "Inbox",
        unread: "false",
        importance: "normal",
        toMe: "true",
        ccMe: "false",
        bodyExcerpt: "Old format",
        pulledAt: "2026-06-16T10:00:00.000Z"
      }
    ]
  });

  assert.equal(store.items.length, 1);
  assert.equal(store.items[0].conversationId, "");
  assert.equal(store.items[0].storeId, "");
  assert.equal(store.items[0].conversationIndex, "");
  assert.equal(store.items[0].senderName, "");
  assert.equal(store.items[0].senderEmail, "");
  assert.equal(store.items[0].sentTime, "");
  assert.equal(store.items[0].to, "");
  assert.equal(store.items[0].cc, "");
  assert.equal(store.items[0].attachmentCount, 0);
  assert.deepEqual(store.items[0].attachmentNames, []);
});

test("mergeDigestIntoStore skips ids already present in mail index", () => {
  const digest = {
    metadata: { generatedAt: "2026-06-16 10:00:00", rangeMode: "recentHours", recentHours: 24, maxItems: 1, folders: ["Inbox"] },
    items: [
      {
        mailId: "mail-001",
        internetMessageId: "<mail-001@example.com>",
        entryId: "entry-001",
        subject: "Contract approval needed",
        from: "Alice <alice@example.com>",
        receivedTime: "2026-06-16 09:00:00",
        folder: "Inbox",
        unread: "true",
        importance: "high",
        toMe: "true",
        ccMe: "false",
        bodyExcerpt: "Please approve the contract."
      }
    ]
  };
  const index = mergeDigestIntoIndex(emptyMailIndex(), digest);
  const merge = mergeDigestIntoStore(emptyMailStore(), digest, index.items.map((item) => item.mailId));
  assert.equal(merge.added, 0);
  assert.equal(merge.skipped, 1);
});

test("mergeDigestIntoIndex records oldest received time per folder", () => {
  const digest = {
    metadata: { generatedAt: "2026-06-16 10:00:00", rangeMode: "recentHours", recentHours: 24, maxItems: 3, folders: ["Inbox", "Inbox/Project"] },
    items: [
      {
        mailId: "mail-001",
        internetMessageId: "<mail-001@example.com>",
        entryId: "entry-001",
        subject: "Newest",
        from: "Alice <alice@example.com>",
        receivedTime: "2026-06-16 09:00:00",
        folder: "Inbox",
        unread: "true",
        importance: "normal",
        toMe: "true",
        ccMe: "false",
        bodyExcerpt: ""
      },
      {
        mailId: "mail-002",
        internetMessageId: "<mail-002@example.com>",
        entryId: "entry-002",
        subject: "Oldest",
        from: "Bob <bob@example.com>",
        receivedTime: "2026-06-15 09:00:00",
        folder: "Inbox",
        unread: "true",
        importance: "normal",
        toMe: "true",
        ccMe: "false",
        bodyExcerpt: ""
      },
      {
        mailId: "mail-003",
        internetMessageId: "<mail-003@example.com>",
        entryId: "entry-003",
        subject: "Project",
        from: "Carol <carol@example.com>",
        receivedTime: "2026-06-14 09:00:00",
        folder: "Inbox/Project",
        unread: "false",
        importance: "normal",
        toMe: "true",
        ccMe: "false",
        bodyExcerpt: ""
      }
    ]
  };

  const index = mergeDigestIntoIndex(emptyMailIndex(), digest);
  assert.deepEqual(folderOldestReceivedTimes(index, ["Inbox", "Inbox/Project"]), {
    Inbox: "2026-06-15 09:00:00",
    "Inbox/Project": "2026-06-14 09:00:00"
  });
});

test("pruneMailStore removes items older than retention days", () => {
  const store = {
    generatedAt: "",
    lastPullAt: "",
    items: [
      {
        mailId: "mail-old",
        sourceMailId: "mail-old",
        internetMessageId: "",
        entryId: "",
        subject: "",
        from: "",
        receivedTime: "2026-05-01 09:00:00",
        folder: "Inbox",
        unread: "false",
        importance: "normal",
        toMe: "true",
        ccMe: "false",
        bodyExcerpt: "",
        pulledAt: "2026-05-01T09:00:00"
      },
      {
        mailId: "mail-new",
        sourceMailId: "mail-new",
        internetMessageId: "",
        entryId: "",
        subject: "",
        from: "",
        receivedTime: "2026-06-15 09:00:00",
        folder: "Inbox",
        unread: "false",
        importance: "normal",
        toMe: "true",
        ccMe: "false",
        bodyExcerpt: "",
        pulledAt: "2026-06-15T09:00:00"
      }
    ]
  };

  const pruned = pruneMailStore(store, 30, new Date("2026-06-16T00:00:00"));
  assert.deepEqual(pruned.items.map((item) => item.mailId), ["mail-new"]);
});

test("pruneMailStore uses pulledAt before receivedTime", () => {
  const store = {
    generatedAt: "",
    lastPullAt: "",
    items: [
      {
        mailId: "historical-but-newly-pulled",
        sourceMailId: "mail-history",
        internetMessageId: "",
        entryId: "",
        subject: "",
        from: "",
        receivedTime: "2026-05-01 09:00:00",
        folder: "Inbox",
        unread: "false",
        importance: "normal",
        toMe: "true",
        ccMe: "false",
        bodyExcerpt: "",
        pulledAt: "2026-06-16T09:00:00"
      }
    ]
  };

  const pruned = pruneMailStore(store, 1, new Date("2026-06-16T12:00:00"));
  assert.equal(pruned.items.length, 1);
});

test("pruneMailIndex removes anchors older than retention days", () => {
  const index = {
    generatedAt: "",
    lastPullAt: "",
    folderAnchors: {},
    items: [
      {
        mailId: "old",
        sourceMailId: "old",
        internetMessageId: "",
        entryId: "",
        receivedTime: "2026-06-01 09:00:00",
        folder: "Inbox",
        lastSeenAt: "2026-06-01T09:00:00"
      },
      {
        mailId: "new",
        sourceMailId: "new",
        internetMessageId: "",
        entryId: "",
        receivedTime: "2026-06-15 09:00:00",
        folder: "Inbox",
        lastSeenAt: "2026-06-15T09:00:00"
      }
    ]
  };
  const pruned = pruneMailIndex(index, 7, new Date("2026-06-16T00:00:00"));
  assert.deepEqual(pruned.items.map((item) => item.mailId), ["new"]);
});

test("pruneMailIndex uses lastSeenAt before receivedTime", () => {
  const index = {
    generatedAt: "",
    lastPullAt: "",
    folderAnchors: {},
    items: [
      {
        mailId: "historical-anchor",
        sourceMailId: "historical-anchor",
        internetMessageId: "",
        entryId: "",
        receivedTime: "2026-05-01 09:00:00",
        folder: "Inbox",
        lastSeenAt: "2026-06-16T09:00:00"
      }
    ]
  };
  const pruned = pruneMailIndex(index, 1, new Date("2026-06-16T12:00:00"));
  assert.equal(pruned.items.length, 1);
});
