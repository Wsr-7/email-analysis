export interface AvailableModel {
  id: string;
  family: string;
  name: string;
  vendor: string;
  maxInputTokens?: number;
}

export interface LlmRequestOptions {
  modelFamily: string;
  model?: AvailableModel;
  cancellationToken?: CancellationTokenLike;
}

export interface DisposableLike {
  dispose(): void;
}

export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested?: (listener: () => void) => DisposableLike;
}

export interface LlmResponse {
  rawText: string;
  model: AvailableModel;
  usedFallback: boolean;
}

export interface LlmProvider {
  listModels(): Promise<AvailableModel[]>;
  sendPrompt(prompt: string, options: LlmRequestOptions): Promise<LlmResponse>;
}

export async function readLlmResponseText(stream: AsyncIterable<unknown>, cancellationToken?: CancellationTokenLike): Promise<string> {
  let full = "";
  for await (const part of stream) {
    if (cancellationToken?.isCancellationRequested) {
      throw new Error("EasyMail task cancelled.");
    }
    full += part && typeof part === "object" && "value" in (part as Record<string, unknown>) && typeof (part as Record<string, unknown>).value === "string"
      ? String((part as Record<string, unknown>).value)
      : String(part);
  }
  if (cancellationToken?.isCancellationRequested) {
    throw new Error("EasyMail task cancelled.");
  }
  return full;
}

export interface ModelSelectionResult {
  selectedIndex: number;
  usedFallback: boolean;
}

export function normalizeAvailableModel(model: {
  id?: unknown;
  family?: unknown;
  name?: unknown;
  vendor?: unknown;
  maxInputTokens?: unknown;
}): AvailableModel {
  const normalized: AvailableModel = {
    id: String(model.id || ""),
    family: String(model.family || ""),
    name: String(model.name || ""),
    vendor: String(model.vendor || "")
  };
  const maxInputTokens = Number(model.maxInputTokens);
  if (Number.isFinite(maxInputTokens) && maxInputTokens > 0) {
    normalized.maxInputTokens = maxInputTokens;
  }
  return normalized;
}

export function selectConfiguredModel(models: AvailableModel[], selectedValue: string): AvailableModel | undefined {
  const index = selectConfiguredModelIndex(models, selectedValue);
  return index >= 0 ? models[index] : undefined;
}

export function selectConfiguredModelIndex(models: AvailableModel[], selectedValue: string): number {
  const selected = String(selectedValue || "").trim();
  if (!selected) {
    return -1;
  }
  return models.findIndex((model) => isSelectedModel(model, selected));
}

export function resolveModelSelection(models: AvailableModel[], selectedValue: string, requestedModel?: AvailableModel): ModelSelectionResult {
  const requestedKey = requestedModel ? modelKey(requestedModel) : "";
  const requestedIndex = requestedModel
    ? models.findIndex((model) => modelKey(model) === requestedKey)
    : -1;
  const selectedIndex = requestedModel && requestedIndex >= 0
    ? requestedIndex
    : selectConfiguredModelIndex(models, selectedValue);
  const selectedModel = selectedIndex >= 0 ? models[selectedIndex] : undefined;
  return {
    selectedIndex,
    usedFallback: Boolean(requestedModel && selectedModel && modelKey(selectedModel) !== requestedKey)
  };
}

export function isSelectedModel(model: AvailableModel, selectedValue: string): boolean {
  const selected = String(selectedValue || "").trim().toLowerCase();
  return [model.id, model.family, model.name, model.vendor, formatModelLabel(model)]
    .map((value) => String(value || "").trim().toLowerCase())
    .includes(selected);
}

export function formatModelLabel(model: AvailableModel): string {
  return [model.vendor, model.family, model.id, model.name]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" / ");
}

export function modelKey(model: AvailableModel): string {
  return [model.vendor, model.family, model.id, model.name].join("\u0000");
}

export function isModelRefreshableErrorMessage(message: unknown): boolean {
  const text = String(message || "").toLowerCase();
  if (/429|too many requests|rate.?limit|quota|temporar|timeout/.test(text)) {
    return false;
  }
  return /unknown model|model_not_supported|language model is no longer (available|supported)|selected model (not found|does not exist|unavailable)|model (not found|does not exist|unavailable)/.test(text);
}
