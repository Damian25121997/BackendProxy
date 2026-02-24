import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "50kb" }));

const PORT = process.env.PORT || 3000;

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const N8N_WEBHOOK_TOKEN = process.env.N8N_WEBHOOK_TOKEN || "";
const HMAC_SECRET = process.env.HMAC_SECRET || "";
const N8N_WHATSAPP_WEBHOOK_URL = process.env.N8N_WHATSAPP_WEBHOOK_URL || "";

// - Rate Limiting (memoria, sin dependicias)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function rateLimit(req, res, next) {
  const ip = req.header["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS){
    rateLimitMap.set(ip, {windowStart: now, count: 1});
    return next();
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX){
    console.log(JSON.stringify({ts: new Date.toISOString(), event: "RATE_LIMITED",
      ip, path: req.path}));
      return res.status(429).json({error: "Too many requests. Try later."});
  }
  return next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if(now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);


// CORS
app.use((req, res, next) => {
  if (ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Origin Validation
function validateOrigin(req, res, next) {
  if(!ALLOWED_ORIGIN) return next();
  const origin = req.header.origin || "";
  const referer = req.header.referer || "";
  const allowed = ALLOWED_ORIGIN.replace(/\/$/, "");

  if (origin && origin.replace(/\/$/, "") === allowed) return next();
  if (referer && referer.startsWith(allowed)) return next();
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "ORIGIN_REJECTED",
    ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip}));
  return res.status(403).json({error: "Forbidden"});
}

// HMAC Signature
function generate(payload) {
  if (!HMAC_SECRET) return {};

  const timestamp = Date.now().toString();
  const data = timestamp + "." + JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", HMAC_SECRET).update(data).digest("hex");
  return {"X-HMAC-Timestamp": timestamp, "X-HMAC-Signature": signature};

}

app.post("/api/lead", async (req, res) => {
  try {
    if (!N8N_WEBHOOK_URL) return res.status(500).send("Missing N8N_WEBHOOK_URL");

    const { name, email, phone, message, subject, source_url, user_agent, timestamp } = req.body || {};

    // Validación mínima
    if (!name || !email || !phone || !message) return res.status(400).send("Missing required fields");

    const payload = { name, email, phone, message, subject, source_url, user_agent, timestamp };

    const r = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-WebHook-Token": N8N_WEBHOOK_TOKEN, ...hmacHeaders
       },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      console.log(JSON.stringify({ts: new Date().toISOString(), event: "N8N_ERROR", status: r.status, path: "api/lead"}));
      return res.status(502).send("Upstream error");
    }

    console.log(JSON.stringify({ts: new Date().toISOString(), event: "LEAD_FOEWARDED", path: "/api/lead"}))
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(JSON.stringify({ts: new Date().toISOString(), event: "SERVER ERROR", path: "/api/lead", error: err.message}));
    return res.status(500).send("Server error");
  }
});

// POST /api/whatsapp-click 
app.post("/api/whatsapp-click", rateLimit, validateOrigin, async (req, res) => {
  try {
    const {source_url, user_agent, timestamp } = req.body || {};
    const payload = {event: "whatsapp_click", source_url, user_agent, timestamp};

    console.log(JSON.stringify({ts: new Date().toISOString().event: "WHATSAPP_CLICK", path: "/api/whatsapp-click"}));

    if(N8N_WHATSAPP_WEBHOOK_URL) {
      const hmacHeaders = generateHmac(payload);
      fetch(N8N_WHATSAPP_WEBHOOK_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-WebHook-Token": N8N_WEBHOOK_TOKEN, ...hmacHeaders},
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
    return res.status(200).json({ok: true});
  } catch(err) {
    return res.status(500).json({ok: false});
  }
});

// health
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => console.log(`Lead proxy listening on ${PORT}`));
