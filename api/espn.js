// Vercel Serverless Function — resilient ESPN public API proxy.
export default async function handler(req, res) {
  // Vercel normally provides req.query, but parse req.url as a safe fallback.
  let raw = typeof req.query?.path === "string" ? req.query.path : "";
  if (!raw && typeof req.url === "string") {
    try { raw = new URL(req.url, "https://prono.local").searchParams.get("path") || ""; }
    catch (_) {}
  }
  if (!raw || raw.length > 700 || raw.startsWith("/") || raw.includes("..")) {
    return res.status(400).json({ error: "Invalid ESPN path", code: "INVALID_PATH" });
  }

  const q = raw.indexOf("?");
  const route = q >= 0 ? raw.slice(0, q) : raw;
  const query = q >= 0 ? raw.slice(q + 1) : "";
  const allowed = /^(soccer|basketball|hockey)\/[a-z0-9._-]+\/(scoreboard|teams\/[0-9]+\/schedule|summary)$/i;
  if (!allowed.test(route)) {
    return res.status(400).json({ error: "ESPN endpoint not allowed", code: "ENDPOINT_NOT_ALLOWED" });
  }

  const target = new URL(route, "https://site.api.espn.com/apis/site/v2/sports/");
  if (query) {
    const params = new URLSearchParams(query);
    for (const key of ["dates", "season", "event"]) {
      const value = params.get(key);
      if (value && /^[0-9-]{1,24}$/.test(value)) target.searchParams.set(key, value);
    }
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 PRONO-Sports/1.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(8500)
    });
    const body = await upstream.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
    if (!upstream.ok) {
      console.error("ESPN upstream response", upstream.status, route);
      return res.status(upstream.status).send(body || JSON.stringify({ error: "ESPN upstream error", status: upstream.status }));
    }
    return res.status(200).send(body);
  } catch (err) {
    console.error("ESPN proxy failure", route, err?.name || "Error", err?.message || "");
    return res.status(502).json({
      error: "ESPN upstream unavailable",
      code: err?.name === "TimeoutError" ? "ESPN_TIMEOUT" : "ESPN_NETWORK_ERROR"
    });
  }
}
