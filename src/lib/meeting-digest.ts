export interface MeetingDigestMetadata {
  generatedAt: string;
  daysAhead: number;
}

export type MeetingResponseStatus = "notResponded" | "organizer" | "tentative" | "accepted" | "declined";
export type MeetingSource = "calendar" | "invite";

export interface MeetingDigestItem {
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
}

export interface MeetingDigestData {
  metadata: MeetingDigestMetadata;
  items: MeetingDigestItem[];
}

export function parseMeetingDigest(markdown: string): MeetingDigestData {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const metadata: MeetingDigestMetadata = { generatedAt: "", daysAhead: 2 };

  const genMatch = text.match(/GeneratedAt:\s*(.+)/);
  if (genMatch) metadata.generatedAt = genMatch[1].trim();
  const daysMatch = text.match(/DaysAhead:\s*(\d+)/);
  if (daysMatch) metadata.daysAhead = Number(daysMatch[1]) || 2;

  const sections = text.split(/\n## Meeting:\s+/).slice(1);
  const items = sections.map((s) => parseMeetingSection(s)).filter(Boolean) as MeetingDigestItem[];
  return { metadata, items };
}

function parseMeetingSection(section: string): MeetingDigestItem | null {
  const text = String(section || "");
  const bodyParts = text.split(/\nBodyExcerpt:\n/);
  const headerText = bodyParts[0] || "";
  const bodyText = (bodyParts[1] || "").replace(/\n---\s*$/, "").trim();
  const lines = headerText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const result: MeetingDigestItem = {
    meetingId: lines[0],
    entryId: "",
    subject: "",
    organizer: "",
    start: "",
    end: "",
    location: "",
    isAllDay: false,
    isRecurring: false,
    requiredAttendees: "",
    optionalAttendees: "",
    responseStatus: "notResponded",
    meetingSource: "calendar",
    importance: "Normal",
    bodyExcerpt: bodyText
  };

  for (const line of lines.slice(1)) {
    assignStr(result, line, "EntryId: ", "entryId");
    assignStr(result, line, "Subject: ", "subject");
    assignStr(result, line, "Organizer: ", "organizer");
    assignStr(result, line, "Start: ", "start");
    assignStr(result, line, "End: ", "end");
    assignStr(result, line, "Location: ", "location");
    assignStr(result, line, "RequiredAttendees: ", "requiredAttendees");
    assignStr(result, line, "OptionalAttendees: ", "optionalAttendees");
    assignStr(result, line, "Importance: ", "importance");
    if (line.startsWith("IsAllDay: ")) result.isAllDay = line.slice("IsAllDay: ".length).trim() === "true";
    if (line.startsWith("IsRecurring: ")) result.isRecurring = line.slice("IsRecurring: ".length).trim() === "true";
    if (line.startsWith("ResponseStatus: ")) result.responseStatus = parseResponseStatus(line.slice("ResponseStatus: ".length).trim());
    if (line.startsWith("MeetingSource: ")) result.meetingSource = parseMeetingSource(line.slice("MeetingSource: ".length).trim());
  }

  return result;
}

function assignStr(target: MeetingDigestItem, line: string, prefix: string, key: keyof MeetingDigestItem): void {
  if (line.startsWith(prefix)) {
    (target as unknown as Record<string, unknown>)[key] = line.slice(prefix.length).trim();
  }
}

function parseResponseStatus(value: string): MeetingResponseStatus {
  const valid: MeetingResponseStatus[] = ["notResponded", "organizer", "tentative", "accepted", "declined"];
  return valid.includes(value as MeetingResponseStatus) ? (value as MeetingResponseStatus) : "notResponded";
}

function parseMeetingSource(value: string): MeetingSource {
  return value === "invite" ? "invite" : "calendar";
}
