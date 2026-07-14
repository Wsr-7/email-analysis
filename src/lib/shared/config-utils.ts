import type { SecurityGateSettings } from "../security/security-types";
import type { RedactionPolicy } from "../security/redaction";

export type Locale = "zh-CN" | "en-US";

const DEFAULT_HARD_BLOCK_KEYWORDS = [
  "password", "passwd", "pwd", "api_key", "apikey", "access_token", "auth_token",
  "secret_key", "private_key", "credential", "credentials", "密码", "口令", "密钥", "私钥", "凭证", "令牌"
];
const DEFAULT_CLASSIFICATION_LEVEL_3_KEYWORDS = ["high registered", "highly restricted", "secret"];
const DEFAULT_CLASSIFICATION_LEVEL_2_KEYWORDS = ["registered", "restricted", "confidential", "contract", "budget"];

export interface ClassificationKeywords {
  3: string[];
  2: string[];
}

export function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number(fallback);
}

export function parseFolders(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  const parsed = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

export function normalizeMailFolders(value: unknown, fallback: string[]): string[] {
  return parseFolders(value, fallback);
}

export type OutlookFolderList = {
  folders: string[];
  defaults: Record<string, string>;
};

export type OutlookFolderPickItem = {
  label: string;
  description?: string;
  picked: boolean;
};

const DEFAULT_OUTLOOK_FOLDER_NAMES = ["Inbox", "Sent Items", "Drafts"];

function defaultOutlookFolderName(folder: string, defaults: Record<string, string>): string {
  const key = String(folder || "").trim().toLowerCase();
  for (const name of DEFAULT_OUTLOOK_FOLDER_NAMES) {
    if (key === name.toLowerCase() || key === String(defaults[name] || "").trim().toLowerCase()) {
      return name;
    }
  }
  return "";
}

function outlookFolderIdentity(folder: string, defaults: Record<string, string>): string {
  return defaultOutlookFolderName(folder, defaults).toLowerCase() || String(folder || "").trim().toLowerCase();
}

export function parseOutlookFolderList(content: string): OutlookFolderList {
  const seen = new Set<string>();
  const folders: string[] = [];
  const defaults: Record<string, string> = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line || line.startsWith("EasyMailFolderList:") || line.startsWith("FolderList:")) {
      continue;
    }
    const defaultMatch = /^FolderListDefault:\s*(Inbox|Sent Items|Drafts)\s*=\s*(.+)$/i.exec(line);
    if (defaultMatch) {
      const name = DEFAULT_OUTLOOK_FOLDER_NAMES.find((item) => item.toLowerCase() === defaultMatch[1]!.toLowerCase())!;
      defaults[name] = defaultMatch[2]!.trim();
      continue;
    }
    const key = line.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      folders.push(line);
    }
  }
  return { folders, defaults };
}

export function buildOutlookFolderPickItems(availableFolders: string[], currentFolders: string[], defaults: Record<string, string>): OutlookFolderPickItem[] {
  const selected = new Set(currentFolders.map((folder) => outlookFolderIdentity(folder, defaults)));
  const seen = new Set<string>();
  const items: OutlookFolderPickItem[] = [];
  for (const folder of [...availableFolders, ...currentFolders]) {
    const label = String(folder || "").trim();
    const identity = outlookFolderIdentity(label, defaults);
    if (!label || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    const defaultName = defaultOutlookFolderName(label, defaults);
    items.push({
      label,
      ...(defaultName ? { description: `(${defaultName})` } : {}),
      picked: selected.has(identity)
    });
  }
  return items;
}

export function normalizeOutlookFolderSelection(folders: string[], defaults: Record<string, string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const folder of folders) {
    const label = String(folder || "").trim();
    const value = defaultOutlookFolderName(label, defaults) || label;
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

export function mergeStringLists(a: string[], b: string[]): string[] {
  return [...new Set([...(a || []), ...(b || [])].map(String).map((item) => item.trim()).filter(Boolean))];
}

export function serializeFolderDateMap(values: Record<string, string>): string {
  return Object.entries(values)
    .filter(([, value]) => value)
    .map(([folder, value]) => `${folder.replace(/[=;]/g, " ").trim()}=${value.replace(/;/g, " ").trim()}`)
    .join(";");
}

export function getLocaleFromConfig(config: Record<string, unknown>): Locale {
  return config.outputLanguage === "zh-CN" ? "zh-CN" : "en-US";
}

export function resolveModelFamily(settingsValue: unknown, stored: unknown, defaultValue: unknown): string {
  for (const value of [settingsValue, stored, defaultValue]) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function shouldMigrateLegacyModelFamily(stored: unknown, settingsValue: unknown, defaultValue: unknown, configExisted: boolean, migrated = false): boolean {
  const storedValue = typeof stored === "string" ? stored.trim() : "";
  const legacyValue = typeof settingsValue === "string" ? settingsValue.trim() : "";
  const defaultModel = typeof defaultValue === "string" ? defaultValue.trim() : "";
  if (migrated) {
    return false;
  }
  if (!legacyValue) {
    return false;
  }
  if (!storedValue) {
    return true;
  }
  return !configExisted && storedValue === defaultModel && legacyValue !== defaultModel;
}

export function parseClassificationLevel(value: unknown, fallback: number): number {
  const labels: Record<string, number> = {
    PUBLIC: 0,
    INTERNAL: 1,
    REGISTERED: 2,
    "HIGH REGISTERED": 3
  };
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized in labels) {
      return labels[normalized]!;
    }
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function buildSecuritySettings(config: Record<string, unknown>): SecurityGateSettings {
  return {
    enabled: true,
    autoAnalyzeEnabled: true,
    maxAutoClassificationLevel: parseClassificationLevel(config.autoAnalyzeMaxClassificationLevel, 2),
    maxManualClassificationLevel: 3,
    hardBlockKeywords: keywordArray(config.hardBlockKeywords, DEFAULT_HARD_BLOCK_KEYWORDS),
    manualConfirmKeywords: keywordArray(config.manualConfirmKeywords, [])
  };
}

export function buildClassificationKeywords(config: Record<string, unknown>): ClassificationKeywords {
  return {
    3: keywordArray(config.classificationLevel3Keywords, DEFAULT_CLASSIFICATION_LEVEL_3_KEYWORDS),
    2: keywordArray(config.classificationLevel2Keywords, DEFAULT_CLASSIFICATION_LEVEL_2_KEYWORDS)
  };
}

function keywordArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return [...fallback];
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function formatTodayLine(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return `Today is ${year}-${month}-${day} (${timeZone}).`;
}

export function buildDefaultRedactionPolicy(): RedactionPolicy {
  return {
    enabled: true,
    redactEmail: true,
    redactPhone: true,
    redactUrl: true,
    redactIp: true,
    redactToken: true,
    redactMoney: true,
    redactIdLike: true,
    customPatterns: []
  };
}
