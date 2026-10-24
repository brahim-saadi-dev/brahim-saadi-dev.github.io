
const rateLimits = new Map();
const alertCooldowns = new Map();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 15;
const ALERT_COOLDOWN_MS = 60_000;
const SITE_ORIGIN = "https://ibrahimsaadi.vercel.app";

const EVENTS = {
  visit:         { icon: "👀", title: "New visitor", color: 0x3498db },
  page_view:     { icon: "👀", title: "New visitor", color: 0x3498db },
  project_open:  { icon: "🗂️", title: "Project opened", color: 0x9b59b6 },
  contact_click: { icon: "✉️", title: "Contact click", color: 0xf1c40f },
  cv_download:   { icon: "📄", title: "CV downloaded", color: 0x2ecc71 },
  rating:        { icon: "⭐", title: "New rating", color: 0xe67e22 },
  game:          { icon: "🎮", title: "Game played", color: 0x1abc9c },
  submission:    { icon: "📝", title: "Form submitted", color: 0x95a5a6 },
  security:      { icon: "🚨", title: "Security alert", color: 0xe74c3c }
};

const clip = (value, max = 200) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
    : "";

function readAgent(ua = "") {
  const bot = /bot|crawler|spider|preview|headless/i.test(ua);
  let browser = "Unknown";

  const browsers = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/(?:Chrome|CriOS)\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"]
  ];

  for (const [regex, name] of browsers) {
    const match = ua.match(regex);
    if (match) {
      browser = `${name} ${match[1].split(".")[0]}`;
      break;
    }
  }

  let os = "Unknown";
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  const device = /iPad|Tablet/.test(ua)
    ? "Tablet"
    : /Mobi|iPhone|Android.*Mobile/.test(ua)
      ? "Mobile"
      : "Desktop";

  return { bot, browser, os, device };
}

function rabatTime() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca",
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false
  }).format(new Date());
}

function referrerLabel(ref) {
  if (!ref) return "Direct visit";
  try {
    const url = new URL(ref);
    return clip(url.hostname + url.pathname, 150);
  } catch {
    return "Unavailable";
  }
}

function getClientIp(req) {
  // Prefer the platform-provided client IP when available.
  const ip = req.headers["x-vercel-forwarded-for"];
  if (typeof ip === "string" && ip.trim()) {
    return clip(ip.split(",")[0].trim(), 64);
  }

  // This fallback is safe only when the deployment platform
  // controls/sanitizes this header.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return clip(forwarded.split(",")[0].trim(), 64);
  }

  return "unavailable";
}

function getRoute(req) {
  // Never trust a visitor-supplied route header.
  return clip(req.url?.split("?")[0] || "/api/log", 120);
}

async function sendDiscord(embed) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) throw new Error("Logging not configured");

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Portfolio Security",
      allowed_mentions: { parse: [] },
      embeds: [embed]
    })
  });

  if (!response.ok) throw new Error("Discord delivery failed");
}

async function securityAlert(req, ip, reason, status) {
  const now = Date.now();
  const key = `${ip}:${reason}`;
  const previous = alertCooldowns.get(key);

  // Avoid turning the webhook into a notification-flood target.
  if (previous && now - previous < ALERT_COOLDOWN_MS) return;
  alertCooldowns.set(key, now);

  if (alertCooldowns.size > 1000) {
    for (const [k, timestamp] of alertCooldowns) {
      if (now - timestamp > ALERT_COOLDOWN_MS) {
        alertCooldowns.delete(k);
      }
    }
  }

  const ua = clip(req.headers["user-agent"], 250);
  const route = getRoute(req);

  try {
    await sendDiscord({
      title: "🚨 Security event detected",
      color: 0xe74c3c,
      fields: [
        { name: "Reason", value: clip(reason, 200), inline: false },
        { name: "HTTP status", value: String(status), inline: true },
        { name: "Method", value: clip(req.method, 12), inline: true },
        { name: "Target route", value: route, inline: true },
        { name: "Client IP", value: `\`${ip}\``, inline: true },
        { name: "User agent", value: ua || "Unavailable", inline: false },
        { name: "Time (Rabat)", value: rabatTime(), inline: false }
      ],
      timestamp: new Date().toISOString()
    });
  } catch {
    // Logging failures must not break request handling.
  }
}

export default async function handler(req, res) {
  const ip = getClientIp(req);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.headers.origin !== SITE_ORIGIN) {
    await securityAlert(req, ip, "Unexpected or missing Origin header", 403);
    return res.status(403).json({ error: "Forbidden origin" });
  }

  const now = Date.now();
  let entry = rateLimits.get(ip);

  if (!entry || now - entry.start >= WINDOW_MS) {
    entry = { start: now, count: 0 };
    rateLimits.set(ip, entry);
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    await securityAlert(req, ip, "Rate limit exceeded: more than 15 requests/minute", 429);
    return res.status(429).json({ error: "Too many requests" });
  }

  if (rateLimits.size > 1000) {
    for (const [key, value] of rateLimits) {
      if (now - value.start >= WINDOW_MS) rateLimits.delete(key);
    }
  }

  try {
    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      await securityAlert(req, ip, "Malformed request body", 400);
      return res.status(400).json({ error: "Invalid request body" });
    }

    const event = body.event;
    const look = EVENTS[event];

    if (!look) {
      await securityAlert(req, ip, "Unknown event type", 400);
      return res.status(400).json({ error: "Invalid event" });
    }

    const details = clip(body.details, 300);
    const meta = body.meta && typeof body.meta === "object"
      && !Array.isArray(body.meta) ? body.meta : {};

    const headers = req.headers;
    const agent = readAgent(clip(headers["user-agent"], 400));

    const fields = [
      {
        name: "Device",
        value: `${agent.device}\n${agent.os}\n${agent.browser}${agent.bot ? "\nBot-like user agent" : ""}`,
        inline: true
      },
      {
        name: "Referrer",
        value: referrerLabel(clip(meta.referrer, 300)),
        inline: true
      },
      {
        name: "Page",
        value: clip(meta.page, 100) || "Not provided",
        inline: true
      },
      {
        name: "Language",
        value: clip(meta.lang, 20) || clip(headers["accept-language"], 60) || "Unknown",
        inline: true
      },
      {
        name: "Screen / viewport",
        value: `${clip(meta.screen, 30) || "Unknown"} / ${clip(meta.viewport, 30) || "Unknown"}`,
        inline: true
      },
      {
        name: "Site theme",
        value: clip(meta.theme, 20) || "Unknown",
        inline: true
      },
      {
        name: "Client IP",
        value: `\`${ip}\``,
        inline: true
      }
    ];

    if (event === "security") {
      fields.push({
        name: "Security details",
        value: details || "No additional details provided",
        inline: false
      });
    }

    await sendDiscord({
      title: `${look.icon} ${look.title}`,
      description: details || undefined,
      color: look.color,
      fields,
      footer: { text: `Rabat time · ${rabatTime()}` },
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Logging failed" });
  }
}
