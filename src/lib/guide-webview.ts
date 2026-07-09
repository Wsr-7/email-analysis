export type GuideLocale = "zh-CN" | "en-US";

export type EasyMailGuideStats = {
  pulled: number;
  pending: number;
  analysed: number;
  threads: number;
};

export type EasyMailGuideOptions = {
  locale: GuideLocale;
  version: string;
  stats: EasyMailGuideStats;
};

type GuideLabels = {
  title: string;
  subtitle: string;
  statsTitle: string;
  sections: Array<{ id: string; title: string; items: string[] }>;
  cards: Array<{ value: string; label: string; hint: string }>;
  actions: Array<{ id: string; label: string; description: string; primary?: boolean }>;
  footer: string;
};

export function renderEasyMailGuideHtml(options: EasyMailGuideOptions): string {
  const labels = buildGuideLabels(options);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
    nav {
      padding: 28px 18px;
      border-right: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    nav h2 { margin: 0 0 22px; font-size: 18px; }
    nav h3 { margin: 22px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
    nav a {
      display: block;
      padding: 7px 8px;
      margin: 2px 0;
      border-radius: 6px;
      color: var(--vscode-foreground);
      text-decoration: none;
    }
    nav a:hover { background: var(--vscode-list-hoverBackground); }
    main { padding: 36px 44px 52px; max-width: 1100px; }
    .hero h1 { margin: 0; font-size: 34px; line-height: 1.12; }
    .hero p { max-width: 760px; color: var(--vscode-descriptionForeground); font-size: 15px; line-height: 1.6; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 26px 0 34px; }
    .stat {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 18px;
      background: var(--vscode-editorWidget-background);
    }
    .stat strong { display: block; font-size: 30px; line-height: 1; margin-bottom: 8px; }
    .stat span { display: block; font-weight: 700; }
    .stat small { display: block; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    section { margin: 30px 0; }
    section h2 { margin: 0 0 12px; font-size: 22px; }
    .card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .guide-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 16px;
      background: var(--vscode-editorWidget-background);
    }
    .guide-card h3 { margin: 0 0 8px; font-size: 15px; }
    .guide-card p { margin: 0; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    button {
      width: 100%;
      text-align: left;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 8px;
      padding: 12px 14px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button strong { display: block; margin-bottom: 4px; }
    button span { display: block; opacity: 0.9; line-height: 1.35; }
    ul { margin: 0; padding-left: 20px; line-height: 1.7; }
    .footer { margin-top: 36px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    @media (max-width: 760px) {
      .layout { grid-template-columns: 1fr; }
      nav { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
      main { padding: 26px 18px 40px; }
      .stats, .card-grid, .actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav>
      <h2>Easy Mail</h2>
      <h3>${escapeHtml(labels.statsTitle)}</h3>
      <a href="#impact">${escapeHtml(labels.statsTitle)}</a>
      <h3>${escapeHtml(labels.sections[0].title)}</h3>
      ${labels.sections.map((section) => `<a href="#${escapeAttr(section.id)}">${escapeHtml(section.title)}</a>`).join("")}
    </nav>
    <main>
      <div class="hero">
        <h1>${escapeHtml(labels.title)}</h1>
        <p>${escapeHtml(labels.subtitle)}</p>
      </div>
      <div id="impact" class="stats">
        ${labels.cards.map((card) => `<div class="stat"><strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span><small>${escapeHtml(card.hint)}</small></div>`).join("")}
      </div>
      <section id="actions">
        <h2>${escapeHtml(options.locale === "zh-CN" ? "常用动作" : "Common Actions")}</h2>
        <div class="actions">
          ${labels.actions.map((action) => `<button class="${action.primary ? "" : "secondary"}" type="button" data-action="${escapeAttr(action.id)}"><strong>${escapeHtml(action.label)}</strong><span>${escapeHtml(action.description)}</span></button>`).join("")}
        </div>
      </section>
      ${labels.sections.map((section) => `<section id="${escapeAttr(section.id)}"><h2>${escapeHtml(section.title)}</h2><div class="guide-card"><ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></section>`).join("")}
      <div class="footer">${escapeHtml(labels.footer)}</div>
    </main>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!button) {
        return;
      }
      vscode.postMessage({ type: 'guideAction', action: button.getAttribute('data-action') || '' });
    });
  </script>
</body>
</html>`;
}

function buildGuideLabels(options: EasyMailGuideOptions): GuideLabels {
  if (options.locale === "zh-CN") {
    return {
      title: "Easy Mail 使用指南",
      subtitle: `本地读取 classic Outlook 邮件，用 Copilot 做分类、摘要、回复草稿和线程分析。当前版本 ${options.version}，插件保持只读：不会自动发送、删除、移动、归档或标记邮件。`,
      statsTitle: "当前状态",
      cards: [
        { value: String(options.stats.pulled), label: "已拉取", hint: "来自本地索引" },
        { value: String(options.stats.pending), label: "待分析", hint: "可手动选择或批量分析" },
        { value: String(options.stats.analysed), label: "已分析", hint: "来自本地分析结果" },
        { value: String(options.stats.threads), label: "邮件线程", hint: "仅显示多邮件线程" }
      ],
      actions: [
        { id: "openDashboard", label: "打开 Dashboard", description: "回到邮件分类、线程和分析结果面板。", primary: true },
        { id: "pullMail", label: "获取新邮件", description: "按当前 VS Code Settings 从 Outlook 拉取新邮件。" },
        { id: "sampleDigest", label: "加载示例数据", description: "不用真实 Outlook 数据，快速验证界面和分析流程。" },
        { id: "loadModels", label: "加载 Copilot 模型", description: "手动读取当前 VS Code 可用的 Copilot Chat 模型。" },
        { id: "openSettings", label: "打开设置", description: "配置范围、文件夹、批大小、保留期和模型默认值。" },
        { id: "openPromptConfig", label: "Prompt 分类配置", description: "调整邮件分类、重点发件人和分类规则。" },
        { id: "openReplyTemplate", label: "打开回复模板", description: "Edit reply-template.md to control draft structure with fixed placeholders." }
      ],
      sections: [
        {
          id: "overview",
          title: "工作流概览",
          items: [
            "先获取新邮件或加载示例数据，邮件进入本地待分析队列。",
            "选择 Copilot 模型后，可以分析下一批、分析选中或分析全部允许项。",
            "分析结果进入分类面板，线程视图只负责跨邮件阅读和线程级分析。"
          ]
        },
        {
          id: "setup",
          title: "配置建议",
          items: [
            "VS Code Settings 是唯一配置来源，Dashboard 内设置会自动同步到 Settings。",
            "模型列表不会自动刷新，点击加载模型后会缓存到本机，直到你再次手动加载。",
            "如果 Outlook COM 不可用，先用示例数据验证插件和 Copilot 路径。"
          ]
        },
        {
          id: "privacy",
          title: "隐私与只读边界",
          items: [
            "插件不会解析 PST/OST，也不会写回 Outlook。",
            "原始邮件正文只进入短期本地队列；分析结果和索引用保留期控制。",
            "高密级或阻断项不会自动进入模型，需要用户明确处理。"
          ]
        },
        {
          id: "troubleshooting",
          title: "排查",
          items: [
            "按钮无反应时，先执行 Reload Window，再打开本指南确认命令是否仍可触发。",
            "模型为空时，点击加载 Copilot 模型；如果仍为空，检查 VS Code Copilot Chat 是否可用。",
            "分析内容的语言是生成时固定的；切换 UI 语言不会自动重写既有分析。"
          ]
        }
      ],
      footer: "Easy Mail Guide 使用插件内置 webview 渲染，因此不依赖 VS Code 原生 walkthrough 是否自动弹出。"
    };
  }

  return {
    title: "Easy Mail User Guide",
    subtitle: `Collect classic Outlook mail locally, then use Copilot for triage, summaries, draft replies, and thread analysis. Version ${options.version}. Easy Mail is read-only: it does not send, delete, move, archive, or mark Outlook messages.`,
    statsTitle: "Current Status",
    cards: [
      { value: String(options.stats.pulled), label: "Pulled", hint: "From the local index" },
      { value: String(options.stats.pending), label: "Pending", hint: "Ready for manual or batch analysis" },
      { value: String(options.stats.analysed), label: "Analysed", hint: "From local analysis results" },
      { value: String(options.stats.threads), label: "Threads", hint: "Multi-message threads only" }
    ],
    actions: [
      { id: "openDashboard", label: "Open Dashboard", description: "Return to mail categories, threads, and analysis results.", primary: true },
      { id: "pullMail", label: "Fetch New Mail", description: "Collect Outlook mail using the current VS Code Settings." },
      { id: "sampleDigest", label: "Load Sample Data", description: "Validate the UI and analysis path without real Outlook data." },
      { id: "loadModels", label: "Load Copilot Models", description: "Manually read Copilot Chat models exposed by this VS Code session." },
      { id: "openSettings", label: "Open Settings", description: "Configure range, folders, batch size, retention, and model defaults." },
      { id: "openPromptConfig", label: "Prompt Categories", description: "Adjust categories, important senders, and classification rules." },
      { id: "openReplyTemplate", label: "Open Reply Template", description: "Edit reply-template.md to control draft structure with fixed placeholders." }
    ],
    sections: [
      {
        id: "overview",
        title: "Workflow Overview",
        items: [
          "Fetch new mail or load sample data first; messages enter the local pending queue.",
          "After selecting a Copilot model, analyze the next batch, selected mails, or all allowed mails.",
          "Analysis results appear in category panels; the thread view is for cross-message reading and thread-level analysis."
        ]
      },
      {
        id: "setup",
        title: "Setup",
        items: [
          "VS Code Settings are the single source of truth. Dashboard controls auto-sync to Settings.",
          "Model discovery is manual and cached locally until you click Load Copilot Models again.",
          "If Outlook COM is unavailable, use sample data to validate the extension and Copilot path first."
        ]
      },
      {
        id: "privacy",
        title: "Privacy and Read-only Boundaries",
        items: [
          "Easy Mail does not parse PST/OST files and does not write back to Outlook.",
          "Original mail body content stays in the short-lived local queue; analysis and index data are controlled by retention settings.",
          "Blocked or high-sensitivity items do not enter the model automatically."
        ]
      },
      {
        id: "troubleshooting",
        title: "Troubleshooting",
        items: [
          "If a button appears stuck, run Reload Window, then reopen this guide to confirm commands still fire.",
          "If the model list is empty, click Load Copilot Models and confirm GitHub Copilot Chat works in VS Code.",
          "Analysis language is fixed when generated; changing UI language does not rewrite existing analysis."
        ]
      }
    ],
    footer: "The Easy Mail Guide is rendered by the extension webview, so it does not depend on VS Code's native walkthrough auto-open behavior."
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
