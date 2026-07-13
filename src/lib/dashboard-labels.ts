import type { Locale } from "./config-utils";
import type { PromptConfig } from "./prompt-config";

export type DashboardLabels = {
  toolbar: Record<"pullMail" | "loadMore" | "sample" | "analyze" | "analyzeSelected" | "analyzeAllAllowed" | "refresh" | "openDigest" | "openSummary" | "generateReports" | "openDailyBrief" | "openThreadReport" | "openSingleMailReport" | "settingsFile" | "promptConfig" | "clearStore" | "loadModels", string>;
  settings: {
    title: string;
    range: string;
    output: string;
    recentHours: string;
    maxItems: string;
    folders: string;
    bodyChars: string;
    bodyCharsHelp: string;
    modelFamily: string;
    noModel: string;
    modelsNotLoaded: string;
    batchSize: string;
    allowAnalyze: string;
    maxClassification: string;
    classificationPublic: string;
    classificationInternal: string;
    classificationRegistered: string;
    classificationHighRegistered: string;
    storeRetentionDays: string;
    indexRetentionDays: string;
    analysisRetentionDays: string;
    importantSenders: string;
    save: string;
    autoSaveNote: string;
    recentHoursOption: string;
    maxItemsOption: string;
    zhOption: string;
    enOption: string;
  };
  meta: Record<"range" | "folders" | "generated" | "requestedModel" | "lastUsedModel" | "lastPull" | "lastImport", string>;
  stats: Record<"pulled" | "pending" | "analysed" | "blocked" | "mustHandle" | "risk" | "waiting" | "notice" | "threads", string>;
  categories: Record<string, string>;
  card: Record<"from" | "to" | "cc" | "body" | "received" | "summary" | "reason" | "suggestedAction" | "copyDraft" | "draftHint" | "generateDraft" | "polish" | "refine" | "instructionPlaceholder" | "outlookActions" | "openReply" | "openReplyAll" | "openForward" | "ignore" | "restore" | "analyze" | "reanalyze" | "openInOutlook" | "noItems" | "thread", string>;
  pending: Record<"title" | "blockedTitle" | "classification" | "autoAllowed" | "manualRequired" | "gateBlocked" | "securityReason" | "select" | "confirmAnalyze", string>;
  threads: Record<"title" | "participants" | "messages" | "lastTime" | "folders" | "contentStatus" | "security" | "analysis" | "analyzeThread" | "spotlight" | "currentStatus" | "keyDecisions" | "openQuestions" | "actionItems" | "waitingOn" | "risks" | "needMyReply" | "suggestedAction" | "partialContext" | "yes" | "no" | "draftReply" | "timeline" | "contentTruncated" | "attachments" | "mailIds", string>;
  meetings: Record<"title" | "acceptedSchedule" | "organizer" | "time" | "location" | "attendees" | "requiredAttendees" | "optionalAttendees" | "status" | "allDay" | "recurring" | "openInOutlook" | "notResponded" | "accepted" | "tentative" | "declined" | "organizer_status", string>;
  nextActions: Record<"title" | "owner" | "task" | "deadline" | "source" | "markDone" | "markIgnored" | "reopen" | "noActions", string>;
  progress: Record<"pullMail" | "loadMore" | "sampleDigest" | "analyze" | "reports" | "loadModels" | "translate" | "cancelling", string> & { detail: string };
  model: Record<"fallback" | "preferred", string>;
};

export const LABELS: Record<Locale, DashboardLabels> = {
  "zh-CN": {
    toolbar: {
      pullMail: "获取新邮件",
      loadMore: "更多历史",
      sample: "示例数据",
      analyze: "分析下一批",
      analyzeSelected: "分析选中",
      analyzeAllAllowed: "分析全部允许项",
      refresh: "刷新",
      openDigest: "打开邮件摘要",
      openSummary: "打开分析总结",
      generateReports: "生成报告",
      openDailyBrief: "打开日报",
      openThreadReport: "打开线程报告",
      openSingleMailReport: "打开单封报告",
      settingsFile: "配置文件",
      promptConfig: "Prompt 分类配置",
      clearStore: "清理本地缓存",
      loadModels: "加载模型"
    },
    settings: {
      title: "设置",
      range: "范围",
      output: "语言",
      recentHours: "最近小时数",
      maxItems: "最多邮件数",
      folders: "拉取文件夹（用 ; 分隔，例如 Inbox;Sent Items;Inbox/Project）",
      bodyChars: "正文截断字符数",
      bodyCharsHelp: "限制每封邮件送给 Copilot 的正文长度，避免分析过慢或上下文过大。",
      modelFamily: "分析模型",
      noModel: "没有可用模型",
      modelsNotLoaded: "请先加载模型",
      batchSize: "每批分析数量",
      allowAnalyze: "允许分析",
      maxClassification: "允许分析最高密级",
      classificationPublic: "PUBLIC",
      classificationInternal: "INTERNAL",
      classificationRegistered: "REGISTERED",
      classificationHighRegistered: "HIGH REGISTERED",
      storeRetentionDays: "原文缓存保留天数",
      indexRetentionDays: "去重索引保留天数",
      analysisRetentionDays: "分析摘要保留天数",
      importantSenders: "重点发件人/邮件组（用 ; 分隔）",
      save: "保存设置",
      autoSaveNote: "修改后会自动保存到 VS Code Settings",
      recentHoursOption: "最近小时数",
      maxItemsOption: "最多邮件数",
      zhOption: "简体中文",
      enOption: "English"
    },
    meta: {
      range: "范围",
      folders: "文件夹",
      generated: "生成时间",
      requestedModel: "请求模型",
      lastUsedModel: "上次使用模型",
      lastPull: "上次拉取",
      lastImport: "上次导入"
    },
    stats: {
      pulled: "已拉取",
      pending: "未分析",
      analysed: "已分析",
      blocked: "需确认",
      mustHandle: "必须处理",
      risk: "风险",
      waiting: "等待回复",
      notice: "通知",
      threads: "邮件线程"
    },
    categories: {
      importantSender: "重点发件人",
      mustHandleToday: "今天必须处理",
      risk: "风险邮件",
      waitingForMe: "等待我回复",
      followUp: "需要跟进",
      notice: "普通通知",
      ignored: "已忽略",
      uncertain: "不确定"
    },
    card: {
      from: "发件人",
      to: "收件人",
      cc: "抄送",
      body: "原文",
      received: "收到时间",
      summary: "摘要",
      reason: "判断原因",
      suggestedAction: "建议动作",
      copyDraft: "复制回复草稿",
      draftHint: "不满意？写下你自己的回复，再润色或优化。",
      generateDraft: "生成草稿",
      polish: "润色",
      refine: "优化",
      instructionPlaceholder: "可选指令，例如：写短一些、请他们确认截止日期",
      outlookActions: "Outlook 操作",
      openReply: "Outlook 回复",
      openReplyAll: "Outlook 全部回复",
      openForward: "Outlook 转发",
      ignore: "忽略",
      restore: "恢复",
      analyze: "分析",
      reanalyze: "重新分析",
      openInOutlook: "在 Outlook 打开",
      noItems: "暂无邮件",
      thread: "线程"
    },
    pending: {
      title: "未分析邮件",
      blockedTitle: "需手动确认",
      classification: "密级",
      autoAllowed: "允许分析",
      manualRequired: "不允许分析",
      gateBlocked: "安全阻断",
      securityReason: "安全原因",
      select: "选择",
      confirmAnalyze: "确认并分析"
    },
    threads: {
      title: "邮件线程",
      participants: "参与人",
      messages: "消息数",
      lastTime: "最后时间",
      folders: "文件夹",
      contentStatus: "内容状态",
      security: "安全状态",
      analysis: "线程分析",
      analyzeThread: "分析整个线程",
      spotlight: "线程聚焦",
      currentStatus: "当前状态",
      keyDecisions: "关键决定",
      openQuestions: "开放问题",
      actionItems: "待办",
      waitingOn: "等待对象",
      risks: "风险",
      needMyReply: "需要我回复",
      suggestedAction: "建议动作",
      partialContext: "上下文不完整，请结合原始邮件核对",
      yes: "是",
      no: "否",
      draftReply: "回复草稿",
      timeline: "时间线",
      contentTruncated: "内容已截断",
      attachments: "附件",
      mailIds: "邮件 ID"
    },
    meetings: {
      title: "会议邀请",
      acceptedSchedule: "已接受的日程",
      organizer: "组织者",
      time: "时间",
      location: "地点",
      attendees: "参会人",
      requiredAttendees: "必选参会人",
      optionalAttendees: "可选参会人",
      status: "出席状态",
      allDay: "全天",
      recurring: "周期性",
      openInOutlook: "在 Outlook 打开",
      notResponded: "未回复",
      accepted: "已接受",
      tentative: "暂定",
      declined: "已拒绝",
      organizer_status: "组织者"
    },
    nextActions: {
      title: "待办事项",
      owner: "负责人",
      task: "任务",
      deadline: "截止日期",
      source: "来源",
      markDone: "完成",
      markIgnored: "忽略",
      reopen: "重新打开",
      noActions: "暂无待办",
    },
    progress: {
      pullMail: "正在获取新邮件",
      loadMore: "正在加载历史邮件",
      sampleDigest: "正在生成示例数据",
      analyze: "正在调用 Copilot 分析",
      reports: "正在生成报告",
      loadModels: "正在加载 Copilot 模型",
      translate: "正在翻译已有分析",
      cancelling: "正在取消…",
      detail: "任务进行中，请稍候..."
    },
    model: {
      fallback: "回退模型",
      preferred: "首选模型"
    }
  },
  "en-US": {
    toolbar: {
      pullMail: "Fetch New",
      loadMore: "More History",
      sample: "Sample Data",
      analyze: "Analyze Next Batch",
      analyzeSelected: "Analyze Selected",
      analyzeAllAllowed: "Analyze All Allowed",
      refresh: "Refresh",
      openDigest: "Open Digest",
      openSummary: "Open Summary",
      generateReports: "Generate Reports",
      openDailyBrief: "Open Daily Brief",
      openThreadReport: "Open Thread Report",
      openSingleMailReport: "Open Mail Report",
      settingsFile: "Settings File",
      promptConfig: "Prompt Config",
      clearStore: "Clear Local Cache",
      loadModels: "Load Models"
    },
    settings: {
      title: "Settings",
      range: "Range",
      output: "Language",
      recentHours: "Recent Hours",
      maxItems: "Max Items",
      folders: "Fetch Folders (; separated, e.g. Inbox;Sent Items;Inbox/Project)",
      bodyChars: "Body Chars",
      bodyCharsHelp: "Limits how many body characters per email are sent to Copilot.",
      modelFamily: "Analysis Model",
      noModel: "No available model",
      modelsNotLoaded: "Load models first",
      batchSize: "Batch Size",
      allowAnalyze: "Allow Analysis",
      maxClassification: "Max Allowed Classification",
      classificationPublic: "PUBLIC",
      classificationInternal: "INTERNAL",
      classificationRegistered: "REGISTERED",
      classificationHighRegistered: "HIGH REGISTERED",
      storeRetentionDays: "Raw Cache Retention Days",
      indexRetentionDays: "Index Retention Days",
      analysisRetentionDays: "Summary Retention Days",
      importantSenders: "Important senders/groups (; separated)",
      save: "Save Settings",
      autoSaveNote: "Changes are saved automatically to VS Code Settings",
      recentHoursOption: "Recent Hours",
      maxItemsOption: "Max Items",
      zhOption: "简体中文",
      enOption: "English"
    },
    meta: {
      range: "Range",
      folders: "Folders",
      generated: "Generated",
      requestedModel: "Requested model",
      lastUsedModel: "Last used model",
      lastPull: "Last pull",
      lastImport: "Last import"
    },
    stats: {
      pulled: "Pulled",
      pending: "Pending",
      analysed: "Analysed",
      blocked: "Needs Confirm",
      mustHandle: "Must Handle",
      risk: "Risk",
      waiting: "Waiting",
      notice: "Notice",
      threads: "Threads"
    },
    categories: {
      importantSender: "Important Senders",
      mustHandleToday: "Must Handle Today",
      risk: "Risk",
      waitingForMe: "Waiting For Me",
      followUp: "Follow-up",
      notice: "Notice",
      ignored: "Ignored",
      uncertain: "Uncertain"
    },
    card: {
      from: "From",
      to: "To",
      cc: "Cc",
      body: "Body",
      received: "Received",
      summary: "Summary",
      reason: "Reason",
      suggestedAction: "Suggested Action",
      copyDraft: "Copy Draft",
      draftHint: "Not satisfied? Draft your own reply, then refine or polish it.",
      generateDraft: "Generate Draft",
      polish: "Polish",
      refine: "Refine",
      instructionPlaceholder: "Optional instruction, e.g. make it shorter or ask them to confirm the deadline",
      outlookActions: "Outlook Actions",
      openReply: "Open Reply",
      openReplyAll: "Open Reply All",
      openForward: "Open Forward",
      ignore: "Ignore",
      restore: "Restore",
      analyze: "Analyze",
      reanalyze: "Re-analyze",
      openInOutlook: "Open in Outlook",
      noItems: "No items",
      thread: "Thread"
    },
    pending: {
      title: "Pending Mail",
      blockedTitle: "Manual Confirmation Required",
      classification: "Classification",
      autoAllowed: "Allowed",
      manualRequired: "Not allowed",
      gateBlocked: "Blocked by security gate",
      securityReason: "Security reason",
      select: "Select",
      confirmAnalyze: "Confirm and Analyze"
    },
    threads: {
      title: "Threads",
      participants: "Participants",
      messages: "Messages",
      lastTime: "Last Time",
      folders: "Folders",
      contentStatus: "Content Status",
      security: "Security",
      analysis: "Thread Analysis",
      analyzeThread: "Analyze Full Thread",
      spotlight: "Thread Spotlight",
      currentStatus: "Current Status",
      keyDecisions: "Key Decisions",
      openQuestions: "Open Questions",
      actionItems: "Action Items",
      waitingOn: "Waiting On",
      risks: "Risks",
      needMyReply: "Need My Reply",
      suggestedAction: "Suggested Action",
      partialContext: "Partial context; verify against original mail",
      yes: "Yes",
      no: "No",
      draftReply: "Draft Reply",
      timeline: "Timeline",
      contentTruncated: "Content truncated",
      attachments: "Attachments",
      mailIds: "Mail IDs"
    },
    meetings: {
      title: "Meeting Invites",
      acceptedSchedule: "Accepted schedule",
      organizer: "Organizer",
      time: "Time",
      location: "Location",
      attendees: "Attendees",
      requiredAttendees: "Required attendees",
      optionalAttendees: "Optional attendees",
      status: "Status",
      allDay: "All Day",
      recurring: "Recurring",
      openInOutlook: "Open in Outlook",
      notResponded: "Not Responded",
      accepted: "Accepted",
      tentative: "Tentative",
      declined: "Declined",
      organizer_status: "Organizer"
    },
    nextActions: {
      title: "Next Actions",
      owner: "Owner",
      task: "Task",
      deadline: "Deadline",
      source: "Source",
      markDone: "Done",
      markIgnored: "Ignore",
      reopen: "Reopen",
      noActions: "No actions",
    },
    progress: {
      pullMail: "Fetching new mail",
      loadMore: "Loading mail history",
      sampleDigest: "Generating sample digest",
      analyze: "Analyzing with Copilot",
      reports: "Generating reports",
      loadModels: "Loading Copilot models",
      translate: "Translating existing analysis",
      cancelling: "Cancelling…",
      detail: "Task is running. Please wait..."
    },
    model: {
      fallback: "fallback",
      preferred: "preferred"
    }
  }
};

export function getLabels(locale: Locale): DashboardLabels {
  return LABELS[locale] || LABELS["zh-CN"];
}

export function buildCategoryLabels(labels: DashboardLabels, promptConfig: PromptConfig, locale: Locale): Record<string, string> {
  const result: Record<string, string> = { ...labels.categories };
  for (const category of promptConfig.categories) {
    result[category.id] = locale === "en-US" ? category.labelEn : category.labelZh;
  }
  return result;
}
