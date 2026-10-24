// Receives events from the portfolio and posts a clean summary card to a Discord webhook.
// Needs the DISCORD_WEBHOOK_URL environment variable in Vercel.

const rateLimits = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 15;
const SITE_ORIGIN = "https://ibrahimsaadi.vercel.app";

// How each event looks in Discord.
const EVENTS = {
  visit:         { icon: "👀", title: "New visitor",     color: 0x3498db },
  page_view:     { icon: "👀", title: "New visitor",     color: 0x3498db },
  project_open:  { icon: "🗂️", title: "Project opened",  color: 0x9b59b6 },
  contact_click: { icon: "✉️", title: "Contact click",   color: 0xf1c40f },
  cv_download:   { icon: "📄", title: "CV downloaded",   color: 0x2ecc71 },
  rating:        { icon: "⭐", title: "New rating",      color: 0xe67e22 },
  game:          { icon: "🎮", title: "Game played",     color: 0x1abc9c },
  submission:    { icon: "📝", title: "Form submitted",  color: 0x95a5a6 },
  security:      { icon: "🚨", title: "Security alert",  color: 0xe74c3c }
};

const clip = (value, max = 200) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";

function flag(code) {
  if (!/^[A-Za-z]{2}$/.test(code || "")) return "🌐";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
}

function countryName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()); }
  catch { return code; }
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

// Small user-agent reader: browser, system and device type.
function readAgent(ua = "") {
  const bot = /bot|crawler|spider|preview|facebookexternalhit|slurp|headless/i.test(ua);
  let browser = "Unknown browser";
  const pick = (re, name) => { const m = ua.match(re); if (m) { browser = `${name} ${m[1].split(".")[0]}`; return true; } return false; };
  pick(/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge") || pick(/OPR\/([\d.]+)/, "Opera") ||
  pick(/SamsungBrowser\/([\d.]+)/, "Samsung Internet") || pick(/(?:Firefox|FxiOS)\/([\d.]+)/, "Firefox") ||
  pick(/(?:Chrome|CriOS)\/([\d.]+)/, "Chrome") || pick(/Version\/([\d.]+).*Safari/, "Safari");

  let os = "Unknown system";
  if (/Windows NT 10|Windows NT 11/.test(ua)) os = "Windows";
  else if (/Windows/.test(ua)) os = "Windows (older)";
  else if (/Android ([\d.]+)/.test(ua)) os = "Android " + ua.match(/Android ([\d.]+)/)[1].split(".")[0];
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS" + (ua.match(/OS (\d+)_/) ? " " + ua.match(/OS (\d+)_/)[1] : "");
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  const device = /iPad|Tablet/.test(ua) ? "Tablet" : /Mobi|iPhone|Android.*Mobile/.test(ua) ? "Mobile" : "Desktop";
  return { bot, browser, os, device };
}

function rabatTime() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca", weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date());
}

function referrerLabel(ref) {
  if (!ref) return "Direct visit";
  try { const u = new URL(ref); return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : ""); }
  catch { return clip(ref, 80); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Accept requests from your own website only.
  if (req.headers.origin !== SITE_ORIGIN) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "unavailable";

  // Best-effort per-instance rate limit.
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (entry && now - entry.start < WINDOW_MS && entry.count >= MAX_REQUESTS) {
    return res.status(429).json({ error: "Too many requests" });
  }
  if (!entry || now - entry.start >= WINDOW_MS) rateLimits.set(ip, { start: now, count: 1 });
  else entry.count++;
  if (rateLimits.size > 1000) {
    for (const [key, value] of rateLimits) if (now - value.start >= WINDOW_MS) rateLimits.delete(key);
  }

  try {
    const body = req.body || {};
    const event = body.event;
    const look = EVENTS[event];
    if (!look) return res.status(400).json({ error: "Invalid event" });

    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) return res.status(500).json({ error: "Logging not configured" });

    const details = clip(body.details, 300);
    const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
    const h = req.headers;

    // Place, from Vercel's own headers (city level, not exact).
    const code = clip(h["x-vercel-ip-country"], 2);
    const city = safeDecode(clip(h["x-vercel-ip-city"], 80));
    const region = safeDecode(clip(h["x-vercel-ip-country-region"], 40));
    const place = code
      ? `${flag(code)} ${[city, region && region !== city && !/^[A-Z0-9]{1,3}$/.test(region) ? region : "", countryName(code)].filter(Boolean).join(", ")}`
      : "🌐 Unknown";

    const agent = readAgent(clip(h["user-agent"], 400));
    const deviceIcon = agent.device === "Mobile" ? "📱" : agent.device === "Tablet" ? "📲" : "💻";
    const visits = Number.parseInt(meta.visits, 10);

    const fields = [
      { name: "📍 Location", value: place, inline: true },
      { name: `${deviceIcon} Device`, value: `${agent.device}${agent.bot ? " (bot?)" : ""}\n${agent.os}\n${agent.browser}`, inline: true },
      { name: "🌍 Language", value: [clip(meta.lang, 20) || clip((h["accept-language"] || "").split(",")[0], 20) || "unknown",
          meta.siteLang ? `site: ${clip(meta.siteLang, 5)}` : ""].filter(Boolean).join("\n"), inline: true },
      { name: "🖥️ Screen", value: [clip(meta.screen, 20), meta.viewport ? `window ${clip(meta.viewport, 20)}` : "",
          meta.theme ? `${clip(meta.theme, 10)} theme` : ""].filter(Boolean).join("\n") || "unknown", inline: true },
      { name: "🔗 Came from", value: referrerLabel(clip(meta.referrer, 200)), inline: true },
      { name: "🕐 Visitor time zone", value: clip(meta.tz, 40) || safeDecode(clip(h["x-vercel-ip-timezone"], 40)) || "unknown", inline: true }
    ];
    if (Number.isFinite(visits) && visits > 0) {
      fields.push({ name: "🔁 Visits", value: visits === 1 ? "First visit from this browser" : `Visit #${visits} from this browser`, inline: true });
    }
    if (meta.page) fields.push({ name: "📄 Page", value: "`" + clip(meta.page, 100).replace(/`/g, "'") + "`", inline: true });
    fields.push({ name: "🌐 IP address", value: "`" + ip + "`", inline: true });

    const embed = {
      title: `${look.icon}  ${look.title}`,
      description: details ? `**${details}**` : undefined,
      color: look.color,
      fields,
      footer: { text: `Rabat time · ${rabatTime()}` },
      timestamp: new Date().toISOString()
    };

    const discordResponse = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Portfolio Log", allowed_mentions: { parse: [] }, embeds: [embed] })
    });
    if (!discordResponse.ok) return res.status(502).json({ error: "Discord delivery failed" });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Logging failed" });
  }
}
