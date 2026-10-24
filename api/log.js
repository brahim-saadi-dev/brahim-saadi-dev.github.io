const rateLimits = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 15;

const ALLOWED_EVENTS = new Set([
  "visit",
  "page_view",
  "project_open",
  "contact_click",
  "cv_download",
  "rating",
  "game",
  "submission",
  "security"
]);

// Embed colours: red for security, green for CV downloads, blue for everything else.
const COLORS = { security: 15158332, cv_download: 3066993 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Accept requests from your own website only.
  const origin = req.headers.origin;
  if (origin !== "https://ibrahimsaadi.vercel.app") {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  // Get the client IP from Vercel's request headers.
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string"
    ? forwarded.split(",")[0].trim()
    : "unavailable";

  // Best-effort per-instance rate limit.
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (entry && now - entry.start < WINDOW_MS &&
      entry.count >= MAX_REQUESTS) {
    return res.status(429).json({ error: "Too many requests" });
  }

  if (!entry || now - entry.start >= WINDOW_MS) {
    rateLimits.set(ip, { start: now, count: 1 });
  } else {
    entry.count++;
  }

  // Periodically remove expired entries.
  if (rateLimits.size > 1000) {
    for (const [key, value] of rateLimits) {
      if (now - value.start >= WINDOW_MS) rateLimits.delete(key);
    }
  }

  try {
    const body = req.body || {};
    const event = body.event;
    const details = typeof body.details === "string"
      ? body.details.slice(0, 300)
      : "";

    if (!ALLOWED_EVENTS.has(event)) {
      return res.status(400).json({ error: "Invalid event" });
    }

    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) {
      return res.status(500).json({ error: "Logging not configured" });
    }

    const discordResponse = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `[${event.replace("_", " ").toUpperCase()}]`,
          color: COLORS[event] || 3447003,
          fields: [
            { name: "Details", value: details || "No details" },
            { name: "Visitor IP", value: ip }
          ],
          timestamp: new Date().toISOString()
        }]
      })
    });

    if (!discordResponse.ok) {
      return res.status(502).json({ error: "Discord delivery failed" });
    }

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Logging failed" });
  }
}
