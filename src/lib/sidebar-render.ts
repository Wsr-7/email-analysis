import type { AnalysisResult } from "./analysis-schema";
import { classificationFor, normalizeClassificationCache, type ClassificationCache } from "./classification";
import { getLocaleFromConfig, mergeStringLists, parseFolders } from "./config-utils";
import { getLabels, buildCategoryLabels, type DashboardLabels } from "./dashboard-labels";
import { filterVisibleThreadsForDashboard } from "./dashboard-state";
import { escapeHtml, escapeAttr, selected } from "./html-utils";
import { selectConfiguredModel } from "./llm-provider";
import { emptyMailIndex, folderOldestReceivedTimes, type StoredMail } from "./mail-store";
import type { NextActionItem } from "./next-actions";
import { normalizePromptConfig } from "./prompt-config";
import { emptyThreadStore, type ThreadStore } from "./thread-store";
import { renderButtonSpinner, formatPriority, formatClassification, renderModelOptions, renderRangeValueControl, renderClassificationOptions, formatAnalyzeNextLabel, type DashboardRenderInput } from "./dashboard-render";
import { emptyMeetingStore, type StoredMeeting } from "./meeting-store";

const QUEUE_ORDER = [
  "meetings",
  "nextActions",
  "pending",
  "blocked",
  "mustHandleToday",
  "risk",
  "waitingForMe",
  "followUp",
  "importantSender",
  "notice",
  "threads",
  "ignored",
  "uncertain"
] as const;

const STABLE_QUEUES = new Set([
  "meetings", "nextActions", "pending", "blocked", "mustHandleToday", "risk", "waitingForMe",
  "followUp", "importantSender", "notice", "threads", "ignored", "uncertain"
]);

function queueIcon(queueId: string): string {
  switch (queueId) {
    case "meetings": return "📅";
    case "nextActions": return "☐";
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
  if (queueId === "meetings") return labels.meetings.title;
  if (queueId === "nextActions") return labels.nextActions.title;
  if (queueId === "pending") return labels.pending.title;
  if (queueId === "blocked") return labels.pending.blockedTitle;
  if (queueId === "threads") return labels.threads.title;
  return categoryLabels[queueId] || labels.categories[queueId] || queueId;
}

function shortTime(t: string): string {
  const m = /(\d{2}:\d{2})/.exec(t || "");
  return m ? m[1] : "";
}

function classificationBadge(mailId: string, classifications: ClassificationCache): string {
  const cls = classificationFor(mailId, classifications);
  if (!cls) return "";
  const label = formatClassification(cls);
  if (!label || label === "-") return "";
  return `<span class="sb-cls-badge">${escapeHtml(label)}</span>`;
}

function renderCompactMailRow(item: StoredMail, queue: string, classifications: ClassificationCache): string {
  const time = shortTime(item.receivedTime || "");
  const meta = [item.from || "", time].filter(Boolean).join(" · ");
  return `<div class="sb-row" data-queue="${escapeAttr(queue)}" data-mail-id="${escapeAttr(item.mailId)}" onclick="openItem('${escapeAttr(item.mailId)}')">
    <div class="sb-subject" title="${escapeAttr(item.subject || item.mailId)}">${escapeHtml(item.subject || item.mailId)}</div>
    <div class="sb-line2"><span class="sb-line2-meta">${escapeHtml(meta)}</span>${classificationBadge(item.mailId, classifications)}</div>
  </div>`;
}

function renderCompactAnalysisRow(item: AnalysisResult["items"][number], queue: string, labels: DashboardLabels, classifications: ClassificationCache): string {
  const time = shortTime(item.receivedTime || "");
  const meta = [item.sender || "", time].filter(Boolean).join(" · ");
  return `<div class="sb-row" data-queue="${escapeAttr(queue)}" data-mail-id="${escapeAttr(item.mailId)}" onclick="openItem('${escapeAttr(item.mailId)}')">
    <div class="sb-subject" title="${escapeAttr(item.subject || item.mailId)}">${escapeHtml(item.subject || item.mailId)}</div>
    <div class="sb-line2"><span class="sb-line2-meta">${escapeHtml(meta)}</span>${classificationBadge(item.mailId, classifications)}<span class="sb-badge">${escapeHtml(formatPriority(item.priority, labels))}</span></div>
  </div>`;
}

function renderCompactThreadRow(thread: ThreadStore["items"][number]): string {
  const time = shortTime(thread.lastTime || "");
  const meta = [thread.participants.slice(0, 2).join(", "), time].filter(Boolean).join(" · ");
  return `<div class="sb-row" data-queue="threads" data-thread-id="${escapeAttr(thread.threadId)}" onclick="openItem('${escapeAttr(thread.threadId)}')">
    <div class="sb-subject" title="${escapeAttr(thread.subject || thread.threadId)}">${escapeHtml(thread.subject || thread.threadId)}</div>
    <div class="sb-line2"><span class="sb-line2-meta">${escapeHtml(meta)}</span><span class="sb-badge">${escapeHtml(String(thread.messageCount))}</span></div>
  </div>`;
}

function meetingStatusBadge(status: string, labels: DashboardLabels): string {
  const map: Record<string, { label: string; cls: string }> = {
    notResponded: { label: labels.meetings.notResponded, cls: "sb-mtg-warn" },
    accepted: { label: labels.meetings.accepted, cls: "sb-mtg-ok" },
    tentative: { label: labels.meetings.tentative, cls: "sb-mtg-tentative" },
    declined: { label: labels.meetings.declined, cls: "sb-mtg-dim" },
    organizer: { label: labels.meetings.organizer_status, cls: "sb-mtg-ok" }
  };
  const m = map[status] || map["notResponded"]!;
  return `<span class="sb-badge ${m.cls}">${escapeHtml(m.label)}</span>`;
}

function renderCompactNextActionRow(item: NextActionItem, labels: DashboardLabels): string {
  const meta = [item.owner || "", item.deadline || ""].filter(Boolean).join(" · ");
  const statusBtn = item.status === "open"
    ? `<button class="sb-badge sb-action-status" data-action="markNextAction" data-action-id="${escapeAttr(item.id)}" data-status="done" onclick="event.stopPropagation();post('markNextAction',{actionId:'${escapeAttr(item.id)}',status:'done'})">${escapeHtml(labels.nextActions.markDone)}</button>`
    : `<button class="sb-badge sb-action-status sb-mtg-dim" data-action="markNextAction" data-action-id="${escapeAttr(item.id)}" data-status="open" onclick="event.stopPropagation();post('markNextAction',{actionId:'${escapeAttr(item.id)}',status:'open'})">${escapeHtml(labels.nextActions.reopen)}</button>`;
  return `<div class="sb-row${item.status !== "open" ? " sb-row-dim" : ""}" data-queue="nextActions" data-thread-id="${escapeAttr(item.sourceId)}" onclick="openItem('${escapeAttr(item.sourceId)}')">
    <div class="sb-subject" title="${escapeAttr(item.task)}">${escapeHtml(item.task)}</div>
    <div class="sb-line2"><span class="sb-line2-meta">${escapeHtml(meta)}</span>${statusBtn}</div>
  </div>`;
}

function renderCompactMeetingRow(item: StoredMeeting, labels: DashboardLabels): string {
  const meta = [item.organizer || "", item.start || ""].filter(Boolean).join(" · ");
  return `<div class="sb-row" data-queue="meetings" data-meeting-id="${escapeAttr(item.entryId)}" onclick="openItem('${escapeAttr(item.entryId)}')">
    <div class="sb-subject" title="${escapeAttr(item.subject || "-")}">${escapeHtml(item.subject || "-")}</div>
    <div class="sb-line2"><span class="sb-line2-meta">${escapeHtml(meta)}</span>${meetingStatusBadge(item.responseStatus, labels)}</div>
  </div>`;
}

export function renderSidebarHtml(input: DashboardRenderInput): string {
  const { state, store, index, availableModels, busyKind, isBusy } = input;
  const config = state.config as Record<string, unknown>;
  const locale = getLocaleFromConfig(config);
  const labels = getLabels(locale);
  const promptConfig = input.promptConfig || normalizePromptConfig({});
  promptConfig.importantSenders = mergeStringLists(promptConfig.importantSenders, parseFolders(config.importantSenders, []));
  const categoryLabels = buildCategoryLabels(labels, promptConfig, locale);
  const threadStore = input.threadStore || emptyThreadStore();
  const visibleThreadStore = filterVisibleThreadsForDashboard(threadStore);
  const queue = input.queue || { pending: [], blocked: [], analysed: [], allowed: [], ignoredPending: [] };
  const configuredModel = String(config.modelFamily || "");
  const canAnalyze = !!selectConfiguredModel(availableModels, configuredModel);
  const busyDisabled = isBusy ? " disabled" : "";
  const analysisDisabled = canAnalyze && !isBusy ? "" : " disabled";
  const pullMailBusy = busyKind === "pullMail";
  const analyzeNextBusy = busyKind === "analyzeNext";
  const analyzeNextLabel = formatAnalyzeNextLabel(labels, config);
  const batchSize: number = 5;
  const configuredFolders = Array.isArray(config.folders) ? config.folders.map(String) : ["Inbox", "Sent Items"];
  const hasHistoryAnchors = Object.keys(folderOldestReceivedTimes(index, configuredFolders)).length > 0;

  const queueCounts: Record<string, number> = {};
  for (const cat of state.categories) {
    queueCounts[cat.id] = cat.items.length;
  }
  const meetingStore = input.meetingStore || emptyMeetingStore();
  const unrespondedMeetings = meetingStore.items.filter((m) => m.responseStatus === "notResponded");
  const upcomingMeetings = meetingStore.items.filter((m) => m.responseStatus !== "notResponded");
  const sortedMeetings = [...unrespondedMeetings, ...upcomingMeetings].sort((a, b) => (a.start || "").localeCompare(b.start || ""));

  const nextActionsItems = (input.nextActionsStore?.items || []).filter((a) => a.status === "open");
  queueCounts["meetings"] = meetingStore.items.length;
  queueCounts["nextActions"] = nextActionsItems.length;
  queueCounts["pending"] = queue.allowed.length;
  queueCounts["blocked"] = queue.blocked.length;
  queueCounts["threads"] = visibleThreadStore.items.length;
  queueCounts["ignored"] = (queueCounts["ignored"] || 0) + (queue.ignoredPending?.length || 0);

  const activeQueues = QUEUE_ORDER.filter((q) => (queueCounts[q] || 0) > 0);
  const defaultQueue = activeQueues[0] || "pending";

  const queueNav = QUEUE_ORDER.map((q) => {
    const count = queueCounts[q] || 0;
    if (count === 0 && !STABLE_QUEUES.has(q)) return "";
    const dimClass = count === 0 ? " sb-queue-dim" : "";
    const separator = q === "mustHandleToday" ? `<div class="sb-queue-separator"></div>` : "";
    return `${separator}<button class="sb-queue-btn${q === defaultQueue ? " active" : ""}${dimClass}" data-queue-id="${escapeAttr(q)}" onclick="showQueue('${escapeAttr(q)}')">
      <span class="sb-queue-icon">${queueIcon(q)}</span>
      <span class="sb-queue-label">${escapeHtml(queueLabel(q, labels, categoryLabels))}</span>
      <span class="sb-queue-count">${count}</span>
    </button>`;
  }).filter(Boolean).join("");

  const classifications = input.classifications || normalizeClassificationCache({});

  const pendingRows = queue.allowed.map((item) => renderCompactMailRow(item, "pending", classifications)).join("");
  const blockedRows = queue.blocked.map((item) => renderCompactMailRow(item, "blocked", classifications)).join("");
  const analysisRows = state.categories.map((cat) =>
    cat.items.map((item) => renderCompactAnalysisRow(item, cat.id, labels, classifications)).join("")
  ).join("");
  const ignoredPendingRows = (queue.ignoredPending || []).map((item) => renderCompactMailRow(item, "ignored", classifications)).join("");
  const threadRows = [...(visibleThreadStore.items || [])].sort((a, b) =>
    String(b.lastTime || "").localeCompare(String(a.lastTime || ""))
  ).map((thread) => renderCompactThreadRow(thread)).join("");
  const nextActionRows = nextActionsItems.map((a) => renderCompactNextActionRow(a, labels)).join("");
  const meetingRows = sortedMeetings.map((m) => renderCompactMeetingRow(m, labels)).join("");

  const statusText = isBusy
    ? `<span class="sb-status-dot busy"></span> ${escapeHtml(busyKind)}`
    : `<span class="sb-status-dot idle"></span> ${escapeHtml(labels.toolbar.refresh)}`;

  const lastPull = store.lastPullAt || "-";

  const modelOptions = renderModelOptions(availableModels, configuredModel, labels);

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
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground, #ccc));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
    display: flex; flex-direction: column;
  }
  button { font-family: inherit; font-size: inherit; cursor: pointer; border: none; }
  a { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Fixed top ── */
  .sb-top { flex-shrink: 0; }

  .sb-header {
    padding: 4px 10px;
    display: flex; align-items: center;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
    gap: 6px;
  }
  .sb-status { display: flex; align-items: center; gap: 5px; font-size: 11px; opacity: 0.7; flex: 1; min-width: 0; }
  .sb-status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .sb-status-dot.idle { background: var(--vscode-charts-green, #4ec9b0); }
  .sb-status-dot.busy { background: var(--vscode-charts-yellow, #cca700); animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: 0.4; } }
  .sb-last-pull { font-size: 10px; opacity: 0.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sb-header-actions { display: flex; align-items: center; gap: 1px; flex-shrink: 0; }
  .sb-icon-btn {
    width: 24px; height: 24px; padding: 0; border-radius: 4px;
    background: transparent; color: var(--vscode-sideBar-foreground, var(--vscode-foreground, #ccc));
    display: inline-flex; align-items: center; justify-content: center;
    opacity: 0.6; position: relative;
  }
  .sb-icon-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground, var(--vscode-widget-border, rgba(128,128,128,0.15))); }
  .sb-icon-btn svg { width: 14px; height: 14px; }

  /* ── Language dropdown ── */
  .sb-lang-wrap { position: relative; display: inline-flex; }
  .sb-lang-dropdown {
    display: none; position: absolute; top: calc(100% + 4px); right: 0; z-index: 100;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background, #252526));
    border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border, #454545));
    border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    min-width: 110px; padding: 4px 0;
  }
  .sb-lang-dropdown.open { display: block; }
  .sb-lang-option {
    display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 12px; text-align: left;
    background: transparent; color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground, #ccc));
    font-size: 12px;
  }
  .sb-lang-option:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground, var(--vscode-widget-border, rgba(128,128,128,0.15)))); }
  .sb-lang-option.active::before { content: "✓"; font-size: 11px; opacity: 0.8; }

  /* ── Action bar ── */
  .sb-actions-bar {
    padding: 5px 10px;
    display: flex; gap: 4px; align-items: center;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
  }
  .sb-primary {
    flex: 1; min-width: 0;
    padding: 5px 10px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
    border-radius: 4px;
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-size: 12px; font-weight: 500;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    transition: background 0.15s, transform 0.1s;
  }
  .sb-primary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .sb-primary:active:not(:disabled) { transform: scale(0.97); }
  .sb-primary:disabled { opacity: 0.35; cursor: not-allowed; }
  .sb-secondary {
    padding: 5px 8px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
    border-radius: 4px; font-size: 12px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    transition: background 0.15s, transform 0.1s;
  }
  .sb-secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .sb-secondary:active:not(:disabled) { transform: scale(0.95); }
  .sb-secondary:disabled { opacity: 0.35; cursor: not-allowed; }
  .sb-analyze-group { display: inline-flex; flex: 1; min-width: 0; }
  .sb-analyze-group .sb-primary { border-radius: 4px 0 0 4px; flex: 1; border-right: none; }
  .sb-batch-select {
    width: 42px; padding: 4px 2px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15)); border-left: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    border-radius: 0 4px 4px 0;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    font-size: 11px; cursor: pointer; text-align: center;
    -webkit-appearance: none; -moz-appearance: none; appearance: none;
  }
  .sb-batch-select:disabled { opacity: 0.35; cursor: not-allowed; }
  .sb-batch-select:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .sb-batch-select:focus { outline: 1px solid var(--vscode-focusBorder, #007fd4); }
  .sb-batch-select option {
    background: var(--vscode-dropdown-background, var(--vscode-input-background, #3c3c3c));
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground, #ccc));
  }
  .sb-model-hint {
    font-size: 10px; color: var(--vscode-editorWarning-foreground, #cca700);
    padding: 2px 10px 0; display: flex; align-items: center; gap: 4px;
  }
  .button-spinner { width: 10px; height: 10px; border: 2px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); border-top-color: var(--vscode-foreground, #fff); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Scrollable middle ── */
  .sb-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; }

  /* ── Queue nav ── */
  .sb-queue-nav {
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
  }
  .sb-queue-btn {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 4px 8px; border-radius: 4px;
    background: transparent;
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground, #ccc));
    text-align: left;
  }
  .sb-queue-btn:hover { background: var(--vscode-list-hoverBackground, var(--vscode-list-hoverBackground, rgba(128,128,128,0.08))); }
  .sb-queue-btn.active {
    background: var(--vscode-list-activeSelectionBackground, #094771);
    color: var(--vscode-list-activeSelectionForeground, #fff);
  }
  .sb-queue-icon { width: 16px; text-align: center; font-size: 12px; opacity: 0.7; flex-shrink: 0; }
  .sb-queue-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-queue-count {
    font-size: 11px; min-width: 20px; text-align: center;
    padding: 1px 6px; border-radius: 10px;
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
  }
  .sb-queue-btn.active .sb-queue-count { background: var(--vscode-badge-background, #4d4d4d); }
  .sb-queue-btn.sb-queue-dim { opacity: 0.4; }
  .sb-queue-btn.sb-queue-dim:hover { opacity: 0.7; }
  .sb-queue-separator { height: 1px; margin: 3px 8px; background: var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2)); }

  /* ── Item rows ── */
  .sb-list-area { padding: 4px 0; }
  .sb-row {
    display: block; padding: 5px 12px; cursor: pointer;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.08));
  }
  .sb-row[hidden] { display: none; }
  .sb-row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.08)); }
  .sb-row.active { background: var(--vscode-list-activeSelectionBackground, rgba(0,127,212,0.28)); color: var(--vscode-list-activeSelectionForeground, var(--vscode-sideBar-foreground, #cccccc)); }
  .sb-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.4; }
  .sb-line2 { display: flex; align-items: center; gap: 6px; margin-top: 1px; }
  .sb-line2-meta { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; opacity: 0.55; }
  .sb-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; white-space: nowrap; flex-shrink: 0; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); }
  .sb-cls-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; white-space: nowrap; flex-shrink: 0; opacity: 0.8; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35)); color: var(--vscode-foreground, #ccc); }

  .sb-row-dim { opacity: 0.45; }
  .sb-action-status { cursor: pointer; font-size: 10px; padding: 1px 6px; border-radius: 8px; border: none; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); }

  /* ── Meeting status badges ── */
  .sb-mtg-warn { background: var(--vscode-editorWarning-foreground, #cca700); color: #000; }
  .sb-mtg-ok { background: var(--vscode-charts-green, #4ec9b0); color: #000; }
  .sb-mtg-tentative { background: var(--vscode-badge-background, #4d4d4d); }
  .sb-mtg-dim { opacity: 0.5; }

  /* ── Empty state ── */
  .sb-empty { padding: 20px 12px; text-align: center; opacity: 0.5; font-size: 12px; }

  /* ── Fixed bottom ── */
  .sb-bottom {
    flex-shrink: 0;
    padding: 4px 8px;
    border-top: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
  }
  .sb-bottom-row { display: flex; gap: 4px; flex-wrap: wrap; padding: 2px 0; }
  .sb-bottom-btn {
    padding: 4px 10px; font-size: 11px; border-radius: 4px;
    background: transparent;
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground, #ccc));
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    transition: background 0.15s, transform 0.1s;
  }
  .sb-bottom-btn:hover { background: var(--vscode-list-hoverBackground, var(--vscode-widget-border, rgba(128,128,128,0.15))); }
  .sb-bottom-btn:active { transform: scale(0.96); }
  .sb-bottom-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .sb-bottom-btn.wb-open {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border-color: transparent; font-weight: 500;
  }
  .sb-bottom-btn.wb-open:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  .sb-bottom-btn.danger { color: var(--vscode-errorForeground, #f48771); border-color: rgba(244,135,113,0.15); }
  .sb-bottom-btn.danger:hover { background: rgba(244,135,113,0.12); }

  /* ── Settings panel (inside bottom) ── */
  .sb-settings { padding: 0 4px; }
  .sb-settings[hidden] { display: none; }
  .sb-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px 0; }
  .sb-settings label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; opacity: 0.8; }
  .sb-settings input, .sb-settings select {
    padding: 5px 8px; border-radius: 4px; font-size: 12px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,0.15)));
    -webkit-appearance: none; -moz-appearance: none; appearance: none;
    transition: border-color 0.15s;
  }
  .sb-settings input:focus, .sb-settings select:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007fd4);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007fd4);
  }
  .sb-settings select {
    padding-right: 22px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='%23999'%3E%3Cpath d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
    background-size: 10px 6px;
    cursor: pointer;
  }
  .sb-settings select option {
    background: var(--vscode-dropdown-background, var(--vscode-input-background, #3c3c3c));
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground, #ccc));
  }
  .sb-settings input[type="number"] {
    -moz-appearance: textfield;
  }
  .sb-settings input[type="number"]::-webkit-outer-spin-button,
  .sb-settings input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none; margin: 0;
  }
</style>
</head>
<body>
  <!-- ═══ Fixed top ═══ -->
  <div class="sb-top">
    <div class="sb-header">
      <div class="sb-status">${statusText}</div>
      <div class="sb-last-pull">${escapeHtml(lastPull)}</div>
      <div class="sb-header-actions">
        <button class="sb-icon-btn" onclick="post('openGuide')" title="${escapeAttr(locale === "zh-CN" ? "帮助" : "Help")}">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 1a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM7.5 0a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15z"/><path d="M5.3 5.7c.2-1.3 1.1-2 2.3-2 1.3 0 2.2.8 2.2 1.9 0 .9-.4 1.3-1.2 1.8-.7.4-1 .8-1 1.5v.4H6.5v-.5c0-.9.4-1.4 1.1-1.8.6-.4.9-.7.9-1.3 0-.6-.5-1-1.2-1-.8 0-1.2.5-1.3 1.1L5.3 5.7zM6.3 11c0-.5.4-.9.9-.9s.9.4.9.9-.4.9-.9.9-.9-.4-.9-.9z"/></svg>
        </button>
        <div class="sb-lang-wrap" id="langToggle">
          <button class="sb-icon-btn" onclick="toggleLangMenu(event)" title="${escapeAttr(locale === "zh-CN" ? "语言" : "Language")}">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="8" cy="8" r="6.5"/><ellipse cx="8" cy="8" rx="2.8" ry="6.5"/><line x1="1.5" y1="5.5" x2="14.5" y2="5.5"/><line x1="1.5" y1="10.5" x2="14.5" y2="10.5"/></svg>
          </button>
          <div class="sb-lang-dropdown" id="langDropdown">
            <button class="sb-lang-option${locale === "en-US" ? " active" : ""}" onclick="setLanguage('en-US')">English</button>
            <button class="sb-lang-option${locale === "zh-CN" ? " active" : ""}" onclick="setLanguage('zh-CN')">中文</button>
          </div>
        </div>
      </div>
    </div>

    <div class="sb-actions-bar">
      <button class="sb-primary${pullMailBusy ? " is-busy" : ""}" onclick="post('pullMail')"${busyDisabled}>${escapeHtml(labels.toolbar.pullMail)}${renderButtonSpinner(pullMailBusy)}</button>
      <div class="sb-analyze-group">
        <button class="sb-primary${analyzeNextBusy ? " is-busy" : ""}" onclick="runAnalyze()"${analysisDisabled}>${escapeHtml(locale === "zh-CN" ? "分析" : "Analyze")}${renderButtonSpinner(analyzeNextBusy)}</button>
        <select class="sb-batch-select" id="batchSelect"${analysisDisabled}>
          <option value="5"${batchSize === 5 ? " selected" : ""}>5</option>
          <option value="10"${batchSize === 10 ? " selected" : ""}>10</option>
          <option value="20"${batchSize === 20 ? " selected" : ""}>20</option>
          <option value="50"${batchSize === 50 ? " selected" : ""}>50</option>
          <option value="all">${escapeHtml(locale === "zh-CN" ? "全部" : "All")}</option>
        </select>
      </div>
      <button class="sb-secondary" onclick="post('loadMore')"${!hasHistoryAnchors ? " disabled" : busyDisabled} title="${escapeAttr(labels.toolbar.loadMore)}">+</button>
      <button class="sb-secondary" onclick="post('refresh')"${busyDisabled} title="${escapeAttr(labels.toolbar.refresh)}">↻</button>
    </div>
    ${!canAnalyze ? `<div class="sb-model-hint"><svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M7.5 1a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM6.3 11c0-.5.4-.9.9-.9s.9.4.9.9-.4.9-.9.9-.9-.4-.9-.9zM6.5 4h2v5h-2V4z"/></svg>${escapeHtml(locale === "zh-CN" ? "请先在下方设置中加载模型" : "Load models in settings below to analyze")}</div>` : ""}
  </div>

  <!-- ═══ Scrollable middle ═══ -->
  <div class="sb-scroll">
    <div class="sb-queue-nav" id="queueNav">
      ${queueNav}
    </div>
    <div class="sb-list-area" id="itemList">
      ${meetingRows}
      ${nextActionRows}
      ${pendingRows}
      ${blockedRows}
      ${analysisRows}
      ${ignoredPendingRows}
      ${threadRows}
      <div class="sb-empty" id="emptyState">${escapeHtml(labels.card.noItems)}</div>
    </div>
  </div>

  <!-- ═══ Fixed bottom ═══ -->
  <div class="sb-bottom">
    <div class="sb-bottom-row">
      <button class="sb-bottom-btn wb-open" onclick="post('openWorkbench')">
        <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" style="flex-shrink:0"><path d="M1 2h14v12H1V2zm1 1v10h5V3H2zm6 0v10h6V3H8z"/></svg>
        ${escapeHtml(locale === "zh-CN" ? "工作台" : "Workbench")}
      </button>
      <button class="sb-bottom-btn" onclick="post('generateReports')"${busyDisabled}>${escapeHtml(labels.toolbar.generateReports)}</button>
      <button class="sb-bottom-btn" onclick="post('sampleDigest')"${busyDisabled}>${escapeHtml(labels.toolbar.sample)}</button>
      <span style="flex:1"></span>
      <button class="sb-bottom-btn" onclick="toggleSettings()">⚙</button>
      <button class="sb-bottom-btn danger" onclick="confirmClear()"${busyDisabled} title="${escapeAttr(locale === "zh-CN" ? "清空所有邮件和分析数据" : "Clear all mail and analysis data")}">✕</button>
    </div>
    <div class="sb-settings" id="settingsPanel" hidden>
      <div class="sb-settings-grid">
        <label>${escapeHtml(labels.settings.range)}
          <select id="rangeMode">
            <option value="recentHours" ${selected(config.rangeMode, "recentHours")}>${escapeHtml(labels.settings.recentHoursOption)}</option>
            <option value="maxItems" ${selected(config.rangeMode, "maxItems")}>${escapeHtml(labels.settings.maxItemsOption)}</option>
          </select>
        </label>
        ${renderRangeValueControl(config, labels)}
        <label><span>${escapeHtml(labels.settings.modelFamily)} <button class="sb-bottom-btn" onclick="post('loadModels')" style="display:inline;padding:1px 6px;">${escapeHtml(labels.toolbar.loadModels)}</button></span>
          <select id="modelFamily">${modelOptions}</select>
        </label>
        <label>${escapeHtml(labels.settings.maxClassification)}
          <select id="autoAnalyzeMaxClassificationLevel">
            ${renderClassificationOptions(Number(config.autoAnalyzeMaxClassificationLevel ?? 2), labels)}
          </select>
        </label>
        <label>${escapeHtml(labels.toolbar.promptConfig)}
          <button class="sb-bottom-btn" onclick="post('openPromptConfig')" style="text-align:left;padding:4px 6px;">${escapeHtml(locale === "zh-CN" ? "打开配置文件" : "Open config file")}</button>
        </label>
      </div>
    </div>
  </div>

<script>
const vscode = acquireVsCodeApi();
const prev = vscode.getState() || {};
let currentQueue = prev.currentQueue || '${escapeAttr(defaultQueue)}';

applyQueue(currentQueue, false);
if (prev.settingsOpen) { document.getElementById('settingsPanel').hidden = false; }
if (prev.batchSelect) { document.getElementById('batchSelect').value = prev.batchSelect; }
if (prev.currentItemId) setActiveRow(prev.currentItemId);

function post(type, extra) { vscode.postMessage(Object.assign({ type: type }, extra || {})); }

function showQueue(queueId) {
  currentQueue = queueId;
  applyQueue(queueId, true);
  vscode.setState(Object.assign({}, vscode.getState() || {}, { currentQueue: queueId }));
}

window.addEventListener('message', function(e) {
  var msg = e.data;
  if (msg && msg.type === 'focusQueue' && msg.queueId) showQueue(msg.queueId);
  if (msg && msg.type === 'focusItem' && msg.id) setActiveRow(msg.id);
});

function applyQueue(queueId, smooth) {
  for (const btn of document.querySelectorAll('.sb-queue-btn')) {
    btn.classList.toggle('active', btn.getAttribute('data-queue-id') === queueId);
  }
  let anyVisible = false;
  for (const row of document.querySelectorAll('.sb-row')) {
    const match = row.getAttribute('data-queue') === queueId;
    row.hidden = !match;
    if (match) anyVisible = true;
  }
  document.getElementById('emptyState').hidden = anyVisible;
}

function openItem(id) {
  setActiveRow(id);
  post('openInWorkbench', { mailId: id });
}

function setActiveRow(id) {
  for (var row of document.querySelectorAll('.sb-row')) {
    var match = row.getAttribute('data-mail-id') === id || row.getAttribute('data-thread-id') === id || row.getAttribute('data-meeting-id') === id;
    row.classList.toggle('active', match);
  }
  vscode.setState(Object.assign({}, vscode.getState() || {}, { currentItemId: id }));
}

function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  panel.hidden = !panel.hidden;
  vscode.setState(Object.assign({}, vscode.getState() || {}, { settingsOpen: !panel.hidden }));
}

function toggleLangMenu(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('langDropdown');
  dd.classList.toggle('open');
}
function setLanguage(lang) {
  document.getElementById('langDropdown').classList.remove('open');
  post('requestLanguageChange', { config: { outputLanguage: lang } });
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('#langToggle')) {
    document.getElementById('langDropdown').classList.remove('open');
  }
});

function runAnalyze() {
  var sel = document.getElementById('batchSelect').value;
  vscode.setState(Object.assign({}, vscode.getState() || {}, { batchSelect: sel }));
  if (sel === 'all') { post('analyzeAllAllowed'); }
  else { post('analyze', { batchSize: Number(sel) }); }
}

document.getElementById('batchSelect').addEventListener('change', function(e) {
  vscode.setState(Object.assign({}, vscode.getState() || {}, { batchSelect: e.target.value }));
});

var rangeValues = {
  recentHours: '${escapeAttr(String(config.recentHours || 24))}',
  maxItems: '${escapeAttr(String(config.maxItems || 50))}'
};
var rangeLabels = {
  recentHours: '${escapeAttr(labels.settings.recentHours)}',
  maxItems: '${escapeAttr(labels.settings.maxItems)}'
};
var configControlIds = ['rangeMode', 'rangeValue', 'modelFamily', 'autoAnalyzeMaxClassificationLevel'];
var autoSave = debounce(function() { saveConfig(true, false); }, 450);
for (var i = 0; i < configControlIds.length; i++) {
  var el = document.getElementById(configControlIds[i]);
  if (!el) continue;
  el.addEventListener('change', autoSave);
}
document.getElementById('rangeMode').addEventListener('change', function(e) {
  var mode = e.target.value === 'maxItems' ? 'maxItems' : 'recentHours';
  document.getElementById('rangeValueLabel').textContent = rangeLabels[mode];
  document.getElementById('rangeValue').value = rangeValues[mode];
});

function saveConfig(keepSettingsOpen, silent) {
  var rangeMode = document.getElementById('rangeMode').value;
  var rangeValue = document.getElementById('rangeValue');
  rangeValues[rangeMode] = rangeValue.value;
  post('saveConfig', {
    silent: silent === true,
    config: {
      rangeMode: rangeMode,
      outputLanguage: '${escapeAttr(locale)}',
      recentHours: rangeMode === 'recentHours' ? rangeValue.value : undefined,
      maxItems: rangeMode === 'maxItems' ? rangeValue.value : undefined,
      modelFamily: document.getElementById('modelFamily').value,
      autoAnalyzeMaxClassificationLevel: document.getElementById('autoAnalyzeMaxClassificationLevel').value
    }
  });
}

function confirmClear() {
  post('confirmClearLocalCache');
}

function debounce(fn, wait) { var timer; return function() { clearTimeout(timer); timer = setTimeout(fn, wait); }; }

</script>
</body>
</html>`;
}
