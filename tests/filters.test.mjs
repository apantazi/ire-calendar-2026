import test from "node:test";
import assert from "node:assert/strict";

import { matchSessionFilters, getRecordingBucket } from "../src/lib/filters.js";
import { normalizeSchedule } from "../src/lib/schedule.js";

const rawSchedule = {
  sessions: [
    {
      id: "panel-recorded",
      title: "Recorded panel",
      description: "A panel about accountability.",
      startsAt: "2026-06-18T09:00:00",
      endsAt: "2026-06-18T10:00:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: [],
      categoryItems: [441467, 481147],
      roomId: 79328,
      status: "Accepted",
    },
    {
      id: "training-not-recorded",
      title: "Hands-on records training",
      description: "Bring a laptop.",
      startsAt: "2026-06-18T10:15:00",
      endsAt: "2026-06-18T11:15:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: [],
      categoryItems: [441468, 481148],
      roomId: 79330,
      status: "Accepted",
    },
    {
      id: "service-unknown",
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
    {
      id: "master-class",
      title: "Investigative skills master class",
      description: "A deeper workshop.",
      startsAt: "2026-06-18T14:00:00",
      endsAt: "2026-06-18T17:00:00",
      isServiceSession: false,
      isPlenumSession: false,
      speakers: [],
      categoryItems: [441469, 481148],
      roomId: 79330,
      status: "Accepted",
    },
  ],
  speakers: [],
  categories: [
    {
      id: 122182,
      title: "Session type",
      type: "session",
      sort: 1,
      items: [
        { id: 441467, name: "Panel", sort: 1 },
        { id: 441468, name: "Hands-on training", sort: 2 },
        { id: 441469, name: "Master class", sort: 3 },
      ],
    },
    {
      id: 132916,
      title: "Recorded?",
      type: "session",
      sort: 56,
      items: [
        { id: 481147, name: "This session *will* be recorded", sort: 1 },
        { id: 481148, name: "This session *will not* be recorded", sort: 2 },
      ],
    },
  ],
  rooms: [
    { id: 84393, name: "Conference-wide", sort: 0 },
    { id: 79328, name: "National Harbor 2", sort: 1 },
    { id: 79330, name: "National Harbor 3", sort: 2 },
  ],
  questions: [],
};

test("filters sessions by session type", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const matches = normalized.sessions.filter((session) =>
    matchSessionFilters(session, {
      sessionType: "Panel",
      recording: "all",
      day: "all",
      track: "all",
      roomPrefix: "all",
      includeService: true,
      search: "",
    }),
  );

  assert.deepEqual(matches.map((session) => session.id), ["panel-recorded"]);
});

test("filters sessions by recorded/not recorded/unknown status", () => {
  const normalized = normalizeSchedule(rawSchedule);

  const recorded = normalized.sessions.filter((session) =>
    matchSessionFilters(session, { recording: "recorded", includeService: true }),
  );
  const notRecorded = normalized.sessions.filter((session) =>
    matchSessionFilters(session, { recording: "not-recorded", includeService: true }),
  );
  const unknown = normalized.sessions.filter((session) =>
    matchSessionFilters(session, { recording: "unknown", includeService: true }),
  );

  assert.deepEqual(recorded.map((session) => session.id), ["panel-recorded"]);
  assert.deepEqual(notRecorded.map((session) => session.id), ["training-not-recorded", "master-class"]);
  assert.deepEqual(unknown.map((session) => session.id), ["service-unknown"]);
});

test("can filter out master classes while keeping other session types", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const matches = normalized.sessions.filter((session) =>
    matchSessionFilters(session, {
      includeMasterClasses: false,
      includeService: true,
      recording: "all",
      sessionType: "all",
    }),
  );

  assert.deepEqual(
    matches.map((session) => session.id),
    ["panel-recorded", "training-not-recorded", "service-unknown"],
  );
});

test("filters sessions by exact duration", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const matches = normalized.sessions.filter((session) =>
    matchSessionFilters(session, {
      durationMinutes: "60",
      includeMasterClasses: true,
      includeService: true,
      recording: "all",
      sessionType: "all",
    }),
  );

  assert.deepEqual(matches.map((session) => session.id), ["panel-recorded", "training-not-recorded"]);
});

test("filters sessions by multiple selected durations", () => {
  const normalized = normalizeSchedule(rawSchedule);
  const matches = normalized.sessions.filter((session) =>
    matchSessionFilters(session, {
      durationMinutes: ["60", "120"],
      includeMasterClasses: true,
      includeService: true,
      recording: "all",
      sessionType: "all",
    }),
  );

  assert.deepEqual(matches.map((session) => session.id), [
    "panel-recorded",
    "training-not-recorded",
    "service-unknown",
  ]);
});

test("classifies recording labels defensively", () => {
  assert.equal(getRecordingBucket("This session *will* be recorded"), "recorded");
  assert.equal(getRecordingBucket("This session *will not* be recorded"), "not-recorded");
  assert.equal(getRecordingBucket(""), "unknown");
});
