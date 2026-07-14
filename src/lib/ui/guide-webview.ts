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
  completedOnboardingStepIds?: string[];
};

type GuideAction = {
  id: string;
  label: string;
  primary?: boolean;
};

type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  detail: string;
  action: GuideAction;
  completeLabel: string;
  optional?: boolean;
};

type GuideLabels = {
  title: string;
  subtitle: string;
  statsTitle: string;
  firstUseTitle: string;
  firstUseSubtitle: string;
  progress: (completed: number, total: number) => string;
  complete: string;
  completeLabel: string;
  referenceTitle: string;
  sections: Array<{ id: string; title: string; items: string[] }>;
  cards: Array<{ value: string; label: string; hint: string }>;
  actions: GuideAction[];
  steps: OnboardingStep[];
  footer: string;
};

export function renderEasyMailGuideHtml(options: EasyMailGuideOptions, nonce: string): string {
  const labels = buildGuideLabels(options);
  const completedSteps = new Set(options.completedOnboardingStepIds || []);
  const completedCount = labels.steps.filter((step) => completedSteps.has(step.id)).length;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeAttr(nonce)}'; img-src data:;" />
  <style>
    :root {
      color-scheme: light dark;
      --guide-accent: var(--vscode-focusBorder, var(--vscode-charts-blue));
      --guide-success: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen));
      --guide-muted: var(--vscode-descriptionForeground);
      --guide-surface: var(--vscode-editorWidget-background);
      --guide-border: var(--vscode-panel-border);
    }
    body {
      margin: 0;
      font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; }
    nav {
      padding: 28px 16px;
      border-right: 1px solid var(--guide-border);
      background: var(--vscode-sideBar-background);
    }
    nav h2 { margin: 0 8px 24px; font-size: 18px; letter-spacing: -0.01em; }
    nav h3 { margin: 22px 8px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--guide-muted); }
    nav a {
      display: block;
      padding: 7px 8px;
      margin: 2px 0;
      border-radius: 5px;
      color: var(--vscode-foreground);
      text-decoration: none;
    }
    nav a:hover, nav a:focus-visible { background: var(--vscode-list-hoverBackground); outline: none; }
    main { box-sizing: border-box; max-width: 1080px; padding: 42px 46px 54px; }
    .eyebrow { margin: 0 0 10px; color: var(--guide-accent); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .hero { max-width: 780px; }
    .hero h1 { margin: 0; font-size: 34px; letter-spacing: -0.03em; line-height: 1.1; }
    .hero p { margin: 14px 0 0; color: var(--guide-muted); font-size: 15px; line-height: 1.65; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 28px 0 36px; }
    .stat { border-top: 2px solid var(--guide-border); padding: 13px 2px 0; }
    .stat strong { display: block; font-size: 28px; line-height: 1; margin-bottom: 7px; }
    .stat span { display: block; font-size: 13px; font-weight: 700; }
    .stat small { display: block; color: var(--guide-muted); margin-top: 3px; }
    section { margin: 38px 0; }
    section h2 { margin: 0; font-size: 21px; letter-spacing: -0.02em; }
    .section-intro { margin: 8px 0 16px; color: var(--guide-muted); line-height: 1.55; }
    .onboarding { border-top: 1px solid var(--guide-border); padding-top: 28px; }
    .progress-row { display: flex; align-items: center; gap: 10px; margin: 14px 0 18px; color: var(--guide-muted); font-size: 13px; }
    .progress-track { flex: 0 1 180px; height: 4px; overflow: hidden; border-radius: 4px; background: var(--vscode-progressBar-background, var(--guide-border)); }
    .progress-track span { display: block; height: 100%; background: var(--guide-accent); }
    .step-list { display: grid; gap: 10px; }
    .onboarding-step {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 13px;
      padding: 17px 18px;
      border: 1px solid var(--guide-border);
      border-left: 3px solid var(--guide-border);
      border-radius: 7px;
      background: var(--guide-surface);
    }
    .onboarding-step.is-complete { border-left-color: var(--guide-success); }
    .step-index {
      display: grid;
      width: 28px;
      height: 28px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--guide-accent);
      border-radius: 50%;
      color: var(--guide-accent);
      font-size: 12px;
      font-weight: 700;
    }
    .is-complete .step-index { border-color: var(--guide-success); color: var(--guide-success); }
    .step-heading { display: flex; align-items: center; gap: 9px; }
    .step-heading h3 { margin: 0; font-size: 15px; }
    .step-status { color: var(--guide-success); font-size: 12px; font-weight: 700; }
    .optional { color: var(--guide-muted); font-size: 12px; font-weight: 600; }
    .onboarding-step p { margin: 7px 0 0; line-height: 1.5; }
    .onboarding-step .detail { color: var(--guide-muted); font-size: 13px; }
    .step-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 13px; }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 5px;
      padding: 7px 11px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.quiet { color: var(--vscode-textLink-foreground); background: transparent; padding-left: 3px; }
    button.quiet:hover { color: var(--vscode-textLink-activeForeground); background: var(--vscode-list-hoverBackground); }
    button:focus-visible, a:focus-visible { outline: 1px solid var(--guide-accent); outline-offset: 2px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .guide-card { border: 1px solid var(--guide-border); border-radius: 7px; padding: 16px 18px; background: var(--guide-surface); }
    ul { margin: 0; padding-left: 20px; line-height: 1.7; }
    .footer { margin-top: 42px; color: var(--guide-muted); font-size: 12px; }
    @media (max-width: 760px) {
      .layout { grid-template-columns: 1fr; }
      nav { border-right: 0; border-bottom: 1px solid var(--guide-border); }
      main { padding: 30px 18px 42px; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav>
      <h2>EasyMail</h2>
      <h3>${escapeHtml(labels.firstUseTitle)}</h3>
      <a href="#first-use">${escapeHtml(labels.firstUseTitle)}</a>
      <h3>${escapeHtml(labels.statsTitle)}</h3>
      <a href="#impact">${escapeHtml(labels.statsTitle)}</a>
      <h3>${escapeHtml(labels.referenceTitle)}</h3>
      ${labels.sections.map((section) => `<a href="#${escapeAttr(section.id)}">${escapeHtml(section.title)}</a>`).join("")}
    </nav>
    <main>
      <div class="hero">
        <div class="eyebrow">EasyMail ${escapeHtml(options.version)}</div>
        <h1>${escapeHtml(labels.title)}</h1>
        <p>${escapeHtml(labels.subtitle)}</p>
      </div>
      <section id="first-use" class="onboarding">
        <h2>${escapeHtml(labels.firstUseTitle)}</h2>
        <p class="section-intro">${escapeHtml(labels.firstUseSubtitle)}</p>
        <div class="progress-row"><strong>${escapeHtml(labels.progress(completedCount, labels.steps.length))}</strong><div class="progress-track" aria-hidden="true"><span style="width: ${(completedCount / labels.steps.length) * 100}%"></span></div></div>
        <div class="step-list">
          ${labels.steps.map((step, index) => {
            const complete = completedSteps.has(step.id);
            return `<article class="onboarding-step${complete ? " is-complete" : ""}" data-step-id="${escapeAttr(step.id)}" data-complete="${complete}">
              <div class="step-index">${complete ? "✓" : index + 1}</div>
              <div>
                <div class="step-heading"><h3>${escapeHtml(step.title)}</h3>${step.optional ? `<span class="optional">${escapeHtml(labels.completeLabel)}</span>` : ""}${complete ? `<span class="step-status">${escapeHtml(labels.complete)}</span>` : ""}</div>
                <p>${escapeHtml(step.description)}</p>
                <p class="detail">${escapeHtml(step.detail)}</p>
                ${complete ? "" : `<div class="step-actions"><button type="button" data-action="${escapeAttr(step.action.id)}">${escapeHtml(step.action.label)}</button><button class="quiet" type="button" data-action="completeOnboardingStep" data-step-id="${escapeAttr(step.id)}">${escapeHtml(step.completeLabel)}</button></div>`}
              </div>
            </article>`;
          }).join("")}
        </div>
      </section>
      <div id="impact" class="stats">
        ${labels.cards.map((card) => `<div class="stat"><strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span><small>${escapeHtml(card.hint)}</small></div>`).join("")}
      </div>
      <section id="actions">
        <h2>${escapeHtml(options.locale === "zh-CN" ? "其他常用动作" : "Other Common Actions")}</h2>
        <div class="actions">
          ${labels.actions.map((action) => `<button class="${action.primary ? "" : "secondary"}" type="button" data-action="${escapeAttr(action.id)}">${escapeHtml(action.label)}</button>`).join("")}
        </div>
      </section>
      ${labels.sections.map((section) => `<section id="${escapeAttr(section.id)}"><h2>${escapeHtml(section.title)}</h2><div class="guide-card"><ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></section>`).join("")}
      <div class="footer">${escapeHtml(labels.footer)}</div>
    </main>
  </div>
  <script nonce="${escapeAttr(nonce)}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!button) {
        return;
      }
      vscode.postMessage({
        type: 'guideAction',
        action: button.getAttribute('data-action') || '',
        stepId: button.getAttribute('data-step-id') || ''
      });
    });
  </script>
</body>
</html>`;
}

function buildGuideLabels(options: EasyMailGuideOptions): GuideLabels {
  if (options.locale === "zh-CN") {
    return {
      title: "从第一封邮件开始，建立自己的处理节奏",
      subtitle: "EasyMail 在本地读取 classic Outlook 邮件，再用 Copilot 协助分类、摘要、回复草稿和线程分析。它保持只读：不会自动发送、删除、移动、归档或标记邮件。",
      statsTitle: "当前状态",
      firstUseTitle: "首次使用",
      firstUseSubtitle: "按顺序完成即可开始；偏好设置不必现在决定，跳过同样会记为完成，之后随时可在 Settings 修改。",
      progress: (completed, total) => `${completed} / ${total} 已完成`,
      complete: "已完成",
      completeLabel: "可稍后设置",
      referenceTitle: "参考",
      cards: [
        { value: String(options.stats.pulled), label: "已拉取", hint: "来自本地索引" },
        { value: String(options.stats.pending), label: "待分析", hint: "可手动选择或批量分析" },
        { value: String(options.stats.analysed), label: "已分析", hint: "来自本地分析结果" },
        { value: String(options.stats.threads), label: "邮件线程", hint: "仅显示多邮件线程" }
      ],
      steps: [
        { id: "sample", title: "先体验：加载示例数据", description: "无需真实 Outlook 数据，先认识分类、阅读和分析界面。", detail: "它不会读取或改动你的邮箱；加载后可在 Sidebar 查看示例队列。", action: { id: "sampleDigest", label: "加载示例数据" }, completeLabel: "完成此步" },
        { id: "models", title: "连接 Copilot", description: "加载当前 VS Code 会话可用的 Copilot Chat 模型。", detail: "加载后，在 Sidebar 顶部选择用于分析的模型。", action: { id: "loadModels", label: "加载 Copilot 模型" }, completeLabel: "完成此步" },
        { id: "folders", title: "选择 Outlook 文件夹", description: "决定 EasyMail 从哪些邮箱文件夹收取邮件。", detail: "建议先启动 Outlook；选择结果会写入 VS Code Settings，之后仍可调整。", action: { id: "selectFolders", label: "选择 Outlook 文件夹" }, completeLabel: "完成此步" },
        { id: "settings", title: "可选：设定你的偏好", description: "重点/忽略发件人、关键词安全规则和保留期都可以晚些再决定。", detail: "不确定就直接完成此步；这些选项不会阻止你收取、查看或分析邮件。", action: { id: "openSettings", label: "打开设置" }, completeLabel: "可稍后设置", optional: true },
        { id: "firstRun", title: "开始第一次真实收取", description: "文件夹和模型准备好后，从 Outlook 拉取邮件并开始处理。", detail: "收取完成后，在 Sidebar 选择队列项目，再按需要分析下一批或选中邮件。", action: { id: "pullMail", label: "获取新邮件" }, completeLabel: "完成此步" }
      ],
      actions: [
        { id: "openDashboard", label: "打开 Dashboard", primary: true },
        { id: "openPromptConfig", label: "编辑 Prompt 分类" },
        { id: "openReplyTemplate", label: "打开回复模板" }
      ],
      sections: [
        { id: "overview", title: "工作流概览", items: ["先获取新邮件或加载示例数据，邮件进入本地待分析队列。", "选择 Copilot 模型后，可以分析下一批、分析选中或分析全部允许项。", "分析结果进入分类面板；线程视图用于跨邮件阅读和线程级分析。"] },
        { id: "setup", title: "配置说明", items: ["VS Code Settings 是唯一配置来源；文件夹建议通过选择 Outlook 文件夹命令加载，手写仍可用。", "重点和忽略发件人、关键词安全规则与保留期都在 Settings 中配置，可随时补充或修改。", "模型列表不会自动刷新，点击加载模型后会缓存到本机，直到你再次手动加载。", "如果 Outlook COM 不可用，先用示例数据验证插件和 Copilot 路径。"] },
        { id: "privacy", title: "隐私与只读边界", items: ["插件不会解析 PST/OST，也不会写回 Outlook。", "原始邮件正文只进入短期本地队列；分析结果和索引用保留期控制。", "高密级或阻断项不会自动进入模型，需要用户明确处理。"] },
        { id: "troubleshooting", title: "排查", items: ["按钮无反应时，先执行 Reload Window，再打开本指南确认命令是否仍可触发。", "模型为空时，点击加载 Copilot 模型；如果仍为空，检查 VS Code Copilot Chat 是否可用。", "分析内容的语言是生成时固定的；切换 UI 语言不会自动重写既有分析。"] }
      ],
      footer: "首次使用进度保存在本机 VS Code 用户配置中；本指南由 EasyMail Webview 渲染，不依赖原生 walkthrough 是否自动弹出。"
    };
  }

  return {
    title: "Start with one message. Build your own rhythm.",
    subtitle: "EasyMail collects classic Outlook mail locally, then uses Copilot for triage, summaries, draft replies, and thread analysis. It stays read-only: it never sends, deletes, moves, archives, or marks Outlook messages.",
    statsTitle: "Current Status",
    firstUseTitle: "Getting Started",
    firstUseSubtitle: "Follow the steps in order. Preferences do not need a decision today; skipping them also completes the step, and you can change them later in Settings.",
    progress: (completed, total) => `${completed} / ${total} complete`,
    complete: "Complete",
    completeLabel: "Set up later",
    referenceTitle: "Reference",
    cards: [
      { value: String(options.stats.pulled), label: "Pulled", hint: "From the local index" },
      { value: String(options.stats.pending), label: "Pending", hint: "Ready for manual or batch analysis" },
      { value: String(options.stats.analysed), label: "Analysed", hint: "From local analysis results" },
      { value: String(options.stats.threads), label: "Threads", hint: "Multi-message threads only" }
    ],
    steps: [
      { id: "sample", title: "Try it first: load sample data", description: "Explore triage, reading, and analysis without real Outlook data.", detail: "It never reads or changes your mailbox; sample messages appear in the Sidebar queue.", action: { id: "sampleDigest", label: "Load Sample Data" }, completeLabel: "Complete this step" },
      { id: "models", title: "Connect Copilot", description: "Load Copilot Chat models available to this VS Code session.", detail: "Then select the model used for analysis at the top of the Sidebar.", action: { id: "loadModels", label: "Load Copilot Models" }, completeLabel: "Complete this step" },
      { id: "folders", title: "Select Outlook folders", description: "Choose the mailbox folders that EasyMail will collect from.", detail: "Starting Outlook first is recommended. Your choices are saved in VS Code Settings and can be changed later.", action: { id: "selectFolders", label: "Select Outlook Folders" }, completeLabel: "Complete this step" },
      { id: "settings", title: "Optional: set your preferences", description: "Important or ignored senders, security keywords, and retention can wait until you know what you need.", detail: "If unsure, complete this step now. None of these options block collection, reading, or analysis.", action: { id: "openSettings", label: "Open Settings" }, completeLabel: "Set up later", optional: true },
      { id: "firstRun", title: "Run your first real collection", description: "With folders and a model ready, collect from Outlook and start processing mail.", detail: "When collection finishes, choose a queue item in the Sidebar and analyze the next batch or selected mail as needed.", action: { id: "pullMail", label: "Fetch New Mail" }, completeLabel: "Complete this step" }
    ],
    actions: [
      { id: "openDashboard", label: "Open Dashboard", primary: true },
      { id: "openPromptConfig", label: "Edit Prompt Categories" },
      { id: "openReplyTemplate", label: "Open Reply Template" }
    ],
    sections: [
      { id: "overview", title: "Workflow Overview", items: ["Fetch new mail or load sample data first; messages enter the local pending queue.", "After selecting a Copilot model, analyze the next batch, selected mails, or all allowed mails.", "Analysis results appear in category panels; the thread view is for cross-message reading and thread-level analysis."] },
      { id: "setup", title: "Configuration", items: ["VS Code Settings are the single source of truth. Use Select Outlook Folders to load folder choices; manual entry remains available.", "Configure important and ignored senders, keyword safety rules, and retention in Settings whenever they become useful.", "Model discovery is manual and cached locally until you click Load Copilot Models again.", "If Outlook COM is unavailable, use sample data to validate the extension and Copilot path first."] },
      { id: "privacy", title: "Privacy and Read-only Boundaries", items: ["EasyMail does not parse PST/OST files and does not write back to Outlook.", "Original mail body content stays in the short-lived local queue; analysis and index data are controlled by retention settings.", "Blocked or high-sensitivity items do not enter the model automatically."] },
      { id: "troubleshooting", title: "Troubleshooting", items: ["If a button appears stuck, run Reload Window, then reopen this guide to confirm commands still fire.", "If the model list is empty, click Load Copilot Models and confirm GitHub Copilot Chat works in VS Code.", "Analysis language is fixed when generated; changing UI language does not rewrite existing analysis."] }
    ],
    footer: "Getting-started progress is stored in your local VS Code user profile. This guide is rendered by the EasyMail webview and does not depend on VS Code's native walkthrough auto-open behavior."
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
