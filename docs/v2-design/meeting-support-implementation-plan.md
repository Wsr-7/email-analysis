# Outlook 会议/日历支持 — 实施计划

## 设计目标

**核心价值**：让用户不错过重要会议——特别是忘了接受邀请导致日历不提醒的场景。

**不做的**：
- 不做 AI 分析（会议正文通常很少）
- 不做时间冲突检测（Outlook 自带）
- 不做出席状态管理（不从 Easy Mail 直接接受/拒绝）

---

## 功能规格

### 采集范围

| 来源 | 类型 | 筛选条件 |
|------|------|---------|
| 日历文件夹 | AppointmentItem (Class=26) | Start >= 今天 00:00 且 Start <= 今天 + N 天 23:59（默认 N=2，即今天+未来2天） |
| 收件箱 | MeetingItem (Class=53) | ReceivedTime >= 过去 7 天，且关联 Appointment 的 Start >= 今天 00:00，且 ResponseStatus = olResponseNotResponded (0) |

已拒绝的会议不采集。已过期的未回复邀请不采集（通过检查关联 Appointment 的 Start 时间过滤）。

### 数据输出

单独文件 `meeting-digest.md`，格式与 `mail-digest.md` 类似：

```markdown
# Outlook Meeting Digest

GeneratedAt: 2026-07-01 10:30:00
DaysAhead: 2

---

## Meeting: mtg-001

EntryId: <entryId>
Subject: Weekly Standup
Organizer: Alice <alice@example.com>
Start: 2026-07-01 14:00
End: 2026-07-01 14:30
Location: Teams Meeting
IsAllDay: false
IsRecurring: true
RequiredAttendees: bob@example.com; carol@example.com
OptionalAttendees: dave@example.com
ResponseStatus: notResponded
MeetingSource: calendar
Importance: Normal

BodyExcerpt:
Let's sync on sprint progress.

---
```

字段说明：
- `ResponseStatus`: `notResponded` | `organizer` | `tentative` | `accepted` | `declined`
- `MeetingSource`: `calendar`（来自日历文件夹）| `invite`（来自收件箱未回复邀请）
- `IsRecurring`: 是否为周期性会议
- `IsAllDay`: 是否全天事件

### 数据模型

新增 `MeetingStore`（独立于 MailStore）：

```typescript
export interface StoredMeeting {
  meetingId: string;       // 内部 ID: "mtg-001"
  entryId: string;         // Outlook EntryID
  subject: string;
  organizer: string;       // "Name <email>"
  start: string;           // ISO-like: "2026-07-01 14:00"
  end: string;
  location: string;
  isAllDay: boolean;
  isRecurring: boolean;
  requiredAttendees: string;
  optionalAttendees: string;
  responseStatus: "notResponded" | "organizer" | "tentative" | "accepted" | "declined";
  meetingSource: "calendar" | "invite";
  importance: string;
  bodyExcerpt: string;
  pulledAt: string;
}

export interface MeetingStore {
  generatedAt: string;
  lastPullAt: string;
  items: StoredMeeting[];
}
```

### UI 展示

新增 "meetings" 队列 tab（在 sidebar 和 workbench 中），位于 threads 之前。

Tab 内分两组：
1. **⚠ 未回复** — `responseStatus === "notResponded"`，醒目样式（类似 blocked 的警告色）
2. **📅 即将到来** — 其余会议（organizer / tentative / accepted），按 start 时间升序

每个会议行显示：
- 主标题：Subject
- 副信息：Start 时间 + Location（或 "线上会议"）
- Badge：出席状态（未回复 = 红色、暂定 = 黄色、已接受 = 绿色、组织者 = 蓝色）

展开详情（sidebar）/ 阅读面板（workbench）显示：
- Organizer
- Start — End（含持续时长）
- Location
- Required / Optional Attendees
- Body（如有）
- 出席状态
- "在 Outlook 中打开"按钮

### 配置项

在 `package.json` 的 `contributes.configuration` 中新增：

```json
{
  "easyMail.meetingDaysAhead": {
    "type": "number",
    "default": 2,
    "minimum": 1,
    "maximum": 14,
    "description": "Number of days ahead to fetch calendar meetings (today + N days)"
  }
}
```

在 `default-config.json` 中添加 `meetingDaysAhead: 2`。

---

## 实施步骤

### Step 1: 新建 VBScript — `collect-outlook-meetings.vbs`

**新建文件**：`scripts/collect-outlook-meetings.vbs`

功能：
1. 接受 CLI 参数：`--days-ahead N`（默认 2）、`--output path`（默认 `../data/meeting-digest.md`）、`--body-chars N`（默认 500）、`--sample`
2. 连接 Outlook COM，获取日历文件夹（`ns.GetDefaultFolder(9)` = olFolderCalendar）
3. 使用 Restrict 筛选 `[Start] >= 'today 00:00' AND [Start] <= 'today+N 23:59'`
4. 同时扫描收件箱的 MeetingItem（Class=53），过滤最近 7 天，对每个调用 `.GetAssociatedAppointment(False)` 获取关联 Appointment，检查 Start >= 今天 且 ResponseStatus = 0
5. 按 EntryId 去重（日历和收件箱可能指向同一个会议）
6. 按 Start 时间排序
7. 输出 `meeting-digest.md`
8. `--sample` 模式生成 3-4 条模拟会议数据

VBScript 关键 COM 属性：
- `AppointmentItem.Start` / `.End` / `.Location` / `.Subject`
- `AppointmentItem.Organizer`（字符串名称）
- `AppointmentItem.RequiredAttendees` / `.OptionalAttendees`（分号分隔字符串）
- `AppointmentItem.ResponseStatus`（0-4 枚举）
- `AppointmentItem.IsRecurring` / `.AllDayEvent`
- `AppointmentItem.Importance`（0/1/2）
- `AppointmentItem.Body`
- `MeetingItem.GetAssociatedAppointment(False)`

**验证**：`cscript scripts/collect-outlook-meetings.vbs --sample` 正常输出。

### Step 2: 会议 Digest 解析器 — `src/lib/meeting-digest.ts`

**新建文件**：`src/lib/meeting-digest.ts`

功能：
1. `parseMeetingDigest(text: string): MeetingDigestData` — 解析 `meeting-digest.md` 的元数据和会议条目
2. 格式与 `digest.ts` 的 `parseDigest` 类似，解析 `## Meeting: mtg-xxx` 分块

**新建测试**：`src/test/meeting-digest.test.ts`

**验证**：`npm test` 通过。

### Step 3: 会议数据模型 — `src/lib/meeting-store.ts`

**新建文件**：`src/lib/meeting-store.ts`

导出：
1. `StoredMeeting` 接口
2. `MeetingStore` 接口
3. `emptyMeetingStore()` 工厂
4. `mergeMeetingDigestIntoStore(store, digestData): MeetingStore` — 按 EntryId 去重合并
5. `pruneMeetingStore(store, retentionDays): MeetingStore` — 清除过期会议

**新建测试**：`src/test/meeting-store.test.ts`

**验证**：`npm test` 通过。

### Step 4: 扩展 AppDataStore — 持久化路径

**修改文件**：`src/lib/app-data.ts`

新增方法：
- `getMeetingDigestPath(): string` → `data/meeting-digest.md`
- `getMeetingStorePath(): string` → `data/meeting-store.json`
- `readMeetingStore(): Promise<MeetingStore>`
- `writeMeetingStore(store: MeetingStore): Promise<void>`

**更新测试**：`src/test/app-data.test.ts` 新增路径测试。

**验证**：`npm test` 通过。

### Step 5: 扩展 Extension — 采集流程

**修改文件**：`src/extension.ts`

在 `pullMailCore` 中追加会议采集逻辑：
1. 从配置读取 `meetingDaysAhead`（默认 2）
2. 执行 `cscript collect-outlook-meetings.vbs --days-ahead N --output <meetingDigestPath> --body-chars 500`
3. 解析 `meeting-digest.md` → 合并到 MeetingStore → 持久化
4. `--sample` 模式同样触发会议 sample

在 `clearLocalCache` 中追加清除 MeetingStore。

在 `loadState` 中追加读取 MeetingStore 并传入渲染器。

**验证**：`npm run compile` 通过。

### Step 6: 扩展 DashboardRenderInput

**修改文件**：`src/lib/dashboard-render.ts`

`DashboardRenderInput` 接口新增：
```typescript
meetingStore: MeetingStore;
```

**更新所有调用处**的 stub/mock（sidebar-render.test.ts、workbench-render.test.ts）。

**验证**：`npm run compile && npm test` 通过。

### Step 7: Sidebar 会议渲染

**修改文件**：`src/lib/sidebar-render.ts`

1. 在 `QUEUE_ORDER` 中 threads 前面插入 `"meetings"`
2. 在 `STABLE_QUEUES` 中加入 `"meetings"`
3. 新增 `renderSidebarMeetingRow()` 函数：
   - 行主体：Subject + Start 时间
   - Badge：出席状态（颜色编码）
   - 展开详情：Organizer、时间范围、Location、Attendees、Body
   - "在 Outlook 中打开"按钮（使用 EntryId）
4. 在 `renderSidebarHtml` 中构建 meetingRows：
   - 分两组渲染：未回复（data-queue="meetings"，特殊样式）、即将到来
   - 按 Start 升序排列
5. 队列计数：meetings tab 显示总数，badge 额外标注未回复数

出席状态 Badge CSS 样式：
- notResponded: 红色/橙色背景，醒目
- tentative: 黄色
- accepted: 绿色
- organizer: 蓝色

**更新测试**：`src/test/sidebar-render.test.ts` 新增会议渲染测试。

**验证**：`npm run compile && npm test` 通过。

### Step 8: Workbench 会议渲染

**修改文件**：`src/lib/workbench-render.ts`

1. Queue tabs 中添加 "meetings"
2. 左侧列表：会议行（Subject + Start + 状态 badge）
3. 右侧阅读面板：完整会议详情卡片
   - 标题 + 出席状态 badge
   - 信息网格：Organizer、时间、地点、周期性
   - Attendees 列表
   - Body（如有）
   - "在 Outlook 中打开"按钮

**更新测试**：`src/test/workbench-render.test.ts` 新增会议渲染测试。

**验证**：`npm run compile && npm test` 通过。

### Step 9: 打开会议的 Outlook 联动

**新建/修改文件**：`scripts/open-outlook-meeting.vbs`（或复用 `open-outlook-mail.vbs`）

由于 AppointmentItem 和 MailItem 共享 `Application.Session.GetItemFromID(entryId)` 方法，现有的 `open-outlook-mail.vbs` 应该也能打开会议项。验证一下，如果不行则新建。

**修改文件**：`src/lib/message-handler.ts`

新增消息类型 `openMeetingInOutlook`，复用或新增 Extension 方法。

**验证**：手动测试打开会议。

### Step 10: 配置项注册

**修改文件**：`package.json`

`contributes.configuration.properties` 中新增 `easyMail.meetingDaysAhead`。

**修改文件**：`default-config.json`

新增 `meetingDaysAhead: 2`。

**修改文件**：`src/lib/sidebar-render.ts`（设置面板，如需要在 UI 中可配置）

在设置面板中新增 meetingDaysAhead 的 number input（与 recentHours 类似）。

**验证**：`npm run compile` 通过。

### Step 11: Sample 模式支持

**修改文件**：`scripts/collect-outlook-meetings.vbs`

`--sample` 生成 4 条模拟会议：
1. 今天下午的 Team Standup（已接受）
2. 明天上午的 Client Review（未回复，醒目提醒）
3. 后天的 All Hands（暂定）
4. 今天的 1:1 Meeting（组织者=自己）

**验证**：`cscript scripts/collect-outlook-meetings.vbs --sample` 输出合理。

### Step 12: 编译、测试、打包、提交

1. `npm run compile` — 零错误
2. `npm test` — 全部通过
3. `npm run package:vsix` — VSIX 打包成功
4. Git commit + push to v2

---

## 文件清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `scripts/collect-outlook-meetings.vbs` | VBScript 会议采集 |
| `src/lib/meeting-digest.ts` | 会议 digest 解析器 |
| `src/lib/meeting-store.ts` | 会议数据模型 + 去重/合并/清理 |
| `src/test/meeting-digest.test.ts` | 解析器测试 |
| `src/test/meeting-store.test.ts` | 数据模型测试 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `package.json` | 新增 `easyMail.meetingDaysAhead` 配置 |
| `default-config.json` | 新增 `meetingDaysAhead: 2` |
| `src/lib/app-data.ts` | 新增会议路径 + 读写方法 |
| `src/lib/dashboard-render.ts` | `DashboardRenderInput` 新增 `meetingStore` |
| `src/lib/sidebar-render.ts` | 新增 meetings 队列 + 会议行渲染 + 设置项 |
| `src/lib/workbench-render.ts` | 新增 meetings tab + 会议详情面板 |
| `src/lib/message-handler.ts` | 新增 `openMeetingInOutlook` 消息 |
| `src/extension.ts` | 采集流程 + loadState + clearLocalCache |
| `src/test/app-data.test.ts` | 新增路径测试 |
| `src/test/sidebar-render.test.ts` | 新增会议渲染测试 |
| `src/test/workbench-render.test.ts` | 新增会议渲染测试 |

---

## 依赖关系

```
Step 1 (VBScript)
    │
Step 2 (digest parser) ── Step 3 (data model)
    │                          │
    └──────── Step 4 (AppDataStore) ────┐
                                        │
                               Step 5 (Extension 采集)
                                        │
                               Step 6 (RenderInput 接口)
                                        │
                          ┌─────────────┼─────────────┐
                     Step 7 (Sidebar)  Step 8 (WB)  Step 9 (打开会议)
                          │             │             │
                     Step 10 (配置) ────┘             │
                          │                           │
                     Step 11 (Sample) ────────────────┘
                          │
                     Step 12 (打包推送)
```

Steps 1-3 可并行开发。Steps 7-9 可并行开发。
