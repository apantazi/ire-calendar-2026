import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildEmbeddingsById, getScheduleEmbeddingFingerprint } from "../src/lib/embeddings.js";
import { normalizeSchedule } from "../src/lib/schedule.js";
import { getStaticAssetUrl } from "../src/lib/staticAssets.js";

test("builds static asset URLs relative to the Vite base path", () => {
  assert.equal(getStaticAssetUrl("data/ire26-schedule.json", "/"), "/data/ire26-schedule.json");
  assert.equal(getStaticAssetUrl("data/ire26-schedule.json", "./"), "./data/ire26-schedule.json");
  assert.equal(getStaticAssetUrl("data/ire26-schedule.json", "/ire/"), "/ire/data/ire26-schedule.json");
  assert.equal(getStaticAssetUrl("data/ire26-schedule.json", "/ire"), "/ire/data/ire26-schedule.json");
  assert.equal(getStaticAssetUrl("/data/ire26-session-embeddings.json", "/ire/"), "/ire/data/ire26-session-embeddings.json");
});

test("committed static schedule matches the committed embedding cache", () => {
  const rawSchedule = JSON.parse(fs.readFileSync("public/data/ire26-schedule.json", "utf8"));
  const embeddingCache = JSON.parse(fs.readFileSync("public/data/ire26-session-embeddings.json", "utf8"));
  const normalized = normalizeSchedule(rawSchedule);

  assert.equal(getScheduleEmbeddingFingerprint(normalized.sessions), embeddingCache.scheduleFingerprint);
  assert.ok(buildEmbeddingsById(embeddingCache).size > 0);
});
