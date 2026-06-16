import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { embedSessionInputs } from "../api/embeddingProvider.js";
import { getScheduleEmbeddingFingerprint, getSessionEmbeddingText } from "../src/lib/embeddings.js";
import { normalizeSchedule } from "../src/lib/schedule.js";

const DEFAULT_SCHEDULE_URL = "https://2026-ire-conference.sessionize.com/api/schedule";
const LOCAL_SCHEDULE_URL = "http://127.0.0.1:5173/api/schedule";
const DEFAULT_OUTPUT_PATH = "public/data/ire26-session-embeddings.json";
const DEFAULT_DESCRIPTION_MAX_CHARS = 600;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function main() {
  if (!process.env.QWEN_EMBEDDING_URL) {
    throw embeddingSetupError();
  }

  const scheduleUrl = process.env.SCHEDULE_URL || DEFAULT_SCHEDULE_URL;
  const scheduleFile = process.env.SCHEDULE_FILE;
  const outputPath = path.resolve(repoRoot, process.env.EMBEDDINGS_OUTPUT || DEFAULT_OUTPUT_PATH);
  const maxDescriptionChars = getMaxDescriptionChars();

  const { rawSchedule, scheduleSource } = await readSchedule({ scheduleUrl, scheduleFile });
  const normalized = normalizeSchedule(rawSchedule);
  const sessionsToEmbed = normalized.sessions.filter((session) => !session.isServiceSession);
  const inputs = sessionsToEmbed.map((session) => ({
    id: session.id,
    text: getSessionEmbeddingText(session, { maxDescriptionChars }),
  }));

  console.log(`Embedding ${inputs.length} non-service sessions with ${process.env.QWEN_EMBEDDING_MODEL || "Qwen/Qwen3-Embedding-8B"}`);
  console.log(`Embedding text caps descriptions at ${maxDescriptionChars} characters.`);
  const embedded = await embedSessionInputs(inputs);
  const payload = {
    app: "ire-calendar-builder",
    version: 1,
    generatedAt: new Date().toISOString(),
    scheduleUrl: scheduleSource,
    scheduleFingerprint: getScheduleEmbeddingFingerprint(normalized.sessions),
    sessionCount: normalized.sessions.length,
    embeddedSessionCount: embedded.embeddings.length,
    maxDescriptionChars,
    model: embedded.model,
    provider: embedded.provider,
    embeddings: embedded.embeddings,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`Saved ${embedded.embeddings.length} embeddings to ${path.relative(repoRoot, outputPath)}`);
}

function getMaxDescriptionChars() {
  const value = Number(process.env.EMBEDDING_DESCRIPTION_MAX_CHARS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_DESCRIPTION_MAX_CHARS;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Schedule fetch failed with ${response.status}`);
  }
  return response.json();
}

async function fetchSchedule(scheduleUrl) {
  console.log(`Fetching schedule from ${scheduleUrl}`);
  try {
    return await fetchJson(scheduleUrl);
  } catch (error) {
    if (process.env.SCHEDULE_URL) throw error;
    console.log(`Schedule fetch failed from primary source: ${error.message}`);
    console.log(`Retrying through local dev proxy at ${LOCAL_SCHEDULE_URL}`);
    return fetchJson(LOCAL_SCHEDULE_URL);
  }
}

async function readSchedule({ scheduleUrl, scheduleFile }) {
  if (scheduleFile) {
    const filePath = path.resolve(repoRoot, scheduleFile);
    console.log(`Reading schedule from ${path.relative(repoRoot, filePath)}`);
    return {
      rawSchedule: JSON.parse(await readFile(filePath, "utf8")),
      scheduleSource: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
    };
  }

  return {
    rawSchedule: await fetchSchedule(scheduleUrl),
    scheduleSource: scheduleUrl,
  };
}

main().catch((error) => {
  console.error(error.message);
  if (error.detail) console.error(error.detail);
  process.exitCode = 1;
});

function embeddingSetupError() {
  const error = new Error("Qwen embedding endpoint is not configured.");
  error.detail = [
    "",
    "Start a local TEI embedding server, then run these commands in the same PowerShell window.",
    "PowerShell continuation lines must end with a backtick, and --model-id must stay inside docker run.",
    "",
    "GPU command:",
    "docker run --gpus all `",
    "  -p 8080:80 `",
    "  -v hf_cache:/data `",
    "  --pull always `",
    "  ghcr.io/huggingface/text-embeddings-inference:1.7.2 `",
    "  --model-id Qwen/Qwen3-Embedding-8B `",
    "  --dtype float16",
    "",
    "If that fails with a cuda>=12.2 driver error, update the NVIDIA driver.",
    "On a 16 GB CPU-only machine, use the smaller Qwen embedding model instead of the full 8B model:",
    "docker run `",
    "  -p 8080:80 `",
    "  -v hf_cache:/data `",
    "  --pull always `",
    "  ghcr.io/huggingface/text-embeddings-inference:cpu-1.7.4 `",
    "  --revision refs/pr/27 `",
    "  --pooling last-token `",
    "  --max-batch-tokens 512 `",
    "  --model-id Qwen/Qwen3-Embedding-0.6B",
    "",
    '$env:QWEN_EMBEDDING_URL="http://localhost:8080/embed"',
    '$env:QWEN_EMBEDDING_FORMAT="tei"',
    '$env:QWEN_EMBEDDING_MODEL="Qwen/Qwen3-Embedding-0.6B"',
    '$env:QWEN_EMBEDDING_BATCH_SIZE="1"',
    '$env:QWEN_EMBEDDING_PROGRESS="1"',
    "npm run build:embeddings",
    "",
    "If Docker is not reachable, start Docker Desktop first. The saved cache will be written to public/data/ire26-session-embeddings.json.",
  ].join("\n");
  return error;
}
