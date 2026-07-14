import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderStat,
  renderButtonSpinner,
  renderDraftBox,
  formatClassification,
  formatGateStatus,
  formatThreadSecurity,
  formatModelInfo,
  formatPriority,
  formatAnalyzeNextLabel,
  formatRangeMeta,
  formatSelectedModel,
  renderRangeValueControl,
  renderClassificationOptions,
  renderModelOptions,
  renderThreadAnalysisSummary,
  renderEditableDraftBox,
} from "../lib/ui/dashboard-render";
import { LABELS, getLabels } from "../lib/ui/dashboard-labels";

const zhLabels = getLabels("zh-CN");
const enLabels = getLabels("en-US");

describe("renderStat", () => {
  it("renders a stat button with label and value", () => {
    const html = renderStat("Pulled", 42, "pending-panel");
    assert.ok(html.includes("Pulled"));
    assert.ok(html.includes("42"));
    assert.ok(html.includes('data-target-id="pending-panel"'));
  });

  it("defaults to 0 for undefined value", () => {
    const html = renderStat("Count", undefined, "target");
    assert.ok(html.includes("0"));
  });
});

describe("renderButtonSpinner", () => {
  it("returns spinner when active", () => {
    assert.ok(renderButtonSpinner(true).includes("button-spinner"));
  });

  it("returns empty when inactive", () => {
    assert.equal(renderButtonSpinner(false), "");
  });
});

describe("renderDraftBox", () => {
  it("renders draft with copy button", () => {
    const html = renderDraftBox("Hello draft");
    assert.ok(html.includes("Hello draft"));
    assert.ok(html.includes("copyDraft"));
  });

  it("returns empty for blank draft", () => {
    assert.equal(renderDraftBox("  "), "");
  });
});

describe("formatClassification", () => {
  it("formats classification with label and level", () => {
    assert.equal(formatClassification({ label: "INTERNAL", level: 1 }), "INTERNAL (1)");
  });

  it("returns dash for undefined", () => {
    assert.equal(formatClassification(undefined), "-");
  });
});

describe("formatGateStatus", () => {
  it("returns blocked label for block decision", () => {
    const result = formatGateStatus({ decision: "block", reasons: [] } as any, false, enLabels);
    assert.equal(result, enLabels.pending.gateBlocked);
  });

  it("returns manual required for manual_confirm", () => {
    const result = formatGateStatus({ decision: "manual_confirm", reasons: [] } as any, false, enLabels);
    assert.equal(result, enLabels.pending.manualRequired);
  });

  it("returns auto allowed when neither blocked nor manual", () => {
    const result = formatGateStatus(undefined, false, enLabels);
    assert.equal(result, enLabels.pending.autoAllowed);
  });
});

describe("formatThreadSecurity", () => {
  it("formats security summary", () => {
    const result = formatThreadSecurity({
      totalMessages: 4,
      allowedMessages: 3,
      manualConfirmMessages: 1,
      blockedMessages: 0,
      highestClassificationLevel: 1,
      partialContext: true,
      reasons: [],
    });
    assert.ok(result.includes("allow 3"));
    assert.ok(result.includes("manual 1"));
    assert.ok(result.includes("partial"));
    assert.ok(result.includes("block 0"));
  });

  it("returns dash for undefined", () => {
    assert.equal(formatThreadSecurity(undefined), "-");
  });
});

describe("formatModelInfo", () => {
  it("formats model info with vendor and name", () => {
    const result = formatModelInfo({ actualVendor: "OpenAI", actualName: "gpt-4o", usedFallback: false }, enLabels);
    assert.ok(result.includes("OpenAI"));
    assert.ok(result.includes("gpt-4o"));
  });

  it("returns dash when all fields empty", () => {
    assert.equal(formatModelInfo({}, enLabels), "-");
  });
});

describe("formatPriority", () => {
  it("translates high to Chinese for zh-CN labels", () => {
    assert.equal(formatPriority("high", zhLabels), "高");
  });

  it("translates medium to Chinese for zh-CN labels", () => {
    assert.equal(formatPriority("medium", zhLabels), "中");
  });

  it("passes through for en-US labels", () => {
    assert.equal(formatPriority("high", enLabels), "high");
  });

  it("returns dash for empty", () => {
    assert.equal(formatPriority("", enLabels), "-");
  });
});

describe("formatAnalyzeNextLabel", () => {
  it("does not read the removed analysis batch size setting", () => {
    const result = formatAnalyzeNextLabel(enLabels, {});
    assert.equal(result, enLabels.toolbar.analyze);
  });
});

describe("formatRangeMeta", () => {
  it("formats maxItems mode", () => {
    const result = formatRangeMeta({ rangeMode: "maxItems", maxItems: 50 }, enLabels);
    assert.ok(result.includes("50"));
  });

  it("formats recentHours mode", () => {
    const result = formatRangeMeta({ rangeMode: "recentHours", recentHours: 24 }, enLabels);
    assert.ok(result.includes("24"));
    assert.ok(result.includes("h"));
  });

  it("returns dash for unknown mode", () => {
    assert.equal(formatRangeMeta({}, enLabels), "-");
  });
});

describe("formatSelectedModel", () => {
  it("returns dash when no model selected", () => {
    assert.equal(formatSelectedModel("", []), "-");
  });

  it("returns value as-is when no matching model found", () => {
    assert.equal(formatSelectedModel("unknown-model", []), "unknown-model");
  });
});

describe("renderRangeValueControl", () => {
  it("renders recentHours control by default", () => {
    const html = renderRangeValueControl({ recentHours: 24 }, enLabels);
    assert.ok(html.includes("rangeValue"));
    assert.ok(html.includes("24"));
  });
});

describe("renderClassificationOptions", () => {
  it("renders 4 classification options", () => {
    const html = renderClassificationOptions(2, enLabels);
    assert.ok(html.includes("PUBLIC"));
    assert.ok(html.includes("selected"));
  });
});

describe("renderModelOptions", () => {
  it("returns not-loaded message when empty", () => {
    const html = renderModelOptions([], "", enLabels);
    assert.ok(html.includes(enLabels.settings.modelsNotLoaded));
  });
});

describe("renderThreadAnalysisSummary", () => {
  const baseAnalysis = {
    threadId: "t1",
    category: "followUp",
    priority: "P1" as const,
    subject: "Test",
    participants: [],
    lastTime: "",
    oneLineSummary: "summary",
    currentStatus: "ongoing",
    keyDecisions: [],
    openQuestions: [],
    actionItems: [],
    waitingOn: [],
    risks: [],
    needMyReply: false,
    suggestedAction: "",
    draftReply: "",
    confidence: 0.9,
    evidence: [],
    needsOriginalMailCheck: false,
    partialContext: false,
  };

  it("returns empty for undefined analysis", () => {
    assert.equal(renderThreadAnalysisSummary(undefined, enLabels), "");
  });

  it("shows currentStatus", () => {
    const html = renderThreadAnalysisSummary(baseAnalysis, enLabels);
    assert.ok(html.includes("ongoing"));
    assert.ok(html.includes(enLabels.threads.currentStatus));
  });

  it("shows needMyReply when true", () => {
    const html = renderThreadAnalysisSummary({ ...baseAnalysis, needMyReply: true }, enLabels);
    assert.ok(html.includes(enLabels.threads.needMyReply));
    assert.ok(html.includes(enLabels.threads.yes));
  });

  it("hides needMyReply when false", () => {
    const html = renderThreadAnalysisSummary({ ...baseAnalysis, needMyReply: false }, enLabels);
    assert.ok(!html.includes(enLabels.threads.needMyReply));
  });

  it("hides empty actionItems section", () => {
    const html = renderThreadAnalysisSummary(baseAnalysis, enLabels);
    assert.ok(!html.includes(enLabels.threads.actionItems));
  });

  it("truncates actionItems to 2 and shows overflow", () => {
    const items = [
      { owner: "A", task: "t1", deadline: "", sourceMailId: "", sourceTime: "" },
      { owner: "B", task: "t2", deadline: "", sourceMailId: "", sourceTime: "" },
      { owner: "C", task: "t3", deadline: "", sourceMailId: "", sourceTime: "" },
    ];
    const html = renderThreadAnalysisSummary({ ...baseAnalysis, actionItems: items }, enLabels);
    assert.ok(html.includes("t1"));
    assert.ok(html.includes("t2"));
    assert.ok(!html.includes("t3"));
    assert.ok(html.includes("(+1)"));
  });

  it("hides empty risks section", () => {
    const html = renderThreadAnalysisSummary(baseAnalysis, enLabels);
    assert.ok(!html.includes(enLabels.threads.risks));
  });

  it("truncates risks to 2 and shows overflow", () => {
    const risks = [
      { level: "high" as const, description: "r1", sourceMailId: "", sourceTime: "" },
      { level: "medium" as const, description: "r2", sourceMailId: "", sourceTime: "" },
      { level: "low" as const, description: "r3", sourceMailId: "", sourceTime: "" },
    ];
    const html = renderThreadAnalysisSummary({ ...baseAnalysis, risks }, enLabels);
    assert.ok(html.includes("r1"));
    assert.ok(html.includes("r2"));
    assert.ok(!html.includes("r3"));
    assert.ok(html.includes("(+1)"));
  });

  it("shows openQuestions truncated to 2", () => {
    const html = renderThreadAnalysisSummary({
      ...baseAnalysis,
      openQuestions: ["q1", "q2", "q3"],
    }, enLabels);
    assert.ok(html.includes(enLabels.threads.openQuestions));
    assert.ok(html.includes("q1"));
    assert.ok(html.includes("q2"));
    assert.ok(!html.includes("q3"));
    assert.ok(html.includes("(+1)"));
  });

  it("hides empty openQuestions section", () => {
    const html = renderThreadAnalysisSummary(baseAnalysis, enLabels);
    assert.ok(!html.includes(enLabels.threads.openQuestions));
  });
});

describe("renderEditableDraftBox", () => {
  it("renders textarea with draft text", () => {
    const html = renderEditableDraftBox("Hello draft", enLabels);
    assert.ok(html.includes("<textarea"));
    assert.ok(html.includes("Hello draft"));
    assert.ok(html.includes("draft-box-editable"));
  });

  it("renders empty textarea when no draft", () => {
    const html = renderEditableDraftBox("", enLabels);
    assert.ok(html.includes("<textarea"));
    assert.ok(html.includes("draft-textarea"));
  });

  it("includes copy button", () => {
    const html = renderEditableDraftBox("text", enLabels);
    assert.ok(html.includes("copyDraft"));
    assert.ok(html.includes(enLabels.card.copyDraft));
  });

  it("renders generate action only when draft is empty", () => {
    const html = (renderEditableDraftBox as any)("", enLabels, {
      itemId: "mail:a1",
      sourceId: "a1"
    });

    assert.ok(html.includes('data-action="generateDraft"'));
    assert.ok(!html.includes("data-generate-action"));
    assert.ok(html.includes("Generate Draft"));
    assert.ok(!html.includes('data-action="polishDraft"'));
    assert.ok(!html.includes('data-action="refineDraft"'));
    assert.ok(!html.includes('data-action="composeMail"'));
    assert.ok(!html.includes('data-action="copyDraft"'));
  });

  it("renders non-empty draft actions with stable item id and Outlook grouping", () => {
    const html = (renderEditableDraftBox as any)("text", enLabels, {
      itemId: "mail:a1",
      sourceId: "a1"
    });

    assert.ok(html.includes('data-item-id="mail:a1"'));
    assert.ok(html.includes('data-source-id="a1"'));
    assert.ok(html.includes('class="draft-editor-wrap"'));
    assert.ok(html.includes('class="draft-copy-button"'));
    assert.ok(html.includes("Outlook Actions"));
    assert.ok(html.includes('data-action="composeMail" data-mode="reply"'));
    assert.ok(!html.includes('data-action="generateDraft"'));
  });

  it("escapes HTML in draft text", () => {
    const html = renderEditableDraftBox("<script>alert(1)</script>", enLabels);
    assert.ok(!html.includes("<script>alert"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
});
