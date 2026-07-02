import test from "node:test";
import assert from "node:assert/strict";
import { buildQueueState, ensureClassifications, normalizeClassificationCache } from "../lib/classification";
import type { StoredMail } from "../lib/mail-store";

const mails: StoredMail[] = [
  {
    mailId: "mail-1",
    sourceMailId: "mail-001",
    internetMessageId: "",
    entryId: "",
    subject: "Public update",
    from: "A <a@example.com>",
    receivedTime: "2026-06-16 09:00:00",
    folder: "Inbox",
    unread: "true",
    importance: "normal",
    toMe: "true",
    ccMe: "false",
    bodyExcerpt: "Normal update.",
    pulledAt: ""
  },
  {
    mailId: "mail-2",
    sourceMailId: "mail-002",
    internetMessageId: "",
    entryId: "",
    subject: "High registered plan",
    from: "B <b@example.com>",
    receivedTime: "2026-06-16 08:00:00",
    folder: "Inbox",
    unread: "true",
    importance: "high",
    toMe: "true",
    ccMe: "false",
    bodyExcerpt: "This is high registered.",
    pulledAt: ""
  }
];

test("buildQueueState separates auto allowed and blocked pending mails", () => {
  const cache = ensureClassifications(mails, normalizeClassificationCache({}));
  const queue = buildQueueState(
    mails,
    { generatedAt: "", overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] },
    [],
    cache,
    true,
    2
  );
  assert.equal(queue.pending.length, 2);
  assert.equal(queue.allowed.length, 1);
  assert.equal(queue.blocked.length, 1);
  assert.equal(queue.blocked[0].mailId, "mail-2");
});

test("buildQueueState uses max classification level, not obsolete auto analyze flag", () => {
  const cache = ensureClassifications(mails, normalizeClassificationCache({}));
  const queue = buildQueueState(
    mails,
    { generatedAt: "", overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] },
    [],
    cache,
    false,
    2
  );

  assert.equal(queue.allowed.length, 1);
  assert.equal(queue.allowed[0].mailId, "mail-1");
});

test("buildQueueState accepts classification level labels from settings", () => {
  const registeredMail: StoredMail = {
    ...mails[0],
    mailId: "mail-3",
    sourceMailId: "mail-003",
    subject: "Registered contract",
    bodyExcerpt: "Please review this contract."
  };
  const cache = ensureClassifications([...mails, registeredMail], normalizeClassificationCache({}));
  const queue = buildQueueState(
    [...mails, registeredMail],
    { generatedAt: "", overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] },
    [],
    cache,
    false,
    "REGISTERED"
  );

  assert.deepEqual(queue.allowed.map((item) => item.mailId).sort(), ["mail-1", "mail-3"]);
  assert.deepEqual(queue.blocked.map((item) => item.mailId), ["mail-2"]);
});
