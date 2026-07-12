import * as vscode from "vscode";
import {
  normalizeAvailableModel,
  resolveModelSelection,
  isModelRefreshableErrorMessage,
  readLlmResponseText,
  type AvailableModel,
  type LlmProvider,
  type LlmRequestOptions,
  type LlmResponse
} from "./llm-provider";

export class CopilotProvider implements LlmProvider {
  private nativeModels: vscode.LanguageModelChat[] = [];
  private availableModels: AvailableModel[] = [];
  private readonly fallbackCancellation = new vscode.CancellationTokenSource();

  public async listModels(): Promise<AvailableModel[]> {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    this.nativeModels = models;
    this.availableModels = models.map(normalizeAvailableModel);
    return this.availableModels.map((model) => ({ ...model }));
  }

  public async sendPrompt(prompt: string, options: LlmRequestOptions): Promise<LlmResponse> {
    if (!this.nativeModels.length) {
      await this.listModels();
    }
    let selection = resolveModelSelection(this.availableModels, options.modelFamily, options.model);
    if (options.model && selection.selectedIndex < 0) {
      await this.listModels();
      selection = resolveModelSelection(this.availableModels, options.modelFamily, options.model);
    }
    try {
      return await this.sendSelectedPrompt(prompt, options, selection.selectedIndex, selection.usedFallback);
    } catch (error) {
      if (!isRefreshableModelError(error, options.cancellationToken)) {
        throw error;
      }
      await this.listModels();
      selection = resolveModelSelection(this.availableModels, options.modelFamily, options.model);
      return this.sendSelectedPrompt(prompt, options, selection.selectedIndex, selection.usedFallback);
    }
  }

  private async sendSelectedPrompt(prompt: string, options: LlmRequestOptions, selectedModelIndex: number, usedFallback: boolean): Promise<LlmResponse> {
    const selectedModel = selectedModelIndex >= 0 ? this.nativeModels[selectedModelIndex] : undefined;
    const selectedAvailableModel = selectedModelIndex >= 0 ? this.availableModels[selectedModelIndex] : undefined;
    if (!selectedModel || !selectedAvailableModel) {
      throw new Error("Select an available GitHub Copilot model before analyzing.");
    }

    const response = await selectedModel.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      (options.cancellationToken as vscode.CancellationToken | undefined) || this.fallbackCancellation.token
    );
    return {
      rawText: await readLlmResponseText(response.text, options.cancellationToken),
      model: selectedAvailableModel,
      usedFallback
    };
  }
}

function isRefreshableModelError(error: unknown, cancellationToken: LlmRequestOptions["cancellationToken"]): boolean {
  if (cancellationToken?.isCancellationRequested || isCancellationError(error)) {
    return false;
  }
  return isModelRefreshableErrorMessage(errorMessage(error));
}

function isCancellationError(error: unknown): boolean {
  const text = errorMessage(error).toLowerCase();
  return /cancelled|canceled|cancellation/.test(text);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error || "");
}
