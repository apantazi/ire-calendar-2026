import { useEffect, useMemo, useRef, useState } from "react";

import { buildAutoSchedule, getConflicts, getConflictSlots } from "./lib/autoBuilder.js";
import {
  downloadText,
  exportPersonalSchedule,
  exportSessionsToCsv,
  exportSessionsToIcs,
  exportSessionsToJson,
  parsePersonalSchedule,
} from "./lib/exports.js";
import { matchSessionFilters } from "./lib/filters.js";
import {
  buildEmbeddingsById,
  isUsableEmbeddingCache,
  rankSessionsByEmbeddingSearch,
} from "./lib/embeddings.js";
import { addSavedPlan, normalizeSavedPlans } from "./lib/plans.js";
import { normalizeSchedule } from "./lib/schedule.js";
import { getStaticAssetUrl } from "./lib/staticAssets.js";

const SCHEDULE_CACHE_URL = getStaticAssetUrl("data/ire26-schedule.json");
const EMBEDDING_CACHE_URL = getStaticAssetUrl("data/ire26-session-embeddings.json");
const VIEWS = [
  ["schedule", "Schedule"],
  ["calendar", "Calendar"],
  ["mine", "My Calendar"],
  ["builder", "Auto Builder"],
  ["speakers", "Speakers"],
  ["tracks", "Tracks"],
];
const COLORS = [
  "#2364aa",
  "#2f9c95",
  "#d96c2c",
  "#7c5cc4",
  "#3f8f39",
  "#c64f7a",
  "#8a6f20",
  "#417f9e",
  "#b14d39",
  "#5f7f52",
  "#995fa3",
  "#4f6f8f",
];

export default function App() {
  const [rawSchedule, setRawSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastLoaded, setLastLoaded] = useState("");
  const importFileRef = useRef(null);
  const [activeView, setActiveView] = useStoredState("ire26:view", "schedule");
  const [selectedIds, setSelectedIds] = useStoredState("ire26:selectedSessions", []);
  const [savedPlans, setSavedPlans] = useStoredState("ire26:savedPlans", []);
  const [anchorsByDay, setAnchorsByDay] = useStoredState("ire26:anchorsByDay", {});
  const [builderStrategy, setBuilderStrategy] = useStoredState("ire26:autoBuilderStrategy", "proximity");
  const [builderTrackPreferences, setBuilderTrackPreferences] = useStoredState("ire26:autoBuilderTrackPreferences", {
    preferred: [],
    excluded: [],
  });
  const [builderRejectedSessionIds, setBuilderRejectedSessionIds] = useStoredState(
    "ire26:autoBuilderRejectedSessionIds",
    [],
  );
  const [showConflictOnly, setShowConflictOnly] = useStoredState("ire26:showConflictOnly", false);
  const [colorMode, setColorMode] = useStoredState("ire26:colorMode", "room");
  const [filters, setFilters] = useStoredState("ire26:filters", {
    search: "",
    day: "all",
    track: "all",
    roomPrefix: "all",
    sessionType: "all",
    recording: "all",
    durationMinutes: [],
    includeService: true,
    includeMasterClasses: true,
  });
  const [activeDay, setActiveDay] = useStoredState("ire26:activeDay", "");
  const [speakerSearch, setSpeakerSearch] = useState("");
  const [activeTrack, setActiveTrack] = useState("");
  const [detail, setDetail] = useState(null);
  const [planName, setPlanName] = useState("");
  const [embeddingsBySessionId, setEmbeddingsBySessionId] = useState(() => new Map());
  const [embeddingStatus, setEmbeddingStatus] = useState({
    state: "idle",
    message: "Semantic relevance will use local text matching until Qwen embeddings are loaded.",
  });
  const queryEmbeddingsCacheRef = useRef(new Map());
  const [searchEmbedding, setSearchEmbedding] = useState(null);
  const [semanticSearchStatus, setSemanticSearchStatus] = useState({
    state: "idle",
    message: "Search uses local matching until saved Qwen session embeddings and query embeddings are available.",
  });

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const schedule = await fetchSchedule();
        if (ignore) return;
        setRawSchedule(schedule);
        setLastLoaded(new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
      } catch (loadError) {
        if (!ignore) setError(loadError.message);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  const normalized = useMemo(
    () => (rawSchedule ? normalizeSchedule(rawSchedule) : null),
    [rawSchedule],
  );

  useEffect(() => {
    if (!normalized || activeDay) return;
    setActiveDay(normalized.days[0]?.date || "");
  }, [activeDay, normalized, setActiveDay]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSessions = useMemo(() => {
    if (!normalized) return [];
    return selectedIds
      .map((id) => normalized.sessionsById.get(id))
      .filter(Boolean)
      .sort((a, b) => a.startsAtMs - b.startsAtMs || a.roomSort - b.roomSort);
  }, [normalized, selectedIds]);

  const colorMaps = useMemo(() => (normalized ? buildColorMaps(normalized) : null), [normalized]);

  const searchQuery = String(filters.search || "").trim();
  const filterOnlySessions = useMemo(() => {
    if (!normalized) return [];
    return normalized.sessions.filter((session) => matchSessionFilters(session, { ...filters, search: "" }));
  }, [filters, normalized]);

  const localFilteredSessions = useMemo(() => {
    if (!normalized) return [];
    return normalized.sessions.filter((session) => matchSessionFilters(session, filters));
  }, [filters, normalized]);

  const filteredSessions = useMemo(() => {
    if (searchQuery.length >= 3 && searchEmbedding && embeddingsBySessionId.size) {
      return rankSessionsByEmbeddingSearch(searchEmbedding, filterOnlySessions, embeddingsBySessionId);
    }
    return localFilteredSessions;
  }, [embeddingsBySessionId, filterOnlySessions, localFilteredSessions, searchEmbedding, searchQuery.length]);

  const conflicts = useMemo(() => getConflicts(selectedSessions), [selectedSessions]);
  const conflictSlots = useMemo(() => getConflictSlots(selectedSessions), [selectedSessions]);
  const savedPlanList = useMemo(() => normalizeSavedPlans(savedPlans), [savedPlans]);

  const hasBuilderAnchors = useMemo(
    () => Object.values(anchorsByDay || {}).some((sessionIds) => (sessionIds || []).filter(Boolean).length),
    [anchorsByDay],
  );

  useEffect(() => {
    if (!normalized) return;

    let ignore = false;
    fetch(EMBEDDING_CACHE_URL, { headers: { accept: "application/json" } })
      .then((response) => {
        if (response.status === 404) {
          setEmbeddingStatus({
            state: "fallback",
            message: "No saved Qwen embedding cache found. Run npm run build:embeddings to enable semantic relevance.",
          });
          return null;
        }
        if (!response.ok) throw new Error(`Embedding cache returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (ignore || !payload) return;
        if (!isUsableEmbeddingCache(payload, normalized.sessions)) {
          setEmbeddingsBySessionId(new Map());
          setEmbeddingStatus({
            state: "fallback",
            message: "Saved Qwen embeddings are stale for the current schedule. Rebuild the embedding cache.",
          });
          return;
        }

        const cachedEmbeddings = buildEmbeddingsById(payload);
        setEmbeddingsBySessionId(cachedEmbeddings);
        setEmbeddingStatus({
          state: "ready",
          message: `Using saved Qwen embeddings from ${new Date(payload.generatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`,
        });
      })
      .catch((cacheError) => {
        if (ignore) return;
        setEmbeddingsBySessionId(new Map());
        setEmbeddingStatus({
          state: "fallback",
          message: `Saved Qwen embeddings could not be loaded: ${cacheError.message}.`,
        });
      });

    return () => {
      ignore = true;
    };
  }, [normalized]);

  useEffect(() => {
    if (!normalized || activeView !== "builder" || builderStrategy !== "relevance") return;
    if (!hasBuilderAnchors) {
      setEmbeddingStatus({
        state: "idle",
        message: "Pick at least one anchor to use semantic relevance.",
      });
      return;
    }

    if (!embeddingsBySessionId.size) {
      setEmbeddingStatus({
        state: "fallback",
        message: "No saved Qwen embeddings are loaded. Run npm run build:embeddings to enable embedding relevance. Using local text relevance for now.",
      });
      return;
    }

    setEmbeddingStatus({
      state: "ready",
      message: "Using saved Qwen embeddings for semantic relevance.",
    });
  }, [activeView, builderStrategy, embeddingsBySessionId, hasBuilderAnchors, normalized]);

  useEffect(() => {
    setSearchEmbedding(null);

    if (searchQuery.length < 3) {
      setSemanticSearchStatus({
        state: "idle",
        message: "Search uses local matching. Type 3+ characters to rank semantically when embeddings are available.",
      });
      return;
    }

    if (!filterOnlySessions.length) {
      setSemanticSearchStatus({
        state: "fallback",
        message: "No sessions match the non-search filters.",
      });
      return;
    }

    if (!embeddingsBySessionId.size) {
      setSemanticSearchStatus({
        state: "fallback",
        message: "Saved session embeddings are not loaded. Showing local matches.",
      });
      return;
    }

    const cachedEmbedding = queryEmbeddingsCacheRef.current.get(searchQuery.toLowerCase());
    if (cachedEmbedding) {
      setSearchEmbedding(cachedEmbedding);
      setSemanticSearchStatus({
        state: "ready",
        message: `Semantic search ranked ${filterOnlySessions.length} candidate session${filterOnlySessions.length === 1 ? "" : "s"}.`,
      });
      return;
    }

    let ignore = false;
    const controller = new AbortController();
    setSemanticSearchStatus({
      state: "loading",
      message: "Embedding search query with Qwen...",
    });

    const timeoutId = window.setTimeout(() => {
      fetchQueryEmbedding(searchQuery, controller.signal)
        .then((embedding) => {
          if (ignore) return;
          queryEmbeddingsCacheRef.current.set(searchQuery.toLowerCase(), embedding);
          setSearchEmbedding(embedding);
          setSemanticSearchStatus({
            state: "ready",
            message: `Semantic search ranked ${filterOnlySessions.length} candidate session${filterOnlySessions.length === 1 ? "" : "s"}.`,
          });
        })
        .catch((embeddingError) => {
          if (ignore || embeddingError.name === "AbortError") return;
          setSemanticSearchStatus({
            state: "fallback",
            message: `Query embedding unavailable: ${stripTrailingPunctuation(embeddingError.message)}. Showing local matches.`,
          });
        });
    }, 350);

    return () => {
      ignore = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [embeddingsBySessionId, filterOnlySessions.length, searchQuery]);

  function toggleSelected(sessionId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return [...next];
    });
  }

  function refreshSchedule() {
    setLoading(true);
    setError("");
    fetchSchedule()
      .then((schedule) => {
        setRawSchedule(schedule);
        setLastLoaded(new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
      })
      .catch((refreshError) => setError(refreshError.message))
      .finally(() => setLoading(false));
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function exportSelected(format) {
    if (!selectedSessions.length) {
      setNotice("Add at least one session to your calendar before exporting ICS.");
      return;
    }
    if (format === "ics") {
      downloadText("ire26-my-schedule.ics", exportSessionsToIcs(selectedSessions), "text/calendar");
      setNotice(`Exported ${selectedSessions.length} selected session${selectedSessions.length === 1 ? "" : "s"} to ICS.`);
    }
    if (format === "csv") {
      downloadText("ire26-my-schedule.csv", exportSessionsToCsv(selectedSessions), "text/csv");
      setNotice(`Exported ${selectedSessions.length} selected session${selectedSessions.length === 1 ? "" : "s"} to CSV.`);
    }
    if (format === "json") {
      downloadText("ire26-my-schedule.json", exportSessionsToJson(selectedSessions), "application/json");
      setNotice(`Exported ${selectedSessions.length} selected session${selectedSessions.length === 1 ? "" : "s"} to JSON.`);
    }
  }

  function exportPersonalScheduleFile() {
    if (!selectedSessions.length) {
      setNotice("Add at least one session before saving a personal schedule file.");
      return;
    }
    downloadText(
      "ire26-personal-schedule.json",
      exportPersonalSchedule(selectedSessions),
      "application/json",
    );
    setNotice(`Saved an importable personal schedule with ${selectedSessions.length} selected session${selectedSessions.length === 1 ? "" : "s"}.`);
  }

  async function importPersonalScheduleFile(event) {
    const file = event.target.files?.[0];
    if (!file || !normalized) return;

    try {
      const imported = parsePersonalSchedule(await file.text(), normalized.sessionsById);
      setSelectedIds(imported.selectedSessionIds);
      setActiveView("mine");
      const missingNote = imported.missingSessionIds.length
        ? ` ${imported.missingSessionIds.length} saved session${imported.missingSessionIds.length === 1 ? "" : "s"} were not found in the current schedule.`
        : "";
      setNotice(`Imported ${imported.selectedSessionIds.length} session${imported.selectedSessionIds.length === 1 ? "" : "s"} into My Calendar.${missingNote}`);
    } catch (importError) {
      setNotice(`Could not import that schedule: ${importError.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function savePlanFromIds(sessionIds, { name = "", source = "manual" } = {}) {
    if (!normalized) return null;
    const validSessionIds = [...new Set(sessionIds.map(String))].filter((id) => normalized.sessionsById.has(id));
    if (!validSessionIds.length) {
      setNotice("Add at least one session before saving a plan.");
      return null;
    }

    const nextPlans = addSavedPlan(savedPlanList, {
      name,
      sessionIds: validSessionIds,
      source,
    });
    setSavedPlans(nextPlans);
    setPlanName("");
    setNotice(`Saved "${nextPlans[0].name}" with ${validSessionIds.length} session${validSessionIds.length === 1 ? "" : "s"}.`);
    return nextPlans[0];
  }

  function saveCurrentPlan() {
    savePlanFromIds(selectedIds, { name: planName, source: "manual" });
  }

  function loadSavedPlan(planId) {
    if (!normalized) return;
    const plan = savedPlanList.find((savedPlan) => savedPlan.id === planId);
    if (!plan) return;
    const validSessionIds = plan.sessionIds.filter((id) => normalized.sessionsById.has(id));
    const missingCount = plan.sessionIds.length - validSessionIds.length;
    setSelectedIds(validSessionIds);
    setActiveView("mine");
    setNotice(
      `Loaded "${plan.name}" with ${validSessionIds.length} session${validSessionIds.length === 1 ? "" : "s"}.${missingCount ? ` ${missingCount} saved session${missingCount === 1 ? "" : "s"} were not found in the current schedule.` : ""}`,
    );
  }

  function deleteSavedPlan(planId) {
    const plan = savedPlanList.find((savedPlan) => savedPlan.id === planId);
    setSavedPlans(savedPlanList.filter((savedPlan) => savedPlan.id !== planId));
    if (plan) setNotice(`Deleted "${plan.name}".`);
  }

  if (loading && !normalized) {
    return <StatusScreen title="Loading IRE schedule" detail="Fetching Sessionize data..." />;
  }

  if (error && !normalized) {
    return (
      <StatusScreen
        title="Could not load schedule"
        detail={error}
        action={<button onClick={refreshSchedule}>Try again</button>}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>IRE 2026 Calendar Builder</h1>
          <p>
            {normalized.sessions.length} schedule rows, {normalized.speakers.length} speakers,
            {normalized.tracks.length} active tracks
          </p>
        </div>
        <div className="header-actions">
          <span className="load-status">{lastLoaded ? `Updated ${lastLoaded}` : "Not loaded"}</span>
          <button className="ghost-button" onClick={refreshSchedule} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="inline-error">{error}</div> : null}
      {notice ? <div className="inline-note">{notice}</div> : null}

      <nav className="view-tabs" aria-label="App views">
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            className={activeView === id ? "active" : ""}
            onClick={() => setActiveView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="summary-strip">
        <Metric label="Selected" value={selectedSessions.length} />
        <Metric label="Conflicts" value={conflicts.length} tone={conflicts.length ? "warn" : ""} />
        <Metric label="Days" value={normalized.days.length} />
        <Metric label="Rooms" value={normalized.rooms.length} />
        <div className="export-bar">
          <button onClick={() => exportSelected("ics")}>
            My ICS
          </button>
          <button disabled={!selectedSessions.length} onClick={() => exportSelected("csv")}>
            CSV
          </button>
          <button disabled={!selectedSessions.length} onClick={() => exportSelected("json")}>
            JSON
          </button>
          <button disabled={!selectedSessions.length} onClick={() => window.print()}>
            Print
          </button>
          <button disabled={!selectedSessions.length} onClick={exportPersonalScheduleFile}>
            Save plan
          </button>
          <button onClick={() => importFileRef.current?.click()}>
            Import plan
          </button>
          <input
            ref={importFileRef}
            className="file-input-hidden"
            type="file"
            accept=".json,application/json"
            onChange={importPersonalScheduleFile}
            hidden
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
      </section>

      <PlanManager
        planName={planName}
        setPlanName={setPlanName}
        selectedCount={selectedSessions.length}
        savedPlans={savedPlanList}
        saveCurrentPlan={saveCurrentPlan}
        loadSavedPlan={loadSavedPlan}
        deleteSavedPlan={deleteSavedPlan}
      />

      {(activeView === "schedule" || activeView === "calendar") && (
        <Filters
          normalized={normalized}
          filters={filters}
          colorMode={colorMode}
          updateFilter={updateFilter}
          setColorMode={setColorMode}
          semanticSearchStatus={semanticSearchStatus}
        />
      )}

      <main>
        {activeView === "schedule" && (
          <ScheduleList
            sessions={filteredSessions}
            selectedSet={selectedSet}
            toggleSelected={toggleSelected}
            setDetail={setDetail}
            setActiveView={setActiveView}
            updateFilter={updateFilter}
            colorMode={colorMode}
            colorMaps={colorMaps}
          />
        )}

        {activeView === "calendar" && (
          <CalendarPanel
            title="Full Schedule"
            sessions={filteredSessions}
            normalized={normalized}
            selectedSet={selectedSet}
            toggleSelected={toggleSelected}
            setDetail={setDetail}
            activeDay={activeDay}
            setActiveDay={setActiveDay}
            colorMode={colorMode}
            colorMaps={colorMaps}
          />
        )}

        {activeView === "mine" && (
          <MyCalendar
            sessions={selectedSessions}
            conflicts={conflicts}
            conflictSlots={conflictSlots}
            showConflictOnly={showConflictOnly}
            setShowConflictOnly={setShowConflictOnly}
            normalized={normalized}
            selectedSet={selectedSet}
            toggleSelected={toggleSelected}
            setDetail={setDetail}
            activeDay={activeDay}
            setActiveDay={setActiveDay}
            colorMode={colorMode}
            colorMaps={colorMaps}
          />
        )}

        {activeView === "builder" && (
          <AutoBuilder
            normalized={normalized}
            anchorsByDay={anchorsByDay}
            setAnchorsByDay={setAnchorsByDay}
            setSelectedIds={setSelectedIds}
            saveGeneratedPlan={(sessionIds, strategy) =>
              savePlanFromIds(sessionIds, {
                source: strategy === "relevance" ? "auto-relevance" : "auto-proximity",
              })
            }
            builderStrategy={builderStrategy}
            setBuilderStrategy={setBuilderStrategy}
            trackPreferences={builderTrackPreferences}
            setTrackPreferences={setBuilderTrackPreferences}
            rejectedSessionIds={builderRejectedSessionIds}
            setRejectedSessionIds={setBuilderRejectedSessionIds}
            embeddingsBySessionId={embeddingsBySessionId}
            embeddingStatus={embeddingStatus}
            selectedSet={selectedSet}
            toggleSelected={toggleSelected}
            setDetail={setDetail}
            colorMode={colorMode}
            colorMaps={colorMaps}
          />
        )}

        {activeView === "speakers" && (
          <SpeakersView
            normalized={normalized}
            search={speakerSearch}
            setSearch={setSpeakerSearch}
            setDetail={setDetail}
          />
        )}

        {activeView === "tracks" && (
          <TracksView
            normalized={normalized}
            activeTrack={activeTrack}
            setActiveTrack={setActiveTrack}
            selectedSet={selectedSet}
            toggleSelected={toggleSelected}
            setDetail={setDetail}
            colorMode={colorMode}
            colorMaps={colorMaps}
          />
        )}
      </main>

      {detail ? (
        <DetailDrawer
          detail={detail}
          normalized={normalized}
          selectedSet={selectedSet}
          toggleSelected={toggleSelected}
          setDetail={setDetail}
          setActiveView={setActiveView}
          updateFilter={updateFilter}
          colorMode={colorMode}
          colorMaps={colorMaps}
        />
      ) : null}
    </div>
  );
}

function PlanManager({
  planName,
  setPlanName,
  selectedCount,
  savedPlans,
  saveCurrentPlan,
  loadSavedPlan,
  deleteSavedPlan,
}) {
  return (
    <section className="plan-panel" aria-label="Saved plans">
      <label className="plan-name-field">
        <span>Plan name</span>
        <input
          name="plan-name"
          value={planName}
          onChange={(event) => setPlanName(event.target.value)}
          placeholder="Name this schedule"
        />
      </label>
      <button className="primary-button" disabled={!selectedCount} onClick={saveCurrentPlan}>
        Save current as new plan
      </button>
      <div className="saved-plans">
        {savedPlans.length ? (
          savedPlans.map((plan) => (
            <article key={plan.id} className="saved-plan">
              <div>
                <strong>{plan.name}</strong>
                <span>
                  {plan.sessionIds.length} session{plan.sessionIds.length === 1 ? "" : "s"} · {planLabel(plan.source)}
                </span>
              </div>
              <button onClick={() => loadSavedPlan(plan.id)}>Load</button>
              <button className="ghost-button" onClick={() => deleteSavedPlan(plan.id)}>
                Delete
              </button>
            </article>
          ))
        ) : (
          <p>No saved plans yet.</p>
        )}
      </div>
    </section>
  );
}

function Filters({ normalized, filters, colorMode, updateFilter, setColorMode, semanticSearchStatus }) {
  const durationOptions = [...new Set(normalized.sessions.map((session) => session.durationMinutes).filter(Boolean))]
    .sort((a, b) => a - b);
  const selectedDurations = normalizeSelectedDurations(filters.durationMinutes);

  function toggleDuration(duration, checked) {
    const value = String(duration);
    const next = checked
      ? [...selectedDurations, value]
      : selectedDurations.filter((selected) => selected !== value);
    updateFilter("durationMinutes", [...new Set(next)].sort((a, b) => Number(a) - Number(b)));
  }

  return (
    <section className="filters-panel">
      <label className="search-field">
        <span>Search</span>
        <input
          name="schedule-search"
          value={filters.search}
          onChange={(event) => updateFilter("search", event.target.value)}
          placeholder="Title, speaker, description, room"
        />
      </label>
      <div className={`search-status ${semanticSearchStatus?.state || "idle"}`}>
        {semanticSearchStatus?.message || "Search uses local matching."}
      </div>

      <label>
        <span>Day</span>
        <select name="schedule-day" value={filters.day} onChange={(event) => updateFilter("day", event.target.value)}>
          <option value="all">All days</option>
          {normalized.days.map((day) => (
            <option key={day.date} value={day.date}>
              {day.dayName}, {shortDate(day.date)}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Track</span>
        <select name="schedule-track" value={filters.track || "all"} onChange={(event) => updateFilter("track", event.target.value)}>
          <option value="all">All tracks</option>
          {normalized.tracks.map((track) => (
            <option key={track.name} value={track.name}>
              {track.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Session type</span>
        <select
          name="schedule-session-type"
          value={filters.sessionType || "all"}
          onChange={(event) => updateFilter("sessionType", event.target.value)}
        >
          <option value="all">All session types</option>
          {normalized.sessionTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Room area</span>
        <select
          name="schedule-room-area"
          value={filters.roomPrefix || "all"}
          onChange={(event) => updateFilter("roomPrefix", event.target.value)}
        >
          <option value="all">All room areas</option>
          {normalized.roomPrefixes.map((prefix) => (
            <option key={prefix} value={prefix}>
              {prefix}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Recorded</span>
        <select
          name="schedule-recording"
          value={filters.recording || "all"}
          onChange={(event) => updateFilter("recording", event.target.value)}
        >
          <option value="all">All recording statuses</option>
          <option value="recorded">Recorded</option>
          <option value="not-recorded">Not recorded</option>
          <option value="unknown">Not specified</option>
        </select>
      </label>

      <label>
        <span>Color</span>
        <select name="schedule-color-mode" value={colorMode} onChange={(event) => setColorMode(event.target.value)}>
          <option value="room">Room area</option>
          <option value="track">Track</option>
          <option value="type">Session type</option>
        </select>
      </label>

      <label className="check-row">
        <input
          name="show-breaks"
          type="checkbox"
          checked={filters.includeService ?? true}
          onChange={(event) => updateFilter("includeService", event.target.checked)}
        />
        <span>Show breaks</span>
      </label>

      <label className="check-row">
        <input
          name="show-master-classes"
          type="checkbox"
          checked={filters.includeMasterClasses ?? true}
          onChange={(event) => updateFilter("includeMasterClasses", event.target.checked)}
        />
        <span>Show master classes</span>
      </label>

      <fieldset className="duration-filter-row">
        <legend>Length</legend>
        <button
          type="button"
          className={selectedDurations.length ? "ghost-button small-button" : "primary-button small-button"}
          onClick={() => updateFilter("durationMinutes", [])}
        >
          All lengths
        </button>
        {durationOptions.map((duration) => (
          <label key={duration} className="duration-check">
            <input
              type="checkbox"
              checked={selectedDurations.includes(String(duration))}
              onChange={(event) => toggleDuration(duration, event.target.checked)}
            />
            <span>{formatDuration(duration)}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function ScheduleList(props) {
  const byDay = groupBy(props.sessions, (session) => session.date);

  if (!props.sessions.length) {
    return <EmptyState title="No sessions match those filters" />;
  }

  return (
    <section className="session-list">
      {[...byDay.entries()].map(([date, sessions]) => (
        <div key={date} className="day-section">
          <div className="section-heading">
            <h2>
              {sessions[0]?.dayName}, {shortDate(date)}
            </h2>
            <span>{sessions.length} rows</span>
          </div>
          <div className="session-stack">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} {...props} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function CalendarPanel({
  title,
  sessions,
  normalized,
  selectedSet,
  toggleSelected,
  setDetail,
  activeDay,
  setActiveDay,
  colorMode,
  colorMaps,
}) {
  const daySessions = sessions.filter((session) => session.date === activeDay);
  const rows = groupBy(daySessions, (session) => session.timeBlock);

  return (
    <section className="calendar-panel">
      <div className="section-heading">
        <h2>{title}</h2>
        <DayTabs days={normalized.days} activeDay={activeDay} setActiveDay={setActiveDay} />
      </div>
      {!daySessions.length ? (
        <EmptyState title="Nothing scheduled for this day" />
      ) : (
        <div className="calendar-grid">
          {[...rows.entries()].map(([timeBlock, rowSessions]) => (
            <div key={timeBlock} className="time-row">
              <div className="time-label">{timeBlock}</div>
              <div className="time-events">
                {rowSessions.map((session) => (
                  <MiniSession
                    key={session.id}
                    session={session}
                    selectedSet={selectedSet}
                    toggleSelected={toggleSelected}
                    setDetail={setDetail}
                    colorMode={colorMode}
                    colorMaps={colorMaps}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MyCalendar({
  sessions,
  conflicts,
  conflictSlots,
  showConflictOnly,
  setShowConflictOnly,
  normalized,
  selectedSet,
  toggleSelected,
  setDetail,
  colorMode,
  colorMaps,
}) {
  if (!sessions.length) {
    return <EmptyState title="No sessions selected yet" detail="Add sessions from Schedule, Tracks, or Auto Builder." />;
  }

  const conflictSessionIds = new Set(conflictSlots.flatMap((slot) => slot.sessions.map((session) => session.id)));
  const visibleSessions = showConflictOnly
    ? sessions.filter((session) => conflictSessionIds.has(session.id))
    : sessions;

  return (
    <section className="my-calendar">
      {conflicts.length ? (
        <div className="conflict-banner">
          {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} across {conflictSlots.length} time block{conflictSlots.length === 1 ? "" : "s"}.
        </div>
      ) : null}
      <div className="my-calendar-tools">
        <label className="check-row compact-check">
          <input
            name="show-conflict-hours"
            type="checkbox"
            checked={showConflictOnly}
            disabled={!conflictSlots.length}
            onChange={(event) => setShowConflictOnly(event.target.checked)}
          />
          <span>Show only conflict hours</span>
        </label>
        {showConflictOnly && conflictSlots.length ? (
          <div className="conflict-slots">
            {conflictSlots.map((slot) => (
              <span key={slot.id}>
                {slot.dayName.slice(0, 3)} {slot.timeBlock}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {showConflictOnly && !visibleSessions.length ? (
        <EmptyState title="No conflicting sessions selected" detail="Turn off the conflict filter to see your full plan." />
      ) : (
        <PersonalWeekCalendar
          sessions={visibleSessions}
          normalized={normalized}
          selectedSet={selectedSet}
          toggleSelected={toggleSelected}
          setDetail={setDetail}
          colorMode={colorMode}
          colorMaps={colorMaps}
          compactToSessions={showConflictOnly}
        />
      )}
    </section>
  );
}

function PersonalWeekCalendar({
  sessions,
  normalized,
  selectedSet,
  toggleSelected,
  setDetail,
  colorMode,
  colorMaps,
  compactToSessions = false,
}) {
  const days = getConferenceWeekDays(normalized.days);
  const hourRows = getCalendarHours(compactToSessions ? sessions : normalized.sessions, days);
  const sessionsByDayHour = groupSessionsByDayHour(sessions);

  return (
    <section className="week-calendar-panel">
      <div className="section-heading">
        <h2>My Week</h2>
        <span>Wednesday-Sunday, hour by hour</span>
      </div>
      <div className="week-calendar-scroller">
        <div
          className="week-calendar-grid"
          style={{ gridTemplateColumns: `82px repeat(${days.length}, minmax(170px, 1fr))` }}
        >
          <div className="week-corner" />
          {days.map((day) => (
            <div key={day.date} className="week-day-head">
              <strong>{day.dayName}</strong>
              <span>{shortDate(day.date)}</span>
            </div>
          ))}
          {hourRows.map((hour) => (
            <WeekHourRow
              key={hour}
              hour={hour}
              days={days}
              sessionsByDayHour={sessionsByDayHour}
              selectedSet={selectedSet}
              toggleSelected={toggleSelected}
              setDetail={setDetail}
              colorMode={colorMode}
              colorMaps={colorMaps}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function WeekHourRow({
  hour,
  days,
  sessionsByDayHour,
  selectedSet,
  toggleSelected,
  setDetail,
  colorMode,
  colorMaps,
}) {
  return (
    <>
      <div className="week-hour-label">{formatHour(hour)}</div>
      {days.map((day) => {
        const sessions = sessionsByDayHour.get(`${day.date}|${hour}`) || [];
        return (
          <div key={`${day.date}-${hour}`} className="week-hour-cell">
            {sessions.map((session) => (
              <WeekSession
                key={session.id}
                session={session}
                selectedSet={selectedSet}
                toggleSelected={toggleSelected}
                setDetail={setDetail}
                colorMode={colorMode}
                colorMaps={colorMaps}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

function WeekSession({ session, selectedSet, toggleSelected, setDetail, colorMode, colorMaps }) {
  const accent = getSessionAccent(session, colorMode, colorMaps);
  return (
    <article className="week-session" style={{ "--accent": accent }}>
      <button className="week-session-title" onClick={() => setDetail({ type: "session", id: session.id })}>
        {session.title}
      </button>
      <span>
        {session.startTime}-{session.endTime} · {session.room}
      </span>
      <button className="tiny-toggle" onClick={() => toggleSelected(session.id)}>
        {selectedSet.has(session.id) ? "Remove" : "Add"}
      </button>
    </article>
  );
}

function AutoBuilder({
  normalized,
  anchorsByDay,
  setAnchorsByDay,
  setSelectedIds,
  saveGeneratedPlan,
  builderStrategy,
  setBuilderStrategy,
  trackPreferences,
  setTrackPreferences,
  rejectedSessionIds,
  setRejectedSessionIds,
  embeddingsBySessionId,
  embeddingStatus,
  selectedSet,
  toggleSelected,
  setDetail,
  colorMode,
  colorMaps,
}) {
  const normalizedTrackPreferences = useMemo(
    () => normalizeTrackPreferences(trackPreferences),
    [trackPreferences],
  );
  const preferredTrackSet = useMemo(
    () => new Set(normalizedTrackPreferences.preferred),
    [normalizedTrackPreferences.preferred],
  );
  const excludedTrackSet = useMemo(
    () => new Set(normalizedTrackPreferences.excluded),
    [normalizedTrackPreferences.excluded],
  );
  const normalizedRejectedSessionIds = useMemo(() => uniqueStrings(rejectedSessionIds), [rejectedSessionIds]);
  const trackPreferenceCount =
    normalizedTrackPreferences.preferred.length + normalizedTrackPreferences.excluded.length;
  const preview = useMemo(
    () =>
      buildAutoSchedule(normalized, {
        anchorsByDay,
        includeServiceSessions: false,
        strategy: builderStrategy,
        embeddingsBySessionId,
        preferredTrackNames: normalizedTrackPreferences.preferred,
        excludedTrackNames: normalizedTrackPreferences.excluded,
        rejectedSessionIds: normalizedRejectedSessionIds,
      }),
    [anchorsByDay, builderStrategy, embeddingsBySessionId, normalized, normalizedRejectedSessionIds, normalizedTrackPreferences],
  );
  const autoRecommendedIds = useMemo(
    () =>
      new Set(
        Object.values(preview.recommendationsByDay || {})
          .flat()
          .map((session) => session.id),
      ),
    [preview.recommendationsByDay],
  );
  const previewSelectedSet = useMemo(
    () => new Set(preview.selectedSessionIds),
    [preview.selectedSessionIds],
  );

  function setAnchor(date, index, sessionId) {
    setAnchorsByDay((current) => {
      const next = { ...current };
      const dayAnchors = [...(next[date] || [])];
      dayAnchors[index] = sessionId;
      next[date] = dayAnchors.filter(Boolean).filter((id, position, all) => all.indexOf(id) === position);
      return next;
    });
  }

  function toggleTrackPreference(trackName, preference) {
    setTrackPreferences((current) => {
      const next = normalizeTrackPreferences(current);
      const preferred = new Set(next.preferred);
      const excluded = new Set(next.excluded);
      const activeSet = preference === "preferred" ? preferred : excluded;
      const otherSet = preference === "preferred" ? excluded : preferred;

      if (activeSet.has(trackName)) {
        activeSet.delete(trackName);
      } else {
        activeSet.add(trackName);
        otherSet.delete(trackName);
      }

      return {
        preferred: [...preferred],
        excluded: [...excluded],
      };
    });
  }

  function rejectSuggestedSession(sessionId) {
    setRejectedSessionIds((current) => [...new Set([...uniqueStrings(current), String(sessionId)])]);
  }

  return (
    <section className="builder-grid">
      <div className="builder-controls">
        <div className="section-heading">
          <h2>Auto Builder</h2>
          <div className="builder-actions">
            <button
              className="primary-button"
              disabled={!preview.selectedSessionIds.length}
              onClick={() => saveGeneratedPlan(preview.selectedSessionIds, builderStrategy)}
            >
              Save generated plan
            </button>
            <button
              className="ghost-button"
              disabled={!preview.selectedSessionIds.length}
              onClick={() => setSelectedIds(preview.selectedSessionIds)}
            >
              Replace current calendar
            </button>
          </div>
        </div>
        <fieldset className="builder-mode">
          <legend>Auto-generation mode</legend>
          <label>
            <input
              type="radio"
              name="auto-builder-mode"
              value="proximity"
              checked={builderStrategy === "proximity"}
              onChange={(event) => setBuilderStrategy(event.target.value)}
            />
            <span>Prioritize close rooms</span>
            <small>Fills open blocks from the same room-area prefixes as your anchors.</small>
          </label>
          <label>
            <input
              type="radio"
              name="auto-builder-mode"
              value="relevance"
              checked={builderStrategy === "relevance"}
              onChange={(event) => setBuilderStrategy(event.target.value)}
            />
            <span>Prioritize semantic relevance</span>
            <small>Ranks titles, descriptions, tracks and speakers against your anchor sessions.</small>
          </label>
        </fieldset>
        {builderStrategy === "relevance" ? (
          <div className={`embedding-status ${embeddingStatus.state}`}>
            {embeddingStatus.message}
          </div>
        ) : null}
        <fieldset className="builder-track-preferences">
          <legend>Track preferences</legend>
          <div className="track-preference-head">
            <span>{trackPreferenceCount ? `${trackPreferenceCount} selected` : "No track preferences"}</span>
            <button
              className="small-button"
              disabled={!trackPreferenceCount}
              onClick={() => setTrackPreferences({ preferred: [], excluded: [] })}
              type="button"
            >
              Clear
            </button>
          </div>
          <div className="track-preference-list">
            {normalized.tracks.map((track) => {
              const preferred = preferredTrackSet.has(track.name);
              const excluded = excludedTrackSet.has(track.name);
              return (
                <div key={track.name} className="track-preference-row">
                  <span className="track-preference-name">
                    {track.name}
                    <small>{track.sessions.length}</small>
                  </span>
                  <label className={preferred ? "active preferred" : ""}>
                    <input
                      type="checkbox"
                      name={`prefer-${toControlName(track.name)}`}
                      checked={preferred}
                      onChange={() => toggleTrackPreference(track.name, "preferred")}
                    />
                    <span>Prefer</span>
                  </label>
                  <label className={excluded ? "active excluded" : ""}>
                    <input
                      type="checkbox"
                      name={`avoid-${toControlName(track.name)}`}
                      checked={excluded}
                      onChange={() => toggleTrackPreference(track.name, "excluded")}
                    />
                    <span>Avoid</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
        {normalized.days.map((day) => {
          const daySessions = normalized.sessions.filter(
            (session) => session.date === day.date && !session.isServiceSession,
          );
          return (
            <div key={day.date} className="anchor-day">
              <h3>
                {day.dayName}, {shortDate(day.date)}
              </h3>
              {[0, 1, 2].map((index) => (
                <label key={index}>
                  <span>Top {index + 1}</span>
                  <select
                    name={`anchor-${day.date}-${index + 1}`}
                    value={(anchorsByDay[day.date] || [])[index] || ""}
                    onChange={(event) => setAnchor(day.date, index, event.target.value)}
                  >
                    <option value="">No anchor</option>
                    {daySessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.startTime} - {session.title} ({session.room})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          );
        })}
      </div>

      <div className="builder-preview">
        <div className="section-heading">
          <h2>Generated Plan</h2>
          <span>
            {preview.selectedSessionIds.length} sessions · {builderStrategy === "relevance" ? `semantic relevance (${preview.relevanceProvider === "qwen-embeddings" ? "Qwen" : "local"})` : "close rooms"}
            {trackPreferenceCount ? ` · ${normalizedTrackPreferences.preferred.length} prefer · ${normalizedTrackPreferences.excluded.length} avoid` : ""}
            {normalizedRejectedSessionIds.length ? ` · ${normalizedRejectedSessionIds.length} rejected` : ""}
          </span>
        </div>
        {normalizedRejectedSessionIds.length ? (
          <div className="builder-rejected-bar">
            <span>{normalizedRejectedSessionIds.length} rejected suggestion{normalizedRejectedSessionIds.length === 1 ? "" : "s"}</span>
            <button className="small-button" type="button" onClick={() => setRejectedSessionIds([])}>
              Clear rejected
            </button>
          </div>
        ) : null}
        {preview.selectedSessions.length ? (
          <div className="session-stack">
            {preview.selectedSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                selectedSet={selectedSet}
                toggleSelected={toggleSelected}
                setDetail={setDetail}
                colorMode={colorMode}
                colorMaps={colorMaps}
                extraAction={
                  autoRecommendedIds.has(session.id) ? (
                    <button
                      className="small-button reject-button"
                      type="button"
                      onClick={() => rejectSuggestedSession(session.id)}
                    >
                      Reject suggestion
                    </button>
                  ) : null
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Pick one anchor to start"
            detail={
              builderStrategy === "relevance"
                ? "The builder fills open blocks with sessions closest to your anchors by local semantic relevance."
                : "The builder fills open blocks in the same room area."
            }
          />
        )}
        {preview.candidateSlots.length ? (
          <div className="suggestion-review">
            <div className="section-heading compact-heading">
              <h2>Suggestions By Time</h2>
              <span>{preview.candidateSlots.length} time blocks</span>
            </div>
            {preview.candidateSlots.map((slot) => (
              <SuggestionSlot
                key={slot.id}
                slot={slot}
                previewSelectedSet={previewSelectedSet}
                setDetail={setDetail}
                rejectSuggestedSession={rejectSuggestedSession}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SuggestionSlot({ slot, previewSelectedSet, setDetail, rejectSuggestedSession }) {
  const railRef = useRef(null);

  function scrollToEdge(edge) {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollTo({
      left: edge === "end" ? rail.scrollWidth : 0,
      behavior: "smooth",
    });
  }

  return (
    <section className="suggestion-slot">
      <div className="suggestion-slot-head">
        <h3>
          {slot.dayName}, {shortDate(slot.date)}
          <span>{slot.timeBlock}</span>
        </h3>
        <div className="suggestion-jumps">
          <button className="small-button" type="button" onClick={() => scrollToEdge("start")}>
            Most relevant
          </button>
          <button className="small-button" type="button" onClick={() => scrollToEdge("end")}>
            Least relevant
          </button>
        </div>
      </div>
      <div className="suggestion-rail" ref={railRef} tabIndex={0} aria-label={`${slot.timeBlock} suggestions`}>
        {slot.candidates.map((session, index) => {
          const selected = previewSelectedSet.has(session.id);
          return (
            <article key={session.id} className={selected ? "suggestion-card selected" : "suggestion-card"}>
              <div className="suggestion-rank">
                <strong>#{index + 1}</strong>
                {selected ? <span>Selected</span> : null}
              </div>
              <button className="suggestion-title" type="button" onClick={() => setDetail({ type: "session", id: session.id })}>
                {session.title}
              </button>
              <div className="suggestion-meta">
                <span>{session.room}</span>
                <span>{formatDuration(session.durationMinutes)}</span>
                {Number.isFinite(session.relevanceScore) && session.relevanceScore > 0 ? (
                  <span>Relevance {Math.round(session.relevanceScore)}</span>
                ) : null}
                {session.proximityScore ? <span>Close room</span> : null}
                {session.trackPreferenceScore ? <span>Preferred track</span> : null}
              </div>
              <p>{session.description || "No description provided."}</p>
              <div className="suggestion-card-actions">
                <button className="small-button" type="button" onClick={() => setDetail({ type: "session", id: session.id })}>
                  Details
                </button>
                {selected ? (
                  <button
                    className="small-button reject-button"
                    type="button"
                    onClick={() => rejectSuggestedSession(session.id)}
                  >
                    Reject
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SpeakersView({ normalized, search, setSearch, setDetail }) {
  const query = search.trim().toLowerCase();
  const speakers = normalized.speakers.filter((speaker) =>
    [speaker.fullName, speaker.tagLine, speaker.bio].join(" ").toLowerCase().includes(query),
  );

  return (
    <section>
      <div className="section-heading">
        <h2>Speakers</h2>
        <label className="compact-search">
          <span>Search</span>
          <input name="speaker-search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      <div className="speaker-grid">
        {speakers.map((speaker) => (
          <button
            key={speaker.id}
            className="speaker-card"
            onClick={() => setDetail({ type: "speaker", id: speaker.id })}
          >
            <Avatar speaker={speaker} />
            <span className="speaker-name">{speaker.fullName}</span>
            <span className="speaker-title">{speaker.tagLine || "Speaker"}</span>
            <span className="speaker-count">{speaker.sessions.length} session{speaker.sessions.length === 1 ? "" : "s"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TracksView({
  normalized,
  activeTrack,
  setActiveTrack,
  selectedSet,
  toggleSelected,
  setDetail,
  colorMode,
  colorMaps,
}) {
  const currentTrack = normalized.tracks.find((track) => track.name === activeTrack) || normalized.tracks[0];

  useEffect(() => {
    if (!activeTrack && normalized.tracks[0]) setActiveTrack(normalized.tracks[0].name);
  }, [activeTrack, normalized.tracks, setActiveTrack]);

  return (
    <section className="tracks-layout">
      <div className="track-list">
        {normalized.tracks.map((track) => (
          <button
            key={track.name}
            className={currentTrack?.name === track.name ? "active" : ""}
            onClick={() => setActiveTrack(track.name)}
          >
            <span>{track.name}</span>
            <span>{track.sessions.length}</span>
          </button>
        ))}
      </div>
      <div>
        <div className="section-heading">
          <h2>{currentTrack?.name || "Tracks"}</h2>
          <span>{currentTrack?.sessions.length || 0} sessions</span>
        </div>
        <div className="session-stack">
          {(currentTrack?.sessions || []).map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              selectedSet={selectedSet}
              toggleSelected={toggleSelected}
              setDetail={setDetail}
              colorMode={colorMode}
              colorMaps={colorMaps}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function DetailDrawer({
  detail,
  normalized,
  selectedSet,
  toggleSelected,
  setDetail,
  setActiveView,
  updateFilter,
  colorMode,
  colorMaps,
}) {
  if (detail.type === "speaker") {
    const speaker = normalized.speakersById.get(detail.id);
    if (!speaker) return null;
    return (
      <DrawerShell title={speaker.fullName} onClose={() => setDetail(null)}>
        <div className="speaker-detail">
          <Avatar speaker={speaker} large />
          <div>
            <p className="detail-title">{speaker.tagLine}</p>
            <p>{speaker.bio || "No bio provided."}</p>
          </div>
        </div>
        <h3>Sessions</h3>
        <div className="session-stack">
          {speaker.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              selectedSet={selectedSet}
              toggleSelected={toggleSelected}
              setDetail={setDetail}
              colorMode={colorMode}
              colorMaps={colorMaps}
              compact
            />
          ))}
        </div>
      </DrawerShell>
    );
  }

  const session = normalized.sessionsById.get(detail.id);
  if (!session) return null;

  return (
    <DrawerShell title={session.title} onClose={() => setDetail(null)}>
      <div className="detail-meta">
        <span>{session.dayName}, {shortDate(session.date)}</span>
        <span>{session.timeBlock}</span>
        <span>{session.room}</span>
      </div>
      <p>{session.description || "No description provided."}</p>
      <div className="detail-actions">
        <button className="primary-button" onClick={() => toggleSelected(session.id)}>
          {selectedSet.has(session.id) ? "Remove from calendar" : "Add to calendar"}
        </button>
        {session.trackNames.map((track) => (
          <button
            key={track}
            className="ghost-button"
            onClick={() => {
              updateFilter("track", track);
              setActiveView("schedule");
              setDetail(null);
            }}
          >
            {track}
          </button>
        ))}
      </div>
      <h3>Speakers</h3>
      <div className="speaker-pills">
        {session.speakers.length ? (
          session.speakers.map((speaker) => (
            <button key={speaker.id} onClick={() => setDetail({ type: "speaker", id: speaker.id })}>
              <Avatar speaker={speaker} />
              <span>{speaker.fullName}</span>
            </button>
          ))
        ) : (
          <p>No speakers listed.</p>
        )}
      </div>
    </DrawerShell>
  );
}

function SessionCard({
  session,
  selectedSet,
  toggleSelected,
  setDetail,
  setActiveView,
  updateFilter,
  colorMode,
  colorMaps,
  compact = false,
  extraAction = null,
}) {
  const accent = getSessionAccent(session, colorMode, colorMaps);
  const selected = selectedSet.has(session.id);

  return (
    <article className={`session-card ${compact ? "compact" : ""}`} style={{ "--accent": accent }}>
      <div className="session-time">
        <strong>{session.startTime}</strong>
        <span>{session.endTime}</span>
      </div>
      <div className="session-main">
        <button className="title-button" onClick={() => setDetail({ type: "session", id: session.id })}>
          {session.title}
        </button>
        <div className="meta-line">
          <span>{session.dayName}, {shortDate(session.date)}</span>
          <span>{formatDuration(session.durationMinutes)}</span>
          <span>{session.room}</span>
          {session.sessionType ? <span>{session.sessionType}</span> : null}
          {session.recordingStatus ? <span>{cleanRecording(session.recordingStatus)}</span> : null}
          {session.relevanceScore ? <span>Relevance {Math.round(session.relevanceScore)}</span> : null}
          {session.trackPreferenceScore ? <span>Preferred track</span> : null}
          {Number.isFinite(session.semanticSearchScore) ? <span>Semantic match {Math.round(session.semanticSearchScore)}</span> : null}
        </div>
        {!compact ? <p>{session.description || "No description provided."}</p> : null}
        <div className="mini-links">
          {session.speakers.slice(0, 4).map((speaker) => (
            <button key={speaker.id} onClick={() => setDetail({ type: "speaker", id: speaker.id })}>
              {speaker.fullName}
            </button>
          ))}
          {session.trackNames.slice(0, 3).map((track) => (
            <button
              key={track}
              onClick={() => {
                updateFilter?.("track", track);
                setActiveView?.("schedule");
              }}
            >
              {track}
            </button>
          ))}
        </div>
      </div>
      <div className="session-card-actions">
        <button className={selected ? "select-button selected" : "select-button"} onClick={() => toggleSelected(session.id)}>
          {selected ? "Added" : "Add"}
        </button>
        {extraAction}
      </div>
    </article>
  );
}

function MiniSession({ session, selectedSet, toggleSelected, setDetail, colorMode, colorMaps }) {
  const accent = getSessionAccent(session, colorMode, colorMaps);
  return (
    <article className="mini-session" style={{ "--accent": accent }}>
      <button className="mini-title" onClick={() => setDetail({ type: "session", id: session.id })}>
        {session.title}
      </button>
      <span>{session.room}</span>
      <button className="tiny-toggle" onClick={() => toggleSelected(session.id)}>
        {selectedSet.has(session.id) ? "Added" : "Add"}
      </button>
    </article>
  );
}

function DayTabs({ days, activeDay, setActiveDay }) {
  return (
    <div className="day-tabs">
      {days.map((day) => (
        <button
          key={day.date}
          className={activeDay === day.date ? "active" : ""}
          onClick={() => setActiveDay(day.date)}
        >
          {day.dayName.slice(0, 3)}
        </button>
      ))}
    </div>
  );
}

function DrawerShell({ title, onClose, children }) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="detail-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close detail panel">
            Close
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function Metric({ label, value, tone = "" }) {
  return (
    <div className={`metric ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Avatar({ speaker, large = false }) {
  const initials = speaker.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  if (speaker.profilePicture) {
    return (
      <img
        className={large ? "avatar large" : "avatar"}
        src={speaker.profilePicture}
        alt=""
        loading="lazy"
      />
    );
  }
  return <span className={large ? "avatar fallback large" : "avatar fallback"}>{initials}</span>;
}

function StatusScreen({ title, detail, action }) {
  return (
    <main className="status-screen">
      <h1>{title}</h1>
      <p>{detail}</p>
      {action}
    </main>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

async function fetchSchedule() {
  const response = await fetch(SCHEDULE_CACHE_URL, { headers: { accept: "application/json" } });
  if (response.ok) return response.json();
  throw new Error(`Static schedule could not be loaded from ${SCHEDULE_CACHE_URL}: ${response.status}.`);
}

async function fetchQueryEmbedding(query, signal) {
  const embeddings = buildEmbeddingsById(
    await fetchTextEmbeddings(
      [{
        id: "__query__",
        text: `Search query: ${query}`,
      }],
      signal,
    ),
  );
  const embedding = embeddings.get("__query__");
  if (!embedding?.length) throw new Error("Embedding provider returned no query vector.");
  return embedding;
}

async function fetchTextEmbeddings(inputs, signal) {
  const response = await fetch("/api/embeddings", {
    method: "POST",
    signal,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ inputs }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Embedding request failed with ${response.status}.`);
  }
  return payload;
}

function useStoredState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

function buildColorMaps(normalized) {
  return {
    room: mapColors(normalized.roomPrefixes),
    track: mapColors(normalized.tracks.map((track) => track.name)),
    type: mapColors(normalized.sessionTypes),
  };
}

function mapColors(values) {
  return new Map(values.map((value, index) => [value, COLORS[index % COLORS.length]]));
}

function getSessionAccent(session, colorMode, colorMaps) {
  if (!colorMaps) return COLORS[0];
  const key =
    colorMode === "track"
      ? session.trackNames[0] || "Other"
      : colorMode === "type"
        ? session.sessionType || session.sessionKind
        : session.roomPrefix;
  return colorMaps[colorMode]?.get(key) || COLORS[0];
}

function groupBy(items, getKey) {
  const grouped = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

function shortDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );
}

function formatDuration(minutes) {
  const totalMinutes = Number(minutes) || 0;
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;
  if (!remainder) return `${hours} hr${hours === 1 ? "" : "s"}`;
  return `${hours} hr${hours === 1 ? "" : "s"} ${remainder} min`;
}

function normalizeSelectedDurations(value) {
  if (!value || value === "all") return [];
  return (Array.isArray(value) ? value : [value])
    .map(String)
    .filter((duration) => duration && duration !== "all");
}

function normalizeTrackPreferences(value) {
  const preferred = uniqueStrings(value?.preferred);
  const excluded = uniqueStrings(value?.excluded).filter((trackName) => !preferred.includes(trackName));
  return { preferred, excluded };
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function toControlName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanRecording(value) {
  return value.replace("This session *", "").replace("*", "");
}

function stripTrailingPunctuation(value) {
  return String(value || "").replace(/[.!?\s]+$/, "");
}

function planLabel(source) {
  if (source === "auto-relevance") return "semantic builder";
  if (source === "auto-proximity") return "close-room builder";
  return "manual";
}

function getConferenceWeekDays(days) {
  if (!days.length) return [];

  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const start = new Date(`${sortedDays[0].date}T12:00:00`);
  while (start.getDay() !== 3) {
    start.setDate(start.getDate() - 1);
  }

  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateString = toIsoDateString(date);
    const matchingDay = sortedDays.find((day) => day.date === dateString);
    return {
      date: dateString,
      dayName: matchingDay?.dayName || new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date),
    };
  });
}

function getCalendarHours(sourceSessions, days) {
  const dayDates = new Set(days.map((day) => day.date));
  const sessions = sourceSessions.filter((session) => dayDates.has(session.date));
  if (!sessions.length) return [];

  const minHour = Math.min(...sessions.map((session) => new Date(session.startsAtMs).getHours()));
  const maxHour = Math.max(
    ...sessions.map((session) => {
      const end = new Date(session.endsAtMs);
      return end.getHours() + (end.getMinutes() || end.getSeconds() ? 1 : 0);
    }),
  );

  return Array.from({ length: Math.max(1, maxHour - minHour) }, (_, index) => minHour + index);
}

function groupSessionsByDayHour(sessions) {
  const grouped = new Map();
  for (const session of sessions) {
    const hour = new Date(session.startsAtMs).getHours();
    const key = `${session.date}|${hour}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  }
  for (const row of grouped.values()) {
    row.sort(compareWeekSessions);
  }
  return grouped;
}

function compareWeekSessions(a, b) {
  return a.startsAtMs - b.startsAtMs || a.roomSort - b.roomSort || a.title.localeCompare(b.title);
}

function formatHour(hour) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
  }).format(new Date(2026, 0, 1, hour));
}

function toIsoDateString(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
