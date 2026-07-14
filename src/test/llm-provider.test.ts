import test from "node:test";
import assert from "node:assert/strict";
import { formatModelLabel, isModelRefreshableErrorMessage, modelKey, normalizeAvailableModel, readLlmResponseText, resolveModelSelection, selectConfiguredModel, selectConfiguredModelIndex } from "../lib/llm-provider";
import { MockProvider } from "./support/mock-provider";

const models = [
  { vendor: "copilot", family: "gpt-5-mini", id: "copilot-utility", name: "GPT-5 mini" },
  { vendor: "copilot", family: "gpt-4o-mini", id: "gpt-4o-mini", name: "GPT-4o mini" }
];

test("selectConfiguredModel matches id, family, name, vendor, and full label", () => {
  assert.equal(selectConfiguredModelIndex(models, "copilot-utility"), 0);
  assert.equal(selectConfiguredModelIndex(models, "gpt-5-mini"), 0);
  assert.equal(selectConfiguredModelIndex(models, "GPT-5 mini"), 0);
  assert.equal(selectConfiguredModelIndex(models, "copilot / gpt-5-mini / copilot-utility / GPT-5 mini"), 0);
  assert.equal(selectConfiguredModelIndex(models, "missing-model"), -1);
  assert.equal(selectConfiguredModel(models, "gpt-4o-mini")?.id, "gpt-4o-mini");
});

test("formatModelLabel and modelKey keep model identity stable", () => {
  assert.equal(formatModelLabel(models[0]), "copilot / gpt-5-mini / copilot-utility / GPT-5 mini");
  assert.equal(modelKey(models[0]), "copilot\u0000gpt-5-mini\u0000copilot-utility\u0000GPT-5 mini");
});

test("resolveModelSelection prefers the requested model and marks fallback when it is missing", () => {
  assert.deepEqual(resolveModelSelection(models, "gpt-4o-mini", models[0]), {
    selectedIndex: 0,
    usedFallback: false
  });
  assert.deepEqual(resolveModelSelection(models, "gpt-4o-mini", { vendor: "copilot", family: "missing", id: "missing", name: "Missing" }), {
    selectedIndex: 1,
    usedFallback: true
  });
});

test("isModelRefreshableErrorMessage only matches stale model selection errors", () => {
  assert.equal(isModelRefreshableErrorMessage("Language model is no longer available"), true);
  assert.equal(isModelRefreshableErrorMessage("selected model not found"), true);
  assert.equal(isModelRefreshableErrorMessage("selected model unavailable"), true);
  assert.equal(isModelRefreshableErrorMessage("Copilot service unavailable"), false);
  assert.equal(isModelRefreshableErrorMessage("Rate limit exceeded for model gpt-x"), false);
  assert.equal(isModelRefreshableErrorMessage("Authentication required: sign in to GitHub Copilot"), false);
  assert.equal(isModelRefreshableErrorMessage("JSON parse failed"), false);
});

test("normalizeAvailableModel tolerates missing model fields", () => {
  assert.deepEqual(normalizeAvailableModel({ family: "gpt-5-mini" }), {
    id: "",
    family: "gpt-5-mini",
    name: "",
    vendor: ""
  });
});

test("readLlmResponseText stops when the response stream is cancelled", async () => {
  let cancelled = false;
  const token = { get isCancellationRequested() { return cancelled; } };
  async function* stream(): AsyncGenerator<{ value: string }> {
    yield { value: "first" };
    cancelled = true;
    yield { value: "second" };
  }

  await assert.rejects(() => readLlmResponseText(stream(), token), /cancelled/i);
});

test("MockProvider returns configured models and records prompts", async () => {
  const provider = new MockProvider({
    models,
    responses: ["{\"items\":[]}"]
  });

  assert.deepEqual(await provider.listModels(), models);
  const response = await provider.sendPrompt("Analyze this", { modelFamily: "gpt-5-mini" });

  assert.equal(response.rawText, "{\"items\":[]}");
  assert.equal(response.model.id, "copilot-utility");
  assert.equal(response.usedFallback, false);
  assert.deepEqual(provider.prompts, ["Analyze this"]);
});

test("MockProvider fails when requested model is unavailable", async () => {
  const provider = new MockProvider({ models });
  await assert.rejects(
    () => provider.sendPrompt("Analyze this", { modelFamily: "unavailable" }),
    /Select an available GitHub Copilot model/
  );
});
