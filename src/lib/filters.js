export function matchSessionFilters(session, filters = {}) {
  const includeService = filters.includeService ?? true;
  const day = filters.day || "all";
  const track = filters.track || "all";
  const roomPrefix = filters.roomPrefix || "all";
  const sessionType = filters.sessionType || "all";
  const recording = filters.recording || "all";
  const durationMinutes = normalizeDurationFilter(filters.durationMinutes);
  const includeMasterClasses = filters.includeMasterClasses ?? true;

  if (!includeService && session.isServiceSession) return false;
  if (!includeMasterClasses && isMasterSession(session)) return false;
  if (day !== "all" && session.date !== day) return false;
  if (track !== "all" && !session.trackNames.includes(track)) return false;
  if (roomPrefix !== "all" && session.roomPrefix !== roomPrefix) return false;
  if (sessionType !== "all" && session.sessionType !== sessionType) return false;
  if (recording !== "all" && getRecordingBucket(session.recordingStatus) !== recording) return false;
  if (durationMinutes.length && !durationMinutes.includes(session.durationMinutes)) return false;

  const query = String(filters.search || "").trim().toLowerCase();
  if (!query) return true;
  return [
    session.title,
    session.description,
    session.room,
    session.sessionType,
    session.recordingStatus,
    session.trackNames.join(" "),
    session.speakerNames.join(" "),
    session.dayName,
    session.date,
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export function getRecordingBucket(recordingStatus = "") {
  const value = String(recordingStatus || "").toLowerCase();
  if (!value) return "unknown";
  if (value.includes("will not") || value.includes("not be recorded")) return "not-recorded";
  if (value.includes("will") && value.includes("recorded")) return "recorded";
  return "unknown";
}

function isMasterSession(session) {
  return String(session.sessionType || "").toLowerCase().includes("master");
}

function normalizeDurationFilter(value) {
  if (!value || value === "all") return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map(Number)
    .filter((duration) => Number.isFinite(duration) && duration > 0);
}
