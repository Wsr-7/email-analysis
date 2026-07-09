import type { SecurityGateSettings } from "./security-types";
import type { RedactionPolicy } from "./redaction";

export type Locale = "zh-CN" | "en-US";

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
  const folders = parseFolders(value, fallback);
  return folders.length === 1 && folders[0]?.toLowerCase() === "inbox" ? fallback : folders;
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

export function resolveModelFamily(stored: unknown, settingsValue: unknown, defaultValue: unknown): string {
  for (const value of [stored, settingsValue, defaultValue]) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function shouldMigrateLegacyModelFamily(stored: unknown, settingsValue: unknown, defaultValue: unknown, configExisted: boolean): boolean {
  const storedValue = typeof stored === "string" ? stored.trim() : "";
  const legacyValue = typeof settingsValue === "string" ? settingsValue.trim() : "";
  const defaultModel = typeof defaultValue === "string" ? defaultValue.trim() : "";
  if (!legacyValue) {
    return false;
  }
  if (!storedValue) {
    return true;
  }
  return !configExisted || (storedValue === defaultModel && legacyValue !== defaultModel);
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
    hardBlockKeywords: ["password", "api_key", "access_token", "auth_token"],
    manualConfirmKeywords: []
  };
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
