import test from "node:test";
import assert from "node:assert/strict";
import { renderEasyMailGuideHtml } from "../lib/ui/guide-webview";

test("renderEasyMailGuideHtml renders guide content and command buttons", () => {
  const html = renderEasyMailGuideHtml({
    locale: "zh-CN",
    version: "0.2.0",
    stats: {
      pulled: 4,
      pending: 2,
      analysed: 1,
      threads: 3
    }
  }, "guide-test-nonce");

  assert.match(html, /EasyMail 使用指南/);
  assert.match(html, /data-action="openDashboard"/);
  assert.match(html, /data-action="loadModels"/);
  assert.match(html, /guideAction/);
  assert.match(html, />4<\/strong>/);
  assert.match(html, /重点和忽略发件人、关键词安全规则与保留期都在 Settings 中配置/);
  assert.match(html, /Prompt 分类决定模型可返回哪些邮件分类/);
  assert.match(html, /回复模板决定四个固定草稿段落在本地如何排版/);
});

test("renderEasyMailGuideHtml keeps the normal title and status above first use", () => {
  const html = renderEasyMailGuideHtml({
    locale: "zh-CN",
    version: "0.4.0",
    stats: { pulled: 1, pending: 2, analysed: 3, threads: 4 }
  }, "guide-test-nonce");

  assert.match(html, /EasyMail 使用指南/);
  assert.ok(html.indexOf('id="impact"') < html.indexOf('id="first-use"'));
});

test("renderEasyMailGuideHtml presents a first-use path and restores completed steps", () => {
  const html = renderEasyMailGuideHtml({
    locale: "zh-CN",
    version: "0.4.0",
    stats: { pulled: 0, pending: 0, analysed: 0, threads: 0 },
    completedOnboardingStepIds: ["sample", "settings"]
  }, "guide-test-nonce");

  assert.match(html, /首次使用/);
  assert.match(html, /加载示例数据/);
  assert.match(html, /选择 Outlook 文件夹/);
  assert.match(html, /可稍后设置/);
  assert.match(html, /2\s*\/\s*5/);
  assert.match(html, /data-step-id="sample"[^>]*data-complete="true"/);
  assert.match(html, /data-action="completeOnboardingStep"/);
});

test("renderEasyMailGuideHtml escapes dynamic values", () => {
  const html = renderEasyMailGuideHtml({
    locale: "en-US",
    version: "<bad>",
    stats: {
      pulled: 0,
      pending: 0,
      analysed: 0,
      threads: 0
    }
  }, "guide-test-nonce");

  assert.match(html, /EasyMail &lt;bad&gt;/);
  assert.doesNotMatch(html, /EasyMail <bad>/);
});

test("renderEasyMailGuideHtml uses a nonce CSP and no inline event handlers", () => {
  const options = {
    locale: "en-US" as const,
    version: "0.3.0",
    stats: { pulled: 0, pending: 0, analysed: 0, threads: 0 }
  };
  const first = renderEasyMailGuideHtml(options, "guide-nonce-1");
  const second = renderEasyMailGuideHtml(options, "guide-nonce-2");
  assert.match(first, /Content-Security-Policy/);
  assert.match(first, /script-src 'nonce-guide-nonce-1'/);
  assert.match(first, /<script nonce="guide-nonce-1">/);
  assert.doesNotMatch(first, /\son[a-z]+=/i);
  assert.notEqual(first, second);
});
