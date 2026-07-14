import type { AnalysisResult } from "./analysis-schema";
import type { ClassificationCache } from "./classification";
import { classificationFor } from "./classification";
import { getLocaleFromConfig, mergeStringLists, parseFolders, positiveNumber } from "./config-utils";
import { getLabels, buildCategoryLabels, type DashboardLabels, LABELS } from "./dashboard-labels";
import { filterVisibleThreadsForDashboard, buildThreadLookup, compareTimelineMessagesForDisplay, type DashboardState } from "./dashboard-state";
import { escapeHtml, escapeAttr, domIdForMail, domIdForThread, domIdForThreadMessage, domIdForCategory, selected, senderDisplayName } from "./html-utils";
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
      <div title="${escapeAttr(item.from || "-")}"><strong>${escapeHtml(labels.card.from)}:</strong> ${escapeHtml(senderDisplayName(item.from || "-"))}</div>
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
        <div class="muted" title="${escapeAttr(message.from || message.senderEmail || "-")}">${escapeHtml(message.receivedTime || message.sentTime || "-")} · ${escapeHtml(senderDisplayName(message.from || message.senderEmail || "-"))}</div>
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
    <div title="${escapeAttr(thread.participants.join(", ") || "-")}"><strong>${escapeHtml(labels.threads.participants)}:</strong> ${escapeHtml(thread.participants.map(senderDisplayName).join(", ") || "-")}</div>
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
  return labels.toolbar.analyze;
}

export function renderRangeValueControl(config: Record<string, unknown>, labels: DashboardLabels): string {
  const rangeMode = config.rangeMode === "maxItems" ? "maxItems" : "recentHours";
  const label = rangeMode === "maxItems" ? labels.settings.maxItems : labels.settings.recentHours;
  const value = rangeMode === "maxItems" ? String(config.maxItems || 50) : String(config.recentHours || 24);
  return `<label><span id="rangeValueLabel">${escapeHtml(label)}</span>
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
        <summary class="wb-btn">${escapeHtml(labels.card.outlookActions)} <span class="outlook-chevron" aria-hidden="true"></span></summary>
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
    <div title="${escapeAttr(item.sender || "-")}"><strong>${escapeHtml(labels.card.from)}:</strong> ${escapeHtml(senderDisplayName(item.sender || "-"))}</div>
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

