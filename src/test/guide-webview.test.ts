import test from "node:test";
import assert from "node:assert/strict";
import { renderEasyMailGuideHtml } from "../lib/guide-webview";

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
  assert.match(html, /重点发件人按 prompt 语义由模型判断，建议同时填写显示名和邮箱。/);
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

  assert.match(html, /Version &lt;bad&gt;/);
  assert.doesNotMatch(html, /Version <bad>/);
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
