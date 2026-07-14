import type { AnalysisItem, AnalysisResult } from "../analysis/analysis-schema";

export function buildSingleMailReport(result: AnalysisResult): string {
  const lines: string[] = [
    "# Single Mail Report",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    "## Overview",
    `- Total mails: ${result.overview.totalMails}`,
    `- Must handle today: ${result.overview.mustHandleToday}`,
    `- Risks: ${result.overview.risks}`,
    `- Waiting for me: ${result.overview.waitingForMe}`,
    `- Notices: ${result.overview.notices}`
  ];

  for (const item of sortItems(result.items)) {
    lines.push(
      "",
      `## ${item.priority} ${item.subject || item.mailId}`,
      "",
      `- Mail ID: ${item.mailId}`,
      `- Category: ${item.category}`,
      `- Sender: ${item.sender}`,
      `- Received: ${item.receivedTime}`,
      `- Confidence: ${formatConfidence(item.confidence)}`,
      `- Needs original mail check: ${yesNo(item.needsOriginalMailCheck)}`,
      "",
      "### Summary",
      item.summary || "No summary available.",
      "",
      "### Reason",
      item.reason || "No reason available.",
      "",
      "### Suggested Action",
      item.suggestedAction || "No suggested action."
    );

    if (item.evidence && item.evidence.length) {
      lines.push("", "### Evidence");
      for (const evidence of item.evidence) {
        const source = evidence.sourceMailId || item.mailId;
        const reason = evidence.reason ? ` — ${evidence.reason}` : "";
        lines.push(`- [${source}] ${evidence.quote}${reason}`);
      }
    }

    if (item.draftReply) {
      lines.push("", "### Draft Reply", item.draftReply);
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function sortItems(items: AnalysisItem[]): AnalysisItem[] {
  return [...items].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
    || left.receivedTime.localeCompare(right.receivedTime)
    || left.mailId.localeCompare(right.mailId));
}

function priorityRank(priority: AnalysisItem["priority"]): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function formatConfidence(confidence: number): string {
  return Number.isFinite(confidence) ? confidence.toFixed(2) : "0.00";
}

function yesNo(value: boolean): "Yes" | "No" {
  return value ? "Yes" : "No";
}
