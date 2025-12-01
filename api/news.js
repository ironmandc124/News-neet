// api/news.js
// Minimal GNews-only endpoint for NEET-PG related articles.
// Requires environment variable GNEWS_API_KEY to be set in Vercel.

// keywords used to build query
const KEYWORDS = [
  "neet pg", "neet-pg", "nbems", "nbe", "fmge",
  "pg medical", "pg counselling", "mcc", "dnb",
  "md ms", "postgraduate", "seat allotment",
  "admit card", "merit list", "counselling", "result"
];

function buildQuery() {
  // quote multiword phrases
  return KEYWORDS.map(k => (k.includes(" ") ? `"${k}"` : k)).join(" OR ");
}

function dedupeByUrl(items) {
  const map = new Map();
  for (const it of items || []) {
    if (!it || !it.url) continue;
    const key = it.url.split("#")[0].split("?")[0]; // simple canonicalization
    if (!map.has(key)) map.set(key, it);
  }
  return [...map.values()];
}

export default async function handler(req, res) {
  const key = process.env.GNEWS_API_KEY;
  if (!key) {
    return res.status(400).json({ error: "Missing GNEWS_API_KEY environment variable" });
  }

  const q = buildQuery();
  const url =
    "https://gnews.io/api/v4/search?q=" +
    encodeURIComponent(q) +
    "&lang=en&country=in&max=50&token=" +
    encodeURIComponent(key);

  try {
    const r = await fetch(url);
    const txt = await r.text();

    if (!r.ok) {
      // forward remote error + preview
      let parsed = null;
      try { parsed = JSON.parse(txt); } catch {}
      return res.status(r.status).json({ error: "GNews error", status: r.status, body: parsed || txt });
    }

    const json = JSON.parse(txt);
    const articles = (json.articles || []).map(a => ({
      title: a.title || "",
      description: a.description || a.content || "",
      url: a.url || "",
      image: a.image || null,
      publishedAt: a.publishedAt || null,
      source: a.source?.name || "GNews"
    }));

    const filtered = dedupeByUrl(articles);

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      count: filtered.length,
      articles: filtered
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}