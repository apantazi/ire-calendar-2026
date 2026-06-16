const MS_PER_MINUTE = 60 * 1000;

export function getRoomPrefix(roomName = "") {
  const room = String(roomName || "").trim();
  if (!room) return "Unassigned";
  if (room === "Conference-wide") return room;
  if (room === "Maryland Foyer") return room;

  const parts = room.split(/\s+/);
  const last = parts.at(-1);
  if (/^\d+(-\d+)?$/.test(last) || /^[A-Z]+$/.test(last)) {
    return parts.slice(0, -1).join(" ");
  }
  return room;
}

export function normalizeSchedule(rawSchedule) {
  const rawRooms = Array.isArray(rawSchedule?.rooms) ? rawSchedule.rooms : [];
  const rawSpeakers = Array.isArray(rawSchedule?.speakers) ? rawSchedule.speakers : [];
  const rawSessions = Array.isArray(rawSchedule?.sessions) ? rawSchedule.sessions : [];
  const rawCategories = Array.isArray(rawSchedule?.categories) ? rawSchedule.categories : [];

  const rooms = rawRooms
    .map((room) => ({
      id: String(room.id),
      name: room.name || "Unassigned",
      sort: Number.isFinite(Number(room.sort)) ? Number(room.sort) : 999,
      prefix: getRoomPrefix(room.name),
    }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const roomsById = new Map(rooms.map((room) => [room.id, room]));

  const categoryItemsById = buildCategoryLookup(rawCategories);

  const speakerSessionIds = new Map();
  for (const session of rawSessions) {
    for (const speakerId of session.speakers || []) {
      const key = String(speakerId);
      if (!speakerSessionIds.has(key)) speakerSessionIds.set(key, new Set());
      speakerSessionIds.get(key).add(String(session.id));
    }
  }

  const speakers = rawSpeakers
    .map((speaker) => {
      const id = String(speaker.id);
      const sessionIds = new Set([
        ...(Array.isArray(speaker.sessions) ? speaker.sessions.map(String) : []),
        ...(speakerSessionIds.get(id) ? [...speakerSessionIds.get(id)] : []),
      ]);

      return {
        id,
        firstName: speaker.firstName || "",
        lastName: speaker.lastName || "",
        fullName: speaker.fullName || [speaker.firstName, speaker.lastName].filter(Boolean).join(" "),
        bio: cleanText(speaker.bio),
        tagLine: speaker.tagLine || "",
        profilePicture: speaker.profilePicture || "",
        links: Array.isArray(speaker.links) ? speaker.links : [],
        isTopSpeaker: Boolean(speaker.isTopSpeaker),
        sessionIds: [...sessionIds],
        sessions: [],
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const speakersById = new Map(speakers.map((speaker) => [speaker.id, speaker]));

  const sessions = rawSessions
    .map((session) => {
      const room = roomsById.get(String(session.roomId));
      const speakerObjects = (session.speakers || [])
        .map((speakerId) => speakersById.get(String(speakerId)))
        .filter(Boolean);
      const categoryItems = (session.categoryItems || [])
        .map((categoryItemId) => categoryItemsById.get(String(categoryItemId)))
        .filter(Boolean)
        .sort((a, b) => a.groupSort - b.groupSort || a.sort - b.sort || a.name.localeCompare(b.name));

      const trackItems = categoryItems.filter((item) => item.groupTitle === "Tracks");
      const sessionTypeItem = categoryItems.find((item) => item.groupTitle === "Session type");
      const recordingItem = categoryItems.find((item) => item.groupTitle === "Recorded?");
      const date = String(session.startsAt || "").slice(0, 10);
      const startsAtMs = toLocalDate(session.startsAt).getTime();
      const endsAtMs = toLocalDate(session.endsAt).getTime();
      const durationMinutes = Math.max(0, Math.round((endsAtMs - startsAtMs) / MS_PER_MINUTE));

      return {
        id: String(session.id),
        title: session.title || "Untitled session",
        description: cleanText(session.description),
        startsAt: session.startsAt || "",
        endsAt: session.endsAt || "",
        startsAtMs,
        endsAtMs,
        date,
        dayName: dayNameForDate(date),
        startTime: formatTimeFromIso(session.startsAt),
        endTime: formatTimeFromIso(session.endsAt),
        timeBlock: `${formatTimeFromIso(session.startsAt)} - ${formatTimeFromIso(session.endsAt)}`,
        durationMinutes,
        roomId: String(session.roomId ?? ""),
        room: room?.name || "Unassigned",
        roomSort: room?.sort ?? 999,
        roomPrefix: room?.prefix || getRoomPrefix(room?.name),
        speakerIds: (session.speakers || []).map(String),
        speakers: speakerObjects,
        speakerNames: speakerObjects.map((speaker) => speaker.fullName),
        categoryItemIds: (session.categoryItems || []).map(String),
        categoryItems,
        sessionType: sessionTypeItem?.name || "",
        trackNames: trackItems.map((item) => item.name),
        tracks: trackItems,
        recordingStatus: recordingItem?.name || "",
        sessionKind: session.isServiceSession ? "Service / break" : "Content",
        plenumKind: session.isPlenumSession ? "Plenary" : "Concurrent",
        isServiceSession: Boolean(session.isServiceSession),
        isPlenumSession: Boolean(session.isPlenumSession),
        liveUrl: session.liveUrl || "",
        recordingUrl: session.recordingUrl || "",
        status: session.status || "",
        isInformed: Boolean(session.isInformed),
        isConfirmed: Boolean(session.isConfirmed),
      };
    })
    .sort(compareSessions);

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  for (const speaker of speakers) {
    speaker.sessionIds = speaker.sessionIds.filter((sessionId) => sessionsById.has(sessionId));
    speaker.sessions = speaker.sessionIds
      .map((sessionId) => sessionsById.get(sessionId))
      .filter(Boolean)
      .sort(compareSessions);
  }

  const days = [...new Map(sessions.map((session) => [session.date, session.dayName])).entries()]
    .map(([date, dayName]) => ({ date, dayName }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const tracks = buildTrackSummary(sessions);
  const sessionTypes = uniqueSorted(sessions.map((session) => session.sessionType).filter(Boolean));
  const roomPrefixes = uniqueSorted(rooms.map((room) => room.prefix).filter(Boolean));

  return {
    sessions,
    sessionsById,
    speakers,
    speakersById,
    rooms,
    roomsById,
    days,
    tracks,
    sessionTypes,
    roomPrefixes,
  };
}

export function compareSessions(a, b) {
  return (
    a.startsAtMs - b.startsAtMs ||
    a.roomSort - b.roomSort ||
    a.title.localeCompare(b.title)
  );
}

export function sessionsOverlap(a, b) {
  return a.startsAtMs < b.endsAtMs && b.startsAtMs < a.endsAtMs;
}

function buildCategoryLookup(rawCategories) {
  const lookup = new Map();
  for (const group of rawCategories) {
    for (const item of group.items || []) {
      lookup.set(String(item.id), {
        id: String(item.id),
        name: item.name || "",
        sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : 999,
        groupId: String(group.id),
        groupTitle: group.title || "",
        groupType: group.type || "",
        groupSort: Number.isFinite(Number(group.sort)) ? Number(group.sort) : 999,
      });
    }
  }
  return lookup;
}

function buildTrackSummary(sessions) {
  const byTrack = new Map();
  for (const session of sessions) {
    for (const track of session.trackNames) {
      if (!byTrack.has(track)) {
        byTrack.set(track, { name: track, sessionIds: [], sessions: [] });
      }
      byTrack.get(track).sessionIds.push(session.id);
      byTrack.get(track).sessions.push(session);
    }
  }
  return [...byTrack.values()].sort((a, b) => b.sessions.length - a.sessions.length || a.name.localeCompare(b.name));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function cleanText(text = "") {
  return String(text || "")
    .replace(/\r\n|\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toLocalDate(iso = "") {
  const [datePart = "", timePart = "00:00:00"] = String(iso).split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, second || 0);
}

function formatTimeFromIso(iso = "") {
  const timePart = String(iso).split("T")[1] || "00:00:00";
  const [hourRaw, minuteRaw] = timePart.split(":");
  const hour24 = Number(hourRaw);
  const minute = Number(minuteRaw || 0);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function dayNameForDate(date = "") {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(parsed);
}
