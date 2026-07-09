import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LABELS, getLabels, buildCategoryLabels } from "../lib/dashboard-labels";

describe("LABELS", () => {
  it("has both locales", () => {
    assert.ok(LABELS["zh-CN"]);
    assert.ok(LABELS["en-US"]);
  });

  it("each locale has all required sections", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const l = LABELS[locale];
      assert.ok(l.toolbar);
      assert.ok(l.settings);
      assert.ok(l.meta);
      assert.ok(l.stats);
      assert.ok(l.categories);
      assert.ok(l.card);
      assert.ok(l.pending);
      assert.ok(l.threads);
      assert.ok(l.progress);
      assert.ok(l.model);
    }
  });
});

describe("getLabels", () => {
  it("returns zh-CN labels", () => {
    assert.equal(getLabels("zh-CN").toolbar.pullMail, "获取新邮件");
  });

  it("returns en-US labels", () => {
    assert.equal(getLabels("en-US").toolbar.pullMail, "Fetch New");
  });
});

describe("buildCategoryLabels", () => {
  it("merges custom categories from prompt config", () => {
    const labels = getLabels("en-US");
    const config = {
      categories: [
        { id: "custom", labelZh: "自定义", labelEn: "Custom", description: "", priorityHint: "" }
      ],
      replyDraftInstruction: "",
      importantSenders: []
    };
    const result = buildCategoryLabels(labels, config, "en-US");
    assert.equal(result.custom, "Custom");
    assert.equal(result.mustHandleToday, "Must Handle Today");
  });
});
