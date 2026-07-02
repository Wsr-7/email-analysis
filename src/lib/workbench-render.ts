import type { AnalysisResult } from "./analysis-schema";
import { classificationFor, normalizeClassificationCache } from "./classification";
import { getLocaleFromConfig } from "./config-utils";
import { getLabels, type DashboardLabels } from "./dashboard-labels";
import { filterVisibleThreadsForDashboard, buildThreadLookup, compareTimelineMessagesForDisplay } from "./dashboard-state";
import { escapeHtml, escapeAttr } from "./html-utils";
import type { StoredMail } from "./mail-store";
import type { SecurityGateDecisionResult } from "./security-types";
import { emptyThreadStore, type ThreadStore } from "./thread-store";
import type { ThreadAnalysisResult } from "./thread-analysis-schema";
import { renderButtonSpinner, formatClassification, formatThreadSecurity, formatPriority, renderDraftBox, renderEditableDraftBox, type DashboardRenderInput } from "./dashboard-render";
import { emptyMeetingStore, type StoredMeeting } from "./meeting-store";

function ignoreOrRestore(queue: string, mailId: string, labels: DashboardLabels): string {
  if (queue === "ignored") {
    return `<button class="wb-btn ghost" data-action="unignore" data-mail-id="${escapeAttr(mailId)}">${escapeHtml(labels.card.restore)}</button>`;
  }
  return `<button class="wb-btn ghost" data-action="ignore" data-mail-id="${escapeAttr(mailId)}">${escapeHtml(labels.card.ignore)}</button>`;
}

function confirmAnalyzeButton(mailId: string, decision: SecurityGateDecisionResult | undefined, labels: DashboardLabels): string {
  if (decision?.decision !== "manual_confirm") return "";
  return `<button class="wb-btn" data-action="analyzeSelected" data-mail-id="${escapeAttr(mailId)}">${escapeHtml(labels.pending.confirmAnalyze)}</button>`;
}

function renderMailDetail(item: StoredMail, queue: string, labels: DashboardLabels, extra: string, extraActions = "", classifications?: ReturnType<typeof normalizeClassificationCache>): string {
  const toHtml = item.to ? `<div class="wb-field"><strong>${escapeHtml(labels.card.to)}:</strong> ${escapeHtml(item.to)}</div>` : "";
  const ccHtml = item.cc ? `<div class="wb-field"><strong>${escapeHtml(labels.card.cc)}:</strong> ${escapeHtml(item.cc)}</div>` : "";
  const cls = classifications ? classificationFor(item.mailId, classifications) : undefined;
  const clsFromExtra = extra.includes(labels.pending.classification);
  const clsHtml = cls && !clsFromExtra ? `<div class="wb-field"><strong>${escapeHtml(labels.pending.classification)}:</strong> ${escapeHtml(formatClassification(cls))}</div>` : "";
  return `<div class="wb-detail-card">
    <h3>${escapeHtml(item.subject || item.mailId)}</h3>
    <div class="wb-meta-grid">
      <div class="wb-field"><strong>${escapeHtml(labels.card.from)}:</strong> ${escapeHtml(item.from || "-")}</div>
      ${toHtml}
      ${ccHtml}
      <div class="wb-field"><strong>${escapeHtml(labels.card.received)}:</strong> ${escapeHtml(item.receivedTime || "-")}</div>
      ${clsHtml}
      ${extra}
    </div>
    <div class="wb-actions">
      ${extraActions}
      <button class="wb-btn" data-action="openInOutlook" data-mail-id="${escapeAttr(item.mailId)}">${escapeHtml(labels.card.openInOutlook)}</button>
      ${ignoreOrRestore(queue, item.mailId, labels)}
    </div>
    <div class="wb-body">${escapeHtml(item.bodyExcerpt || "")}</div>
  </div>`;
}

function renderAnalysisDetail(item: AnalysisResult["items"][number], queue: string, labels: DashboardLabels, threadId: string, classifications: ReturnType<typeof normalizeClassificationCache>, originalMail?: StoredMail): string {
  const priority = formatPriority(item.priority, labels);
  const draftHtml = renderEditableDraftBox(item.draftReply || "", labels, { itemId: `mail:${item.mailId}`, sourceId: item.mailId, generateAction: "analyzeSelected" });
  const classification = classificationFor(item.mailId, classifications);
  const clsHtml = classification ? `<div class="wb-field"><strong>${escapeHtml(labels.pending.classification)}:</strong> ${escapeHtml(formatClassification(classification))}</div>` : "";
  const toHtml = originalMail?.to ? `<div class="wb-field"><strong>${escapeHtml(labels.card.to)}:</strong> ${escapeHtml(originalMail.to)}</div>` : "";
  const ccHtml = originalMail?.cc ? `<div class="wb-field"><strong>${escapeHtml(labels.card.cc)}:</strong> ${escapeHtml(originalMail.cc)}</div>` : "";
  const threadLink = threadId
    ? `<div class="wb-field"><strong>${escapeHtml(labels.card.thread)}:</strong> ${escapeHtml(threadId)}</div>`
    : "";
  const bodyText = originalMail?.bodyExcerpt || "";
  const bodyHtml = bodyText ? `<div class="wb-section"><div class="wb-field"><strong>${escapeHtml(labels.card.body)}:</strong></div><div class="wb-body">${escapeHtml(bodyText)}</div></div>` : "";
  return `<div class="wb-detail-card">
    <div class="wb-detail-header">
      <h3>${escapeHtml(item.subject || item.mailId)}</h3>
      <span class="wb-priority">${escapeHtml(priority)}</span>
    </div>
    <div class="wb-meta-grid">
      <div class="wb-field"><strong>${escapeHtml(labels.card.from)}:</strong> ${escapeHtml(item.sender || "-")}</div>
      ${toHtml}
      ${ccHtml}
      <div class="wb-field"><strong>${escapeHtml(labels.card.received)}:</strong> ${escapeHtml(item.receivedTime || "-")}</div>
      ${clsHtml}
    </div>
    <div class="wb-actions">
      <button class="wb-btn" data-action="openInOutlook" data-mail-id="${escapeAttr(item.mailId)}">${escapeHtml(labels.card.openInOutlook)}</button>
      ${ignoreOrRestore(queue, item.mailId, labels)}
    </div>
    <div class="wb-section">
      <div class="wb-field"><strong>${escapeHtml(labels.card.summary)}:</strong></div>
      <div class="wb-section-body">${escapeHtml(item.summary || "-")}</div>
    </div>
    <div class="wb-section">
      <div class="wb-field"><strong>${escapeHtml(labels.card.reason)}:</strong></div>
      <div class="wb-section-body">${escapeHtml(item.reason || "-")}</div>
    </div>
    <div class="wb-section">
      <div class="wb-field"><strong>${escapeHtml(labels.card.suggestedAction)}:</strong></div>
      <div class="wb-section-body">${escapeHtml(item.suggestedAction || "-")}</div>
    </div>
    ${threadLink}
    ${draftHtml}
    ${bodyHtml}
  </div>`;
}

function renderSpotlightList(label: string, values: string[]): string {
  if (!values.length) {
    return "";
  }
  return `<h4>${escapeHtml(label)}</h4><ul class="wb-ul">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function renderSpotlightActionItems(analysis: ThreadAnalysisResult["items"][number], labels: DashboardLabels): string {
  if (!analysis.actionItems.length) {
    return "";
  }
  return `<h4>${escapeHtml(labels.threads.actionItems)}</h4><ul class="wb-ul">${analysis.actionItems.map((item) => {
    const task = [item.owner, item.task, item.deadline].filter(Boolean).join(": ") || "-";
    return `<li>${escapeHtml(task)}</li>`;
  }).join("")}</ul>`;
}

function renderSpotlightRisks(analysis: ThreadAnalysisResult["items"][number], labels: DashboardLabels): string {
  if (!analysis.risks.length) {
    return "";
  }
  return `<h4>${escapeHtml(labels.threads.risks)}</h4><ul class="wb-ul">${analysis.risks.map((risk) => `<li><span class="wb-risk-level">${escapeHtml(risk.level)}</span> ${escapeHtml(risk.description)}</li>`).join("")}</ul>`;
}

function renderThreadSpotlight(analysis: ThreadAnalysisResult["items"][number] | undefined, labels: DashboardLabels): string {
  if (!analysis) {
    return "";
  }
  const status = analysis.currentStatus || analysis.oneLineSummary;
  return `
    <section class="wb-thread-analysis">
      <h4>${escapeHtml(labels.threads.spotlight)}</h4>
      ${analysis.partialContext ? `<div class="wb-warn wb-section-body">${escapeHtml(labels.threads.partialContext)}</div>` : ""}
      ${status ? `<div class="wb-field"><strong>${escapeHtml(labels.threads.currentStatus)}:</strong></div><div class="wb-section-body">${escapeHtml(status)}</div>` : ""}
      ${renderSpotlightList(labels.threads.keyDecisions, analysis.keyDecisions)}
      ${renderSpotlightList(labels.threads.openQuestions, analysis.openQuestions)}
      ${renderSpotlightActionItems(analysis, labels)}
      ${renderSpotlightList(labels.threads.waitingOn, analysis.waitingOn)}
      ${renderSpotlightRisks(analysis, labels)}
      <div class="wb-field"><strong>${escapeHtml(labels.threads.needMyReply)}:</strong> ${escapeHtml(analysis.needMyReply ? labels.threads.yes : labels.threads.no)}</div>
      ${analysis.suggestedAction ? `<div class="wb-field"><strong>${escapeHtml(labels.threads.suggestedAction)}:</strong></div><div class="wb-section-body">${escapeHtml(analysis.suggestedAction)}</div>` : ""}
      ${renderEditableDraftBox(analysis.draftReply || "", labels, { itemId: `thread:${analysis.threadId}`, sourceId: analysis.threadId, generateAction: "analyzeThread" })}
    </section>`;
}

function renderThreadDetail(
  thread: ThreadStore["items"][number],
  labels: DashboardLabels,
  analysis: ThreadAnalysisResult["items"][number] | undefined,
  busyKind: string,
  ignoredIds?: Set<string>
): string {
  const timelineItems = [...(thread.timeline || [])].sort(compareTimelineMessagesForDisplay);
  const timeline = timelineItems.map((msg) =>
    `<div class="wb-tl-item">
      <div class="wb-tl-head">
        <strong>${escapeHtml(msg.from || msg.senderEmail || "")}</strong>
        <span class="wb-tl-time">${escapeHtml(msg.receivedTime || msg.sentTime || "")}</span>
      </div>
      <div class="wb-tl-body-wrap">${msg.mailId ? `<button class="wb-tl-open" data-action="openInOutlook" data-mail-id="${escapeAttr(msg.mailId)}" title="${escapeAttr(labels.card.openInOutlook)}">↗</button>` : ""}<div class="wb-tl-body">${escapeHtml(msg.bodyDelta || msg.bodyPreview || "")}</div></div>
    </div>`
  ).join("");

  return `<div class="wb-detail-card">
    <h3>${escapeHtml(thread.subject || thread.threadId)}</h3>
    <div class="wb-meta-grid">
      <div class="wb-field"><strong>${escapeHtml(labels.threads.participants)}:</strong> ${escapeHtml(thread.participants.join(", ") || "-")}</div>
      <div class="wb-field"><strong>${escapeHtml(labels.threads.lastTime)}:</strong> ${escapeHtml(thread.lastTime || "-")}</div>
      <div class="wb-field"><strong>${escapeHtml(labels.threads.security)}:</strong> ${escapeHtml(formatThreadSecurity(thread.security))}</div>
    </div>
    <div class="wb-actions">
      <button class="wb-btn${busyKind === "analyzeThread" ? " is-busy" : ""}" data-action="analyzeThread" data-thread-id="${escapeAttr(thread.threadId)}"${busyKind ? " disabled" : ""}>${escapeHtml(labels.threads.analyzeThread)}${renderButtonSpinner(busyKind === "analyzeThread")}</button>
      ${ignoredIds && thread.sourceMailIds.length > 0 && thread.sourceMailIds.every((id) => ignoredIds.has(id))
        ? `<button class="wb-btn ghost" data-action="unignoreThread" data-thread-id="${escapeAttr(thread.threadId)}">${escapeHtml(labels.card.restore)}</button>`
        : `<button class="wb-btn ghost" data-action="ignoreThread" data-thread-id="${escapeAttr(thread.threadId)}">${escapeHtml(labels.card.ignore)}</button>`}
    </div>
    ${renderThreadSpotlight(analysis, labels)}
    ${timelineItems.length ? `<div class="wb-timeline-section"><h4>${escapeHtml(labels.threads.timeline)} (${timelineItems.length})</h4>${timeline}</div>` : ""}
  </div>`;
}

function meetingStatusLabel(status: string, labels: DashboardLabels): string {
  const map: Record<string, string> = {
    notResponded: labels.meetings.notResponded,
    accepted: labels.meetings.accepted,
    tentative: labels.meetings.tentative,
    declined: labels.meetings.declined,
    organizer: labels.meetings.organizer_status
  };
  return map[status] || map["notResponded"]!;
}

function renderMeetingDetail(item: StoredMeeting, labels: DashboardLabels): string {
  const timeRange = `${item.start || "-"} — ${item.end || "-"}`;
  const flags: string[] = [];
  if (item.isAllDay) flags.push(labels.meetings.allDay);
  if (item.isRecurring) flags.push(labels.meetings.recurring);
  return `<div class="wb-detail-card">
    <div class="wb-detail-header">
      <h3>${escapeHtml(item.subject || "-")}</h3>
      <span class="wb-priority wb-mtg-${escapeAttr(item.responseStatus)}">${escapeHtml(meetingStatusLabel(item.responseStatus, labels))}</span>
    </div>
    <div class="wb-meta-grid">
      <div class="wb-field"><strong>${escapeHtml(labels.meetings.organizer)}:</strong> ${escapeHtml(item.organizer || "-")}</div>
      <div class="wb-field"><strong>${escapeHtml(labels.meetings.time)}:</strong> ${escapeHtml(timeRange)}</div>
      ${item.location ? `<div class="wb-field"><strong>${escapeHtml(labels.meetings.location)}:</strong> ${escapeHtml(item.location)}</div>` : ""}
      ${item.requiredAttendees ? `<div class="wb-field"><strong>${escapeHtml(labels.meetings.attendees)}:</strong> ${escapeHtml(item.requiredAttendees)}</div>` : ""}
      ${flags.length ? `<div class="wb-field">${escapeHtml(flags.join(", "))}</div>` : ""}
    </div>
    ${item.bodyExcerpt ? `<div class="wb-body">${escapeHtml(item.bodyExcerpt)}</div>` : ""}
    <div class="wb-actions">
      <button class="wb-btn" data-action="openMeetingInOutlook" data-meeting-id="${escapeAttr(item.entryId)}">${escapeHtml(labels.meetings.openInOutlook)}</button>
    </div>
  </div>`;
}

export function renderWorkbenchHtml(input: DashboardRenderInput): string {
  const { state, busyKind } = input;
  const config = state.config as Record<string, unknown>;
  const locale = getLocaleFromConfig(config);
  const labels = getLabels(locale);
  const threadStore = input.threadStore || emptyThreadStore();
  const visibleThreadStore = filterVisibleThreadsForDashboard(threadStore);
  const threadAnalysis = input.threadAnalysis || { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] };
  const threadByMailId = buildThreadLookup(visibleThreadStore);
  const queue = input.queue || { pending: [], blocked: [], analysed: [], allowed: [], ignoredPending: [] };
  const classifications = input.classifications || normalizeClassificationCache({});
  const securityDecisions = input.securityDecisions || new Map<string, SecurityGateDecisionResult>();
  const analysisByThreadId = new Map((threadAnalysis.items || []).map((item) => [item.threadId, item]));

  const meetingStore = input.meetingStore || emptyMeetingStore();
  const sortedMeetings = [...meetingStore.items].sort((a, b) => {
    if (a.responseStatus === "notResponded" && b.responseStatus !== "notResponded") return -1;
    if (a.responseStatus !== "notResponded" && b.responseStatus === "notResponded") return 1;
    return (a.start || "").localeCompare(b.start || "");
  });

  const detailData: string[] = [];

  for (const item of queue.pending) {
    const classification = classificationFor(item.mailId, classifications);
    const extra = `<div class="wb-field"><strong>${escapeHtml(labels.pending.classification)}:</strong> ${escapeHtml(formatClassification(classification))}</div>`;
    detailData.push(`<div class="wb-reader" data-id="${escapeAttr(item.mailId)}">${renderMailDetail(item, "pending", labels, extra, "", classifications)}</div>`);
  }

  for (const item of queue.blocked) {
    const classification = classificationFor(item.mailId, classifications);
    const gateDecision = securityDecisions.get(item.mailId);
    const gateTitle = gateDecision?.decision === "manual_confirm" ? labels.pending.blockedTitle : labels.pending.gateBlocked;
    const extra = `<div class="wb-field"><strong>${escapeHtml(labels.pending.classification)}:</strong> ${escapeHtml(formatClassification(classification))}</div>
      <div class="wb-field wb-warn"><strong>${escapeHtml(gateTitle)}:</strong> ${escapeHtml(gateDecision?.reasons.join("; ") || "-")}</div>`;
    detailData.push(`<div class="wb-reader" data-id="${escapeAttr(item.mailId)}">${renderMailDetail(item, "blocked", labels, extra, confirmAnalyzeButton(item.mailId, gateDecision, labels), classifications)}</div>`);
  }

  const mailById = new Map((input.store?.items || []).map((m) => [m.mailId, m]));

  for (const cat of state.categories) {
    for (const item of cat.items) {
      const threadId = threadByMailId.get(item.mailId) || "";
      const originalMail = mailById.get(item.mailId);
      detailData.push(`<div class="wb-reader" data-id="${escapeAttr(item.mailId)}">${renderAnalysisDetail(item, cat.id, labels, threadId, classifications, originalMail)}</div>`);
    }
  }

  for (const item of (queue.ignoredPending || [])) {
    detailData.push(`<div class="wb-reader" data-id="${escapeAttr(item.mailId)}">${renderMailDetail(item, "ignored", labels, "", "", classifications)}</div>`);
  }

  for (const mtg of sortedMeetings) {
    detailData.push(`<div class="wb-reader" data-id="${escapeAttr(mtg.entryId)}">${renderMeetingDetail(mtg, labels)}</div>`);
  }

  const sortedThreads = [...(visibleThreadStore.items || [])].sort((a, b) => String(b.lastTime || "").localeCompare(String(a.lastTime || "")));
  for (const thread of sortedThreads) {
    detailData.push(`<div class="wb-reader" data-id="${escapeAttr(thread.threadId)}">${renderThreadDetail(thread, labels, analysisByThreadId.get(thread.threadId), busyKind, input.ignoredIds)}</div>`);
  }

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
  }
  button { font-family: inherit; font-size: inherit; cursor: pointer; border: none; }
  a { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; }

  /* ── Full-width reading pane ── */
  .wb-pane { height: 100%; overflow-y: auto; }
  .wb-reader { display: none; }
  .wb-reader.active { display: block; }
  .wb-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.3; font-size: 14px; }

  /* Detail card styles */
  .wb-detail-card { padding: 24px 28px; }
  .wb-detail-card h3 { font-size: 17px; line-height: 1.4; margin-bottom: 4px; font-weight: 600; }
  .wb-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .wb-detail-header h3 { flex: 1; }
  .wb-priority { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); white-space: nowrap; flex-shrink: 0; margin-top: 4px; }
  .wb-meta-grid { display: grid; grid-template-columns: 1fr; gap: 4px; padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12)); margin-bottom: 12px; }
  .wb-field { font-size: 12px; line-height: 1.6; }
  .wb-warn { color: var(--vscode-errorForeground, #f48771); }
  .wb-section { margin-bottom: 12px; }
  .wb-section-body { font-size: 13px; line-height: 1.6; padding: 4px 0; opacity: 0.9; }
  .wb-body { font-size: 12px; line-height: 1.7; white-space: pre-wrap; padding: 12px 14px; margin: 8px 0; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08)); border-radius: 4px; border-left: 3px solid var(--vscode-focusBorder, #007fd4); max-height: 400px; overflow-y: auto; }
  .wb-actions { display: flex; gap: 8px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12)); flex-wrap: wrap; }
  .wb-btn { padding: 5px 14px; border-radius: 4px; font-size: 12px; font-weight: 500; background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); display: inline-flex; align-items: center; gap: 6px; transition: background 0.15s, transform 0.1s; }
  .wb-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, #1177bb); }
  .wb-btn:active:not(:disabled) { transform: scale(0.97); }
  .wb-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .wb-btn.ghost { background: transparent; color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15)); }
  .wb-btn.ghost:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  .wb-btn.is-busy { gap: 6px; }

  /* Thread analysis */
  .wb-thread-analysis { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12)); }
  .wb-thread-analysis h4 { font-size: 12px; font-weight: 600; margin: 12px 0 4px 0; opacity: 0.8; }
  .wb-thread-analysis h4:first-child { margin-top: 0; }
  .wb-ul { margin: 4px 0 4px 20px; font-size: 13px; }
  .wb-ul li { padding: 2px 0; line-height: 1.5; }
  .wb-risk-level { font-size: 10px; padding: 1px 5px; border-radius: 6px; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); text-transform: uppercase; margin-right: 4px; }

  /* Timeline */
  .wb-timeline-section { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12)); }
  .wb-timeline-section > h4 { font-size: 13px; font-weight: 600; margin-bottom: 12px; opacity: 0.7; }
  .wb-tl-item { padding: 10px 0 10px 14px; border-left: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.25)); margin-bottom: 2px; }
  .wb-tl-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .wb-tl-head strong { font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wb-tl-time { font-size: 11px; opacity: 0.5; flex-shrink: 0; }
  .wb-tl-body-wrap { position: relative; margin-top: 4px; }
  .wb-tl-open { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; padding: 0; border-radius: 4px; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); font-size: 14px; line-height: 24px; text-align: center; opacity: 0; transition: opacity 0.15s; z-index: 1; }
  .wb-tl-body-wrap:hover .wb-tl-open { opacity: 0.7; }
  .wb-tl-open:hover { opacity: 1 !important; background: var(--vscode-button-hoverBackground, #1177bb); }
  .wb-tl-body { font-size: 12px; line-height: 1.6; white-space: pre-wrap; padding: 8px 36px 8px 12px; border-radius: 4px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08)); color: var(--vscode-editor-foreground, #ccc); }

  /* Draft box */
  .draft-box { position: relative; margin-top: 8px; }
  .draft-box pre { margin: 0; padding: 10px 40px 10px 14px; font-size: 12px; white-space: pre-wrap; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08)); border-radius: 4px; line-height: 1.6; }
  .draft-box-editable { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .draft-editor-wrap { position: relative; width: 100%; }
  .draft-textarea {
    width: 100%;
    min-height: 180px;
    max-height: 42vh;
    resize: vertical;
    padding: 10px 38px 10px 12px;
    border-radius: 4px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,0.35)));
    background: var(--vscode-input-background, var(--vscode-editor-background, #1e1e1e));
    color: var(--vscode-input-foreground, var(--vscode-editor-foreground, #cccccc));
    font: inherit;
    line-height: 1.55;
  }
  .draft-textarea:focus, .draft-instruction:focus { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
  .draft-instruction {
    width: 100%;
    min-height: 34px;
    padding: 7px 9px;
    border-radius: 4px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,0.35)));
    background: var(--vscode-input-background, var(--vscode-editor-background, #1e1e1e));
    color: var(--vscode-input-foreground, var(--vscode-editor-foreground, #cccccc));
    font: inherit;
  }
  .draft-copy-button { position: absolute; top: 7px; right: 7px; width: 26px; height: 26px; padding: 0; border-radius: 4px; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); border: none; }
  .draft-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; }
  .draft-outlook-actions { position: relative; }
  .draft-outlook-actions > summary { list-style: none; cursor: pointer; }
  .draft-outlook-actions > summary::-webkit-details-marker { display: none; }
  .draft-outlook-menu { position: absolute; z-index: 10; display: flex; flex-direction: column; gap: 4px; min-width: 150px; margin-top: 6px; padding: 6px; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25)); border-radius: 4px; background: var(--vscode-dropdown-background, var(--vscode-editor-background, #1e1e1e)); box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
  .draft-outlook-actions:not([open]) .draft-outlook-menu { display: none; }
  .copy-icon-button { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; padding: 0; border-radius: 4px; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); border: none; }
  .copy-icon { position: relative; display: inline-block; width: 12px; height: 14px; border: 1.5px solid currentColor; border-radius: 1px; box-sizing: border-box; }
  .copy-icon::before { content: ""; position: absolute; width: 12px; height: 14px; left: -5px; top: 3px; border: 1.5px solid currentColor; border-radius: 1px; background: var(--vscode-button-secondaryBackground, #3a3d41); box-sizing: border-box; }

  /* Meeting status */
  .wb-mtg-notResponded { background: var(--vscode-editorWarning-foreground, #cca700); color: #000; }
  .wb-mtg-accepted, .wb-mtg-organizer { background: var(--vscode-charts-green, #4ec9b0); color: #000; }
  .wb-mtg-tentative { background: var(--vscode-badge-background, #4d4d4d); }
  .wb-mtg-declined { opacity: 0.5; }
</style>
</head>
<body>
  <div class="wb-pane" id="reader">
    ${detailData.join("")}
    <div class="wb-placeholder" id="placeholder">${escapeHtml(locale === "zh-CN" ? "从侧栏选择邮件以阅读详情" : "Select an item from sidebar to read")}</div>
  </div>

<script>
var vscode = acquireVsCodeApi();
var prev = vscode.getState() || {};
var currentId = prev.currentId || '';

if (currentId) showReader(currentId);

function post(type, extra) { vscode.postMessage(Object.assign({ type: type }, extra || {})); }

function showReader(id) {
  hideReaders();
  for (var r of document.querySelectorAll('.wb-reader')) {
    if (r.getAttribute('data-id') === id) { r.classList.add('active'); document.getElementById('placeholder').hidden = true; document.getElementById('reader').scrollTop = 0; return; }
  }
}

function hideReaders() {
  for (var r of document.querySelectorAll('.wb-reader')) r.classList.remove('active');
  document.getElementById('placeholder').hidden = false;
}

window.addEventListener('message', function(e) {
  var msg = e.data;
  if (msg && msg.type === 'focusItem' && msg.id) {
    currentId = msg.id;
    showReader(currentId);
    vscode.setState({ currentId: currentId });
  }
  if (msg && msg.type === 'updateDraft' && msg.itemId) {
    var box = document.querySelector('.draft-box-editable[data-item-id="' + msg.itemId + '"]');
    if (box) { var ta = box.querySelector('.draft-textarea'); if (ta) ta.value = msg.text || ''; }
  }
});

document.addEventListener('click', function(e) {
  var t = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
  if (!t) return;
  var a = t.getAttribute('data-action');
  if (a === 'copyDraft') { var ta = t.closest('.draft-box-editable'); var v = ta ? ta.querySelector('.draft-textarea') : null; post('copyDraft', { draftReply: v ? v.value : (t.getAttribute('data-draft-reply') || '') }); }
  if (a === 'polishDraft' || a === 'refineDraft') { var box = t.closest('.draft-box-editable'); var txt = box ? box.querySelector('.draft-textarea') : null; var ins = box ? box.querySelector('.draft-instruction') : null; var itemId = box ? box.getAttribute('data-item-id') || '' : ''; post(a, { draftText: txt ? txt.value : '', instruction: ins ? ins.value : '', itemId: itemId }); }
  if (a === 'composeMail') { var box2 = t.closest('.draft-box-editable'); var txt2 = box2 ? box2.querySelector('.draft-textarea') : null; var sourceId2 = box2 ? box2.getAttribute('data-source-id') || '' : ''; post('composeMail', { mode: t.getAttribute('data-mode') || '', draftText: txt2 ? txt2.value : '', itemId: sourceId2 }); }
  if (a === 'generateDraft') { var box3 = t.closest('.draft-box-editable'); var sourceId = box3 ? box3.getAttribute('data-source-id') || '' : ''; var itemId3 = box3 ? box3.getAttribute('data-item-id') || '' : ''; post('generateDraft', { itemId: itemId3, sourceId: sourceId }); }
  if (a === 'ignore') post('ignore', { mailId: t.getAttribute('data-mail-id') || '' });
  if (a === 'unignore') post('unignore', { mailId: t.getAttribute('data-mail-id') || '' });
  if (a === 'openInOutlook') post('openInOutlook', { mailId: t.getAttribute('data-mail-id') || '' });
  if (a === 'analyzeSelected') post('analyzeSelected', { mailIds: [t.getAttribute('data-mail-id') || ''] });
  if (a === 'analyzeThread') post('analyzeThread', { threadId: t.getAttribute('data-thread-id') || '' });
  if (a === 'ignoreThread') post('ignoreThread', { threadId: t.getAttribute('data-thread-id') || '' });
  if (a === 'unignoreThread') post('unignoreThread', { threadId: t.getAttribute('data-thread-id') || '' });
  if (a === 'openMeetingInOutlook') post('openMeetingInOutlook', { meetingId: t.getAttribute('data-meeting-id') || '' });
});
</script>
</body>
</html>`;
}
