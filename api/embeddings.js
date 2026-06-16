import { embedSessionInputs } from "./embeddingProvider.js";

export default async function handler(request, response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, authorization");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Use POST to embed sessions." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const payload = await embedSessionInputs(body.inputs);
    response.setHeader("cache-control", "private, max-age=86400");
    response.status(200).json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: error.statusCode === 501 || error.statusCode === 400 ? error.message : "Unable to generate Qwen embeddings.",
      detail: error.detail || error.message,
    });
  }
}

async function readJsonBody(request) {
  if (typeof request.body === "string") return request.body ? JSON.parse(request.body) : {};
  if (Buffer.isBuffer(request.body)) {
    const text = request.body.toString("utf8");
    return text ? JSON.parse(text) : {};
  }
  if (request.body && typeof request.body === "object" && !isReadableStream(request.body)) return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function isReadableStream(value) {
  return typeof value?.getReader === "function";
}
