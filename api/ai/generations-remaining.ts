import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const AI_FREE_LIMIT = 3;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = req.headers["authorization"] || "";
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Not logged in" });

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
    if (!supabaseUrl || !supabaseAnon) return res.status(500).json({ error: "Server missing Supabase config" });

    const userRes = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnon },
    });
    if (!userRes.ok) return res.status(401).json({ error: "Invalid token" });
    const user = await userRes.json();
    const userId = user?.id;
    if (!userId) return res.status(401).json({ error: "Invalid user" });

    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnon);

    const { count, error } = await supabase
      .from("ai_generations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("used_own_key", false);

    if (error) console.error("Count error:", error);
    const used = count || 0;

    return res.json({ used, limit: AI_FREE_LIMIT, remaining: Math.max(0, AI_FREE_LIMIT - used) });
  } catch (err) {
    console.error("Generations remaining error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
