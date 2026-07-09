import test from "node:test";
import assert from "node:assert/strict";
import { cleanMailBody, extractReplyDelta, hashBody, markDuplicateBodies } from "../lib/thread-timeline";

test("cleanMailBody normalizes line endings and trims noisy whitespace", () => {
  const body = "  Hello team,  \r\n\r\n\r\nPlease review this.   \r\n\r\n";

  assert.equal(cleanMailBody(body), "Hello team,\n\nPlease review this.");
});

test("extractReplyDelta removes English Outlook quoted history", () => {
  const body = `Please use version 2 of the proposal.

Thanks,
Me

From: Alice <alice@example.com>
Sent: Tuesday, June 16, 2026 9:00 AM
To: Me <me@example.com>
Subject: Proposal review

Please review version 1 of the proposal.`;

  assert.equal(extractReplyDelta(body), "Please use version 2 of the proposal.\n\nThanks,\nMe");
});

test("extractReplyDelta removes Chinese Outlook quoted history", () => {
  const body = `请以第二版报价为准。

谢谢。

发件人: 张三 <zhangsan@example.com>
发送时间: 2026年6月16日 09:00
收件人: 我 <me@example.com>
主题: 报价确认

请确认第一版报价。`;

  assert.equal(extractReplyDelta(body), "请以第二版报价为准。\n\n谢谢。");
});

test("extractReplyDelta removes common reply-chain separators", () => {
  assert.equal(extractReplyDelta("Latest reply.\n\nOn Tue, Alice wrote:\nOld reply."), "Latest reply.");
  assert.equal(extractReplyDelta("最新回复。\n\n在 2026年7月1日 Alice 写道:\n旧邮件。"), "最新回复。");
  assert.equal(extractReplyDelta("Latest reply.\n\n______________________________\nFrom: Alice\nSent: Today\nOld reply."), "Latest reply.");
  assert.equal(extractReplyDelta("Latest reply.\n\nFrom: Alice\nSent: Today\nOld reply."), "Latest reply.");
});

test("hashBody is deterministic for equivalent cleaned body text", () => {
  const first = hashBody("Status update\r\n\r\nReady.  ");
  const second = hashBody("Status update\n\nReady.");

  assert.equal(first, second);
  assert.notEqual(first, hashBody("Status update\n\nBlocked."));
});

test("markDuplicateBodies marks later repeated cleaned body content", () => {
  const marked = markDuplicateBodies([
    { id: "mail-001", body: "Same update.\r\n" },
    { id: "mail-002", body: "Same update.\n" },
    { id: "mail-003", body: "Different update." }
  ]);

  assert.equal(marked[0].isDuplicateBody, false);
  assert.equal(marked[0].duplicateOfId, undefined);
  assert.equal(marked[1].isDuplicateBody, true);
  assert.equal(marked[1].duplicateOfId, "mail-001");
  assert.equal(marked[2].isDuplicateBody, false);
});
