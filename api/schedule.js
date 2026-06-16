const SCHEDULE_URL = "https://2026-ire-conference.sessionize.com/api/schedule";

export default async function handler(_request, response) {
  try {
    const upstream = await fetch(SCHEDULE_URL, {
      headers: { accept: "application/json" },
    });

    const body = await upstream.text();
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=1800");
    response.status(upstream.ok ? 200 : upstream.status).send(body);
  } catch (error) {
    response
      .status(502)
      .json({ error: "Unable to fetch the IRE Sessionize schedule.", detail: error.message });
  }
}
