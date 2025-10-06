// server/index.js  (ESM)

import express from "express";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import cors from "cors";
import path from "node:path";
import dotenv from "dotenv";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";

// --- __dirname shim for ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables for server and also fall back to root-level env files used by Vite
// Order: server/.env.local -> server/.env -> project/.env.local -> project/.env -> project/env.local (no dot) -> project/env
dotenv.config({ path: path.join(__dirname, ".env.local") });
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, "..", "env.local") });
dotenv.config({ path: path.join(__dirname, "..", "env") });

// --- DB (SQLite): server/credsdb.txt ---
const DB_FILE = path.join(__dirname, "credsdb.txt");
sqlite3.verbose();
const db = new sqlite3.Database(DB_FILE);

// Ensure 'archived' column exists on 'plans'
db.serialize(() => {
  db.run(
    "ALTER TABLE plans ADD COLUMN archived INTEGER DEFAULT 0",
    (err) => {
      // ignore "duplicate column" errors — this is idempotent
      if (err && !String(err.message || "").includes("duplicate column")) {
        console.error("ALTER TABLE plans ADD COLUMN archived failed:", err.message);
      }
    }
  );
});

// --- Express app ---
const app = express();
app.set("trust proxy", 1);
app.use(
  cors({
    origin: (_origin, cb) => cb(null, true), // dev: allow all (lets your phone connect)
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Sessions (SQLite store) ---
const SQLiteStore = connectSqlite3(session);
app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: __dirname, // keep sessions db in server folder too
    }),
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      sameSite: "lax",
      secure: !!process.env.COOKIE_SECURE || /^https:/i.test(process.env.PUBLIC_ORIGIN || ""),
    },
  })
);

// ---- DB bootstrap
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    data TEXT,
    archived INTEGER DEFAULT 0,
    predecessor_plan_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_prefs (
    user_id INTEGER PRIMARY KEY,
    last_plan_server_id INTEGER,
    last_week_id TEXT,
    last_day_id TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    week_id TEXT NOT NULL,
    day_id TEXT NOT NULL,
    data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, plan_id, week_id, day_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS completions (
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    week_id TEXT NOT NULL,
    day_id TEXT NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, plan_id, week_id, day_id)
  )`);
});

// ---- Auth helpers
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  next();
}

// ---- Auth routes
app.get("/api/me", (req, res) => {
  res.json(req.session.user || null);
});

// legacy username/password endpoints removed in favor of Supabase auth

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---- Supabase session bridge: Accept a Supabase access token, verify with Supabase,
// ensure a local user row, and attach to express-session so existing endpoints work.
app.post("/api/supa/session", async (req, res) => {
  try {
    const auth = req.headers["authorization"] || "";
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : (req.body && req.body.token) || "";
    if (!token) return res.status(400).json({ error: "Missing Supabase token" });

    // Accept either server envs or (as a convenience) Vite-style envs
    const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPA_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!SUPA_URL || !SUPA_ANON) {
      return res.status(500).json({
        error: "Server missing Supabase env",
        hint: "Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) on the server",
      });
    }

    const uRes = await fetch(`${SUPA_URL.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPA_ANON,
      },
    });
    if (!uRes.ok) {
      const text = await uRes.text();
      return res.status(401).json({ error: `Supabase verify failed: ${text}` });
    }
    const user = await uRes.json();
    const email = String(user?.email || "").trim();
    if (!email) return res.status(400).json({ error: "No email on Supabase user" });

    // Ensure local users row using email as unique username
    await new Promise((resolve) => {
      db.run(
        "INSERT INTO users (username, password) VALUES (?, ?) ON CONFLICT(username) DO NOTHING",
        [email, ""],
        () => resolve()
      );
    });
    const row = await new Promise((resolve, reject) => {
      db.get("SELECT id, username FROM users WHERE username=?", [email], (err, r) => (err ? reject(err) : resolve(r)));
    });
    if (!row) return res.status(500).json({ error: "Failed to load/create local user" });

    req.session.user = { id: row.id, username: row.username };
    res.json(req.session.user);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---- Prefs


app.put("/api/prefs", requireAuth, (req, res) => {
  const { lastPlanServerId, lastWeekId, lastDayId } = req.body || {};
  db.run(
    `INSERT INTO user_prefs (user_id, last_plan_server_id, last_week_id, last_day_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_plan_server_id=excluded.last_plan_server_id,
                                       last_week_id=excluded.last_week_id,
                                       last_day_id=excluded.last_day_id`,
    [req.session.user.id, lastPlanServerId, lastWeekId, lastDayId],
    (err) => {
      if (err) return res.status(500).send("Failed to save prefs");
      res.json({ ok: true });
    }
  );
});

// ---- Plans
app.get("/api/plans", requireAuth, (req, res) => {
  const archived = Number(req.query.archived || 0) ? 1 : 0;
  db.all(
    "SELECT id, name, data, archived FROM plans WHERE user_id=? AND archived=?",
    [req.session.user.id, archived],
    (err, rows) => {
      if (err) return res.status(500).send("Failed to load plans");
      res.json(rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : {} })));
    }
  );
});

// Archive a plan: sets archived = 1
app.post("/api/plans/:id/archive", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const sql = "UPDATE plans SET archived = 1 WHERE id = ?";
  db.run(sql, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Plan not found" });
    res.json({ ok: true, id });
  });
});


app.post("/api/plans", requireAuth, (req, res) => {
  const { name, data } = req.body || {};
  db.run(
    "INSERT INTO plans (user_id, name, data, archived) VALUES (?, ?, ?, 0)",
    [req.session.user.id, name || "Plan", JSON.stringify(data || {})],
    function (err) {
      if (err) return res.status(500).send("Failed to create plan");
      db.get("SELECT id, name, data, archived FROM plans WHERE id=?", [this.lastID], (e, row) => {
        if (e || !row) return res.status(500).send("Failed");
        res.json({ ...row, data: row.data ? JSON.parse(row.data) : {} });
      });
    }
  );
});

app.put("/api/plans/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, data } = req.body || {};
  db.run(
    "UPDATE plans SET name=?, data=? WHERE id=? AND user_id=?",
    [name, JSON.stringify(data || {}), id, req.session.user.id],
    (err) => {
      if (err) return res.status(500).send("Failed to update plan");
      db.get("SELECT id, name, data FROM plans WHERE id=?", [id], (e, row) => {
        if (e || !row) return res.status(500).send("Failed");
        res.json({ ...row, data: row.data ? JSON.parse(row.data) : {} });
      });
    }
  );
});

app.delete("/api/plans/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.run("DELETE FROM plans WHERE id=? AND user_id=?", [id, req.session.user.id], (err) => {
    if (err) return res.status(500).send("Failed to delete");
    res.json({ ok: true });
  });
});

// ---- Templates CRUD
app.get("/api/templates", requireAuth, (req, res) => {
  db.all(
    "SELECT id, name, data FROM templates WHERE user_id=? ORDER BY id DESC",
    [req.session.user.id],
    (err, rows) => {
      if (err) return res.status(500).send("Failed to load templates");
      res.json(rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : {} })));
    }
  );
});

app.post("/api/templates", requireAuth, (req, res) => {
  const { name, data } = req.body || {};
  db.run(
    "INSERT INTO templates (user_id, name, data) VALUES (?, ?, ?)",
    [req.session.user.id, name || "Template", JSON.stringify(data || {})],
    function (err) {
      if (err) return res.status(500).send("Failed to create template");
      db.get("SELECT id, name, data FROM templates WHERE id=?", [this.lastID], (e, row) => {
        if (e || !row) return res.status(500).send("Failed");
        res.json({ ...row, data: row.data ? JSON.parse(row.data) : {} });
      });
    }
  );
});

app.put("/api/templates/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, data } = req.body || {};
  db.run(
    "UPDATE templates SET name=?, data=? WHERE id=? AND user_id=?",
    [name, JSON.stringify(data || {}), id, req.session.user.id],
    (err) => {
      if (err) return res.status(500).send("Failed to update template");
      db.get("SELECT id, name, data FROM templates WHERE id=?", [id], (e, row) => {
        if (e || !row) return res.status(500).send("Failed");
        res.json({ ...row, data: row.data ? JSON.parse(row.data) : {} });
      });
    }
  );
});

app.delete("/api/templates/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.run("DELETE FROM templates WHERE id=? AND user_id=?", [id, req.session.user.id], (err) => {
    if (err) return res.status(500).send("Failed to delete template");
    res.json({ ok: true });
  });
});

// Rollover: archive current plan, clone with incremented "(#n)" suffix, return new plan
app.post("/api/plans/:id/rollover", requireAuth, (req, res) => {
  const planId = Number(req.params.id);
  db.get(
    "SELECT * FROM plans WHERE id=? AND user_id=?",
    [planId, req.session.user.id],
    (err, plan) => {
      if (err || !plan) return res.status(404).send("Plan not found");
      const data = plan.data ? JSON.parse(plan.data) : {};

      const name = String(plan.name);
      const match = name.match(/\(#(\d+)\)\s*$/);
      const nextN = match ? Number(match[1]) + 1 : 2;
      const base = match ? name.replace(/\(#\d+\)\s*$/, "").trim() : name.trim();
      const newName = `${base} (#${nextN})`;

      db.serialize(() => {
        db.run("UPDATE plans SET archived=1 WHERE id=?", [planId]);

        db.run(
          "INSERT INTO plans (user_id, name, data, archived, predecessor_plan_id) VALUES (?, ?, ?, 0, ?)",
          [req.session.user.id, newName, JSON.stringify(data), planId],
          function (insErr) {
            if (insErr) return res.status(500).send("Failed to clone plan");
            const newId = this.lastID;
            db.get("SELECT id, name, data, archived FROM plans WHERE id=?", [newId], (e2, row) => {
              if (e2 || !row) return res.status(500).send("Failed to read new plan");
              res.json({ ...row, data: row.data ? JSON.parse(row.data) : {} });
            });
          }
        );
      });
    }
  );
});

// ---- Sessions (save & fetch last for (plan,week,day))
app.post("/api/sessions", requireAuth, (req, res) => {
  const { planServerId, weekId, dayId, data } = req.body || {};
  if (!planServerId || !weekId || !dayId) return res.status(400).send("Missing fields");
  db.run(
    `INSERT INTO sessions (user_id, plan_id, week_id, day_id, data, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, plan_id, week_id, day_id)
     DO UPDATE SET data=excluded.data, updated_at=CURRENT_TIMESTAMP`,
    [req.session.user.id, planServerId, weekId, dayId, JSON.stringify(data || {})],
    (err) => {
      if (err) return res.status(500).send("Failed to save session");
      res.json({ ok: true });
    }
  );
});

app.get("/api/sessions/last", requireAuth, (req, res) => {
  const { planServerId, weekId, dayId } = req.query;
  if (!planServerId || !weekId || !dayId) return res.status(400).send("Missing query");
  db.get(
    "SELECT data FROM sessions WHERE user_id=? AND plan_id=? AND week_id=? AND day_id=?",
    [req.session.user.id, Number(planServerId), String(weekId), String(dayId)],
    (err, row) => {
      if (err || !row) return res.json(null);
      const data = row.data ? JSON.parse(row.data) : null;
      res.json(data);
    }
  );
});

// ---- Completion tracking
app.post("/api/completed", requireAuth, (req, res) => {
  const { planServerId, weekId, dayId, completed } = req.body || {};
  if (!planServerId || !weekId || !dayId) return res.status(400).send("Missing fields");
  if (completed) {
    db.run(
      `INSERT INTO completions (user_id, plan_id, week_id, day_id, completed_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, plan_id, week_id, day_id) DO UPDATE SET completed_at=CURRENT_TIMESTAMP`,
      [req.session.user.id, planServerId, weekId, dayId],
      (err) => {
        if (err) return res.status(500).send("Failed to set completed");
        res.json({ ok: true });
      }
    );
  } else {
    db.run(
      `DELETE FROM completions WHERE user_id=? AND plan_id=? AND week_id=? AND day_id=?`,
      [req.session.user.id, planServerId, weekId, dayId],
      (err) => {
        if (err) return res.status(500).send("Failed to unset completed");
        res.json({ ok: true });
      }
    );
  }
});

app.get("/api/completed/get", requireAuth, (req, res) => {
  const { planServerId, weekId, dayId } = req.query;
  if (!planServerId || !weekId || !dayId) return res.status(400).send("Missing query");
  db.get(
    `SELECT 1 FROM completions WHERE user_id=? AND plan_id=? AND week_id=? AND day_id=?`,
    [req.session.user.id, Number(planServerId), String(weekId), String(dayId)],
    (err, row) => {
      if (err) return res.status(500).send("Failed");
      res.json({ completed: !!row });
    }
  );
});

app.get("/api/completed/last", requireAuth, (req, res) => {
  const { planServerId } = req.query;
  if (!planServerId) return res.status(400).send("Missing planServerId");
  db.get(
    `SELECT week_id, day_id, completed_at
     FROM completions
     WHERE user_id=? AND plan_id=?
     ORDER BY datetime(completed_at) DESC
     LIMIT 1`,
    [req.session.user.id, Number(planServerId)],
    (err, row) => {
      if (err || !row) return res.json(null);
      res.json({ week_id: row.week_id, day_id: row.day_id, completed_at: row.completed_at });
    }
  );
});

// List all completed (week_id, day_id) for a plan for the current user
app.get("/api/completed/all", requireAuth, (req, res) => {
  const { planServerId } = req.query;
  if (!planServerId) return res.status(400).send("Missing planServerId");
  db.all(
    `SELECT week_id, day_id, completed_at
     FROM completions
     WHERE user_id=? AND plan_id=?
     ORDER BY datetime(completed_at) ASC`,
    [req.session.user.id, Number(planServerId)],
    (err, rows) => {
      if (err) return res.status(500).send("Failed");
      const out = (rows || []).map((r) => ({ week_id: String(r.week_id), day_id: String(r.day_id) }));
      res.json(out);
    }
  );
});

// ---- Start server
const PORT = process.env.PORT || 5174;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
