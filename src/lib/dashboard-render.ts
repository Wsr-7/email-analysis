import type { AnalysisResult } from "./analysis-schema";
import type { ClassificationCache } from "./classification";
import { classificationFor } from "./classification";
import { getLocaleFromConfig, mergeStringLists, parseFolders, positiveNumber } from "./config-utils";
import { getLabels, buildCategoryLabels, type DashboardLabels, LABELS } from "./dashboard-labels";
import { filterVisibleThreadsForDashboard, buildThreadLookup, compareTimelineMessagesForDisplay, type DashboardState } from "./dashboard-state";
import { escapeHtml, escapeAttr, domIdForMail, domIdForThread, domIdForThreadMessage, domIdForCategory, selected } from "./html-utils";
import { formatModelLabel, isSelectedModel, modelKey, selectConfiguredModel, type AvailableModel } from "./llm-provider";
import { emptyMailIndex, emptyMailStore, folderOldestReceivedTimes, type MailIndex, type MailStore, type StoredMail } from "./mail-store";
import { normalizePromptConfig, type PromptConfig } from "./prompt-config";
import { normalizeClassificationCache } from "./classification";
import type { SecurityGateDecisionResult } from "./security-types";
import { emptyThreadStore, type ThreadStore } from "./thread-store";
import type { ThreadAnalysisResult } from "./thread-analysis-schema";
import type { MeetingStore } from "./meeting-store";

type SecurityDecisionMap = Map<string, SecurityGateDecisionResult>;

export function renderStat(label: string, value: number | undefined, targetId: string): string {
  return `<button class="stat" data-action="jumpPanel" data-target-id="${escapeAttr(targetId)}"><span>${escapeHtml(label)}</span><span class="value">${escapeHtml(String(value || 0))}</span></button>`;
}

export function renderButtonSpinner(active: boolean): string {
  return active ? `<span class="button-spinner" aria-hidden="true"></span>` : "";
}

export function renderCategory(
  category: string,
  items: AnalysisResult["items"],
  labels: DashboardLabels,
  categoryLabels: Record<string, string>,
  threadByMailId: Map<string, string>
): string {
  const cards = items.length ? items.map((item) => renderCard(item, labels, threadByMailId, category === "ignored")).join("") : `<div class="empty">${escapeHtml(labels.card.noItems)}</div>`;
  return `<details class="category" id="${escapeAttr(domIdForCategory(category))}"><summary>${escapeHtml(categoryLabels[category] || labels.categories[category] || category)} (${items.length})</summary><div class="category-body">${cards}</div></details>`;
}

export function renderPendingPanel(
  panelId: string,
  title: string,
  items: StoredMail[],
  classifications: ClassificationCache,
  labels: DashboardLabels,
  allowedItems: StoredMail[],
  blocked: boolean,
  threadByMailId: Map<string, string>,
  securityDecisions: SecurityDecisionMap
): string {
  const allowed = new Set(allowedItems.map((item) => item.mailId));
  const cards = items.length ? items.map((item) => {
    const classification = classificationFor(item.mailId, classifications);
    const gateDecision = securityDecisions.get(item.mailId);
    const status = formatGateStatus(gateDecision, blocked || !allowed.has(item.mailId), labels);
    const showStatus = blocked || !allowed.has(item.mailId) || gateDecision?.decision === "manual_confirm" || gateDecision?.decision === "block";
    const statusBadge = showStatus ? `<div class="badge">${escapeHtml(status)}</div>` : "";
    const reason = gateDecision?.reasons.length
      ? `<div><strong>${escapeHtml(labels.pending.securityReason)}:</strong> ${escapeHtml(gateDecision.reasons.join("; "))}</div>`
      : "";
    const threadId = threadByMailId.get(item.mailId) || "";
    const threadHtml = threadId
      ? `<div><strong>${escapeHtml(labels.card.thread)}:</strong> <a href="#${escapeAttr(domIdForThread(threadId))}">${escapeHtml(threadId)}</a></div>`
      : "";
    return `<article class="card pending-card" id="${escapeAttr(domIdForMail(item.mailId))}">
      <div class="header">
        <label class="select-row"><input type="checkbox" data-mail-id="${escapeAttr(item.mailId)}" /> ${escapeHtml(labels.pending.select)}</label>
        ${statusBadge}
      </div>
      <div class="title">${escapeHtml(item.subject || item.mailId)}</div>
      <div><strong>${escapeHtml(labels.card.from)}:</strong> ${escapeHtml(item.from || "-")}</div>
      <div><strong>${escapeHtml(labels.card.received)}:</strong> ${escapeHtml(item.receivedTime || "-")}</div>
      <div><strong>${escapeHtml(labels.pending.classification)}:</strong> ${escapeHtml(formatClassification(classification))}</div>
      ${reason}
      ${threadHtml}
    </article>`;
  }).join("") : `<div class="empty">${escapeHtml(labels.card.noItems)}</div>`;
  return `<details class="category" id="${escapeAttr(panelId)}"><summary>${escapeHtml(title)} (${items.length})</summary><div class="category-body">${cards}</div></details>`;
}

export function renderThreadsPanel(threadStore: ThreadStore, labels: DashboardLabels, threadAnalysis: ThreadAnalysisResult, busyKind: string): string {
  const threads = [...(threadStore.items || [])].sort((a, b) => String(b.lastTime || "").localeCompare(String(a.lastTime || "")));
  const analysisByThreadId = new Map((threadAnalysis.items || []).map((item) => [item.threadId, item]));
  const cards = threads.length
    ? threads.map((thread) => renderThreadCard(thread, labels, analysisByThreadId.get(thread.threadId), busyKind)).join("")
    : `<div class="empty">${escapeHtml(labels.card.noItems)}</div>`;
  return `<details class="category" id="threads-panel"><summary>${escapeHtml(labels.threads.title)} (${threads.length})</summary><div class="category-body">${cards}</div></details>`;
}

export function renderThreadCard(thread: ThreadStore["items"][number], labels: DashboardLabels, analysis: ThreadAnalysisResult["items"][number] | undefined, busyKind: string): string {
  const timelineItems = [...(thread.timeline || [])].sort(compareTimelineMessagesForDisplay);
  const timeline = timelineItems.length
    ? timelineItems.map((message) => {
      const attachments = message.attachmentNames.length
        ? `${message.attachmentCount}: ${message.attachmentNames.join(", ")}`
        : String(message.attachmentCount || 0);
      return `<div class="timeline-item" id="${escapeAttr(domIdForThreadMessage(thread.threadId, message.mailId))}">
        <div><strong>${escapeHtml(message.subject || message.mailId)}</strong></div>
        <div class="muted">${escapeHtml(message.receivedTime || message.sentTime || "-")} · ${escapeHtml(message.from || message.senderEmail || "-")}</div>
        <div class="muted">${escapeHtml(labels.threads.attachments)}: ${escapeHtml(attachments)}</div>
        <div class="muted">${escapeHtml(labels.threads.mailIds)}: <a href="#${escapeAttr(domIdForMail(message.mailId))}">${escapeHtml(message.mailId)}</a></div>
        <pre>${escapeHtml(message.bodyDelta || message.bodyPreview || "")}</pre>
      </div>`;
    }).join("")
    : `<div class="empty">${escapeHtml(labels.card.noItems)}</div>`;
  return `<article class="card" id="${escapeAttr(domIdForThread(thread.threadId))}">
    <div class="header">
      <div class="title">${escapeHtml(thread.subject || thread.threadId)}</div>
      <div class="badge">${escapeHtml(`${labels.threads.messages}: ${String(thread.messageCount)}`)}</div>
    </div>
    <div><strong>${escapeHtml(labels.threads.participants)}:</strong> ${escapeHtml(thread.participants.join(", ") || "-")}</div>
    <div><strong>${escapeHtml(labels.threads.lastTime)}:</strong> ${escapeHtml(thread.lastTime || "-")}</div>
    <div><strong>${escapeHtml(labels.threads.folders)}:</strong> ${escapeHtml(thread.folders.join(", ") || "-")}</div>
    <div><strong>${escapeHtml(labels.threads.contentStatus)}:</strong> ${escapeHtml(thread.contentStatus || "-")}</div>
    <div><strong>${escapeHtml(labels.threads.security)}:</strong> ${escapeHtml(formatThreadSecurity(thread.security))}</div>
    <div class="actions"><button class="secondary ${busyKind === "analyzeThread" ? "is-busy" : ""}" data-action="analyzeThread" data-thread-id="${escapeAttr(thread.threadId)}"${busyKind ? " disabled" : ""}>${escapeHtml(labels.threads.analyzeThread)}${renderButtonSpinner(busyKind === "analyzeThread")}</button></div>
    <details>
      <summary>${escapeHtml(labels.threads.timeline)} (${timelineItems.length})</summary>
      <div class="timeline">${timeline}</div>
    </details>
    ${renderThreadAnalysisSummary(analysis, labels)}
  </article>`;
}

export function renderThreadAnalysisSummary(analysis: ThreadAnalysisResult["items"][number] | undefined, labels: DashboardLabels): string {
  if (!analysis) {
    return "";
  }
  // ponytail: dashboard truncates to 2 items per list; workbench has full detail
  const maxItems = 2;
  const truncatedActions = analysis.actionItems.slice(0, maxItems);
  const actionOverflow = analysis.actionItems.length > maxItems ? ` <span class="muted">(+${analysis.actionItems.length - maxItems})</span>` : "";
  const actionItems = truncatedActions.length
    ? `<ul>${truncatedActions.map((item) => `<li>${escapeHtml([item.owner, item.task, item.deadline].filter(Boolean).join(": ") || "-")}</li>`).join("")}</ul>${actionOverflow}`
    : "";
  const truncatedRisks = analysis.risks.slice(0, maxItems);
  const riskOverflow = analysis.risks.length > maxItems ? ` <span class="muted">(+${analysis.risks.length - maxItems})</span>` : "";
  const risks = truncatedRisks.length
    ? `<ul>${truncatedRisks.map((risk) => `<li>${escapeHtml(`${risk.level}: ${risk.description}`)}</li>`).join("")}</ul>${riskOverflow}`
    : "";
  const truncatedQuestions = (analysis.openQuestions || []).slice(0, maxItems);
  const questionOverflow = (analysis.openQuestions || []).length > maxItems ? ` <span class="muted">(+${(analysis.openQuestions || []).length - maxItems})</span>` : "";
  const questions = truncatedQuestions.length
    ? `<ul>${truncatedQuestions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>${questionOverflow}`
    : "";
  const draft = analysis.draftReply ? renderDraftBox(analysis.draftReply) : "";
  const needReply = analysis.needMyReply
    ? `<div><strong>${escapeHtml(labels.threads.needMyReply)}:</strong> ${escapeHtml(labels.threads.yes)}</div>`
    : "";
  return `<details open>
    <summary>${escapeHtml(labels.threads.analysis)} (${escapeHtml(analysis.priority)} / ${escapeHtml(analysis.category)})</summary>
    <div class="timeline">
      <div><strong>${escapeHtml(labels.threads.currentStatus)}:</strong> ${escapeHtml(analysis.currentStatus || analysis.oneLineSummary || "-")}</div>
      ${needReply}
      ${actionItems ? `<div><strong>${escapeHtml(labels.threads.actionItems)}:</strong>${actionItems}</div>` : ""}
      ${questions ? `<div><strong>${escapeHtml(labels.threads.openQuestions)}:</strong>${questions}</div>` : ""}
      ${risks ? `<div><strong>${escapeHtml(labels.threads.risks)}:</strong>${risks}</div>` : ""}
      ${draft ? `<div><strong>${escapeHtml(labels.threads.draftReply)}:</strong>${draft}</div>` : ""}
    </div>
  </details>`;
}

export function renderModelOptions(
  models: AvailableModel[],
  selectedValue: string,
  labels: DashboardLabels
): string {
  if (!models.length) {
    return `<option value="">${escapeHtml(labels.settings.modelsNotLoaded)}</option>`;
  }
  const uniqueModels = [...new Map(models.map((model) => [modelKey(model), model])).values()];
  const options = uniqueModels.map((model) => {
    const value = model.id || model.family;
    return `<option value="${escapeAttr(value)}" ${isSelectedModel(model, selectedValue) ? "selected" : ""}>${escapeHtml(formatModelLabel(model))}</option>`;
  });
  if (!selectedValue || !uniqueModels.some((model) => isSelectedModel(model, selectedValue))) {
    options.unshift(`<option value="" selected>${escapeHtml(labels.settings.noModel)}</option>`);
  }
  return options.join("");
}

export function formatAnalyzeNextLabel(labels: DashboardLabels, config: Record<string, unknown>): string {
  const batchSize = positiveNumber(config.analysisBatchSize, 5);
  return `${labels.toolbar.analyze} (${String(batchSize)})`;
}

export function renderRangeValueControl(config: Record<string, unknown>, labels: DashboardLabels): string {
  const rangeMode = config.rangeMode === "maxItems" ? "maxItems" : "recentHours";
  const label = rangeMode === "maxItems" ? labels.settings.maxItems : labels.settings.recentHours;
  const value = rangeMode === "maxItems" ? String(config.maxItems || 50) : String(config.recentHours || 24);
  return `<label>${escapeHtml(label)}
        <input id="rangeValue" type="number" min="1" value="${escapeAttr(value)}" />
      </label>`;
}

export function formatRangeMeta(metadata: { rangeMode?: unknown; recentHours?: unknown; maxItems?: unknown }, labels: DashboardLabels): string {
  const mode = String(metadata.rangeMode || "");
  if (mode.toLowerCase() === "maxitems") {
    return `${labels.settings.maxItemsOption} / ${String(metadata.maxItems || "-")}`;
  }
  if (mode.toLowerCase() === "recenthours") {
    return `${labels.settings.recentHoursOption} / ${String(metadata.recentHours || "-")}h`;
  }
  return "-";
}

export function formatSelectedModel(selectedValue: unknown, models: AvailableModel[]): string {
  const sel = String(selectedValue || "");
  const model = selectConfiguredModel(models, sel) as AvailableModel | undefined;
  return model ? formatModelLabel(model) : sel || "-";
}

export function renderClassificationOptions(selectedLevel: number, labels: DashboardLabels): string {
  const options = [
    [0, labels.settings.classificationPublic],
    [1, labels.settings.classificationInternal],
    [2, labels.settings.classificationRegistered],
    [3, labels.settings.classificationHighRegistered]
  ] as const;
  return options.map(([level, label]) => {
    return `<option value="${level}" ${selected(selectedLevel, level)}>${escapeHtml(label)}</option>`;
  }).join("");
}

export function renderDraftBox(draftReply: string): string {
  const draft = String(draftReply || "");
  if (!draft.trim()) {
    return "";
  }
  return `<div class="draft-box"><pre>${escapeHtml(draft)}</pre><button class="copy-icon-button" data-action="copyDraft" data-draft-reply="${escapeAttr(draft)}" title="Copy draft" aria-label="Copy draft"><span class="copy-icon" aria-hidden="true"></span></button></div>`;
}

export function renderEditableDraftBox(
  draftReply: string,
  labels: DashboardLabels,
  options: { itemId?: string; sourceId?: string; generateAction?: "analyzeSelected" | "analyzeThread" } = {}
): string {
  const draft = String(draftReply || "");
  const itemId = String(options.itemId || "");
  const sourceId = String(options.sourceId || "");
  const hasDraft = Boolean(draft.trim());
  const actions = hasDraft
    ? `<div class="draft-actions">
      <button class="wb-btn" data-action="polishDraft">${escapeHtml(labels.card.polish)}</button>
      <button class="wb-btn" data-action="refineDraft">${escapeHtml(labels.card.refine)}</button>
      <details class="draft-outlook-actions">
        <summary class="wb-btn">${escapeHtml(labels.card.outlookActions)} <span class="outlook-chevron" aria-hidden="true">⌄</span></summary>
        <div class="draft-outlook-menu">
          <button class="wb-btn" data-action="composeMail" data-mode="reply">${escapeHtml(labels.card.openReply)}</button>
          <button class="wb-btn" data-action="composeMail" data-mode="replyAll">${escapeHtml(labels.card.openReplyAll)}</button>
          <button class="wb-btn" data-action="composeMail" data-mode="forward">${escapeHtml(labels.card.openForward)}</button>
        </div>
      </details>
    </div>`
    : `<div class="draft-actions">
      <button class="wb-btn" data-action="generateDraft">${escapeHtml(labels.card.generateDraft)}</button>
    </div>`;
  const copyButton = hasDraft
    ? `<button class="draft-copy-button" data-action="copyDraft" title="${escapeAttr(labels.card.copyDraft)}" aria-label="${escapeAttr(labels.card.copyDraft)}"><span class="copy-icon" aria-hidden="true"></span></button>`
    : "";
  return `<div class="draft-box draft-box-editable" data-item-id="${escapeAttr(itemId)}" data-source-id="${escapeAttr(sourceId)}">
    <div class="wb-field"><strong>${escapeHtml(labels.threads.draftReply)}:</strong></div>
    <div class="draft-editor-wrap">
      <textarea class="draft-textarea">${escapeHtml(draft)}</textarea>
      ${copyButton}
    </div>
    <div class="draft-hint muted">${escapeHtml(labels.card.draftHint)}</div>
    <input class="draft-instruction" type="text" placeholder="${escapeAttr(labels.card.instructionPlaceholder)}" />
    ${actions}
  </div>`;
}

export function renderCard(item: AnalysisResult["items"][number], labels: DashboardLabels, threadByMailId: Map<string, string>, isIgnored = false): string {
  const threadId = threadByMailId.get(item.mailId) || "";
  const threadHtml = threadId
    ? `<div><strong>${escapeHtml(labels.card.thread)}:</strong> <a href="#${escapeAttr(domIdForThread(threadId))}">${escapeHtml(threadId)}</a></div>`
    : "";
  const draftReply = String(item.draftReply || "");
  const draftHtml = draftReply.trim() ? renderDraftBox(draftReply) : "";
  const ignoreButton = isIgnored
    ? ""
    : `<button class="secondary" data-action="ignore" data-mail-id="${escapeAttr(item.mailId)}">${escapeHtml(labels.card.ignore)}</button>`;
  const openButton = `<button class="secondary" data-action="openInOutlook" data-mail-id="${escapeAttr(item.mailId)}">${escapeHtml(labels.card.openInOutlook)}</button>`;
  return `<article class="card" id="${escapeAttr(domIdForMail(item.mailId))}">
    <div class="header">
      <div class="title">${escapeHtml(item.subject || item.mailId)}</div>
      <div class="badge">${escapeHtml(formatPriority(item.priority, labels))}</div>
    </div>
    <div><strong>${escapeHtml(labels.card.from)}:</strong> ${escapeHtml(item.sender || "-")}</div>
    <div><strong>${escapeHtml(labels.card.received)}:</strong> ${escapeHtml(item.receivedTime || "-")}</div>
    <div><strong>${escapeHtml(labels.card.summary)}:</strong> ${escapeHtml(item.summary || "-")}</div>
    <div><strong>${escapeHtml(labels.card.reason)}:</strong> ${escapeHtml(item.reason || "-")}</div>
    <div><strong>${escapeHtml(labels.card.suggestedAction)}:</strong> ${escapeHtml(item.suggestedAction || "-")}</div>
    ${threadHtml}
    ${draftHtml}
    <div class="actions">
      ${openButton}
      ${ignoreButton}
    </div>
  </article>`;
}

export function formatClassification(classification: { label?: string; level?: number } | undefined): string {
  if (!classification) {
    return "-";
  }
  return `${classification.label} (${classification.level})`;
}

export function formatGateStatus(decision: SecurityGateDecisionResult | undefined, fallbackManual: boolean, labels: DashboardLabels): string {
  if (decision?.decision === "block") {
    return labels.pending.gateBlocked;
  }
  if (decision?.decision === "manual_confirm" || fallbackManual) {
    return labels.pending.manualRequired;
  }
  return labels.pending.autoAllowed;
}

export function formatThreadSecurity(security: ThreadStore["items"][number]["security"]): string {
  if (!security) {
    return "-";
  }
  return [
    `allow ${security.allowedMessages}`,
    `manual ${security.manualConfirmMessages}`,
    `block ${security.blockedMessages}`,
    security.partialContext ? "partial" : ""
  ].filter(Boolean).join(" / ");
}

export function formatModelInfo(modelInfo: Record<string, unknown>, labels: DashboardLabels): string {
  const actualFamily = String(modelInfo.actualFamily || "");
  const actualName = String(modelInfo.actualName || "");
  const actualVendor = String(modelInfo.actualVendor || "");
  const fallback = modelInfo.usedFallback === true ? labels.model.fallback : labels.model.preferred;
  if (!actualFamily && !actualName && !actualVendor) {
    return "-";
  }
  return [actualVendor, actualName || actualFamily, fallback].filter(Boolean).join(" / ");
}

export function formatPriority(priority: string, labels: DashboardLabels): string {
  const normalized = String(priority || "").toLowerCase();
  if (labels === LABELS["zh-CN"]) {
    if (normalized === "high") {
      return "高";
    }
    if (normalized === "medium") {
      return "中";
    }
    if (normalized === "low") {
      return "低";
    }
  }
  return priority || "-";
}

export interface DashboardRenderInput {
  state: DashboardState;
  store: MailStore;
  index: MailIndex;
  queue: { pending: StoredMail[]; blocked: StoredMail[]; analysed: StoredMail[]; allowed: StoredMail[]; ignoredPending?: StoredMail[] };
  classifications: ClassificationCache;
  securityDecisions: SecurityDecisionMap;
  promptConfig: PromptConfig;
  threadStore: ThreadStore;
  threadAnalysis: ThreadAnalysisResult;
  meetingStore?: MeetingStore;
  nextActionsStore?: import("./next-actions").NextActionsStore;
  ignoredIds?: Set<string>;
  availableModels: AvailableModel[];
  busyKind: string;
  isBusy: boolean;
  workingDrafts?: Map<string, string>;
}

/** @deprecated Old monolithic dashboard renderer — replaced by sidebar-render.ts and workbench-render.ts */
export function renderDashboardHtml(input: DashboardRenderInput): string {
  const { state, store, index, availableModels, busyKind, isBusy } = input;
  const digestMeta = state.digestMetadata || {};
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
  const categoryHtml = new Map(state.categories.map((entry) => [entry.id, renderCategory(entry.id, entry.items, labels, categoryLabels, threadByMailId)]));
  const mustHandleHtml = categoryHtml.get("mustHandleToday") || "";
  const analysedTargetId = domIdForCategory(state.categories.find((entry) => entry.id !== "ignored" && entry.items.length > 0)?.id || "mustHandleToday");
  const rows = state.categories
    .filter((entry) => entry.id !== "mustHandleToday")
    .map((entry) => categoryHtml.get(entry.id) || "")
    .join("");
  const queue = input.queue || { pending: [], blocked: [], analysed: [], allowed: [] };
  const classifications = input.classifications || normalizeClassificationCache({});
  const securityDecisions = input.securityDecisions || new Map<string, SecurityGateDecisionResult>();
  const configuredModel = String(config.modelFamily || "");
  const canAnalyze = !!selectConfiguredModel(availableModels, configuredModel);
  const busyDisabled = isBusy ? " disabled" : "";
  const analysisDisabled = canAnalyze && !isBusy ? "" : " disabled";
  const activeBusyKind = busyKind;
  const pullMailBusy = activeBusyKind === "pullMail";
  const loadMoreBusy = activeBusyKind === "loadMore";
  const sampleBusy = activeBusyKind === "sample";
  const analyzeNextBusy = activeBusyKind === "analyzeNext";
  const analyzeSelectedBusy = activeBusyKind === "analyzeSelected";
  const analyzeAllBusy = activeBusyKind === "analyzeAll";
  const reportsBusy = activeBusyKind === "reports";
  const modelOptions = renderModelOptions(availableModels, configuredModel, labels);
  const analyzeNextLabel = formatAnalyzeNextLabel(labels, config);
  const pendingHtml = renderPendingPanel("pending-panel", labels.pending.title, queue.pending, classifications, labels, queue.allowed, false, threadByMailId, securityDecisions);
  const blockedHtml = renderPendingPanel("blocked-panel", labels.pending.blockedTitle, queue.blocked, classifications, labels, [], true, threadByMailId, securityDecisions);
  const threadsHtml = renderThreadsPanel(visibleThreadStore, labels, threadAnalysis, activeBusyKind);
  const configuredFolders = Array.isArray(config.folders) ? config.folders.map(String) : ["Inbox"];
  const hasHistoryAnchors = Object.keys(folderOldestReceivedTimes(index, configuredFolders)).length > 0;
  const loadMoreDisabled = hasHistoryAnchors ? "" : " disabled";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: light; }
    body { font-family: "Segoe UI", sans-serif; margin: 0; padding: 56px 12px 12px; color: #1b2a34; background: #f3f0ea; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
    .toolbar-group { display: flex; gap: 8px; flex-wrap: wrap; padding: 4px; border-radius: 10px; background: rgba(255, 255, 255, 0.55); }
    button { border: 0; border-radius: 8px; padding: 8px 12px; background: #0f4c5c; color: #fff; cursor: pointer; }
    button:disabled { opacity: 0.48; cursor: not-allowed; }
    button.secondary { background: #d8c3a5; color: #2f2a24; }
    button.ghost { background: #e9e1d4; color: #2f2a24; }
    .language-toggle { position: fixed; top: 12px; right: 12px; z-index: 10; display: inline-flex; align-items: center; gap: 8px; min-width: 122px; background: #fffdf8; color: #132a35; border: 1px solid #d8c3a5; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10); font-weight: 700; }
    .help-toggle { position: fixed; top: 12px; right: 146px; z-index: 10; width: 34px; height: 34px; padding: 0; border-radius: 50%; background: #fffdf8; color: #132a35; border: 1px solid #d8c3a5; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10); font-weight: 800; }
    .globe-icon { position: relative; display: inline-block; width: 18px; height: 18px; border: 2px solid currentColor; border-radius: 50%; box-sizing: border-box; }
    .globe-icon::before { content: ""; position: absolute; top: -2px; bottom: -2px; left: 50%; width: 6px; transform: translateX(-50%); border-left: 1px solid currentColor; border-right: 1px solid currentColor; border-radius: 50%; }
    .globe-icon::after { content: ""; position: absolute; left: -2px; right: -2px; top: 50%; border-top: 1px solid currentColor; transform: translateY(-50%); }
    .chevron { width: 7px; height: 7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg) translateY(-2px); }
    button.is-busy { display: inline-flex; align-items: center; gap: 8px; }
    .button-spinner { width: 12px; height: 12px; border: 2px solid rgba(255, 255, 255, 0.42); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .settings { background: #fff; border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; }
    .settings summary { cursor: pointer; font-weight: 700; }
    .settings .settings-body { margin-top: 10px; }
    .help { color: #6d6d6d; font-size: 11px; line-height: 1.35; }
    .autosave-note { color: #41515a; font-size: 12px; margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #faf7f2; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #41515a; }
    .field-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .inline-action { padding: 3px 8px; border-radius: 6px; font-size: 11px; line-height: 1.2; white-space: nowrap; }
    input, select { border: 1px solid #d8c3a5; border-radius: 6px; padding: 6px 8px; background: #fffdf8; color: #1b2a34; }
    .meta { background: #fff; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; border-left: 5px solid #0f4c5c; box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05); }
    .meta-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .meta-item { min-width: 0; }
    .meta-label { display: block; color: #5c6870; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .meta-value { display: block; color: #132a35; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; margin-top: 2px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
    .stat { background: #fff; color: #132a35; padding: 10px; border-radius: 10px; text-align: left; min-height: 72px; display: flex; flex-direction: column; justify-content: center; }
    .stat:hover { outline: 2px solid #d8c3a5; }
    .stat .value { font-size: 22px; font-weight: 700; }
    details.category { margin-bottom: 12px; background: #fff; border-radius: 10px; padding: 8px 10px; }
    details.category:focus { outline: 2px solid #0f4c5c; outline-offset: 2px; }
    details.category summary { cursor: pointer; font-weight: 700; font-size: 16px; }
    details.category .category-body { margin-top: 8px; }
    .card { background: #fff; border-radius: 10px; padding: 12px; margin-bottom: 8px; }
    .header { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .title { font-weight: 700; }
    .badge { border-radius: 999px; padding: 2px 8px; font-size: 12px; background: #f5c16c; }
    .empty { color: #6d6d6d; font-style: italic; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .actions button { padding: 6px 10px; font-size: 12px; }
    .select-row { display: flex; flex-direction: row; align-items: center; gap: 6px; }
    .draft-box { position: relative; margin-top: 8px; }
    .draft-box pre { margin: 0; padding-right: 44px; }
    .copy-icon-button { position: absolute; top: 7px; right: 7px; width: 28px; height: 28px; padding: 0; border-radius: 6px; background: rgba(255, 253, 248, 0.94); color: #132a35; border: 1px solid #d8c3a5; }
    .copy-icon { position: relative; display: inline-block; width: 15px; height: 18px; border: 2px solid currentColor; border-radius: 2px; background: rgba(255, 253, 248, 0.94); box-sizing: border-box; }
    .copy-icon::before { content: ""; position: absolute; width: 15px; height: 18px; left: -7px; top: 4px; border: 2px solid currentColor; border-radius: 2px; background: rgba(255, 253, 248, 0.94); box-sizing: border-box; }
    .copy-icon::after { content: ""; position: absolute; right: -2px; top: -2px; width: 7px; height: 7px; background: rgba(255, 253, 248, 0.94); border-left: 2px solid currentColor; border-bottom: 2px solid currentColor; }
    .timeline { display: grid; gap: 8px; margin-top: 8px; }
    .timeline-item { border-left: 3px solid #d8c3a5; padding-left: 10px; }
    .muted { color: #6d6d6d; font-size: 12px; }
    pre { white-space: pre-wrap; background: #faf7f2; padding: 8px; border-radius: 8px; }
  </style>
</head>
<body>
  <button class="help-toggle" type="button" title="Open Easy Mail guide" aria-label="Open Easy Mail guide" onclick="post('openGuide')">?</button>
  <button class="language-toggle" id="outputLanguage" type="button" value="${escapeAttr(locale)}" onclick="toggleLanguage()"><span class="globe-icon" aria-hidden="true"></span><span class="language-label">${escapeHtml(locale === "en-US" ? labels.settings.enOption : labels.settings.zhOption)}</span><span class="chevron" aria-hidden="true"></span></button>
  <div class="toolbar">
    <div class="toolbar-group">
      <button class="${pullMailBusy ? "is-busy" : ""}" onclick="post('pullMail')"${busyDisabled}>${escapeHtml(labels.toolbar.pullMail)}${renderButtonSpinner(pullMailBusy)}</button>
      <button class="${loadMoreBusy ? "is-busy" : ""}" onclick="post('loadMore')"${loadMoreDisabled || busyDisabled}>${escapeHtml(labels.toolbar.loadMore)}${renderButtonSpinner(loadMoreBusy)}</button>
      <button class="${sampleBusy ? "is-busy" : ""}" onclick="post('sampleDigest')"${busyDisabled}>${escapeHtml(labels.toolbar.sample)}${renderButtonSpinner(sampleBusy)}</button>
      <button class="${analyzeNextBusy ? "is-busy" : ""}" onclick="post('analyze')"${analysisDisabled}>${escapeHtml(analyzeNextLabel)}${renderButtonSpinner(analyzeNextBusy)}</button>
      <button class="${analyzeSelectedBusy ? "is-busy" : ""}" onclick="analyzeSelected()"${analysisDisabled}>${escapeHtml(labels.toolbar.analyzeSelected)}${renderButtonSpinner(analyzeSelectedBusy)}</button>
      <button class="${analyzeAllBusy ? "is-busy" : ""}" onclick="post('analyzeAllAllowed')"${analysisDisabled}>${escapeHtml(labels.toolbar.analyzeAllAllowed)}${renderButtonSpinner(analyzeAllBusy)}</button>
      <button onclick="post('refresh')"${busyDisabled}>${escapeHtml(labels.toolbar.refresh)}</button>
    </div>
    <div class="toolbar-group">
      <button class="secondary" onclick="post('openSummary')">${escapeHtml(labels.toolbar.openSummary)}</button>
      <button class="secondary ${reportsBusy ? "is-busy" : ""}" onclick="post('generateReports')"${busyDisabled}>${escapeHtml(labels.toolbar.generateReports)}${renderButtonSpinner(reportsBusy)}</button>
    </div>
    <div class="toolbar-group">
      <button class="ghost" onclick="post('openSettings')">${escapeHtml(labels.toolbar.settingsFile)}</button>
      <button class="ghost" onclick="post('openPromptConfig')">${escapeHtml(labels.toolbar.promptConfig)}</button>
      <button class="ghost" onclick="post('clearLocalCache')"${busyDisabled}>${escapeHtml(labels.toolbar.clearStore)}</button>
    </div>
  </div>
  <details class="settings" id="settingsPanel">
    <summary>${escapeHtml(labels.settings.title)}</summary>
    <div class="settings-body">
      <div class="grid">
      <label>${escapeHtml(labels.settings.range)}
        <select id="rangeMode">
          <option value="recentHours" ${selected(config.rangeMode, "recentHours")}>${escapeHtml(labels.settings.recentHoursOption)}</option>
          <option value="maxItems" ${selected(config.rangeMode, "maxItems")}>${escapeHtml(labels.settings.maxItemsOption)}</option>
        </select>
      </label>
      ${renderRangeValueControl(config, labels)}
      <label>${escapeHtml(labels.settings.folders)}
        <input id="folders" value="${escapeAttr(Array.isArray(config.folders) ? config.folders.join(";") : "Inbox")}" />
      </label>
      <label><span class="field-title">${escapeHtml(labels.settings.modelFamily)} <button class="inline-action" type="button" onclick="post('loadModels')"${busyDisabled}>${escapeHtml(labels.toolbar.loadModels)}</button></span>
        <select id="modelFamily">
          ${modelOptions}
        </select>
      </label>
      <label>${escapeHtml(labels.settings.maxClassification)}
        <select id="autoAnalyzeMaxClassificationLevel">
          ${renderClassificationOptions(Number(config.autoAnalyzeMaxClassificationLevel ?? 2), labels)}
        </select>
      </label>
      </div>
      <div class="autosave-note">${escapeHtml(labels.settings.autoSaveNote)}</div>
    </div>
  </details>
  <div class="meta">
    <div class="meta-grid">
      <div class="meta-item"><span class="meta-label">${escapeHtml(labels.meta.range)}</span><span class="meta-value">${escapeHtml(formatRangeMeta(digestMeta, labels))}</span></div>
      <div class="meta-item"><span class="meta-label">${escapeHtml(labels.meta.folders)}</span><span class="meta-value">${escapeHtml((digestMeta.folders || []).join(", ") || "-")}</span></div>
      <div class="meta-item"><span class="meta-label">${escapeHtml(labels.meta.generated)}</span><span class="meta-value">${escapeHtml(digestMeta.generatedAt || "-")}</span></div>
      <div class="meta-item"><span class="meta-label">${escapeHtml(labels.meta.lastPull)}</span><span class="meta-value">${escapeHtml(store.lastPullAt || "-")}</span></div>
      <div class="meta-item"><span class="meta-label">${escapeHtml(labels.meta.requestedModel)}</span><span class="meta-value">${escapeHtml(formatSelectedModel(config.modelFamily, availableModels))}</span></div>
    </div>
  </div>
  <div class="stats">
    ${renderStat(labels.stats.pulled, index.items.length, "pending-panel")}
    ${renderStat(labels.stats.pending, queue.pending.length, "pending-panel")}
    ${renderStat(labels.stats.analysed, state.overview.totalMails, analysedTargetId)}
    ${renderStat(labels.stats.blocked, queue.blocked.length, "blocked-panel")}
    ${renderStat(labels.stats.mustHandle, state.overview.mustHandleToday, domIdForCategory("mustHandleToday"))}
    ${renderStat(labels.stats.risk, state.overview.risks, domIdForCategory("risk"))}
    ${renderStat(labels.stats.waiting, state.overview.waitingForMe, domIdForCategory("waitingForMe"))}
    ${renderStat(labels.stats.notice, state.overview.notices, domIdForCategory("notice"))}
    ${renderStat(labels.stats.threads, visibleThreadStore.items.length, "threads-panel")}
  </div>
  ${pendingHtml}
  ${mustHandleHtml}
  ${blockedHtml}
  ${rows}
  ${threadsHtml}
  <script>
    const vscode = acquireVsCodeApi();
    const previousState = vscode.getState() || {};
    const settingsPanel = document.getElementById('settingsPanel');
    if (previousState.settingsOpen) {
      settingsPanel.open = true;
    }
    if (Array.isArray(previousState.openPanels)) {
      for (const panelId of previousState.openPanels) {
        const panel = document.getElementById(panelId);
        if (panel && panel.tagName === 'DETAILS') {
          panel.open = true;
        }
      }
    }
    settingsPanel.addEventListener('toggle', () => {
      vscode.setState(Object.assign({}, vscode.getState() || {}, { settingsOpen: settingsPanel.open }));
    });
    for (const panel of document.querySelectorAll('details.category')) {
      panel.addEventListener('toggle', () => {
        const openPanels = Array.from(document.querySelectorAll('details.category[open]')).map((item) => item.id).filter(Boolean);
        vscode.setState(Object.assign({}, vscode.getState() || {}, { openPanels }));
      });
    }
    const configControlIds = ['rangeMode', 'rangeValue', 'folders', 'modelFamily', 'autoAnalyzeMaxClassificationLevel'];
    const autoSaveConfig = debounce(() => saveConfig(true, false), 450);
    for (const id of configControlIds) {
      const control = document.getElementById(id);
      if (!control) {
        continue;
      }
      control.addEventListener('change', autoSaveConfig);
      if (control.tagName === 'INPUT') {
        control.addEventListener('input', autoSaveConfig);
      }
    }
    document.addEventListener('click', (event) => {
      const target = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!target) {
        return;
      }
      const action = target.getAttribute('data-action');
      if (action === 'copyDraft') {
        post('copyDraft', { draftReply: target.getAttribute('data-draft-reply') || '' });
      }
      if (action === 'ignore') {
        ignoreMail(target.getAttribute('data-mail-id') || '');
      }
      if (action === 'openInOutlook') {
        post('openInOutlook', { mailId: target.getAttribute('data-mail-id') || '' });
      }
      if (action === 'analyzeThread') {
        post('analyzeThread', { threadId: target.getAttribute('data-thread-id') || '' });
      }
      if (action === 'jumpPanel') {
        jumpToPanel(target.getAttribute('data-target-id') || '');
      }
    });
    function post(type, extra) { vscode.postMessage(Object.assign({ type }, extra || {})); }
    function saveConfig(keepSettingsOpen, silent) {
      const rangeMode = document.getElementById('rangeMode').value;
      const rangeValue = document.getElementById('rangeValue');
      vscode.setState(Object.assign({}, vscode.getState() || {}, { settingsOpen: keepSettingsOpen !== false }));
      post('saveConfig', {
        silent: silent === true,
        config: {
          rangeMode,
          outputLanguage: document.getElementById('outputLanguage').value,
          recentHours: rangeMode === 'recentHours' ? rangeValue.value : undefined,
          maxItems: rangeMode === 'maxItems' ? rangeValue.value : undefined,
          folders: document.getElementById('folders').value,
          modelFamily: document.getElementById('modelFamily').value,
          autoAnalyzeMaxClassificationLevel: document.getElementById('autoAnalyzeMaxClassificationLevel').value
        }
      });
    }
    function toggleLanguage() {
      vscode.setState(Object.assign({}, vscode.getState() || {}, { settingsOpen: true }));
      const button = document.getElementById('outputLanguage');
      const next = button.value === 'en-US' ? 'zh-CN' : 'en-US';
      button.value = next;
      const label = button.querySelector('.language-label');
      if (label) {
        label.textContent = next === 'en-US' ? 'English' : '简体中文';
      }
      post('requestLanguageChange', { config: { outputLanguage: next } });
    }
    function debounce(fn, wait) {
      let timer;
      return () => {
        clearTimeout(timer);
        timer = setTimeout(fn, wait);
      };
    }
    function jumpToPanel(targetId, smooth) {
      const target = document.getElementById(targetId);
      if (!target) {
        return;
      }
      if (target.tagName === 'DETAILS') {
        target.open = true;
      }
      target.scrollIntoView({ behavior: smooth === false ? 'auto' : 'smooth', block: 'start' });
      if (typeof target.focus === 'function') {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    }
    function ignoreMail(mailId) {
      post('ignore', { mailId });
    }
    function analyzeSelected() {
      const checked = Array.from(document.querySelectorAll('input[data-mail-id]:checked')).map((input) => input.getAttribute('data-mail-id'));
      post('analyzeSelected', { mailIds: checked });
    }
  </script>
</body>
</html>`;
}
