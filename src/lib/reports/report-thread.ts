import type { ThreadAnalysisItem, ThreadAnalysisResult } from "../analysis/thread-analysis-schema";

export function buildThreadReport(result: ThreadAnalysisResult): string {
  const lines: string[] = [
    "# Thread Report",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    "## Overview",
    `- Total threads: ${result.overview.totalThreads}`,
    `- Must handle today: ${result.overview.mustHandleToday}`,
    `- Risks: ${result.overview.risks}`,
    `- Waiting for me: ${result.overview.waitingForMe}`,
    `- Notices: ${result.overview.notices}`
  ];

  for (const item of sortItems(result.items)) {
    lines.push(
      "",
      `## ${item.priority} ${item.subject || item.threadId}`,
      "",
      `- Thread ID: ${item.threadId}`,
      `- Category: ${item.category}`,
      `- Participants: ${item.participants.join(", ") || "Unknown"}`,
      `- Last time: ${item.lastTime}`,
      `- Need my reply: ${yesNo(item.needMyReply)}`,
      `- Partial context: ${yesNo(item.partialContext)}`,
      `- Needs original mail check: ${yesNo(item.needsOriginalMailCheck)}`,
      `- Confidence: ${formatConfidence(item.confidence)}`,
      "",
      "### Summary",
      item.oneLineSummary || "No summary available."
    );

    if (item.currentStatus) {
      lines.push("", "### Current Status", item.currentStatus);
    }

    appendList(lines, "Key Decisions", item.keyDecisions);
    appendList(lines, "Open Questions", item.openQuestions);

    if (item.actionItems.length) {
      lines.push("", "### Action Items");
      for (const action of item.actionItems) {
        lines.push(`- ${action.owner || "Unassigned"}: ${action.task || "No task"}${formatActionMeta(action.deadline, action.sourceMailId, action.sourceTime)}`);
      }
    }

    appendList(lines, "Waiting On", item.waitingOn);

    if (item.risks.length) {
      lines.push("", "### Risks");
      for (const risk of item.risks) {
        const source = risk.sourceMailId ? ` (source: ${risk.sourceMailId})` : "";
        lines.push(`- ${risk.level}: ${risk.description}${source}`);
      }
    }

    if (item.suggestedAction) {
      lines.push("", "### Suggested Action", item.suggestedAction);
    }

    if (item.evidence.length) {
      lines.push("", "### Evidence");
      for (const evidence of item.evidence) {
        const source = evidence.sourceMailId || item.threadId;
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

function appendList(lines: string[], heading: string, values: string[]): void {
  if (!values.length) {
    return;
  }
  lines.push("", `### ${heading}`);
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}

function formatActionMeta(deadline: string, sourceMailId: string, sourceTime: string): string {
  const parts: string[] = [];
  if (deadline) {
    parts.push(`deadline: ${deadline}`);
  }
  if (sourceMailId) {
    parts.push(`source: ${sourceMailId}`);
  }
  if (sourceTime) {
    parts.push(`time: ${sourceTime}`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function sortItems(items: ThreadAnalysisItem[]): ThreadAnalysisItem[] {
  return [...items].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
    || left.lastTime.localeCompare(right.lastTime)
    || left.threadId.localeCompare(right.threadId));
}

function priorityRank(priority: ThreadAnalysisItem["priority"]): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function formatConfidence(confidence: number): string {
  return Number.isFinite(confidence) ? confidence.toFixed(2) : "0.00";
}

function yesNo(value: boolean): "Yes" | "No" {
  return value ? "Yes" : "No";
}
