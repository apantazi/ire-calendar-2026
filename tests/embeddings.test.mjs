import test from "node:test";
import assert from "node:assert/strict";

import {
  embedSessionInputs,
} from "../api/embeddingProvider.js";
import {
  averageEmbeddings,
  buildEmbeddingsById,
  cosineSimilarity,
  getScheduleEmbeddingFingerprint,
  getSessionEmbeddingText,
  rankSessionsByEmbeddingSearch,
  scoreEmbeddingRelevance,
} from "../src/lib/embeddings.js";

test("builds stable embedding text from session content", () => {
  const text = getSessionEmbeddingText({
    title: "Data session",
    description: "Learn documents and analysis.",
    sessionType: "Hands-on training",
    trackNames: ["Data analysis"],
    speakerNames: ["Ada Lovelace"],
    room: "National Harbor 2",
  });

  assert.match(text, /Title: Data session/);
  assert.match(text, /Description: Learn documents and analysis\./);
  assert.match(text, /Tracks: Data analysis/);
  assert.match(text, /Speakers: Ada Lovelace/);
  assert.doesNotMatch(text, /National Harbor 2/);
});

test("embedding text can cap long descriptions while preserving metadata", () => {
  const text = getSessionEmbeddingText(
    {
      title: "Crypto tracing",
      description: "a".repeat(200),
      sessionType: "Panel",
      trackNames: ["Business"],
      speakerNames: ["Ada Lovelace"],
    },
    { maxDescriptionChars: 40 },
  );

  assert.match(text, /Title: Crypto tracing/);
  assert.match(text, /Description: a{40}\.\.\./);
  assert.match(text, /Session type: Panel/);
  assert.match(text, /Tracks: Business/);
  assert.match(text, /Speakers: Ada Lovelace/);
  assert.ok(text.length < 160);
});

test("computes cosine similarity and averaged anchor embeddings", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.deepEqual(averageEmbeddings([[1, 0], [0, 1]]), [0.5, 0.5]);
});

test("scores candidate relevance from provided Qwen-style embeddings", () => {
  const score = scoreEmbeddingRelevance([0.9, 0.1], [[1, 0], [0.8, 0.2]]);
  const unrelated = scoreEmbeddingRelevance([0, 1], [[1, 0], [0.8, 0.2]]);

  assert.ok(score > unrelated);
  assert.ok(score <= 100);
});

test("ranks sessions by semantic query embedding similarity", () => {
  const sessions = [
    { id: "records", startsAtMs: 2, roomSort: 2, title: "Public records" },
    { id: "sports", startsAtMs: 1, roomSort: 1, title: "Sports beat" },
    { id: "missing", startsAtMs: 3, roomSort: 3, title: "No vector" },
  ];
  const ranked = rankSessionsByEmbeddingSearch(
    [1, 0],
    sessions,
    new Map([
      ["records", [0.95, 0.05]],
      ["sports", [0, 1]],
    ]),
  );

  assert.deepEqual(ranked.map((session) => session.id), ["records", "sports", "missing"]);
  assert.equal(ranked[0].semanticSearchScore, 99.86);
  assert.equal(ranked[2].semanticSearchScore, undefined);
});

test("maps embedding API results by session id", () => {
  const embeddings = buildEmbeddingsById({
    embeddings: [
      { id: "a", embedding: [1, 2, 3] },
      { id: "b", embedding: [0, 1, 0] },
      { id: "", embedding: [9] },
    ],
  });

  assert.deepEqual(embeddings.get("a"), [1, 2, 3]);
  assert.deepEqual(embeddings.get("b"), [0, 1, 0]);
  assert.equal(embeddings.has(""), false);
});

test("builds a deterministic schedule fingerprint that changes with content", () => {
  const sessions = [
    {
      id: "a",
      title: "Session A",
      description: "Original",
      startsAt: "2026-06-18T09:00:00",
      endsAt: "2026-06-18T10:00:00",
      roomId: "1",
      categoryItemIds: ["track"],
    },
    {
      id: "b",
      title: "Session B",
      description: "Other",
      startsAt: "2026-06-18T10:15:00",
      endsAt: "2026-06-18T11:15:00",
      roomId: "2",
      categoryItemIds: [],
    },
  ];

  const first = getScheduleEmbeddingFingerprint(sessions);
  const reordered = getScheduleEmbeddingFingerprint([...sessions].reverse());
  const changed = getScheduleEmbeddingFingerprint([
    sessions[0],
    { ...sessions[1], description: "Changed" },
  ]);

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("embedding provider explains unreachable local endpoint failures", async () => {
  await assert.rejects(
    () =>
      embedSessionInputs(
        [{ id: "one", text: "A session about public records." }],
        {
          QWEN_EMBEDDING_URL: "http://127.0.0.1:1/embed",
          QWEN_EMBEDDING_FORMAT: "tei",
        },
      ),
    /Could not reach embedding endpoint at http:\/\/127\.0\.0\.1:1\/embed/,
  );
});
