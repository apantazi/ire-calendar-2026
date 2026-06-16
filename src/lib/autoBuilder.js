import { compareSessions, sessionsOverlap } from "./schedule.js";
import { scoreEmbeddingRelevance } from "./embeddings.js";

export function buildAutoSchedule(normalizedSchedule, options = {}) {
  const anchorsByDay = options.anchorsByDay || {};
  const includeServiceSessions = Boolean(options.includeServiceSessions);
  const strategy = options.strategy === "relevance" ? "relevance" : "proximity";
  const embeddingsBySessionId = normalizeEmbeddingsBySessionId(options.embeddingsBySessionId);
  const preferredTrackNames = normalizeStringSet(options.preferredTrackNames);
  const excludedTrackNames = normalizeStringSet(options.excludedTrackNames);
  const rejectedSessionIds = normalizeStringSet(options.rejectedSessionIds);
  const relevanceProvider = strategy === "relevance" && embeddingsBySessionId.size ? "qwen-embeddings" : "local-text";
  const selected = new Map();
  const recommendationsByDay = {};
  const candidateSlotsByDay = {};
  const skippedConflicts = [];

  for (const day of normalizedSchedule.days) {
    const anchorIds = (anchorsByDay[day.date] || []).slice(0, 3);
    const anchors = anchorIds
      .map((id) => normalizedSchedule.sessionsById.get(id))
      .filter(Boolean)
      .sort(compareSessions);
    const anchorIdSet = new Set(anchors.map((anchor) => anchor.id));

    for (const anchor of anchors) {
      selected.set(anchor.id, anchor);
    }

    recommendationsByDay[day.date] = [];
    candidateSlotsByDay[day.date] = [];
    if (!anchors.length) continue;
    const anchorEmbeddings = anchors
      .map((anchor) => embeddingsBySessionId.get(anchor.id))
      .filter(Boolean);

    const preferredPrefixes = new Set(
      anchors
        .filter((session) => !session.isServiceSession)
        .map((session) => session.roomPrefix)
        .filter(Boolean),
    );

    const sameDayCandidates = normalizedSchedule.sessions
      .filter((session) => session.date === day.date)
      .filter((session) => !selected.has(session.id))
      .filter((session) => !rejectedSessionIds.has(session.id))
      .filter((session) => includeServiceSessions || !session.isServiceSession)
      .filter((session) => !hasAnyTrack(session, excludedTrackNames))
      .map((session) => ({
        ...session,
        relevanceScore:
          strategy === "relevance"
            ? scoreCandidateRelevance(session, anchors, embeddingsBySessionId, anchorEmbeddings)
            : 0,
        relevanceProvider,
        proximityScore: preferredPrefixes.has(session.roomPrefix) ? 1 : 0,
        trackPreferenceScore: hasAnyTrack(session, preferredTrackNames) ? 1 : 0,
      }))
      .sort((a, b) => {
        if (a.startsAtMs !== b.startsAtMs) return a.startsAtMs - b.startsAtMs;
        return compareCandidateWithinSlot(a, b, strategy);
      });

    candidateSlotsByDay[day.date] = buildCandidateSlots(
      day.date,
      sameDayCandidates.filter(
        (candidate) => !anchors.some((anchor) => sessionsOverlap(anchor, candidate)),
      ),
      strategy,
    );

    for (const candidate of sameDayCandidates) {
      const conflictingSessions = [...selected.values()].filter(
        (session) => session.date === candidate.date && sessionsOverlap(session, candidate),
      );
      if (conflictingSessions.length) {
        if (conflictingSessions.some((session) => anchorIdSet.has(session.id))) {
          skippedConflicts.push(candidate);
        }
        continue;
      }

      selected.set(candidate.id, candidate);
      recommendationsByDay[day.date].push(candidate);
    }
  }

  const selectedSessions = [...selected.values()].sort(compareSessions);
  const candidateSlots = Object.values(candidateSlotsByDay).flat();
  return {
    strategy,
    relevanceProvider,
    rejectedSessionIds: [...rejectedSessionIds],
    selectedSessions,
    selectedSessionIds: selectedSessions.map((session) => session.id),
    recommendationsByDay,
    candidateSlots,
    candidateSlotsByDay,
    skippedConflicts: skippedConflicts.sort(compareSessions),
  };
}

function buildCandidateSlots(date, candidates, strategy) {
  const slotsByStart = new Map();
  for (const candidate of candidates) {
    const key = `${date}|${candidate.startsAtMs}`;
    if (!slotsByStart.has(key)) {
      slotsByStart.set(key, {
        id: key,
        date,
        dayName: candidate.dayName || "",
        startMs: candidate.startsAtMs,
        endMs: candidate.endsAtMs,
        candidates: [],
      });
    }
    const slot = slotsByStart.get(key);
    slot.endMs = Math.max(slot.endMs, candidate.endsAtMs);
    slot.candidates.push(candidate);
  }

  return [...slotsByStart.values()]
    .map((slot) => ({
      ...slot,
      timeBlock: `${formatTimeFromMs(slot.startMs)} - ${formatTimeFromMs(slot.endMs)}`,
      candidates: slot.candidates.sort((a, b) => compareCandidateWithinSlot(a, b, strategy)),
    }))
    .filter((slot) => slot.candidates.length)
    .sort((a, b) => a.startMs - b.startMs);
}

function compareCandidateWithinSlot(a, b, strategy) {
  if (b.trackPreferenceScore !== a.trackPreferenceScore) {
    return b.trackPreferenceScore - a.trackPreferenceScore;
  }
  if (strategy === "relevance" && b.relevanceScore !== a.relevanceScore) {
    return b.relevanceScore - a.relevanceScore;
  }
  if (b.proximityScore !== a.proximityScore) return b.proximityScore - a.proximityScore;
  return compareSessions(a, b);
}

function scoreCandidateRelevance(session, anchors, embeddingsBySessionId, anchorEmbeddings) {
  const candidateEmbedding = embeddingsBySessionId.get(session.id);
  if (candidateEmbedding && anchorEmbeddings.length) {
    return scoreEmbeddingRelevance(candidateEmbedding, anchorEmbeddings);
  }
  return scoreSessionRelevance(session, anchors);
}

function normalizeEmbeddingsBySessionId(value) {
  if (value instanceof Map) return value;
  if (!value || typeof value !== "object") return new Map();
  return new Map(Object.entries(value));
}

function normalizeStringSet(value) {
  return new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
}

function hasAnyTrack(session, trackNames) {
  if (!trackNames.size) return false;
  return (session.trackNames || []).some((trackName) => trackNames.has(trackName));
}

export function getConflicts(sessions) {
  const conflicts = [];
  const sorted = [...sessions].sort(compareSessions);

  for (let index = 0; index < sorted.length; index += 1) {
    for (let next = index + 1; next < sorted.length; next += 1) {
      if (sorted[index].date !== sorted[next].date) continue;
      if (sorted[next].startsAtMs >= sorted[index].endsAtMs) break;
      if (sessionsOverlap(sorted[index], sorted[next])) {
        conflicts.push([sorted[index], sorted[next]]);
      }
    }
  }

  return conflicts;
}

export function getConflictSlots(sessions) {
  const conflictingIds = new Set(getConflicts(sessions).flat().map((session) => session.id));
  if (!conflictingIds.size) return [];

  const byDate = new Map();
  for (const session of sessions.filter((session) => conflictingIds.has(session.id)).sort(compareSessions)) {
    if (!byDate.has(session.date)) byDate.set(session.date, []);
    byDate.get(session.date).push(session);
  }

  const slots = [];
  for (const [date, daySessions] of byDate.entries()) {
    let group = [];
    let groupEnd = 0;

    function flushGroup() {
      if (group.length < 2) {
        group = [];
        groupEnd = 0;
        return;
      }

      const startMs = Math.min(...group.map((session) => session.startsAtMs));
      const endMs = Math.max(...group.map((session) => session.endsAtMs));
      slots.push({
        id: `${date}-${startMs}-${endMs}`,
        date,
        dayName: group[0]?.dayName || "",
        startMs,
        endMs,
        timeBlock: `${formatTimeFromMs(startMs)} - ${formatTimeFromMs(endMs)}`,
        sessions: [...group].sort(compareSessions),
      });
      group = [];
      groupEnd = 0;
    }

    for (const session of daySessions) {
      if (!group.length) {
        group = [session];
        groupEnd = session.endsAtMs;
        continue;
      }

      if (session.startsAtMs < groupEnd) {
        group.push(session);
        groupEnd = Math.max(groupEnd, session.endsAtMs);
      } else {
        flushGroup();
        group = [session];
        groupEnd = session.endsAtMs;
      }
    }
    flushGroup();
  }

  return slots.sort((a, b) => a.startMs - b.startMs);
}

export function scoreSessionRelevance(session, anchors = []) {
  const anchorTokens = new Set(anchors.flatMap((anchor) => tokenizeSession(anchor)));
  const sessionTokens = new Set(tokenizeSession(session));
  if (!anchorTokens.size || !sessionTokens.size) return 0;

  let overlap = 0;
  for (const token of sessionTokens) {
    if (anchorTokens.has(token)) overlap += 1;
  }

  const cosineLikeScore = overlap / Math.sqrt(anchorTokens.size * sessionTokens.size);
  const trackOverlap = session.trackNames?.some((track) =>
    anchors.some((anchor) => anchor.trackNames?.includes(track)),
  )
    ? 0.18
    : 0;
  const typeOverlap = anchors.some((anchor) => anchor.sessionType && anchor.sessionType === session.sessionType)
    ? 0.08
    : 0;

  return Math.round((cosineLikeScore + trackOverlap + typeOverlap) * 10000) / 100;
}

function tokenizeSession(session) {
  return [
    session.title,
    session.description,
    session.sessionType,
    ...(session.trackNames || []),
    ...(session.speakerNames || []),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map(stemToken)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function stemToken(token) {
  return token
    .replace(/ies$/, "y")
    .replace(/ing$/, "")
    .replace(/ed$/, "")
    .replace(/s$/, "");
}

function formatTimeFromMs(ms) {
  const date = new Date(ms);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "bring",
  "but",
  "for",
  "from",
  "how",
  "into",
  "not",
  "session",
  "that",
  "the",
  "this",
  "with",
  "you",
  "your",
]);
