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

export const REQUIRED_MAIL_FOLDERS = ["Inbox", "Sent Items"] as const;

export function normalizeMailFolders(value: unknown, fallback: string[]): string[] {
  return mergeStringLists([...REQUIRED_MAIL_FOLDERS], parseFolders(value, fallback));
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
