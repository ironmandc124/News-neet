/*
 Minimal /api/cron health + fetch runner (safe single-file version).
 This proves Vercel will serve the route. Once working we can restore full fetch logic.
*/
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  // quick health + hint
  return res.status(200).json({ ok: true, route: "/api/cron", time: new Date().toISOString(), note: "minimal handler — replace with full cron after deploy" });
}
