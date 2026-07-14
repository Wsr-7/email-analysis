import type { AnalysisResult } from "./analysis-schema";

const LABELS: Record<string, string> = {
  mustHandleToday: "Must Handle Today",
  risk: "Risk",
  waitingForMe: "Waiting For Me",
  followUp: "Follow-up",
  notice: "Notice",
  ignored: "Ignored",
  uncertain: "Uncertain"
};

export function buildSummaryMarkdown(analysis: AnalysisResult, categoryLabels: Record<string, string> = LABELS): string {
  const lines: string[] = ["# AI Mail Summary", ""];
  lines.push(`GeneratedAt: ${analysis.generatedAt}`);
  lines.push("");

  const categories = unique([...Object.keys(categoryLabels), ...analysis.items.map((item) => item.category)]);
  for (const category of categories) {
    const items = analysis.items.filter((item) => item.category === category);
    lines.push(`## ${categoryLabels[category] || category}`);
    lines.push("");
    if (!items.length) {
      lines.push("- No items");
      lines.push("");
      continue;
    }

    for (const item of items) {
      lines.push(`### ${item.subject || item.mailId}`);
      lines.push("");
      lines.push(`- Priority: ${item.priority}`);
      lines.push(`- Sender: ${item.sender}`);
      lines.push(`- ReceivedTime: ${item.receivedTime}`);
      lines.push(`- Summary: ${item.summary}`);
      lines.push(`- Reason: ${item.reason}`);
      lines.push(`- Suggested Action: ${item.suggestedAction}`);
      if (item.evidence?.length) {
        lines.push("- Evidence:");
        for (const evidence of item.evidence) {
          const source = evidence.sourceMailId ? `source: ${evidence.sourceMailId}` : "source: unknown";
          const quote = evidence.quote ? ` quote: ${evidence.quote}` : "";
          const reason = evidence.reason ? ` reason: ${evidence.reason}` : "";
          lines.push(`  - ${source}${quote}${reason}`);
        }
      }
      lines.push("- Draft Reply:");
      lines.push("");
      lines.push("```text");
      lines.push(item.draftReply || "");
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
