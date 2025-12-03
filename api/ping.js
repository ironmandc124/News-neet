export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ ok: true, route: '/api/ping', time: new Date().toISOString() });
}
