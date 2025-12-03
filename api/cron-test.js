// Simple test endpoint to verify Vercel deploys new functions
export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ ok: true, route: '/api/cron-test', time: new Date().toISOString() });
}
