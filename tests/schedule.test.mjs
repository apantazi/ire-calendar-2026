import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSchedule, getRoomPrefix } from "../src/lib/schedule.js";
import { addSavedPlan } from "../src/lib/plans.js";
import { buildAutoSchedule, getConflictSlots } from "../src/lib/autoBuilder.js";
import {
  exportPersonalSchedule,
  exportSessionsToCsv,
  exportSessionsToIcs,
  parsePersonalSchedule,
} from "../src/lib/exports.js";

const rawSchedule = {
  sessions: [
    {
      id: "anchor",
      title: "Anchor data session",
      description: "A useful anchor session.",
      startsAt: "2026-06-18T09:00:00",
      endsAt: "2026-06-18T10:00:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: ["speaker-1"],
      categoryItems: [441467, 458388, 481147],
      roomId: 79328,
      liveUrl: null,
      recordingUrl: null,
      status: "Accepted",
      isInformed: true,
      isConfirmed: true,
    },
    {
      id: "same-prefix",
      title: "Nearby follow-up",
      description: "Same room prefix and no conflict.",
      startsAt: "2026-06-18T10:15:00",
      endsAt: "2026-06-18T11:15:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: ["speaker-2"],
      categoryItems: [441468, 458406, 481148],
      roomId: 79330,
      status: "Accepted",
    },
    {
      id: "different-prefix",
      title: "Farther away",
      description: "Different room prefix.",
      startsAt: "2026-06-18T10:15:00",
      endsAt: "2026-06-18T11:15:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: ["speaker-2"],
      categoryItems: [441468, 458406, 481148],
      roomId: 81420,
      status: "Accepted",
    },
    {
      id: "semantic-match",
      title: "Digging into anchor data",
      description: "A useful anchor data session follow-up with documents and analysis.",
      startsAt: "2026-06-18T11:30:00",
      endsAt: "2026-06-18T12:30:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: ["speaker-2"],
      categoryItems: [441468, 458388, 481148],
      roomId: 81420,
      status: "Accepted",
    },
    {
      id: "nearby-low-relevance",
      title: "Nearby sports writing",
      description: "A session about sports notebooks and daily beats.",
      startsAt: "2026-06-18T11:30:00",
      endsAt: "2026-06-18T12:30:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: ["speaker-2"],
      categoryItems: [441468, 458406, 481148],
      roomId: 79330,
      status: "Accepted",
    },
    {
      id: "conflict",
      title: "Overlapping session",
      description: "Conflicts with the anchor.",
      startsAt: "2026-06-18T09:30:00",
      endsAt: "2026-06-18T10:30:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: ["speaker-2"],
      categoryItems: [441467, 458404, 481147],
      roomId: 79329,
      status: "Accepted",
    },
    {
      id: "lunch",
      title: "Lunch",
      description: "",
      startsAt: "2026-06-18T12:30:00",
      endsAt: "2026-06-18T14:30:00",
      isServiceSession: true,
      isPlenumSession: false,
      speakers: [],
      categoryItems: [],
      roomId: 84393,
      status: null,
    },
  ],
  speakers: [
    {
      id: "speaker-1",
      firstName: "Ada",
      lastName: "Lovelace",
      fullName: "Ada Lovelace",
      bio: "Data pioneer.",
      tagLine: "Analytical News",
      profilePicture: "https://example.com/ada.jpg",
      isTopSpeaker: false,
      links: [],
      sessions: ["anchor"],
      categoryItems: [],
      questionAnswers: [],
    },
    {
      id: "speaker-2",
      firstName: "Ida",
      lastName: "Wells",
      fullName: "Ida Wells",
      bio: "Investigative reporter.",
      tagLine: "Accountability Desk",
      profilePicture: "",
      isTopSpeaker: false,
      links: [],
      sessions: ["same-prefix", "different-prefix", "conflict", "semantic-match", "nearby-low-relevance"],
      categoryItems: [],
      questionAnswers: [],
    },
  ],
  categories: [
    {
      id: 122182,
      title: "Session type",
      type: "session",
      sort: 1,
      items: [
        { id: 441467, name: "Panel", sort: 1 },
        { id: 441468, name: "Hands-on training", sort: 2 },
      ],
    },
    {
      id: 127056,
      title: "Tracks",
      type: "session",
      sort: 40,
      items: [
        { id: 458388, name: "Data analysis", sort: 10 },
        { id: 458404, name: "Story ideas", sort: 26 },
        { id: 458406, name: "Tools & tech", sort: 28 },
      ],
    },
    {
      id: 132916,
      title: "Recorded?",
      type: "session",
      sort: 56,
      items: [
        { id: 481147, name: "This session *will* be recorded ✅", sort: 1 },
        { id: 481148, name: "This session *will not* be recorded ⛔️", sort: 2 },
      ],
    },
  ],
  rooms: [
    { id: 84393, name: "Conference-wide", sort: 0 },
    { id: 79328, name: "National Harbor 2", sort: 1 },
    { id: 79330, name: "National Harbor 3", sort: 2 },
    { id: 79329, name: "National Harbor 4-5", sort: 3 },
    { id: 81420, name: "Maryland 1-2", sort: 13 },
  ],
  questions: [],
};

test("normalizes Sessionize schedule into joined app entities", () => {
  const normalized = normalizeSchedule(rawSchedule);

  assert.equal(normalized.sessions.length, 7);
  assert.equal(normalized.speakers.length, 2);
  assert.deepEqual(normalized.days.map((day) => day.date), ["2026-06-18"]);

  const anchor = normalized.sessionsById.get("anchor");
  assert.equal(anchor.room, "National Harbor 2");
  assert.equal(anchor.roomPrefix, "National Harbor");
  assert.equal(anchor.date, "2026-06-18");
  assert.equal(anchor.dayName, "Thursday");
  assert.equal(anchor.startTime, "9:00 AM");
  assert.equal(anchor.endTime, "10:00 AM");
  assert.equal(anchor.durationMinutes, 60);
  assert.equal(anchor.sessionKind, "Content");
  assert.equal(anchor.sessionType, "Panel");
  assert.deepEqual(anchor.trackNames, ["Data analysis"]);
  assert.equal(anchor.recordingStatus, "This session *will* be recorded ✅");
  assert.deepEqual(anchor.speakerNames, ["Ada Lovelace"]);

  const ada = normalized.speakersById.get("speaker-1");
  assert.equal(ada.fullName, "Ada Lovelace");
  assert.deepEqual(ada.sessionIds, ["anchor"]);
  assert.equal(ada.sessions[0].title, "Anchor data session");
});

test("derives stable room prefixes for proximity planning", () => {
  assert.equal(getRoomPrefix("National Harbor 12-13"), "National Harbor");
  assert.equal(getRoomPrefix("Maryland A"), "Maryland");
  assert.equal(getRoomPrefix("Maryland Foyer"), "Maryland Foyer");
  assert.equal(getRoomPrefix("Chesapeake JKL"), "Chesapeake");
  assert.equal(getRoomPrefix("Conference-wide"), "Conference-wide");
});

test("auto-builder preserves anchors and fills nearby non-conflicting sessions", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const result = buildAutoSchedule(normalized, {
    anchorsByDay: { "2026-06-18": ["anchor"] },
    includeServiceSessions: false,
  });

  assert.deepEqual(result.selectedSessionIds, ["anchor", "same-prefix", "nearby-low-relevance"]);
  assert.deepEqual(result.skippedConflicts.map((session) => session.id), ["conflict"]);
  assert.equal(result.recommendationsByDay["2026-06-18"][0].id, "same-prefix");
});

test("auto-builder relevance strategy chooses semantically closer sessions over nearby rooms", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const result = buildAutoSchedule(normalized, {
    anchorsByDay: { "2026-06-18": ["anchor"] },
    includeServiceSessions: false,
    strategy: "relevance",
  });

  assert.deepEqual(result.selectedSessionIds, ["anchor", "same-prefix", "semantic-match"]);
  assert.equal(result.recommendationsByDay["2026-06-18"].at(-1).id, "semantic-match");
  assert.ok(result.recommendationsByDay["2026-06-18"].at(-1).relevanceScore > 0);
});

test("auto-builder relevance strategy can use supplied embedding vectors", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const result = buildAutoSchedule(normalized, {
    anchorsByDay: { "2026-06-18": ["anchor"] },
    includeServiceSessions: false,
    strategy: "relevance",
    embeddingsBySessionId: new Map([
      ["anchor", [1, 0]],
      ["same-prefix", [0.8, 0.2]],
      ["semantic-match", [0.95, 0.05]],
      ["nearby-low-relevance", [0, 1]],
      ["different-prefix", [0, 1]],
      ["conflict", [0, 1]],
    ]),
  });

  assert.deepEqual(result.selectedSessionIds, ["anchor", "same-prefix", "semantic-match"]);
  assert.equal(result.relevanceProvider, "qwen-embeddings");
  assert.ok(result.recommendationsByDay["2026-06-18"].at(-1).relevanceScore > 90);
});

test("auto-builder preferred tracks can beat nearby rooms inside a time slot", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const result = buildAutoSchedule(normalized, {
    anchorsByDay: { "2026-06-18": ["anchor"] },
    includeServiceSessions: false,
    strategy: "proximity",
    preferredTrackNames: ["Data analysis"],
  });

  assert.deepEqual(result.selectedSessionIds, ["anchor", "same-prefix", "semantic-match"]);
  assert.equal(result.recommendationsByDay["2026-06-18"].at(-1).id, "semantic-match");
  assert.equal(result.recommendationsByDay["2026-06-18"].at(-1).trackPreferenceScore, 1);
});

test("auto-builder excluded tracks are removed from generated recommendations", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const result = buildAutoSchedule(normalized, {
    anchorsByDay: { "2026-06-18": ["anchor"] },
    includeServiceSessions: false,
    strategy: "proximity",
    excludedTrackNames: ["Tools & tech"],
  });

  assert.deepEqual(result.selectedSessionIds, ["anchor", "semantic-match"]);
  assert.deepEqual(
    result.recommendationsByDay["2026-06-18"].map((session) => session.id),
    ["semantic-match"],
  );
});

test("auto-builder rejected suggestions promote the next ranked candidate", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const result = buildAutoSchedule(normalized, {
    anchorsByDay: { "2026-06-18": ["anchor"] },
    includeServiceSessions: false,
    strategy: "proximity",
    rejectedSessionIds: ["same-prefix"],
  });

  assert.deepEqual(result.selectedSessionIds, ["anchor", "different-prefix", "nearby-low-relevance"]);
  assert.deepEqual(
    result.recommendationsByDay["2026-06-18"].map((session) => session.id),
    ["different-prefix", "nearby-low-relevance"],
  );
});

test("auto-builder exposes time-slot candidates sorted by relevance", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const result = buildAutoSchedule(normalized, {
    anchorsByDay: { "2026-06-18": ["anchor"] },
    includeServiceSessions: false,
    strategy: "relevance",
    embeddingsBySessionId: new Map([
      ["anchor", [1, 0]],
      ["same-prefix", [0.8, 0.2]],
      ["semantic-match", [0.95, 0.05]],
      ["nearby-low-relevance", [0, 1]],
      ["different-prefix", [0, 1]],
      ["conflict", [0, 1]],
    ]),
  });

  const daySlots = result.candidateSlotsByDay["2026-06-18"];
  const midmorning = daySlots.find((slot) => slot.timeBlock === "10:15 AM - 11:15 AM");
  const lateMorning = daySlots.find((slot) => slot.timeBlock === "11:30 AM - 12:30 PM");

  assert.deepEqual(midmorning.candidates.map((session) => session.id), ["same-prefix", "different-prefix"]);
  assert.deepEqual(lateMorning.candidates.map((session) => session.id), ["semantic-match", "nearby-low-relevance"]);
  assert.ok(lateMorning.candidates[0].relevanceScore > lateMorning.candidates[1].relevanceScore);
});

test("conflict slots identify overlapping selected sessions", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const selected = ["anchor", "conflict", "lunch"].map((id) => normalized.sessionsById.get(id));

  const slots = getConflictSlots(selected);

  assert.equal(slots.length, 1);
  assert.equal(slots[0].date, "2026-06-18");
  assert.equal(slots[0].timeBlock, "9:00 AM - 10:30 AM");
  assert.deepEqual(slots[0].sessions.map((session) => session.id), ["anchor", "conflict"]);
});

test("saved plans append new named plans without overwriting existing ones", () => {
  const plans = addSavedPlan([], {
    name: "Manual plan",
    sessionIds: ["anchor", "same-prefix", "anchor"],
    source: "manual",
    id: "plan-1",
    createdAt: "2026-06-08T12:00:00.000Z",
  });
  const next = addSavedPlan(plans, {
    name: "Generated relevance plan",
    sessionIds: ["anchor", "semantic-match"],
    source: "auto-relevance",
    id: "plan-2",
    createdAt: "2026-06-08T12:05:00.000Z",
  });

  assert.equal(next.length, 2);
  assert.deepEqual(next.map((plan) => plan.name), ["Generated relevance plan", "Manual plan"]);
  assert.deepEqual(next[1].sessionIds, ["anchor", "same-prefix"]);
});

test("auto-builder does not generate sessions for days with no anchors", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const result = buildAutoSchedule(normalized, {
    anchorsByDay: {},
    includeServiceSessions: false,
  });

  assert.deepEqual(result.selectedSessionIds, []);
  assert.deepEqual(result.recommendationsByDay["2026-06-18"], []);
});

test("exports selected sessions to CSV and ICS", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const selected = ["anchor", "same-prefix"].map((id) => normalized.sessionsById.get(id));

  const csv = exportSessionsToCsv(selected);
  assert.match(csv, /"Anchor data session","2026-06-18","9:00 AM","10:00 AM","National Harbor 2"/);

  const ics = exportSessionsToIcs(selected);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Anchor data session/);
  assert.match(ics, /LOCATION:National Harbor 2/);
  assert.match(ics, /END:VCALENDAR/);
});

test("exports and imports a personal schedule by selected IDs", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const selected = ["anchor", "same-prefix"].map((id) => normalized.sessionsById.get(id));

  const exported = exportPersonalSchedule(selected);
  const exportedJson = JSON.parse(exported);
  assert.equal(exportedJson.app, "ire-calendar-builder");
  assert.deepEqual(exportedJson.selectedSessionIds, ["anchor", "same-prefix"]);
  assert.equal(exportedJson.sessions[0].title, "Anchor data session");

  const imported = parsePersonalSchedule(
    JSON.stringify({ selectedSessionIds: ["same-prefix", "missing", "same-prefix"] }),
    normalized.sessionsById,
  );
  assert.deepEqual(imported.selectedSessionIds, ["same-prefix"]);
  assert.deepEqual(imported.missingSessionIds, ["missing"]);
});
