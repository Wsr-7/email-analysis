# Sidebar / Workbench Differentiation Plan

## Problem

Sidebar and Workbench currently have full functional overlap — both render complete mail details, analysis fields, draft replies, thread timelines, and action buttons. They are visually different but functionally identical.

## Design Decision

**Sidebar = Remote Control** (navigation + global actions)
**Workbench = Display** (reading + context actions)

Zero functional overlap. Each has a clear, non-redundant role.

## Sidebar (keeps)

- Status bar (idle/busy dot + last pull time)
- Global action buttons: Fetch New, Analyze, Load More, Refresh
- Queue nav with counts (click → open workbench at that tab)
- Compact mail list for current queue: **one line per item** (subject + sender or priority badge), no expandable detail
- Clicking any item → opens workbench and focuses that item
- Bottom bar: Workbench toggle, Reports, Sample Data, Settings gear, Clear

## Sidebar (removes)

- `toggleRow()` expand/collapse behavior
- `.sb-detail` sections (From/Received/Summary/Reason/Action fields)
- Draft reply boxes
- Thread timeline `<details>` sections
- Thread analysis display
- Meeting detail expansion (organizer/time/location/attendees)
- Per-item action buttons (Open in Outlook / Ignore / Workbench)
- `renderSidebarAnalysisRow()` extra fields
- `renderSidebarThreadRow()` analysis + timeline
- `renderSidebarMeetingRow()` detail fields

## Workbench (keeps)

- Tabs (queue switching, synced with sidebar)
- Left column: item list
- Right column: Reading Pane with full detail
- Context action buttons inside Reading Pane: Open in Outlook, Ignore/Restore, Copy Draft, Analyze Thread

## Workbench (removes)

- Top bar with Fetch/Analyze/Reports/Refresh buttons (these live in sidebar only)
- Status dot (redundant with sidebar)

## Implementation Steps

### Step 1: Simplify sidebar item rows

Replace `renderSidebarMailRow`, `renderSidebarAnalysisRow`, `renderSidebarThreadRow`, `renderSidebarMeetingRow` with compact one-line renderers. Remove `.sb-detail` CSS. Change click handler from `toggleRow()` to `openInWorkbench(mailId/threadId/meetingId)`.

### Step 2: Remove workbench top bar

Remove `.wb-bar` section (Fetch/Analyze/Reports/Refresh buttons). The workbench starts directly with tabs.

### Step 3: Update sidebar click → workbench navigation

Sidebar item click sends `openInWorkbench` message with the item ID. Extension opens workbench panel and posts `focusItem` message.

### Step 4: Clean up CSS

Remove unused `.sb-detail`, `.sb-field`, `.sb-timeline-*`, `.sb-analysis` styles from sidebar. Remove `.wb-bar`, `.wb-act` styles from workbench.

### Step 5: Update tests

Update sidebar-render tests to verify no detail sections. Update workbench-render tests to verify no top bar buttons.

### Step 6: Compile, test, package, commit, push
