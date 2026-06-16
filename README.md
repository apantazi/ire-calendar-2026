# IRE 2026 Calendar Builder

Interactive schedule planner for the IRE 2026 conference. It ships a static Sessionize schedule snapshot, normalizes sessions, speakers, rooms, and tracks, and lets users build a local personal calendar.

## What It Does

- Browse all sessions with search, day, track, session-type, room-area, recording-status, one-or-more length, service/break, and master-class filters.
- Open any session for full details, speaker links, tracks, room, recording status, and add/remove controls.
- Open any speaker for bio, organization/title, photo, and every listed session.
- Click tracks to see every session in that track, with day/date visible on each session card.
- View the full schedule in a calendar-style day view.
- View your selected sessions in a Wednesday-Sunday week calendar with days side by side and hour-by-hour rows.
- Filter your personal calendar to only the conflicting hours where selected sessions overlap.
- Color sessions by room area, track, or session type.
- Search ranks sessions by semantic similarity when saved Qwen session embeddings and a query-embedding endpoint are available; otherwise it falls back to local matching.
- Use Auto Builder: pick up to three top sessions per day, then generate a non-conflicting plan by prioritizing close rooms or the most semantically similar session in each open time slot.
- Add Auto Builder track preferences: prefer tracks you want more of, or avoid tracks you do not want included in generated recommendations.
- Save selections and multiple named plans in browser `localStorage`, so generated plans can be saved without overwriting the active calendar.
- Export selected sessions as `.ics`, `.csv`, `.json`, or print, and save/import an importable personal schedule file.

## Initial Setup

This repo is set up as a static app. The schedule snapshot and saved Qwen embeddings are already committed under `public/data`, so a normal setup does not require Docker, Hugging Face, Sessionize, or any secret token.

From a fresh checkout:

```powershell
npm install
npm test
npm run dev
```

Open the local URL Vite prints, usually:

```text
http://127.0.0.1:5173/
```

For a production/static build:

```powershell
npm run build
npm run preview
```

The production files are written to `dist/`. GitHub Pages can serve that folder because `vite.config.js` uses `base: "./"` and the app reads data through Vite's base path.

Expected committed data files:

```text
public/data/ire26-schedule.json
public/data/ire26-session-embeddings.json
```

If those files are present and their fingerprints match, Auto Builder semantic relevance works immediately from saved embeddings. Live semantic query search still falls back to local text matching unless `/api/embeddings` is provided by a separate backend.

## Data Source

Original schedule source:

```text
https://2026-ire-conference.sessionize.com/api/schedule
```

The runtime app does not pull the live Sessionize schedule. It loads this committed static snapshot instead:

```text
public/data/ire26-schedule.json
```

The saved Qwen embedding cache is fingerprinted against that snapshot, so GitHub Pages can serve the schedule and precomputed vectors as ordinary static files.

Current committed snapshot shape:

- `sessions`: 267 rows
- `speakers`: 440 rows
- `categories`: 3 groups
- `rooms`: 22 rooms
- `saved embeddings`: 221 non-service sessions

Core fields:

- `sessions`: `id`, `title`, `description`, `startsAt`, `endsAt`, `isServiceSession`, `isPlenumSession`, `speakers`, `categoryItems`, `roomId`, `liveUrl`, `recordingUrl`, `status`, `isInformed`, `isConfirmed`
- `speakers`: `id`, `firstName`, `lastName`, `fullName`, `bio`, `tagLine`, `profilePicture`, `links`, `sessions`, `isTopSpeaker`
- `rooms`: `id`, `name`, `sort`
- `categories`: `id`, `title`, `items`, `sort`, `type`

Derived fields:

- `date`, `dayName`, `startTime`, `endTime`, `timeBlock`, `durationMinutes`
- `room`, `roomPrefix`, `roomSort`
- `sessionType`, `trackNames`, `recordingStatus`
- joined `speakers`, `speakerNames`, and per-speaker `sessions`

Room-area prefixes used by Auto Builder:

- `National Harbor 2`, `National Harbor 12-13` -> `National Harbor`
- `Maryland A`, `Maryland 1-2` -> `Maryland`
- `Chesapeake GHI`, `Chesapeake 1-3` -> `Chesapeake`
- `Conference-wide` and `Maryland Foyer` stay distinct.

Search and Auto Builder relevance mode can use Qwen/Qwen3-Embedding-8B vectors when an embedding endpoint is configured. If no endpoint is available, they fall back to local text relevance over session titles, descriptions, tracks, session types, and speaker names.

## Qwen Embeddings

For normal use, you do not need to rebuild embeddings. Use the committed cache in `public/data/ire26-session-embeddings.json`.

The browser does not load Qwen/Qwen3-Embedding-8B directly. If a backend exists, the app can call `/api/embeddings`, which forwards search query text to a configured server-side embedding provider and keeps the API key off the client. GitHub Pages does not provide that backend, so search falls back to local text matching there.

The app first tries to load saved embeddings from:

```text
public/data/ire26-session-embeddings.json
```

That file includes a schedule fingerprint. If `public/data/ire26-schedule.json` changes, rebuild the embedding cache so the app does not treat the cache as stale.

Semantic search uses those saved session embeddings plus one live query embedding. The app embeds the search query through `/api/embeddings`, compares that vector against saved session vectors with cosine similarity, and sorts sessions by the semantic match score.

Auto Builder semantic relevance uses only the saved session embeddings. It does not generate session embeddings live in the browser. For each day with anchors, it averages the selected anchor vectors, scores same-day candidate sessions against that anchor profile, and fills each open time slot with the most similar non-conflicting session. If the saved cache is missing or stale, Auto Builder falls back to local text relevance until `npm run build:embeddings` is run again.

### Refreshing Schedule And Embeddings

Only do this when you intentionally update the frozen schedule snapshot.

1. Start the app locally so the dev proxy can fetch Sessionize:

```powershell
npm run dev
```

2. In another PowerShell window, save the latest schedule snapshot:

```powershell
Invoke-WebRequest `
  -Uri "http://127.0.0.1:5173/api/schedule" `
  -OutFile "public\data\ire26-schedule.json"
```

3. Start a local embedding server. GPU is fastest if your NVIDIA driver supports the container. CPU works with the smaller model but can take several minutes.

Recommended local GPU provider from the official model card:

```powershell
docker run --gpus all `
  -p 8080:80 `
  -v hf_cache:/data `
  --pull always `
  ghcr.io/huggingface/text-embeddings-inference:1.7.2 `
  --model-id Qwen/Qwen3-Embedding-8B `
  --dtype float16
```

If that fails with a `cuda>=12.2` NVIDIA driver error, update the NVIDIA driver. The full `Qwen/Qwen3-Embedding-8B` model is not practical on a 16 GB CPU-only machine; the container can be killed while loading the model. For CPU-only local embedding generation, use the smaller Qwen embedding model:

```powershell
docker run `
  -p 8080:80 `
  -v hf_cache:/data `
  --pull always `
  ghcr.io/huggingface/text-embeddings-inference:cpu-1.7.4 `
  --revision refs/pr/27 `
  --pooling last-token `
  --max-batch-tokens 512 `
  --model-id Qwen/Qwen3-Embedding-0.6B
```

4. Rebuild the embedding cache against the saved static schedule.

PowerShell:

```powershell
$env:QWEN_EMBEDDING_URL="http://localhost:8080/embed"
$env:QWEN_EMBEDDING_FORMAT="tei"
$env:QWEN_EMBEDDING_MODEL="Qwen/Qwen3-Embedding-0.6B"
$env:QWEN_EMBEDDING_BATCH_SIZE="1"
$env:QWEN_EMBEDDING_PROGRESS="1"
$env:SCHEDULE_URL="http://127.0.0.1:5173/data/ire26-schedule.json"
npm run build:embeddings
```

5. Verify schedule and embedding cache match:

```powershell
npm test
npm run build
```

After this, the app can be run or deployed statically. Docker/TEI is no longer needed unless you refresh embeddings again.

For a generic TEI or server-side embedding endpoint, configure:

```bash
QWEN_EMBEDDING_URL=http://localhost:8080/embed
QWEN_EMBEDDING_FORMAT=tei
QWEN_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
```

If you used the CPU-only `Qwen/Qwen3-Embedding-0.6B` command, set `QWEN_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-0.6B` so the generated cache records the model correctly.

For an OpenAI-compatible embeddings endpoint, set:

```bash
QWEN_EMBEDDING_URL=https://your-provider.example/v1/embeddings
QWEN_EMBEDDING_FORMAT=openai
QWEN_EMBEDDING_API_KEY=your_token
QWEN_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
QWEN_EMBEDDING_DIMENSIONS=512
```

`QWEN_EMBEDDING_DIMENSIONS` is only sent to OpenAI-compatible endpoints. Use it when the provider supports Qwen's Matryoshka-style shorter vectors.

### GitHub Pages

GitHub Pages is supported for the static app:

1. Keep these files committed:
   - `public/data/ire26-schedule.json`
   - `public/data/ire26-session-embeddings.json`
2. Run `npm run build`.
3. Publish the `dist` directory with GitHub Pages.

The Vite config uses `base: "./"`, and static data URLs are built from `import.meta.env.BASE_URL`, so the app works from a project URL such as `https://USERNAME.github.io/REPO/` without hard-coded root paths.

GitHub Pages cannot run `/api/embeddings` or hide an embedding-provider token. On GitHub Pages:

- Auto Builder semantic relevance works from the saved session embeddings.
- Text search works locally.
- Live semantic query search falls back unless you host a separate embedding proxy elsewhere.

## Local Development

Normal local development with saved schedule and embeddings:

```powershell
npm install
npm test
npm run dev
```

Build production files after code or data changes:

```powershell
npm test
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deployment Plan

Recommended path: static GitHub Pages.

1. Push this folder to a GitHub repository.
2. Confirm the static data files exist:
   - `public/data/ire26-schedule.json`
   - `public/data/ire26-session-embeddings.json`
3. Run `npm test`.
4. Run `npm run build`.
5. Publish `dist` to GitHub Pages.

Common options:

- Use GitHub Actions to build and deploy `dist`.
- Or build locally and push the contents of `dist` to a `gh-pages` branch.

Because this is static hosting, `/api/schedule` is not needed and the app does not pull the live Sessionize schedule at runtime. `/api/embeddings` is also unavailable on GitHub Pages, so live semantic query search falls back to local text matching unless you wire in a separate backend. Auto Builder semantic relevance still uses the saved embeddings.

## Automated Refresh

GitHub Actions includes an hourly static-data refresh workflow:

```text
.github/workflows/refresh-data.yml
```

It runs at minute 17 of every hour to avoid GitHub's busiest top-of-hour schedule window. The workflow:

1. Downloads the latest Sessionize schedule into `public/data/ire26-schedule.json`.
2. Compares the new schedule fingerprint with the saved embedding cache.
3. Starts a CPU Text Embeddings Inference container for `Qwen/Qwen3-Embedding-0.6B` only when the schedule changed.
4. Rebuilds `public/data/ire26-session-embeddings.json`.
5. Runs `npm test` and `npm run build`.
6. Commits the refreshed static data.
7. Deploys the rebuilt `dist` artifact to GitHub Pages.

Manual refresh:

1. Open GitHub.
2. Go to `Actions` > `Refresh Schedule Data`.
3. Click `Run workflow`.
4. Set `force_embeddings` to `true` only if you want to rebuild embeddings even when the schedule has not changed.

The scheduled workflow commits with `GITHUB_TOKEN`, so it deploys Pages inside the same workflow instead of relying on the separate push-triggered `Deploy` workflow.

## Verification Checklist

- `npm test` passes.
- `npm run build` passes.
- App loads `public/data/ire26-schedule.json`.
- App loads `public/data/ire26-session-embeddings.json` and reports saved Qwen embeddings as ready.
- Add/remove selections persist after refresh.
- Auto Builder preserves anchors, excludes overlapping sessions, and supports both close-room and semantic-relevance generation modes.
- Search works with local fallback, and semantic search ranks by saved session embeddings plus live query embeddings when `/api/embeddings` has a server-side provider configured.
- Saved plans can be added, loaded, and deleted without replacing other named plans.
- Speaker and session drawers open from multiple views.
- Track clicks show all sessions in that track.
- My Calendar shows the Wednesday-Sunday week grid and can filter to conflict hours.
- ICS, CSV, JSON, and print exports work from selected sessions.
- Personal schedule `.json` import/export restores selected sessions.
- Empty ICS exports show a note instead of silently doing nothing.
