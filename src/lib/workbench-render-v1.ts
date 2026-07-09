import type { AnalysisResult } from "./analysis-schema";
import { classificationFor } from "./classification";
import { getLocaleFromConfig, mergeStringLists, parseFolders } from "./config-utils";
import { getLabels, buildCategoryLabels, type DashboardLabels } from "./dashboard-labels";
import { filterVisibleThreadsForDashboard, buildThreadLookup, compareTimelineMessagesForDisplay, type DashboardState } from "./dashboard-state";
import { escapeHtml, escapeAttr, domIdForMail, domIdForThread } from "./html-utils";
import { selectConfiguredModel } from "./llm-provider";
import { emptyMailStore, type StoredMail } from "./mail-store";
import { normalizePromptConfig } from "./prompt-config";
import { normalizeClassificationCache } from "./classification";
import type { SecurityGateDecisionResult } from "./security-types";
import { emptyThreadStore, type ThreadStore } from "./thread-store";
import type { ThreadAnalysisResult } from "./thread-analysis-schema";
import { renderButtonSpinner, formatClassification, formatGateStatus, formatThreadSecurity, formatPriority, renderDraftBox, type DashboardRenderInput } from "./dashboard-render";

const QUEUE_ORDER = [
  "pending", "blocked",
  "mustHandleToday", "risk", "waitingForMe", "followUp",
  "importantSender", "notice", "threads", "ignored", "uncertain"
] as const;

function queueIcon(queueId: string): string {
  switch (queueId) {
    case "mustHandleToday": return "!";
    case "risk": return "⚠";
    case "waitingForMe": return "←";
    case "pending": return "○";
    case "blocked": return "✕";
    case "followUp": return "→";
    case "importantSender": return "★";
    case "notice": return "·";
    case "threads": return "≡";
    case "ignored": return "—";
    case "uncertain": return "?";
    default: return "·";
  }
}

function queueLabel(queueId: string, labels: DashboardLabels, categoryLabels: Record<string, string>): string {
  if (queueId === "pending") return labels.pending.title;
  if (queueId === "blocked") return labels.pending.blockedTitle;
  if (queueId === "threads") return labels.threads.title;
  return categoryLabels[queueId] || labels.categories[queueId] || queueId;
}

function renderMailDetail(item: StoredMail, labels: DashboardLabels, extra: string): string {
  return `<div class="wb-detail-card" id="detail-${escapeAttr(item.mailId)}">
    <h3>${escapeHtml(item.subject || item.mailId)}</h3>
    <div class="wb-field"><strong>${escapeHtml(labels.card.from)}:</strong> ${escapeHtml(item.from || "-")}</div>
    <div class="wb-field"><strong>${escapeHtml(labels.card.received)}:</strong> ${escapeHtml(item.receivedTime || "-")}</div>
    ${extra}
    <div class="wb-field-body">${escapeHtml(item.bodyExcerpt || "")}</div>
    <div class="wb-actions">
      <button class="wb-btn" data-action="openInOutlook" data-mail-id="${escapeAttr(item.mailId)}">${escapeHtml(labels.card.openInOutlook)}</button>
      <button class="wb-btn ghost" data-action="ignore" data-mail-id="${escapeAttr(item.mailId)}">${escapeHtml(labels.card.ignore)}</button>
    </div>
  </div>`;
}

function renderAnalysisDetail(item: AnalysisResult["items"][number], labels: DashboardLabels, threadId: string): string {
  const priority = formatPriority(item.priority, labels);
  const draftHtml = item.draftReply ? renderDraftBox(item.draftReply) : "";
  const threadLink = threadId
    ? `<div class="wb-field"><strong>${escapeHtml(labels.card.thread)}:</strong> <a href="#" onclick="selectQueue('threads');return false;">${escapeHtml(threadId)}</a></div>`
    : "";
  return `<div class="wb-detail-card" id="detail-${escapeAttr(item.mailId)}">
    <h3>${escapeHtml(item.subject || item.mailId)}</h3>
    <span class="wb-badge">${escapeHtml(priority)}</span>
    <div class="wb-field"><strong>${escapeHtml(labels.card.from)}:</strong> ${escapeHtml(item.sender || "-")}</div>
    <div class="wb-field"><strong>${escapeHtml(labels.card.received)}:</strong> ${escapeHtml(item.receivedTime || "-")}</div>
    <div class="wb-field"><strong>${escapeHtml(labels.card.summary)}:</strong> ${escapeHtml(item.summary || "-")}</div>
    <div class="wb-field"><strong>${escapeHtml(labels.card.reason)}:</strong> ${escapeHtml(item.reason || "-")}</div>
    <div class="wb-field"><strong>${escapeHtml(labels.card.suggestedAction)}:</strong> ${escapeHtml(item.suggestedAction || "-")}</div>
    ${threadLink}
    ${draftHtml}
    <div class="wb-actions">
      <button class="wb-btn" data-action="openInOutlook" data-mail-id="${escapeAttr(item.mailId)}">${escapeHtml(labels.card.openInOutlook)}</button>
      <button class="wb-btn ghost" data-action="ignore" data-mail-id="${escapeAttr(item.mailId)}">${escapeHtml(labels.card.ignore)}</button>
    </div>
  </div>`;
}

function renderThreadDetail(
  thread: ThreadStore["items"][number],
  labels: DashboardLabels,
  analysis: ThreadAnalysisResult["items"][number] | undefined,
  busyKind: string
): string {
  const timelineItems = [...(thread.timeline || [])].sort(compareTimelineMessagesForDisplay);
  const timeline = timelineItems.map((msg) =>
    `<div class="wb-timeline-item">
      <div class="wb-timeline-head">${escapeHtml(msg.from || msg.senderEmail || "")} · ${escapeHtml(msg.receivedTime || msg.sentTime || "")}</div>
      <div class="wb-timeline-body">${escapeHtml((msg.bodyDelta || msg.bodyPreview || "").slice(0, 300))}</div>
    </div>`
  ).join("");

  const analysisHtml = analysis ? `
    <div class="wb-analysis">
      <div class="wb-field"><strong>${escapeHtml(labels.threads.currentStatus)}:</strong> ${escapeHtml(analysis.currentStatus || analysis.oneLineSummary || "-")}</div>
      ${analysis.actionItems.length ? `<div class="wb-field"><strong>${escapeHtml(labels.threads.actionItems)}:</strong><ul class="wb-list">${analysis.actionItems.map((a) => `<li>${escapeHtml([a.owner, a.task, a.deadline].filter(Boolean).join(": "))}</li>`).join("")}</ul></div>` : ""}
      ${analysis.risks?.length ? `<div class="wb-field"><strong>${escapeHtml(labels.threads.risks)}:</strong><ul class="wb-list">${analysis.risks.map((r) => `<li>[${escapeHtml(r.level)}] ${escapeHtml(r.description)}</li>`).join("")}</ul></div>` : ""}
      ${analysis.draftReply ? renderDraftBox(analysis.draftReply) : ""}
    </div>` : "";

  return `<div class="wb-detail-card" id="detail-thread-${escapeAttr(thread.threadId)}">
    <h3>${escapeHtml(thread.subject || thread.threadId)}</h3>
    <div class="wb-field"><strong>${escapeHtml(labels.threads.participants)}:</strong> ${escapeHtml(thread.participants.join(", ") || "-")}</div>
    <div class="wb-field"><strong>${escapeHtml(labels.threads.lastTime)}:</strong> ${escapeHtml(thread.lastTime || "-")}</div>
    <div class="wb-field"><strong>${escapeHtml(labels.threads.security)}:</strong> ${escapeHtml(formatThreadSecurity(thread.security))}</div>
    <div class="wb-actions">
      <button class="wb-btn${busyKind === "analyzeThread" ? " is-busy" : ""}" data-action="analyzeThread" data-thread-id="${escapeAttr(thread.threadId)}"${busyKind ? " disabled" : ""}>${escapeHtml(labels.threads.analyzeThread)}${renderButtonSpinner(busyKind === "analyzeThread")}</button>
    </div>
    ${analysisHtml}
    ${timelineItems.length ? `<div class="wb-timeline-section"><h4>${escapeHtml(labels.threads.timeline)} (${timelineItems.length})</h4><div class="wb-timeline">${timeline}</div></div>` : ""}
  </div>`;
}

export function renderWorkbenchHtml(input: DashboardRenderInput): string {
  const { state, store, availableModels, busyKind, isBusy } = input;
  const config = state.config as Record<string, unknown>;
  const locale = getLocaleFromConfig(config);
  const labels = getLabels(locale);
  const promptConfig = input.promptConfig || normalizePromptConfig({});
  promptConfig.importantSenders = mergeStringLists(promptConfig.importantSenders, parseFolders(config.importantSenders, []));
  const categoryLabels = buildCategoryLabels(labels, promptConfig, locale);
  const threadStore = input.threadStore || emptyThreadStore();
  const visibleThreadStore = filterVisibleThreadsForDashboard(threadStore);
  const threadAnalysis = input.threadAnalysis || { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] };
  const threadByMailId = buildThreadLookup(visibleThreadStore);
  const queue = input.queue || { pending: [], blocked: [], analysed: [], allowed: [] };
  const classifications = input.classifications || normalizeClassificationCache({});
  const securityDecisions = input.securityDecisions || new Map<string, SecurityGateDecisionResult>();
  const configuredModel = String(config.modelFamily || "");
  const canAnalyze = !!selectConfiguredModel(availableModels, configuredModel);
  const busyDisabled = isBusy ? " disabled" : "";
  const analysisDisabled = canAnalyze && !isBusy ? "" : " disabled";
  const analysisByThreadId = new Map((threadAnalysis.items || []).map((item) => [item.threadId, item]));

  const queueCounts: Record<string, number> = {};
  for (const cat of state.categories) { queueCounts[cat.id] = cat.items.length; }
  queueCounts["pending"] = queue.pending.length;
  queueCounts["blocked"] = queue.blocked.length;
  queueCounts["threads"] = visibleThreadStore.items.length;

  const activeQueues = QUEUE_ORDER.filter((q) => (queueCounts[q] || 0) > 0);
  const defaultQueue = activeQueues[0] || "pending";

  const railItems = QUEUE_ORDER.map((q) => {
    const count = queueCounts[q] || 0;
    if (count === 0 && q !== "pending" && q !== "mustHandleToday") return "";
    const dimClass = count === 0 ? " wb-dim" : "";
    return `<button class="wb-rail-item${q === defaultQueue ? " active" : ""}${dimClass}" data-queue-id="${escapeAttr(q)}" onclick="selectQueue('${escapeAttr(q)}')">
      <span class="wb-rail-icon">${queueIcon(q)}</span>
      <span class="wb-rail-label">${escapeHtml(queueLabel(q, labels, categoryLabels))}</span>
      <span class="wb-rail-count">${count}</span>
    </button>`;
  }).filter(Boolean).join("");

  // Build list items and detail panels for each queue
  const listData: string[] = [];
  const detailData: string[] = [];

  for (const item of queue.pending) {
    const classification = classificationFor(item.mailId, classifications);
    const extra = `<div class="wb-field"><strong>${escapeHtml(labels.pending.classification)}:</strong> ${escapeHtml(formatClassification(classification))}</div>`;
    listData.push(`<div class="wb-list-item" data-queue="pending" data-id="${escapeAttr(item.mailId)}" onclick="selectItem(this)">
      <span class="wb-list-subject">${escapeHtml(item.subject || item.mailId)}</span>
      <span class="wb-list-meta">${escapeHtml(item.from || "")}</span>
    </div>`);
    detailData.push(`<div class="wb-detail-panel" data-queue="pending" data-id="${escapeAttr(item.mailId)}">${renderMailDetail(item, labels, extra)}</div>`);
  }

  for (const item of queue.blocked) {
    const classification = classificationFor(item.mailId, classifications);
    const gateDecision = securityDecisions.get(item.mailId);
    const extra = `<div class="wb-field"><strong>${escapeHtml(labels.pending.classification)}:</strong> ${escapeHtml(formatClassification(classification))}</div>
      <div class="wb-field wb-blocked-reason"><strong>${escapeHtml(labels.pending.gateBlocked)}:</strong> ${escapeHtml(gateDecision?.reasons.join("; ") || "-")}</div>`;
    listData.push(`<div class="wb-list-item" data-queue="blocked" data-id="${escapeAttr(item.mailId)}" onclick="selectItem(this)">
      <span class="wb-list-subject">${escapeHtml(item.subject || item.mailId)}</span>
      <span class="wb-list-meta">${escapeHtml(item.from || "")}</span>
    </div>`);
    detailData.push(`<div class="wb-detail-panel" data-queue="blocked" data-id="${escapeAttr(item.mailId)}">${renderMailDetail(item, labels, extra)}</div>`);
  }

  for (const cat of state.categories) {
    for (const item of cat.items) {
      const threadId = threadByMailId.get(item.mailId) || "";
      listData.push(`<div class="wb-list-item" data-queue="${escapeAttr(cat.id)}" data-id="${escapeAttr(item.mailId)}" onclick="selectItem(this)">
        <span class="wb-list-subject">${escapeHtml(item.subject || item.mailId)}</span>
        <span class="wb-list-badge">${escapeHtml(formatPriority(item.priority, labels))}</span>
      </div>`);
      detailData.push(`<div class="wb-detail-panel" data-queue="${escapeAttr(cat.id)}" data-id="${escapeAttr(item.mailId)}">${renderAnalysisDetail(item, labels, threadId)}</div>`);
    }
  }

  const sortedThreads = [...(visibleThreadStore.items || [])].sort((a, b) => String(b.lastTime || "").localeCompare(String(a.lastTime || "")));
  for (const thread of sortedThreads) {
    listData.push(`<div class="wb-list-item" data-queue="threads" data-id="${escapeAttr(thread.threadId)}" onclick="selectItem(this)">
      <span class="wb-list-subject">${escapeHtml(thread.subject || thread.threadId)}</span>
      <span class="wb-list-badge">${escapeHtml(String(thread.messageCount))}</span>
    </div>`);
    detailData.push(`<div class="wb-detail-panel" data-queue="threads" data-id="${escapeAttr(thread.threadId)}">${renderThreadDetail(thread, labels, analysisByThreadId.get(thread.threadId), busyKind)}</div>`);
  }

  const statusText = isBusy
    ? `<span class="wb-status-dot busy"></span> ${escapeHtml(busyKind)}`
    : `<span class="wb-status-dot idle"></span> Idle`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; }
  body {
    font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-editor-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
    display: flex; flex-direction: column;
  }
  button { font-family: inherit; font-size: inherit; cursor: pointer; border: none; }
  a { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Top bar ── */
  .wb-topbar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; flex-shrink: 0;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    background: var(--vscode-editor-background, #1e1e1e);
  }
  .wb-status { display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: 0.7; }
  .wb-status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .wb-status-dot.idle { background: var(--vscode-charts-green, #4ec9b0); }
  .wb-status-dot.busy { background: var(--vscode-charts-yellow, #cca700); animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: 0.4; } }
  .wb-topbar-spacer { flex: 1; }
  .wb-action {
    padding: 4px 12px; border-radius: 4px; font-size: 12px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    display: inline-flex; align-items: center; gap: 6px;
  }
  .wb-action:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, #1177bb); }
  .wb-action:disabled { opacity: 0.45; cursor: not-allowed; }
  .wb-action.secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
  }
  .wb-action.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .button-spinner { width: 10px; height: 10px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Three-column layout ── */
  .wb-columns { display: flex; flex: 1; overflow: hidden; }

  /* Left rail */
  .wb-rail {
    width: 200px; flex-shrink: 0; overflow-y: auto;
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
    padding: 4px 0;
  }
  .wb-rail-item {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 6px 12px; text-align: left;
    background: transparent;
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground, #ccc));
  }
  .wb-rail-item:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05)); }
  .wb-rail-item.active {
    background: var(--vscode-list-activeSelectionBackground, #094771);
    color: var(--vscode-list-activeSelectionForeground, #fff);
  }
  .wb-rail-icon { width: 16px; text-align: center; font-size: 12px; opacity: 0.7; flex-shrink: 0; }
  .wb-rail-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .wb-rail-count {
    font-size: 10px; min-width: 18px; text-align: center;
    padding: 1px 5px; border-radius: 8px;
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
  }
  .wb-dim { opacity: 0.4; }
  .wb-dim:hover { opacity: 0.7; }

  /* Middle list */
  .wb-list-col {
    width: 320px; flex-shrink: 0; overflow-y: auto;
    border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
  }
  .wb-list-item {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px; cursor: pointer;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.08));
  }
  .wb-list-item:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05)); }
  .wb-list-item.active {
    background: var(--vscode-list-activeSelectionBackground, #094771);
    color: var(--vscode-list-activeSelectionForeground, #fff);
  }
  .wb-list-item[hidden] { display: none; }
  .wb-list-subject { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .wb-list-meta { font-size: 11px; opacity: 0.55; white-space: nowrap; max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
  .wb-list-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); white-space: nowrap; }
  .wb-list-empty { padding: 20px 12px; text-align: center; opacity: 0.5; font-size: 12px; }

  /* Right detail */
  .wb-detail-col {
    flex: 1; overflow-y: auto; padding: 16px 20px;
  }
  .wb-detail-panel { display: none; }
  .wb-detail-panel.active { display: block; }
  .wb-detail-card h3 { font-size: 16px; margin-bottom: 12px; line-height: 1.3; }
  .wb-field { padding: 4px 0; line-height: 1.5; font-size: 13px; }
  .wb-field-body { margin-top: 12px; padding: 8px; font-size: 12px; white-space: pre-wrap; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; max-height: 300px; overflow-y: auto; }
  .wb-blocked-reason { color: var(--vscode-errorForeground, #f48771); }
  .wb-badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 8px; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); margin-bottom: 8px; }
  .wb-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  .wb-btn {
    padding: 5px 14px; border-radius: 4px; font-size: 12px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    display: inline-flex; align-items: center; gap: 6px;
  }
  .wb-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, #1177bb); }
  .wb-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .wb-btn.ghost { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); }
  .wb-btn.is-busy { gap: 6px; }
  .wb-list { margin: 4px 0 4px 20px; padding: 0; list-style: disc; }
  .wb-list li { padding: 2px 0; }

  .wb-analysis { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15)); }
  .wb-timeline-section { margin-top: 12px; }
  .wb-timeline-section h4 { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
  .wb-timeline { padding: 4px 0; }
  .wb-timeline-item { padding: 6px 0 6px 12px; border-left: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.3)); margin-bottom: 4px; }
  .wb-timeline-head { font-size: 11px; opacity: 0.6; }
  .wb-timeline-body { font-size: 12px; white-space: pre-wrap; margin-top: 4px; opacity: 0.85; }

  .wb-detail-empty { padding: 40px 20px; text-align: center; opacity: 0.4; font-size: 14px; }

  /* Draft box */
  .draft-box { position: relative; margin-top: 8px; }
  .draft-box pre { margin: 0; padding: 8px 40px 8px 12px; font-size: 12px; white-space: pre-wrap; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; }
  .copy-icon-button { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; padding: 0; border-radius: 4px; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); border: none; }
  .copy-icon { position: relative; display: inline-block; width: 12px; height: 14px; border: 1.5px solid currentColor; border-radius: 1px; box-sizing: border-box; }
  .copy-icon::before { content: ""; position: absolute; width: 12px; height: 14px; left: -5px; top: 3px; border: 1.5px solid currentColor; border-radius: 1px; background: var(--vscode-button-secondaryBackground, #3a3d41); box-sizing: border-box; }
</style>
</head>
<body>
  <div class="wb-topbar">
    <div class="wb-status">${statusText}</div>
    <div class="wb-topbar-spacer"></div>
    <button class="wb-action${isBusy && busyKind === "pullMail" ? " is-busy" : ""}" onclick="post('pullMail')"${busyDisabled}>${escapeHtml(labels.toolbar.pullMail)}${renderButtonSpinner(busyKind === "pullMail")}</button>
    <button class="wb-action${isBusy && busyKind === "analyzeNext" ? " is-busy" : ""}" onclick="post('analyze')"${analysisDisabled}>${escapeHtml(locale === "zh-CN" ? "分析" : "Analyze")}${renderButtonSpinner(busyKind === "analyzeNext")}</button>
    <button class="wb-action secondary" onclick="post('generateReports')"${busyDisabled}>${escapeHtml(labels.toolbar.generateReports)}</button>
    <button class="wb-action secondary" onclick="post('refresh')"${busyDisabled}>↻</button>
  </div>

  <div class="wb-columns">
    <div class="wb-rail" id="rail">${railItems}</div>
    <div class="wb-list-col" id="listCol">
      ${listData.join("")}
      <div class="wb-list-empty" id="listEmpty">${escapeHtml(labels.card.noItems)}</div>
    </div>
    <div class="wb-detail-col" id="detailCol">
      ${detailData.join("")}
      <div class="wb-detail-empty" id="detailEmpty">${escapeHtml(locale === "zh-CN" ? "选择一个邮件查看详情" : "Select an item to view details")}</div>
    </div>
  </div>

<script>
var vscode = acquireVsCodeApi();
var prev = vscode.getState() || {};
var currentQueue = prev.currentQueue || '${escapeAttr(defaultQueue)}';
var currentId = prev.currentId || '';

function post(type, extra) { vscode.postMessage(Object.assign({ type: type }, extra || {})); }

applyQueue(currentQueue);
if (currentId) { applySelection(currentId); }

function selectQueue(queueId) {
  currentQueue = queueId;
  currentId = '';
  applyQueue(queueId);
  vscode.setState({ currentQueue: queueId, currentId: '' });
}

function applyQueue(queueId) {
  for (var btn of document.querySelectorAll('.wb-rail-item')) {
    btn.classList.toggle('active', btn.getAttribute('data-queue-id') === queueId);
  }
  var firstVisible = null;
  for (var item of document.querySelectorAll('.wb-list-item')) {
    var match = item.getAttribute('data-queue') === queueId;
    item.hidden = !match;
    item.classList.remove('active');
    if (match && !firstVisible) firstVisible = item;
  }
  document.getElementById('listEmpty').hidden = !!firstVisible;
  hideAllDetails();
  if (!currentId && firstVisible) {
    selectItem(firstVisible);
  }
}

function selectItem(el) {
  for (var item of document.querySelectorAll('.wb-list-item')) { item.classList.remove('active'); }
  el.classList.add('active');
  var id = el.getAttribute('data-id');
  currentId = id;
  applySelection(id);
  vscode.setState({ currentQueue: currentQueue, currentId: id });
}

function applySelection(id) {
  hideAllDetails();
  for (var panel of document.querySelectorAll('.wb-detail-panel')) {
    if (panel.getAttribute('data-id') === id) {
      panel.classList.add('active');
      document.getElementById('detailEmpty').hidden = true;
      return;
    }
  }
  document.getElementById('detailEmpty').hidden = false;
}

function hideAllDetails() {
  for (var panel of document.querySelectorAll('.wb-detail-panel')) { panel.classList.remove('active'); }
  document.getElementById('detailEmpty').hidden = false;
}

document.addEventListener('click', function(event) {
  var target = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
  if (!target) return;
  var action = target.getAttribute('data-action');
  if (action === 'copyDraft') post('copyDraft', { draftReply: target.getAttribute('data-draft-reply') || '' });
  if (action === 'ignore') post('ignore', { mailId: target.getAttribute('data-mail-id') || '' });
  if (action === 'unignore') post('unignore', { mailId: target.getAttribute('data-mail-id') || '' });
  if (action === 'openInOutlook') post('openInOutlook', { mailId: target.getAttribute('data-mail-id') || '' });
  if (action === 'analyzeThread') post('analyzeThread', { threadId: target.getAttribute('data-thread-id') || '' });
});
</script>
</body>
</html>`;
}
