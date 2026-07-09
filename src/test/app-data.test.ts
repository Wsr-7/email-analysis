import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AppDataStore } from "../lib/app-data";

const store = new AppDataStore({
  globalStoragePath: "/mock/storage",
  extensionPath: "/mock/extension"
});

describe("AppDataStore config", () => {
  it("round-trips private config values", async () => {
    const globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "easy-mail-config-test-"));
    try {
      const data = new AppDataStore({ globalStoragePath, extensionPath: process.cwd() });
      await data.ensureConfig();
      await data.writeConfig({ modelFamily: "copilot-utility" });

      assert.deepEqual(await data.readConfig(), { modelFamily: "copilot-utility" });
    } finally {
      await fs.rm(globalStoragePath, { recursive: true, force: true });
    }
  });
});

describe("AppDataStore path getters", () => {
  it("getDataDir returns data subdir", () => {
    assert.equal(store.getDataDir(), path.join("/mock/storage", "data"));
  });

  it("getConfigPath returns config path in storage root", () => {
    assert.equal(store.getConfigPath(), path.join("/mock/storage", "easy-mail.config.json"));
  });

  it("getDigestPath returns digest in data dir", () => {
    assert.ok(store.getDigestPath().endsWith("mail-digest.md"));
  });

  it("getAnalysisPath returns analysis in data dir", () => {
    assert.ok(store.getAnalysisPath().endsWith("analysis-result.json"));
  });

  it("getMailStorePath returns mail store in data dir", () => {
    assert.ok(store.getMailStorePath().endsWith("mail-store.json"));
  });

  it("getMailIndexPath returns mail index in data dir", () => {
    assert.ok(store.getMailIndexPath().endsWith("mail-index.json"));
  });

  it("getThreadStorePath returns thread store in data dir", () => {
    assert.ok(store.getThreadStorePath().endsWith("thread-store.json"));
  });

  it("getClassificationCachePath returns classification cache in data dir", () => {
    assert.ok(store.getClassificationCachePath().endsWith("classification-cache.json"));
  });

  it("getPromptConfigPath returns prompt config in storage root", () => {
    assert.equal(store.getPromptConfigPath(), path.join("/mock/storage", "prompt-config.json"));
  });

  it("getLogDir returns logs subdir in storage root", () => {
    assert.equal(store.getLogDir(), path.join("/mock/storage", "logs"));
  });

  it("all data paths share the data dir prefix", () => {
    const dataDir = store.getDataDir();
    assert.ok(store.getDigestPath().startsWith(dataDir));
    assert.ok(store.getAnalysisPath().startsWith(dataDir));
    assert.ok(store.getSummaryPath().startsWith(dataDir));
    assert.ok(store.getDailyBriefPath().startsWith(dataDir));
    assert.ok(store.getThreadReportPath().startsWith(dataDir));
    assert.ok(store.getSingleMailReportPath().startsWith(dataDir));
    assert.ok(store.getIgnoredPath().startsWith(dataDir));
    assert.ok(store.getModelInfoPath().startsWith(dataDir));
    assert.ok(store.getAvailableModelsPath().startsWith(dataDir));
  });
});
