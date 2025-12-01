// api/cron.js → Fetch & Save NEET PG news every 30 minutes (called by Vercel Cron)

import { promises as fs } from "fs";
import path from "path";

async function fetchGNews() {
  const key = process.env.GNEWS_API_KEY;
  const query =
    'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR fmge OR "pg medical" OR "pg counselling"';

  const url =
    "https://gnews.io/api/v4/search?q=" +
    encodeURIComponent(query) +
    "&lang=en&country=in&max=50&token=" +
    key;

  const res = await fetch(url);
  const j = await res.json();
  return j.articles || [];
}

function filterNEETPG(items) {
  const include = [
    "neet pg", "neet-pg", "nbems", "nbe", "fmge",
    "pg medical", "pg counselling",
    "pg entrance", "md ms", "neet ss", "dnb",
    "gujarat neet pg", "maharashtra neet pg",
    "rajasthan neet pg", "karnataka neet pg"
  ];

  return items.filter(a => {
    const t = (
      (a.title || "") +
      " " +
      (a.description || "") +
      " " +
      (a.content || "")
    ).toLowerCase();
    return include.some(k => t.includes(k));
  });
}

export default async function handler(req, res) {
  try {
    const raw = await fetchGNews();
    const filtered = filterNEETPG(raw);

    const final = {
      fetchedAt: new Date().toISOString(),
      count: filtered.length,
      articles: filtered
    };

    // Save to file
    const file = path.join(process.cwd(), "news-cache.json");
    await fs.writeFile(file, JSON.stringify(final, null, 2));

    return res.status(200).json({ ok: true, saved: filtered.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}