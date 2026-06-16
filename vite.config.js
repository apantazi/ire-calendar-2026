import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { embedSessionInputs } from "./api/embeddingProvider.js";

const SCHEDULE_URL = "https://2026-ire-conference.sessionize.com/api/schedule";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "ire-schedule-dev-api",
      configureServer(server) {
        server.middlewares.use("/api/schedule", async (_req, res) => {
          try {
            const response = await fetch(SCHEDULE_URL, {
              headers: { accept: "application/json" },
            });
            if (!response.ok) {
              res.statusCode = response.status;
              res.end(JSON.stringify({ error: `Sessionize returned ${response.status}` }));
              return;
            }

            res.setHeader("content-type", "application/json; charset=utf-8");
            res.setHeader("cache-control", "public, max-age=60");
            res.end(await response.text());
          } catch (error) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        server.middlewares.use("/api/embeddings", async (req, res) => {
          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Use POST to embed sessions." }));
            return;
          }

          try {
            const body = await readJsonRequest(req);
            const payload = await embedSessionInputs(body.inputs);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.setHeader("cache-control", "private, max-age=86400");
            res.end(JSON.stringify(payload));
          } catch (error) {
            res.statusCode = error.statusCode || 502;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({
              error: error.statusCode === 501 || error.statusCode === 400 ? error.message : "Unable to generate Qwen embeddings.",
              detail: error.detail || error.message,
            }));
          }
        });
      },
    },
  ],
});

async function readJsonRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
