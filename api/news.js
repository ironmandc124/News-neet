// ================================
// api/news.js
// Fetch GNews + RSS (TOI, FreePress, Telegram via RSSHub),
// filter NEET-PG, remove articles older than 48 hours (all sources).
// ================================

// -------------------- helpers --------------------
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

// -------------------- filter NEET PG (include only) --------------------
function filterNEETPG(articles) {
  const include = [
    "neet pg",
    "neet-pg",
    "nbems",
    "nbe",
    "fmge",
    "pg medical",
    "pg counselling",
    "neet ss",
    "dnb",
    "md ms",
    "pg entrance",
    "postgraduate",
    "post graduate",
    "counselling",
    "medical college",
    "seat allotment"
  ];

  return (articles || []).filter((a) => {
    const text = (ensureString(a.title) + " " + ensureString(a.summary) + " " + ensureString(a.description || "")).toLowerCase();
    return include.some((good) => text.includes(good));
  });
}

// -------------------- expiry: drop articles older than 48 hours --------------------
function dropOlderThan48h(articles) {
  const TTL = 2 * 24 * 60 * 60 * 1000; // 48 hours in ms
  const now = Date.now();

  return (articles || []).filter(a => {
    const date = parseDateSafe(a.publishedAt || a.published || a.pubDate || a.publishedAt);
    if (!date) return false; // drop if no valid date
    return now - date.getTime() <= TTL;
  });
}

// -------------------- fetch helpers --------------------
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// GNews
async function fetchGNews() {
  try {
    const query = 'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR fmge OR "pg medical" OR "pg counselling"';
    const url =
      "https://gnews.io/api/v4/search?q=" +
      encodeURIComponent(query) +
      "&lang=en&country=in&max=50&token=" +
      encodeURIComponent(process.env.GNEWS_API_KEY || "");
    const data = await fetchJSON(url);
    if (!data || !Array.isArray(data.articles)) return [];
    // normalize GNews fields to common shape
    return data.articles.map(a => ({
      id: a.id || a.url || null,
      title: a.title || "",
      summary: a.description || a.content || "",
      description: a.description || "",
      content: a.content || "",
      link: a.url || a.link || "",
      url: a.url || a.link || "",
      publishedAt: a.publishedAt || a.published || null,
      image: a.image || a.urlToImage || null,
      source: a.source?.name || "GNews"
    }));
  } catch {
    return [];
  }
}

// RSS sources (TOI, FreePress, Telegram via RSSHub)
const RSS_SOURCES = [
  "https://timesofindia.indiatimes.com/rssfeeds/913168846.cms",
  "https://www.freepressjournal.in/rss/section/education",
  "https://rsshub.app/telegram/channel/zynerdneetpg2025"
];

async function fetchRSSFeed(rssUrl) {
  try {
    const r = await fetch(rssUrl);
    if (!r.ok) return [];
    const xml = await r.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const block = m[1];
      const title = cleanCDATA((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
      const description = cleanCDATA((block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "");
      const link = cleanCDATA((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
      const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || (block.match(/<dc:date>([\s\S]*?)<\/dc:date>/) || [])[1] || null;
      return {
        id: link || title,
        title,
        summary: description,
        description,
        link,
        url: link,
        publishedAt: pub,
        image: null,
        source: rssUrl.includes("telegram") ? "Telegram Channel" : (rssUrl.includes("freepressjournal") ? "FreePress" : "TOI")
      };
    });

    return items;
  } catch (e) {
    console.log("fetchRSSFeed error", rssUrl, e && e.message);
    return [];
  }
}

// -------------------- dedupe by canonical url or title --------------------
function canonicalizeUrl(u) {
  try {
    if (!u) return "";
    const x = new URL(u);
    x.hash = "";
    x.search = "";
    return x.toString().replace(/\/+$/, "");
  } catch {
    return (u || "").toString();
  }
}
function normalizeTitle(t) {
  if (!t) return "";
  return t.toString().toLowerCase().replace(/[\u2018\u2019\u201C\u201D]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function dedupe(list) {
  const byUrl = new Map();
  const byTitle = new Map();

  for (const it of (list || [])) {
    const url = canonicalizeUrl(it.link || it.url || "");
    const normTitle = normalizeTitle(it.title || "");

    const obj = {
      ...it,
      link: it.link || it.url || "",
      publishedAt: it.publishedAt || it.published || it.pubDate || null
    };

    if (url) {
      if (!byUrl.has(url)) byUrl.set(url, obj);
      else {
        // keep newest
        const ex = byUrl.get(url);
        const exT = parseDateSafe(ex.publishedAt)?.getTime() || 0;
        const nT = parseDateSafe(obj.publishedAt)?.getTime() || 0;
        if (nT > exT) byUrl.set(url, obj);
      }
    } else if (normTitle) {
      if (!byTitle.has(normTitle)) byTitle.set(normTitle, obj);
      else {
        const ex = byTitle.get(normTitle);
        const exT = parseDateSafe(ex.publishedAt)?.getTime() || 0;
        const nT = parseDateSafe(obj.publishedAt)?.getTime() || 0;
        if (nT > exT) byTitle.set(normTitle, obj);
      }
    }
  }

  // merge: prefer canonical url entries, then title-only entries
  const merged = new Map();
  for (const [u, item] of byUrl) {
    const key = normalizeTitle(item.title) || u;
    merged.set(key, item);
  }
  for (const [t, item] of byTitle) {
    const key = t || item.link || Date.now() + Math.random();
    if (!merged.has(key)) merged.set(key, item);
  }

  // return as array sorted by publishedAt desc
  return Array.from(merged.values()).sort((a, b) => {
    const ta = parseDateSafe(a.publishedAt)?.getTime() || 0;
    const tb = parseDateSafe(b.publishedAt)?.getTime() || 0;
    return tb - ta;
  });
}

// -------------------- main handler --------------------
export default async function handler(req, res) {
  try {
    // fetch gnews
    const gnews = await fetchGNews();

    // fetch all RSS feeds in parallel
    const rssArrays = await Promise.all(RSS_SOURCES.map(u => fetchRSSFeed(u)));
    const rssItems = rssArrays.flat();

    // merge + dedupe
    const mergedRaw = [...(gnews || []), ...(rssItems || [])];
    const merged = dedupe(mergedRaw);

    // filter NEET PG only
    let filtered = filterNEETPG(merged);

    // drop articles older than 48 hours (applies to ALL sources)
    filtered = dropOlderThan48h(filtered);

    // final sort
    filtered.sort((a, b) => {
      const ta = parseDateSafe(a.publishedAt)?.getTime() || 0;
      const tb = parseDateSafe(b.publishedAt)?.getTime() || 0;
      return tb - ta;
    });

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      count: filtered.length,
      articles: filtered
    });
  } catch (e) {
    console.error("news handler error:", e && e.message);
    return res.status(500).json({ error: String(e) });
  }
}