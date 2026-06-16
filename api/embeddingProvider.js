const DEFAULT_MODEL = "Qwen/Qwen3-Embedding-8B";
const DEFAULT_BATCH_SIZE = 32;
const MAX_INPUTS = 400;

export async function embedSessionInputs(rawInputs, env = process.env) {
  const endpoint = env.QWEN_EMBEDDING_URL;
  if (!endpoint) {
    throw embeddingError(
      "Qwen embedding endpoint is not configured.",
      501,
      "Set QWEN_EMBEDDING_URL to a TEI /embed endpoint or OpenAI-compatible /v1/embeddings endpoint.",
    );
  }

  const inputs = normalizeInputs(rawInputs).slice(0, MAX_INPUTS);
  if (!inputs.length) {
    throw embeddingError("No embedding inputs provided.", 400);
  }

  const embeddings = [];
  let embeddedCount = 0;
  for (const chunk of chunkArray(inputs, getBatchSize(env))) {
    const chunkEmbeddings = await fetchEmbeddings(endpoint, chunk.map((input) => input.text), env);
    if (chunkEmbeddings.length !== chunk.length) {
      throw embeddingError(
        `Embedding provider returned ${chunkEmbeddings.length} vectors for ${chunk.length} inputs.`,
      );
    }
    for (let index = 0; index < chunk.length; index += 1) {
      embeddings.push({
        id: chunk[index].id,
        embedding: chunkEmbeddings[index],
      });
    }
    embeddedCount += chunk.length;
    if (env.QWEN_EMBEDDING_PROGRESS === "1") {
      console.log(`Embedded ${embeddedCount}/${inputs.length}`);
    }
  }

  return {
    model: env.QWEN_EMBEDDING_MODEL || DEFAULT_MODEL,
    provider: "qwen",
    embeddings,
  };
}

async function fetchEmbeddings(endpoint, texts, env) {
  const format = getProviderFormat(endpoint, env);
  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(env),
      body: JSON.stringify(buildProviderBody(format, texts, env)),
    });
  } catch (error) {
    throw embeddingError(
      `Could not reach embedding endpoint at ${endpoint}.`,
      502,
      `Confirm the TEI container is still running and that Docker maps it to port 8080. ${error.cause?.message || error.message}`,
    );
  }

  const payload = await upstream.json().catch(async () => ({ raw: await upstream.text() }));
  if (!upstream.ok) {
    throw embeddingError(
      payload?.error?.message || payload?.error || payload?.detail || `Embedding provider returned ${upstream.status}.`,
      502,
    );
  }

  return extractEmbeddings(format, payload);
}

function buildProviderBody(format, texts, env) {
  if (format === "openai") {
    const body = {
      model: env.QWEN_EMBEDDING_MODEL || DEFAULT_MODEL,
      input: texts,
    };
    const dimensions = Number(env.QWEN_EMBEDDING_DIMENSIONS);
    if (Number.isFinite(dimensions) && dimensions > 0) body.dimensions = dimensions;
    return body;
  }

  return { inputs: texts };
}

function extractEmbeddings(format, payload) {
  if (format === "openai") {
    return [...(payload?.data || [])]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.embeddings)) return payload.embeddings;
  throw embeddingError("Embedding provider response did not include vectors.");
}

function buildHeaders(env) {
  const headers = { "content-type": "application/json" };
  const token = env.QWEN_EMBEDDING_API_KEY || env.HUGGINGFACE_API_TOKEN || env.HF_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function getProviderFormat(endpoint, env) {
  const explicit = String(env.QWEN_EMBEDDING_FORMAT || "").toLowerCase();
  if (explicit === "openai" || explicit === "tei") return explicit;
  return endpoint.includes("/v1/embeddings") ? "openai" : "tei";
}

function normalizeInputs(inputs) {
  if (!Array.isArray(inputs)) return [];
  return inputs
    .map((input) => ({
      id: String(input?.id || ""),
      text: String(input?.text || "").trim(),
    }))
    .filter((input) => input.id && input.text);
}

function getBatchSize(env) {
  const batchSize = Number(env.QWEN_EMBEDDING_BATCH_SIZE);
  return Number.isFinite(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function embeddingError(message, statusCode = 502, detail = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.detail = detail;
  return error;
}
