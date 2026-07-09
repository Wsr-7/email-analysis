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
  });

  assert.match(html, /Easy Mail 使用指南/);
  assert.match(html, /data-action="openDashboard"/);
  assert.match(html, /data-action="loadModels"/);
  assert.match(html, /guideAction/);
  assert.match(html, />4<\/strong>/);
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
  });

  assert.match(html, /Version &lt;bad&gt;/);
  assert.doesNotMatch(html, /Version <bad>/);
});
