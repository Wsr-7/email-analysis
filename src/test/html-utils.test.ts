import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, escapeAttr, domIdForMail, domIdForThread, domIdForThreadMessage, domIdForCategory, safeDomId, selected, toJsLiteral } from "../lib/html-utils";

describe("escapeHtml", () => {
  it("escapes all HTML special characters", () => {
    assert.equal(escapeHtml(`<div class="a" data-x='b'>&`), "&lt;div class=&quot;a&quot; data-x=&#39;b&#39;&gt;&amp;");
  });

  it("returns empty string for falsy input", () => {
    assert.equal(escapeHtml(""), "");
  });
});

describe("escapeAttr", () => {
  it("delegates to escapeHtml", () => {
    assert.equal(escapeAttr(`"quoted"`), escapeHtml(`"quoted"`));
  });
});

describe("safeDomId", () => {
  it("strips non-alphanumeric characters except underscore and dash", () => {
    assert.equal(safeDomId("abc.def@123"), "abc-def-123");
  });

  it("handles empty input", () => {
    assert.equal(safeDomId(""), "");
  });
});

describe("domIdForMail", () => {
  it("prefixes with mail-", () => {
    assert.equal(domIdForMail("msg-001"), "mail-msg-001");
  });
});

describe("domIdForThread", () => {
  it("prefixes with thread-", () => {
    assert.equal(domIdForThread("t.1"), "thread-t-1");
  });
});

describe("domIdForThreadMessage", () => {
  it("combines thread and mail ids", () => {
    assert.equal(domIdForThreadMessage("t1", "m1"), "thread-message-t1-m1");
  });
});

describe("domIdForCategory", () => {
  it("prefixes with category-", () => {
    assert.equal(domIdForCategory("risk"), "category-risk");
  });
});

describe("selected", () => {
  it("returns selected when values match", () => {
    assert.equal(selected("foo", "foo"), "selected");
  });

  it("returns empty when values differ", () => {
    assert.equal(selected("foo", "bar"), "");
  });

  it("handles numeric comparison via string coercion", () => {
    assert.equal(selected(5, "5"), "selected");
  });
});

describe("toJsLiteral", () => {
  it("returns a JSON-quoted string with HTML entities escaped", () => {
    const result = toJsLiteral("<script>'alert'</script>");
    assert.ok(!result.includes("<"));
    assert.ok(!result.includes(">"));
    assert.ok(!result.includes("'"));
    assert.ok(result.startsWith('"'));
    assert.ok(result.endsWith('"'));
  });
});
