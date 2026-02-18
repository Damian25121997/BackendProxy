import express from "express";

const app = express();
app.use(express.json({ limit: "50kb" }));

const PORT = process.env.PORT || 3000;

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL; // secreto
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ""; // ej: https://neutralops.cloud
const SHARED_SECRET = process.env.SHARED_SECRET || ""; // opcional
const N8N_WEBHOOK_TOKEN = process.env.N8N_WEBHOOK_TOKEN || "";

// CORS básico (solo tu dominio)
app.use((req, res, next) => {
  if (ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Shared-Secret");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/api/lead", async (req, res) => {
  try {
    if (!N8N_WEBHOOK_URL) {
      return res.status(500).send("Missing N8N_WEBHOOK_URL");
    }

    // (opcional) proteger endpoint si querés
    if (SHARED_SECRET) {
      const provided = req.header("X-Shared-Secret") || "";
      if (provided !== SHARED_SECRET) {
        return res.status(401).send("Unauthorized");
      }
    }

    const { name, email, phone, message, subject, source_url, user_agent, timestamp } = req.body || {};

    // Validación mínima
    if (!name || !email || !phone || !message) {
      return res.status(400).send("Missing required fields");
    }

    const payload = { name, email, phone, message, subject, source_url, user_agent, timestamp };

    const N8N_WEBHOOK_TOKEN = process.env.N8N_WEBHOOK_TOKEN || "";

    const r = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-WebHook-Token": N8N_WEBHOOK_TOKEN
       },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(502).send(`n8n error: ${r.status} ${text}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server error");
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => console.log(`Lead proxy listening on ${PORT}`));
