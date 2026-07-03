import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { positiveNumber, parseFolders, normalizeMailFolders, mergeStringLists, serializeFolderDateMap, getLocaleFromConfig, parseClassificationLevel, buildSecuritySettings, buildDefaultRedactionPolicy } from "../lib/config-utils";

describe("positiveNumber", () => {
  it("returns parsed number when positive", () => {
    assert.equal(positiveNumber("42", 10), 42);
  });

  it("returns fallback for non-positive input", () => {
    assert.equal(positiveNumber(-1, 10), 10);
    assert.equal(positiveNumber("abc", 5), 5);
  });
});

describe("parseFolders", () => {
  it("parses semicolon-separated string", () => {
    assert.deepEqual(parseFolders("Inbox;Sent", []), ["Inbox", "Sent"]);
  });

  it("passes through arrays", () => {
    assert.deepEqual(parseFolders(["A", "B"], []), ["A", "B"]);
  });

  it("returns fallback for empty input", () => {
    assert.deepEqual(parseFolders("", ["Inbox"]), ["Inbox"]);
  });
});

describe("default folders", () => {
  it("include Sent Items so self replies are collected for thread timelines", () => {
    const defaults = JSON.parse(fs.readFileSync(path.join(process.cwd(), "default-config.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

    assert.deepEqual(defaults.folders, ["Inbox", "Sent Items"]);
    assert.deepEqual(manifest.contributes.configuration.properties["easyMail.folders"].default, ["Inbox", "Sent Items"]);
  });

  it("keeps explicit folder settings without forcing fixed folders", () => {
    assert.deepEqual(normalizeMailFolders(["Inbox"], ["Inbox", "Sent Items"]), ["Inbox"]);
    assert.deepEqual(normalizeMailFolders("Inbox", ["Inbox", "Sent Items"]), ["Inbox"]);
    assert.deepEqual(normalizeMailFolders("Archive", ["Inbox", "Sent Items"]), ["Archive"]);
    assert.deepEqual(normalizeMailFolders("", ["Inbox", "Sent Items"]), ["Inbox", "Sent Items"]);
  });
});

describe("mergeStringLists", () => {
  it("deduplicates and merges", () => {
    const result = mergeStringLists(["a", "b"], ["b", "c"]);
    assert.deepEqual(result.sort(), ["a", "b", "c"]);
  });
});

describe("serializeFolderDateMap", () => {
  it("serializes folder-date pairs", () => {
    const result = serializeFolderDateMap({ Inbox: "2026-01-01", Sent: "2026-01-02" });
    assert.ok(result.includes("Inbox=2026-01-01"));
    assert.ok(result.includes("Sent=2026-01-02"));
    assert.ok(result.includes(";"));
  });

  it("filters out empty values", () => {
    const result = serializeFolderDateMap({ Inbox: "2026-01-01", Sent: "" });
    assert.ok(!result.includes("Sent"));
  });
});

describe("getLocaleFromConfig", () => {
  it("returns zh-CN when configured", () => {
    assert.equal(getLocaleFromConfig({ outputLanguage: "zh-CN" }), "zh-CN");
  });

  it("defaults to en-US", () => {
    assert.equal(getLocaleFromConfig({}), "en-US");
  });
});

describe("buildSecuritySettings", () => {
  it("parses classification level labels and string numbers", () => {
    assert.equal(parseClassificationLevel("REGISTERED", 1), 2);
    assert.equal(parseClassificationLevel("HIGH REGISTERED", 1), 3);
    assert.equal(parseClassificationLevel("2", 1), 2);
    assert.equal(parseClassificationLevel("unknown", 1), 1);
  });

  it("builds settings with defaults", () => {
    const settings = buildSecuritySettings({});
    assert.equal(settings.enabled, true);
    assert.equal(settings.maxAutoClassificationLevel, 2);
    assert.equal(settings.maxManualClassificationLevel, 3);
    assert.ok(settings.hardBlockKeywords?.includes("password"));
  });

  it("ignores obsolete autoAnalyzeEnabled false", () => {
    const settings = buildSecuritySettings({ autoAnalyzeEnabled: false });
    assert.equal(settings.autoAnalyzeEnabled, true);
  });

  it("uses parsed max allowed classification level", () => {
    const settings = buildSecuritySettings({ autoAnalyzeMaxClassificationLevel: "REGISTERED" });
    assert.equal(settings.maxAutoClassificationLevel, 2);
  });
});

describe("buildDefaultRedactionPolicy", () => {
  it("returns fully enabled policy", () => {
    const policy = buildDefaultRedactionPolicy();
    assert.equal(policy.enabled, true);
    assert.equal(policy.redactEmail, true);
    assert.equal(policy.redactPhone, true);
    assert.deepEqual(policy.customPatterns, []);
  });
});
