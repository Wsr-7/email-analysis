import type { AnalysisItem, AnalysisResult } from "../analysis/analysis-schema";
import type { ThreadAnalysisItem, ThreadAnalysisResult } from "../analysis/thread-analysis-schema";

export function buildDailyBrief(
  mailResult: AnalysisResult,
  threadResult?: ThreadAnalysisResult,
  dateLabel?: string
): string {
  const threads = threadResult?.items || [];
  const lines: string[] = [
    `# Daily Brief${dateLabel ? ` - ${dateLabel}` : ""}`,
    "",
    `Generated: ${mailResult.generatedAt}`,
    "",
    "## Overview",
    `- Single mails: ${mailResult.overview.totalMails}`,
    `- Threads: ${threadResult?.overview.totalThreads || 0}`,
    `- Must handle today: ${mailResult.overview.mustHandleToday + (threadResult?.overview.mustHandleToday || 0)}`,
    `- Risks: ${mailResult.overview.risks + (threadResult?.overview.risks || 0)}`,
    `- Waiting for me: ${mailResult.overview.waitingForMe + (threadResult?.overview.waitingForMe || 0)}`,
    `- Notices: ${mailResult.overview.notices + (threadResult?.overview.notices || 0)}`
  ];

  const topMails = topMailItems(mailResult.items);
  if (topMails.length) {
    lines.push("", "## Top Single Mails");
    for (const item of topMails) {
      lines.push(`- ${item.priority} ${item.subject || item.mailId} — ${item.summary || "No summary available."}${formatAction(item.suggestedAction)}`);
    }
  }

  const topThreads = topThreadItems(threads);
  if (topThreads.length) {
    lines.push("", "## Top Threads");
    for (const item of topThreads) {
      lines.push(`- ${item.priority} ${item.subject || item.threadId} — ${item.oneLineSummary || "No summary available."}${formatAction(item.suggestedAction)}`);
    }
  }

  const reviewFlags = buildReviewFlags(mailResult.items, threads);
  if (reviewFlags.length) {
    lines.push("", "## Review Flags", ...reviewFlags);
  }

  return lines.join("\n").trimEnd() + "\n";
}

function topMailItems(items: AnalysisItem[]): AnalysisItem[] {
  return sortMailItems(items)
    .filter((item) => item.priority === "P0" || item.priority === "P1" || item.category === "mustHandleToday" || item.category === "risk" || item.category === "waitingForMe")
    .slice(0, 10);
}

function topThreadItems(items: ThreadAnalysisItem[]): ThreadAnalysisItem[] {
  return sortThreadItems(items)
    .filter((item) => item.priority === "P0" || item.priority === "P1" || item.category === "mustHandleToday" || item.category === "risk" || item.category === "waitingForMe")
    .slice(0, 10);
}

function buildReviewFlags(mailItems: AnalysisItem[], threadItems: ThreadAnalysisItem[]): string[] {
  const flags: string[] = [];

  for (const item of sortMailItems(mailItems)) {
    if (item.needsOriginalMailCheck) {
      flags.push(`- mail ${item.mailId}: needs original mail check`);
    }
  }

  for (const item of sortThreadItems(threadItems)) {
    const reasons: string[] = [];
    if (item.partialContext) {
      reasons.push("partial context");
    }
    if (item.needsOriginalMailCheck) {
      reasons.push("needs original mail check");
    }
    if (reasons.length) {
      flags.push(`- thread ${item.threadId}: ${reasons.join("; ")}`);
    }
  }

  return flags;
}

function sortMailItems(items: AnalysisItem[]): AnalysisItem[] {
  return [...items].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
    || left.receivedTime.localeCompare(right.receivedTime)
    || left.mailId.localeCompare(right.mailId));
}

function sortThreadItems(items: ThreadAnalysisItem[]): ThreadAnalysisItem[] {
  return [...items].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
    || left.lastTime.localeCompare(right.lastTime)
    || left.threadId.localeCompare(right.threadId));
}

function priorityRank(priority: AnalysisItem["priority"]): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function formatAction(action: string): string {
  return action ? ` (action: ${action})` : "";
}
