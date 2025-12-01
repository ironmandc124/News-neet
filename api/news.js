// api/news.js
// Aggregate NEET-PG news from multiple RSS sources + Telegram (RSSHub).
// No GNews used (avoids daily quota issues).
// Filters NEET-PG keywords, splits telegramNews, expires items after 48h.

// ---------- helpers ----------
function cleanCDATA(s) {
  if (!s) return "";
  return s.replace(/<!\[CDATA\[(.*?)\]\]>/gi, "$1").trim();
}
function ensureString(x) { return x == null ? "" : String(x); }
function parseDateSafe(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function within48Hours(dateStr) {
  const d = parseDateSafe(dateStr);
  if (!d) return false;
  return (Date.now() - d.getTime()) <= 48 * 60 * 60 * 1000;
}

// ---------- filter: NEET PG keywords ----------
function filterNEETPG(items) {
  const inc = [
    "neet pg", "neet-pg", "nbems", "nbe", "fmge", "pg medical",
    "pg counselling", "neet ss", "dnb", "md ms", "pg entrance",
    "postgraduate", "post graduate", "counselling", "medical college",
    "seat allotment", "counselling result", "seat allotment result"
  ];
  return (items || []).filter(a => {
    const t = (ensureString(a.title) + " " + ensureString(a.summary) + " " + ensureString(a.description)).toLowerCase();
    return inc.some(k => t.includes(k));
  });
}

// ---------- dedupe by link or title ----------
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
  return t.toString().toLowerCase().replace(/\s+/g, " ").trim();
}
function dedupe(list) {
  const byUrl = new Map();
  const byTitle = new Map();

  for (const it of (list || [])) {
    const url = canonicalizeUrl(it.link || it.url || "");
    const title = normalizeTitle(it.title || "");
    const obj = { ...it, link: it.link || it.url || "" };

    if (url) {
      if (!byUrl.has(url)) byUrl.set(url, obj);
    } else if (title) {
      if (!byTitle.has(title)) byTitle.set(title, obj);
    }
  }

  const out = [...byUrl.values()];
  for (const v of byTitle.values()) {
    if (!out.find(x => normalizeTitle(x.title) === normalizeTitle(v.title))) out.push(v);
  }
  return out;
}

// ---------- RSS sources (add/remove as you want) ----------
const RSS_SOURCES = [
  // Economic Times - Education top stories (good source for counselling/results)
  "https://education.economictimes.indiatimes.com/rss/topstories",

  // India Today - Education section (broad)
  "https://www.indiatoday.in/education-today/rss",

  // Medical Dialogues (medical education & news)
  "https://speciality.medicaldialogues.in/rss-feed",

  // FreePressJournal education (kept)
  "https://www.freepressjournal.in/rss/section/education",

  // Telegram via RSSHub (Zynerd channel)
  "https://rsshub.app/telegram/channel/zynerdneetpg2025"
];

// ---------- fetch & parse RSS (safe) ----------
async function fetchRSSFeed(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) {
      // return empty + include simple debug hint
      return { items: [], url, status: r.status };
    }
    const xml = await r.text();

    // parse <item> blocks
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const block = m[1];
      const title = cleanCDATA((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
      const description = cleanCDATA((block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "");
      const link = cleanCDATA((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
      const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || (block.match(/<dc:date>([\s\S]*?)<\/dc:date>/) || [])[1] || null;

      return {
        title,
        summary: description,
        description,
        link,
        publishedAt: pub,
        source: url.includes("telegram") ? "Telegram" :
                url.includes("economictimes") ? "EconomicTimes" :
                url.includes("indiatoday") ? "IndiaToday" :
                url.includes("medicaldialogues") ? "MedicalDialogues" :
                url.includes("freepressjournal") ? "FreePress" : url
      };
    });

    return { items, url, status: 200 };
  } catch (e) {
    return { items: [], url, status: "err", error: String(e) };
  }
}

// ---------- main handler ----------
export default async function handler(req, res) {
  try {
    // fetch RSS feeds in parallel
    const rssResults = await Promise.all(RSS_SOURCES.map(u => fetchRSSFeed(u)));

    // collect all parsed items, but keep telegram separate
    let allItems = [];
    let telegramItems = [];

    for (const r of rssResults) {
      if (!r || !Array.isArray(r.items)) continue;
      if ((r.url || "").includes("/telegram/") || (r.items.length && r.items[0]?.source === "Telegram")) {
        telegramItems.push(...r.items);
      } else {
        allItems.push(...r.items);
      }
    }

    // filter for NEET-PG keywords
    allItems = filterNEETPG(allItems);
    telegramItems = filterNEETPG(telegramItems);

    // drop items older than 48h
    allItems = allItems.filter(a => within48Hours(a.publishedAt));
    telegramItems = telegramItems.filter(a => within48Hours(a.publishedAt));

    // dedupe each list and sort by publishedAt desc
    allItems = dedupe(allItems).sort((a,b) => (parseDateSafe(b.publishedAt)?.getTime() || 0) - (parseDateSafe(a.publishedAt)?.getTime() || 0));
    telegramItems = dedupe(telegramItems).sort((a,b) => (parseDateSafe(b.publishedAt)?.getTime() || 0) - (parseDateSafe(a.publishedAt)?.getTime() || 0));

    // debug info (helpful while you verify)
    const debug = {
      fetchedAt: new Date().toISOString(),
      sourcesQueried: rssResults.map(r => ({ url: r.url, status: r.status || "unknown", parsed: (r.items||[]).length }))
    };

    return res.status(200).json({
      debug,
      fetchedAt: new Date().toISOString(),
      countGeneral: allItems.length,
      countTelegram: telegramItems.length,
      generalNews: allItems,
      telegramNews: telegramItems
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}