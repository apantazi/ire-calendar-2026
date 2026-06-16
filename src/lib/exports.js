export function exportSessionsToCsv(sessions) {
  const headers = [
    "Title",
    "Date",
    "Start",
    "End",
    "Room",
    "Speakers",
    "Tracks",
    "Session type",
    "Recording",
    "Description",
  ];
  const rows = sessions.map((session) => [
    session.title,
    session.date,
    session.startTime,
    session.endTime,
    session.room,
    session.speakerNames.join("; "),
    session.trackNames.join("; "),
    session.sessionType,
    session.recordingStatus,
    session.description,
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function exportSessionsToJson(sessions) {
  return JSON.stringify(
    sessions.map((session) => ({
      id: session.id,
      title: session.title,
      date: session.date,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      room: session.room,
      speakers: session.speakerNames,
      tracks: session.trackNames,
      sessionType: session.sessionType,
      recordingStatus: session.recordingStatus,
      description: session.description,
    })),
    null,
    2,
  );
}

export function exportPersonalSchedule(sessions) {
  return JSON.stringify(
    {
      app: "ire-calendar-builder",
      version: 1,
      exportedAt: new Date().toISOString(),
      selectedSessionIds: sessions.map((session) => session.id),
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        date: session.date,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        room: session.room,
      })),
    },
    null,
    2,
  );
}

export function parsePersonalSchedule(text, sessionsById = null) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  const rawIds = extractPersonalScheduleIds(parsed);
  if (!rawIds.length) {
    throw new Error("No selected sessions were found in that file.");
  }

  const uniqueIds = [...new Set(rawIds.map(String).filter(Boolean))];
  if (!sessionsById) {
    return { selectedSessionIds: uniqueIds, missingSessionIds: [] };
  }

  const selectedSessionIds = uniqueIds.filter((id) => sessionsById.has(id));
  const missingSessionIds = uniqueIds.filter((id) => !sessionsById.has(id));
  return { selectedSessionIds, missingSessionIds };
}

export function exportSessionsToIcs(sessions) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IRE Calendar Builder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const session of sessions) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(session.id)}@ire-calendar-builder`,
      `DTSTAMP:${toIcsUtc(new Date())}`,
      `DTSTART:${toFloatingIcs(session.startsAt)}`,
      `DTEND:${toFloatingIcs(session.endsAt)}`,
      `SUMMARY:${escapeIcsText(session.title)}`,
      `LOCATION:${escapeIcsText(session.room)}`,
      `DESCRIPTION:${escapeIcsText(buildIcsDescription(session))}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function extractPersonalScheduleIds(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed?.selectedSessionIds)) {
    return parsed.selectedSessionIds;
  }
  if (Array.isArray(parsed?.sessions)) {
    return parsed.sessions.map((session) => session?.id);
  }
  return [];
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function buildIcsDescription(session) {
  const parts = [
    session.description,
    session.speakerNames.length ? `Speakers: ${session.speakerNames.join("; ")}` : "",
    session.trackNames.length ? `Tracks: ${session.trackNames.join("; ")}` : "",
    session.recordingStatus,
  ].filter(Boolean);
  return parts.join("\\n\\n");
}

function toFloatingIcs(iso = "") {
  return String(iso).replaceAll("-", "").replaceAll(":", "").slice(0, 15);
}

function toIcsUtc(date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r?\n/g, "\\n");
}
