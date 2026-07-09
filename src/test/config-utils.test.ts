import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { positiveNumber, parseFolders, normalizeMailFolders, mergeStringLists, serializeFolderDateMap, getLocaleFromConfig, resolveModelFamily, parseClassificationLevel, buildSecuritySettings, buildDefaultRedactionPolicy, formatTodayLine } from "../lib/config-utils";
import { detectDraftLanguageFromText, latestNonSelfThreadText, resolveDraftLanguage, resolveOutputLanguage } from "../lib/language-contract";

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

  it("migrates old Inbox-only folder settings to the current default", () => {
    assert.deepEqual(normalizeMailFolders(["Inbox"], ["Inbox", "Sent Items"]), ["Inbox", "Sent Items"]);
    assert.deepEqual(normalizeMailFolders("Inbox", ["Inbox", "Sent Items"]), ["Inbox", "Sent Items"]);
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

describe("resolveModelFamily", () => {
  it("uses private config before legacy settings and defaults", () => {
    assert.equal(resolveModelFamily("stored-model", "legacy-model", "default-model"), "stored-model");
  });

  it("falls back from empty private config to legacy settings", () => {
    assert.equal(resolveModelFamily(" ", " legacy-model ", "default-model"), "legacy-model");
  });

  it("falls back to the default model when neither stored nor legacy settings are set", () => {
    assert.equal(resolveModelFamily(undefined, "", "default-model"), "default-model");
  });
});

describe("resolveOutputLanguage", () => {
  it("uses an explicit output language before the VS Code UI language", () => {
    assert.equal(resolveOutputLanguage("en-US", "zh-cn"), "en-US");
    assert.equal(resolveOutputLanguage("zh-CN", "en"), "zh-CN");
  });

  it("falls back to the VS Code UI language when output language is not explicit", () => {
    assert.equal(resolveOutputLanguage(undefined, "zh-cn"), "zh-CN");
    assert.equal(resolveOutputLanguage(undefined, "en"), "en-US");
  });
});

describe("draft language detection", () => {
  it("detects English, Chinese, and mixed first-paragraph text", () => {
    assert.equal(detectDraftLanguageFromText("Please confirm the contract by Friday."), "en");
    assert.equal(detectDraftLanguageFromText("请在周五前确认合同。"), "zh-CN");
    assert.equal(detectDraftLanguageFromText("请确认合同状态和审批意见 contract status.\nPlease ignore this later English paragraph."), "zh-CN");
    assert.equal(detectDraftLanguageFromText("Hi Alice,\n请在周五前确认合同。"), "zh-CN");
  });

  it("resolves explicit draft language before auto detection", () => {
    assert.equal(resolveDraftLanguage("en", "请确认合同。"), "en");
    assert.equal(resolveDraftLanguage("zh-CN", "Please confirm."), "zh-CN");
    assert.equal(resolveDraftLanguage("auto", "请确认合同。"), "zh-CN");
  });

  it("uses the latest incoming thread message for auto draft language", () => {
    const text = latestNonSelfThreadText({
      timeline: [
        { folder: "Inbox", toMe: "true", bodyDelta: "请确认合同。" },
        { folder: "Custom Sent", toMe: "false", ccMe: "false", bodyDelta: "I will check." }
      ]
    });

    assert.equal(text, "请确认合同。");
  });

  it("does not keep hardcoded English repair instructions in manual draft paths", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
    assert.equal(source.includes("ensureEnglishDraftText"), false);
    assert.equal(source.includes("Translate the following reply draft to English"), false);
    assert.equal(source.includes("do not include Chinese characters"), false);
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

describe("formatTodayLine", () => {
  it("formats using local date parts and the local IANA timezone, not UTC", () => {
    const date = new Date(2026, 6, 8, 23, 30, 0);
    const line = formatTodayLine(date);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.equal(line, `Today is 2026-07-08 (${timeZone}).`);
  });

  it("defaults to the current date when no argument is passed", () => {
    const line = formatTodayLine();
    assert.match(line, /^Today is \d{4}-\d{2}-\d{2} \(.+\)\.$/);
  });
});
