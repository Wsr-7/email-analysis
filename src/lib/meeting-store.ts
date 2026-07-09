import type { MeetingDigestData, MeetingResponseStatus, MeetingSource } from "./meeting-digest";

export interface StoredMeeting {
  meetingId: string;
  entryId: string;
  subject: string;
  organizer: string;
  start: string;
  end: string;
  location: string;
  isAllDay: boolean;
  isRecurring: boolean;
  requiredAttendees: string;
  optionalAttendees: string;
  responseStatus: MeetingResponseStatus;
  meetingSource: MeetingSource;
  importance: string;
  bodyExcerpt: string;
  pulledAt: string;
}

export interface MeetingStore {
  generatedAt: string;
  lastPullAt: string;
  items: StoredMeeting[];
}

export function emptyMeetingStore(): MeetingStore {
  return { generatedAt: "", lastPullAt: "", items: [] };
}

export function mergeMeetingDigestIntoStore(store: MeetingStore, digest: MeetingDigestData): MeetingStore {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const existingByEntryId = new Map(store.items.filter((m) => m.entryId).map((m) => [m.entryId, m]));

  for (const item of digest.items) {
    const stored: StoredMeeting = {
      meetingId: item.meetingId,
      entryId: item.entryId,
      subject: item.subject,
      organizer: item.organizer,
      start: item.start,
      end: item.end,
      location: item.location,
      isAllDay: item.isAllDay,
      isRecurring: item.isRecurring,
      requiredAttendees: item.requiredAttendees,
      optionalAttendees: item.optionalAttendees,
      responseStatus: item.responseStatus,
      meetingSource: item.meetingSource,
      importance: item.importance,
      bodyExcerpt: item.bodyExcerpt,
      pulledAt: now
    };

    if (item.entryId && existingByEntryId.has(item.entryId)) {
      const existing = existingByEntryId.get(item.entryId)!;
      Object.assign(existing, stored);
    } else {
      existingByEntryId.set(item.entryId || item.meetingId, stored);
    }
  }

  return {
    generatedAt: digest.metadata.generatedAt || store.generatedAt,
    lastPullAt: now,
    items: Array.from(existingByEntryId.values())
  };
}

export function pruneMeetingStore(store: MeetingStore): MeetingStore {
  const todayStr = new Date().toISOString().slice(0, 10);
  return {
    ...store,
    items: store.items.filter((m) => {
      const startDate = (m.start || "").slice(0, 10);
      return startDate >= todayStr || m.responseStatus === "notResponded";
    })
  };
}

export function normalizeMeetingStore(raw: unknown): MeetingStore {
  if (!raw || typeof raw !== "object") return emptyMeetingStore();
  const obj = raw as Record<string, unknown>;
  return {
    generatedAt: String(obj.generatedAt || ""),
    lastPullAt: String(obj.lastPullAt || ""),
    items: Array.isArray(obj.items) ? obj.items.map(normalizeMeetingItem) : []
  };
}

function normalizeMeetingItem(raw: unknown): StoredMeeting {
  if (!raw || typeof raw !== "object") {
    return { meetingId: "", entryId: "", subject: "", organizer: "", start: "", end: "", location: "", isAllDay: false, isRecurring: false, requiredAttendees: "", optionalAttendees: "", responseStatus: "notResponded", meetingSource: "calendar", importance: "Normal", bodyExcerpt: "", pulledAt: "" };
  }
  const o = raw as Record<string, unknown>;
  return {
    meetingId: String(o.meetingId || ""),
    entryId: String(o.entryId || ""),
    subject: String(o.subject || ""),
    organizer: String(o.organizer || ""),
    start: String(o.start || ""),
    end: String(o.end || ""),
    location: String(o.location || ""),
    isAllDay: !!o.isAllDay,
    isRecurring: !!o.isRecurring,
    requiredAttendees: String(o.requiredAttendees || ""),
    optionalAttendees: String(o.optionalAttendees || ""),
    responseStatus: (["notResponded", "organizer", "tentative", "accepted", "declined"].includes(String(o.responseStatus || "")) ? String(o.responseStatus) : "notResponded") as MeetingResponseStatus,
    meetingSource: (o.meetingSource === "invite" ? "invite" : "calendar") as MeetingSource,
    importance: String(o.importance || "Normal"),
    bodyExcerpt: String(o.bodyExcerpt || ""),
    pulledAt: String(o.pulledAt || "")
  };
}
