// Vercel Serverless Function: POST /api/ai/generate-program
import { createClient } from "@supabase/supabase-js";

const AI_FREE_LIMIT = 3;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Auth: verify Supabase JWT
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Not logged in" });

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnon) return res.status(500).json({ error: "Server missing Supabase config" });

    // Verify the user token
    const userRes = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnon },
    });
    if (!userRes.ok) return res.status(401).json({ error: "Invalid token" });
    const user = await userRes.json();
    const userId = user?.id;
    if (!userId) return res.status(401).json({ error: "Invalid user" });

    const { prompt, apiKey } = req.body || {};
    if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "Missing prompt" });

    const userKey = apiKey && typeof apiKey === "string" ? apiKey.trim() : "";
    const serverKey = process.env.ANTHROPIC_API_KEY || "";
    const usingOwnKey = !!userKey;

    // Initialize Supabase service client for rate limiting
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnon);

    // Rate limit check for free tier
    if (!usingOwnKey) {
      if (!serverKey) return res.status(503).json({ error: "AI generation is not configured. Please provide your own Anthropic API key." });

      const { count, error: countErr } = await supabase
        .from("ai_generations")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("used_own_key", false);

      if (countErr) console.error("Rate limit check error:", countErr);
      const used = count || 0;
      if (used >= AI_FREE_LIMIT) {
        return res.status(429).json({
          error: `You've used all ${AI_FREE_LIMIT} free generations. Add your own Anthropic API key to generate more programs.`,
          limitReached: true,
        });
      }
    }

    const activeKey = usingOwnKey ? userKey : serverKey;
    console.log("[AI] Calling Anthropic API for user:", userId);

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": activeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    console.log("[AI] Anthropic response status:", anthropicRes.status);

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => "");
      console.error("[AI] Anthropic API error:", anthropicRes.status, errBody);
      if (anthropicRes.status === 401) {
        return res.status(401).json({ error: usingOwnKey ? "Invalid API key. Please check your Anthropic API key." : "Server API key is invalid." });
      }
      return res.status(502).json({ error: "AI service error. Please try again." });
    }

    const result = await anthropicRes.json();
    let csv = (result?.content?.[0]?.text || "").trim();

    // Strip markdown code fences if present
    csv = csv.replace(/^```(?:csv)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    if (!csv || !csv.includes("planName")) {
      return res.status(502).json({ error: "AI did not return a valid program CSV. Please try again." });
    }

    // Record generation in Supabase
    const { error: insertErr } = await supabase
      .from("ai_generations")
      .insert({ user_id: userId, used_own_key: usingOwnKey });

    if (insertErr) console.error("[AI] Failed to record generation:", insertErr);

    res.json({ csv });
  } catch (err) {
    console.error("[AI] Generation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
