export default function handler(req, res) {
  // Minimal health-check handler to prove the route exists
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({ ok: true, route: "/api/cron", time: new Date().toISOString() });
}
