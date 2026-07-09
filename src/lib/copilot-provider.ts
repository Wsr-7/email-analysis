import * as vscode from "vscode";
import {
  normalizeAvailableModel,
  modelKey,
  selectConfiguredModelIndex,
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
    let modelIndex = options.model
      ? this.availableModels.findIndex((model) => modelKey(model) === modelKey(options.model as AvailableModel))
      : selectConfiguredModelIndex(this.availableModels, options.modelFamily);
    if (options.model && modelIndex < 0) {
      await this.listModels();
      modelIndex = this.availableModels.findIndex((model) => modelKey(model) === modelKey(options.model as AvailableModel));
    }
    const selectedModelIndex = modelIndex >= 0 ? modelIndex : selectConfiguredModelIndex(this.availableModels, options.modelFamily);
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
      rawText: await readResponseText(response.text),
      model: selectedAvailableModel,
      usedFallback: false
    };
  }
}

async function readResponseText(stream: AsyncIterable<unknown>): Promise<string> {
  let full = "";
  for await (const part of stream) {
    if (part && typeof part === "object" && "value" in (part as Record<string, unknown>) && typeof (part as Record<string, unknown>).value === "string") {
      full += String((part as Record<string, unknown>).value);
    } else {
      full += String(part);
    }
  }
  return full;
}
