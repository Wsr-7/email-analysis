import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeAnalysis, parseAnalysisJson, pruneAnalysisResult, type AnalysisResult } from "../analysis/analysis-schema";
import { ensureClassifications, normalizeClassificationCache, type ClassificationCache } from "../security/classification";
import { parseDigest } from "../domain/digest";
import { emptyMailIndex, emptyMailStore, mergeDigestIntoStore, normalizeMailIndex, normalizeMailStore, type MailIndex, type MailStore } from "./mail-store";
import { allowedCategoryIds, normalizePromptConfig, type PromptConfig } from "../analysis/prompt-config";
import { LEGACY_REPLY_TEMPLATE_FILE_NAME, REPLY_TEMPLATE_FILE_NAME, validateReplyTemplate } from "../analysis/reply-template";
import { normalizeNextActionsStore, type NextActionsStore } from "./next-actions";
import { normalizeThreadAnalysis, type ThreadAnalysisResult } from "../analysis/thread-analysis-schema";
import { buildThreadStore } from "../domain/thread-engine";
import { emptyThreadStore, mergeThreadStores, normalizeThreadStore, type ThreadStore } from "./thread-store";
import { normalizeAvailableModel, type AvailableModel } from "../analysis/llm-provider";
import { emptyMeetingStore, normalizeMeetingStore, type MeetingStore } from "./meeting-store";
import { formatError } from "../shared/process-runner";

export interface AppPaths {
  globalStoragePath: string;
  extensionPath: string;
}

export class AppDataStore {
  constructor(private readonly paths: AppPaths) {}

  getDataDir(): string {
    return path.join(this.paths.globalStoragePath, "data");
  }

  getConfigPath(): string {
    return path.join(this.paths.globalStoragePath, "easy-mail.config.json");
  }

  getDigestPath(): string {
    return path.join(this.getDataDir(), "mail-digest.md");
  }

  getAnalysisPath(): string {
    return path.join(this.getDataDir(), "analysis-result.json");
  }

  getThreadAnalysisPath(): string {
    return path.join(this.getDataDir(), "thread-analysis-result.json");
  }

  getSummaryPath(): string {
    return path.join(this.getDataDir(), "mail-summary.md");
  }

  getDailyBriefPath(): string {
    return path.join(this.getDataDir(), "daily-brief.md");
  }

  getThreadReportPath(): string {
    return path.join(this.getDataDir(), "thread-report.md");
  }

  getSingleMailReportPath(): string {
    return path.join(this.getDataDir(), "single-mail-report.md");
  }

  getIgnoredPath(): string {
    return path.join(this.getDataDir(), "ignored.json");
  }

  getModelInfoPath(): string {
    return path.join(this.getDataDir(), "model-info.json");
  }

  getAvailableModelsPath(): string {
    return path.join(this.getDataDir(), "available-models.json");
  }

  getMailStorePath(): string {
    return path.join(this.getDataDir(), "mail-store.json");
  }

  getMailIndexPath(): string {
    return path.join(this.getDataDir(), "mail-index.json");
  }

  getThreadStorePath(): string {
    return path.join(this.getDataDir(), "thread-store.json");
  }

  getMeetingStorePath(): string {
    return path.join(this.getDataDir(), "meeting-store.json");
  }

  getMeetingDigestPath(): string {
    return path.join(this.getDataDir(), "meeting-digest.md");
  }

  getClassificationCachePath(): string {
    return path.join(this.getDataDir(), "classification-cache.json");
  }

  getNextActionsPath(): string {
    return path.join(this.getDataDir(), "next-actions.json");
  }

  getPromptConfigPath(): string {
    return path.join(this.paths.globalStoragePath, "prompt-config.json");
  }

  getReplyTemplatePath(): string {
    return path.join(this.paths.globalStoragePath, REPLY_TEMPLATE_FILE_NAME);
  }

  getLegacyReplyTemplatePath(): string {
    return path.join(this.paths.globalStoragePath, LEGACY_REPLY_TEMPLATE_FILE_NAME);
  }

  getLogDir(): string {
    return path.join(this.paths.globalStoragePath, "logs");
  }

  async ensureConfig(): Promise<void> {
    await fs.promises.mkdir(this.paths.globalStoragePath, { recursive: true });
    if (!fs.existsSync(this.getConfigPath())) {
      const defaults = path.join(this.paths.extensionPath, "default-config.json");
      await fs.promises.copyFile(defaults, this.getConfigPath());
    }
    if (!fs.existsSync(this.getPromptConfigPath())) {
      const defaults = path.join(this.paths.extensionPath, "prompts", "prompt-config.default.json");
      await fs.promises.copyFile(defaults, this.getPromptConfigPath());
    }
    if (!fs.existsSync(this.getReplyTemplatePath())) {
      if (fs.existsSync(this.getLegacyReplyTemplatePath())) {
        await fs.promises.copyFile(this.getLegacyReplyTemplatePath(), this.getReplyTemplatePath());
      } else {
        const defaults = path.join(this.paths.extensionPath, "prompts", REPLY_TEMPLATE_FILE_NAME);
        await fs.promises.copyFile(defaults, this.getReplyTemplatePath());
      }
    }
  }

  async readReplyTemplate(log: (event: string, data: Record<string, unknown>) => Promise<void>): Promise<string> {
    await this.ensureConfig();
    const template = await fs.promises.readFile(this.getReplyTemplatePath(), "utf8");
    const missing = validateReplyTemplate(template);
    if (missing.length) {
      await log("replyTemplate:missingPlaceholders", { missing });
      throw new Error(`Reply template is missing required placeholder(s): ${missing.map((key) => `{{${key}}}`).join(", ")}`);
    }
    return template;
  }

  async readDefaults(): Promise<Record<string, unknown>> {
    return JSON.parse(await fs.promises.readFile(path.join(this.paths.extensionPath, "default-config.json"), "utf8"));
  }

  async readConfig(): Promise<Record<string, unknown>> {
    await this.ensureConfig();
    try {
      return JSON.parse(await fs.promises.readFile(this.getConfigPath(), "utf8"));
    } catch {
      return {};
    }
  }

  async writeConfig(config: Record<string, unknown>): Promise<void> {
    await fs.promises.writeFile(this.getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  async readIgnoredIds(): Promise<string[]> {
    if (!fs.existsSync(this.getIgnoredPath())) {
      return [];
    }
    try {
      return JSON.parse(await fs.promises.readFile(this.getIgnoredPath(), "utf8"));
    } catch {
      return [];
    }
  }

  async writeIgnoredIds(ids: string[]): Promise<void> {
    await fs.promises.writeFile(this.getIgnoredPath(), JSON.stringify(ids, null, 2), "utf8");
  }

  async readModelInfo(): Promise<Record<string, unknown>> {
    if (!fs.existsSync(this.getModelInfoPath())) {
      return {};
    }
    try {
      return JSON.parse(await fs.promises.readFile(this.getModelInfoPath(), "utf8"));
    } catch {
      return {};
    }
  }

  async writeModelInfo(info: Record<string, unknown>): Promise<void> {
    await fs.promises.writeFile(this.getModelInfoPath(), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  }

  async readCachedAvailableModels(
    cache: AvailableModel[] | null,
    log: (event: string, data: Record<string, unknown>) => Promise<void>
  ): Promise<AvailableModel[]> {
    if (cache) {
      return cache;
    }
    if (!fs.existsSync(this.getAvailableModelsPath())) {
      return [];
    }
    try {
      const raw = JSON.parse(await fs.promises.readFile(this.getAvailableModelsPath(), "utf8"));
      return Array.isArray(raw.items)
        ? raw.items.map(normalizeAvailableModel).filter((item: AvailableModel) => item.id || item.family || item.name)
        : [];
    } catch (error) {
      await log("models:cacheReadError", { error: formatError(error) });
      return [];
    }
  }

  async writeAvailableModels(items: AvailableModel[]): Promise<void> {
    await fs.promises.writeFile(this.getAvailableModelsPath(), `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`, "utf8");
  }

  async readAnalysisResult(readConfig: () => Promise<Record<string, unknown>>): Promise<AnalysisResult> {
    if (!fs.existsSync(this.getAnalysisPath())) {
      return { generatedAt: "", overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] };
    }
    try {
      const config = await readConfig();
      const promptConfig = await this.readPromptConfig();
      return pruneAnalysisResult(
        normalizeAnalysis(JSON.parse(await fs.promises.readFile(this.getAnalysisPath(), "utf8")), allowedCategoryIds(promptConfig)),
        Number(config.analysisRetentionDays || 7),
        allowedCategoryIds(promptConfig)
      );
    } catch {
      return { generatedAt: "", overview: { totalMails: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] };
    }
  }

  async writeAnalysisResult(result: AnalysisResult): Promise<void> {
    await fs.promises.writeFile(this.getAnalysisPath(), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  async readThreadAnalysisResult(): Promise<ThreadAnalysisResult> {
    if (!fs.existsSync(this.getThreadAnalysisPath())) {
      return { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] };
    }
    try {
      const promptConfig = await this.readPromptConfig();
      return normalizeThreadAnalysis(
        JSON.parse(await fs.promises.readFile(this.getThreadAnalysisPath(), "utf8")),
        allowedCategoryIds(promptConfig)
      );
    } catch {
      return { generatedAt: "", overview: { totalThreads: 0, mustHandleToday: 0, risks: 0, waitingForMe: 0, notices: 0 }, items: [] };
    }
  }

  async writeThreadAnalysisResult(result: ThreadAnalysisResult): Promise<void> {
    await fs.promises.writeFile(this.getThreadAnalysisPath(), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  async readMailStore(): Promise<MailStore> {
    if (!fs.existsSync(this.getMailStorePath())) {
      return emptyMailStore();
    }
    try {
      return normalizeMailStore(JSON.parse(await fs.promises.readFile(this.getMailStorePath(), "utf8")));
    } catch {
      return emptyMailStore();
    }
  }

  async writeMailStore(store: MailStore): Promise<void> {
    await fs.promises.writeFile(this.getMailStorePath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async readMailIndex(): Promise<MailIndex> {
    if (!fs.existsSync(this.getMailIndexPath())) {
      return emptyMailIndex();
    }
    try {
      return normalizeMailIndex(JSON.parse(await fs.promises.readFile(this.getMailIndexPath(), "utf8")));
    } catch {
      return emptyMailIndex();
    }
  }

  async writeMailIndex(index: MailIndex): Promise<void> {
    await fs.promises.writeFile(this.getMailIndexPath(), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }

  async readThreadStore(): Promise<ThreadStore> {
    if (!fs.existsSync(this.getThreadStorePath())) {
      return emptyThreadStore();
    }
    try {
      return normalizeThreadStore(JSON.parse(await fs.promises.readFile(this.getThreadStorePath(), "utf8")));
    } catch {
      return emptyThreadStore();
    }
  }

  async writeThreadStore(store: ThreadStore): Promise<void> {
    await fs.promises.writeFile(this.getThreadStorePath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async readMeetingStore(): Promise<MeetingStore> {
    if (!fs.existsSync(this.getMeetingStorePath())) {
      return emptyMeetingStore();
    }
    try {
      return normalizeMeetingStore(JSON.parse(await fs.promises.readFile(this.getMeetingStorePath(), "utf8")));
    } catch {
      return emptyMeetingStore();
    }
  }

  async writeMeetingStore(store: MeetingStore): Promise<void> {
    await fs.promises.writeFile(this.getMeetingStorePath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async readClassificationCache(): Promise<ClassificationCache> {
    if (!fs.existsSync(this.getClassificationCachePath())) {
      return normalizeClassificationCache({});
    }
    try {
      return normalizeClassificationCache(JSON.parse(await fs.promises.readFile(this.getClassificationCachePath(), "utf8")));
    } catch {
      return normalizeClassificationCache({});
    }
  }

  async writeClassificationCache(cache: ClassificationCache): Promise<void> {
    await fs.promises.writeFile(this.getClassificationCachePath(), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  }

  async readPromptConfig(): Promise<PromptConfig> {
    await this.ensureConfig();
    try {
      return normalizePromptConfig(JSON.parse(await fs.promises.readFile(this.getPromptConfigPath(), "utf8")));
    } catch {
      return normalizePromptConfig({});
    }
  }

  async readNextActions(): Promise<NextActionsStore> {
    if (!fs.existsSync(this.getNextActionsPath())) {
      return { items: [] };
    }
    try {
      return normalizeNextActionsStore(JSON.parse(await fs.promises.readFile(this.getNextActionsPath(), "utf8")));
    } catch {
      return { items: [] };
    }
  }

  async writeNextActions(store: NextActionsStore): Promise<void> {
    await fs.promises.writeFile(this.getNextActionsPath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async importDigestIfStoreMissing(): Promise<void> {
    const store = await this.readMailStore();
    if (store.items.length || !fs.existsSync(this.getDigestPath())) {
      return;
    }
    const digest = parseDigest(await fs.promises.readFile(this.getDigestPath(), "utf8"));
    const merge = mergeDigestIntoStore(store, digest);
    await this.writeMailStore(merge.store);
    await this.writeThreadStore(mergeThreadStores(await this.readThreadStore(), buildThreadStore(merge.store.items)));
    await this.writeClassificationCache(ensureClassifications(merge.store.items, await this.readClassificationCache()));
  }
}
