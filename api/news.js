// ================================
// api/news.js
// Fetch GNews + RSS + Telegram
// Split Telegram news separately
// Filter NEET PG + 48h expiry
// ================================

// ---- helpers ----
function cleanCDATA(s) {
  if (!s) return s;
  return s.replace(/<!\[CDATA\[(.*?)\]\]>/gi, "$1").trim();
}

function ensureString(x) {
  return x == null ? "" : String(x);
}

function parseDateSafe(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

function dropOlderThan48h(items) {
  const TTL = 2 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return items.filter(a => {
    const t = parseDateSafe(a.publishedAt)?.getTime();
    if (!t) return false;
    return now - t <= TTL;
  });
}

// ---- NEET PG filter ----
function filterNEETPG(items) {
  const inc = [
    "neet pg", "neet-pg", "nbems", "nbe", "fmge", "pg medical",
    "pg counselling", "neet ss", "dnb", "md ms", "pg entrance",
    "postgraduate", "post graduate", "counselling", "medical college",
    "seat allotment"
  ];

  return items.filter(a => {
    const t = (ensureString(a.title) + " " + ensureString(a.summary)).toLowerCase();
    return inc.some(k => t.includes(k));
  });
}

// ---- GNews ----
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchGNews() {
  const query =
    'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR fmge OR "pg medical" OR "pg counselling"';

  const url =
    "https://gnews.io/api/v4/search?q=" +
    encodeURIComponent(query) +
    "&lang=en&country=in&max=50&token=" +
    encodeURIComponent(process.env.GNEWS_API_KEY || "");

  const data = await fetchJSON(url);
  if (!data || !data.articles) return [];
  return data.articles.map(a => ({
    title: a.title,
    summary: a.description,
    link: a.url,
    publishedAt: a.publishedAt,
    image: a.image,
    source: "GNews"
  }));
}

// ---- RSS ----
const RSS_SOURCES = [
  "https://timesofindia.indiatimes.com/rssfeeds/913168846.cms",
  "https://www.freepressjournal.in/rss/section/education",
  "https://rsshub.app/telegram/channel/zynerdneetpg2025"
];

async function fetchRSSFeed(url) {
  try {
    const r = await fetch(url);
    const xml = await r.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const d = m[1];
      return {
        title: cleanCDATA((d.match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
        summary: cleanCDATA((d.match(/<description>([\s\S]*?)<\/description>/) || [])[1]),
        link: cleanCDATA((d.match(/<link>([\s\S]*?)<\/link>/) || [])[1]),
        publishedAt: cleanCDATA((d.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1]),
        source: url.includes("telegram")
          ? "Telegram"
          : url.includes("freepress")
          ? "FreePress"
          : "TOI"
      };
    });
    return items;
  } catch {
    return [];
  }
}

// ---- merge + dedupe ----
function canonicalize(u) {
  try {
    const x = new URL(u);
    x.search = "";
    x.hash = "";
    return x.toString();
  } catch { return u; }
}

function dedupe(list) {
  const map = new Map();
  for (const a of list) {
    if (!a.link) continue;
    const key = canonicalize(a.link);
    if (!map.has(key)) map.set(key, a);
  }
  return [...map.values()];
}

// ---- handler ----
export default async function handler(req, res) {
  try {
    const gnews = await fetchGNews();
    const rss = (await Promise.all(RSS_SOURCES.map(fetchRSSFeed))).flat();

    // SPLIT TELEGRAM HERE
    let telegramItems = rss.filter(a => a.source === "Telegram");
    let generalItems = [
      ...gnews,
      ...rss.filter(a => a.source !== "Telegram")
    ];

    // FILTER NEET PG
    telegramItems = filterNEETPG(telegramItems);
    generalItems = filterNEETPG(generalItems);

    // EXPIRY 48h
    telegramItems = dropOlderThan48h(telegramItems);
    generalItems = dropOlderThan48h(generalItems);

    // dedupe + sort
    telegramItems = dedupe(telegramItems).sort((a, b) => {
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    generalItems = dedupe(generalItems).sort((a, b) => {
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      countGeneral: generalItems.length,
      countTelegram: telegramItems.length,
      generalNews: generalItems,
      telegramNews: telegramItems
    });
  } catch (e) {
    return res.status(500).json({ error: e.toString() });
  }
}