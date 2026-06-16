export function getSessionEmbeddingText(session, options = {}) {
  const description = limitText(session.description, options.maxDescriptionChars);
  return [
    ["Title", session.title],
    ["Description", description],
    ["Session type", session.sessionType],
    ["Tracks", (session.trackNames || []).join(", ")],
    ["Speakers", (session.speakerNames || []).join(", ")],
  ]
    .filter(([, value]) => String(value || "").trim())
    .map(([label, value]) => `${label}: ${String(value).trim()}`)
    .join("\n");
}

function limitText(value, maxChars) {
  const text = String(value || "").trim();
  const limit = Number(maxChars);
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}...`;
}

export function buildEmbeddingsById(payload) {
  const rows = Array.isArray(payload?.embeddings) ? payload.embeddings : [];
  const byId = new Map();
  for (const row of rows) {
    const id = String(row?.id || "");
    const embedding = normalizeEmbedding(row?.embedding);
    if (id && embedding.length) byId.set(id, embedding);
  }
  return byId;
}

export function getScheduleEmbeddingFingerprint(sessions) {
  const stableRows = [...(Array.isArray(sessions) ? sessions : [])]
    .map((session) => ({
      id: String(session.id || ""),
      title: String(session.title || ""),
      description: String(session.description || ""),
      startsAt: String(session.startsAt || ""),
      endsAt: String(session.endsAt || ""),
      roomId: String(session.roomId || ""),
      categoryItemIds: [...(session.categoryItemIds || [])].map(String).sort(),
      speakerIds: [...(session.speakerIds || [])].map(String).sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return `fnv1a32:${hashString(JSON.stringify(stableRows))}`;
}

export function isUsableEmbeddingCache(payload, sessions) {
  return (
    payload?.scheduleFingerprint &&
    payload.scheduleFingerprint === getScheduleEmbeddingFingerprint(sessions) &&
    buildEmbeddingsById(payload).size > 0
  );
}

export function scoreEmbeddingRelevance(candidateEmbedding, anchorEmbeddings) {
  const candidate = normalizeEmbedding(candidateEmbedding);
  const anchor = averageEmbeddings(anchorEmbeddings);
  if (!candidate.length || !anchor.length) return 0;
  return Math.round(Math.max(0, cosineSimilarity(candidate, anchor)) * 10000) / 100;
}

export function rankSessionsByEmbeddingSearch(queryEmbedding, sessions, embeddingsBySessionId) {
  const query = normalizeEmbedding(queryEmbedding);
  if (!query.length) return sessions;
  const embeddingMap = normalizeEmbeddingsMap(embeddingsBySessionId);

  return [...(Array.isArray(sessions) ? sessions : [])]
    .map((session, originalIndex) => {
      const sessionEmbedding = embeddingMap.get(String(session.id || ""));
      const similarity = sessionEmbedding ? cosineSimilarity(query, sessionEmbedding) : null;
      return {
        session,
        originalIndex,
        score: Number.isFinite(similarity) ? Math.round(Math.max(0, similarity) * 10000) / 100 : null,
      };
    })
    .sort((a, b) => {
      const aHasScore = Number.isFinite(a.score);
      const bHasScore = Number.isFinite(b.score);
      if (aHasScore && bHasScore) return b.score - a.score || a.originalIndex - b.originalIndex;
      if (aHasScore) return -1;
      if (bHasScore) return 1;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ session, score }) => (
      Number.isFinite(score) ? { ...session, semanticSearchScore: score } : session
    ));
}

export function averageEmbeddings(embeddings) {
  const rows = (Array.isArray(embeddings) ? embeddings : [])
    .map(normalizeEmbedding)
    .filter((embedding) => embedding.length);
  if (!rows.length) return [];

  const dimensions = Math.min(...rows.map((embedding) => embedding.length));
  const averaged = Array.from({ length: dimensions }, () => 0);
  for (const embedding of rows) {
    for (let index = 0; index < dimensions; index += 1) {
      averaged[index] += embedding[index];
    }
  }
  return averaged.map((value) => value / rows.length);
}

export function cosineSimilarity(leftEmbedding, rightEmbedding) {
  const left = normalizeEmbedding(leftEmbedding);
  const right = normalizeEmbedding(rightEmbedding);
  const dimensions = Math.min(left.length, right.length);
  if (!dimensions) return 0;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < dimensions; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isFinite);
}

function normalizeEmbeddingsMap(value) {
  if (value instanceof Map) return value;
  if (!value || typeof value !== "object") return new Map();
  return new Map(Object.entries(value));
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
