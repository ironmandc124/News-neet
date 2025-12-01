// api/news.js
// Fetch GNews + official website(s) (simple HTML scan) and return separated results.
// NO expiry / TTL — all matched items are returned.

// ---------------- config ----------------
const FALLBACK_GNEWS_KEY = "831bd2aeeed811b91e4b860f2ebb1770"; // fallback if env not set

const OFFICIAL_SITES = [
  "https://arogyasathi.gujarat.gov.in/CurrentOpenings"
];

// keywords to consider NEET-PG related (used for both GNews query and HTML scanning)
const KEYWORDS = [
  "neet pg", "neet-pg", "nbems", "nbe", "fmge", "pg medical",
  "pg counselling", "mcc", "dnb", "md ms", "postgraduate", "seat allotment",
  "admit card", "merit list", "counselling", "counselling result", "registration", "result"
];

// ---------------- helpers ----------------
function joinKeywordsForQuery() {
  return KEYWORDS.map(k => (k.includes(" ") ? `"${k}"` : k)).join(" OR ");
}

function containsKeyword(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return KEYWORDS.some(k => t.includes(k));
}

function cleanText(s) {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

function canonicalizeUrl(u, base) {
  try {
    if (!u) return "";
    return new URL(u, base).toString();
  } catch {
    return u || "";
  }
}

function uniqByUrl(list) {
  const m = new Map();
  for (const it of list || []) {
    if (!it.link) continue;
    const k = it.link;
    if (!m.has(k)) m.set(k, it);
  }
  return Array.from(m.values());
}

// escape helper for regex snippet
function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------- fetch GNews ----------------
async function fetchGNews() {
  const key = process.env.GNEWS_API_KEY || FALLBACK_GNEWS_KEY;
  if (!key) return { articles: [], raw: null, error: "no-key" };

  const q = joinKeywordsForQuery();
  const url = "https://gnews.io/api/v4/search?q=" + encodeURIComponent(q) + "&lang=en&country=in&max=30&token=" + encodeURIComponent(key);

  try {
    const r = await fetch(url);
    const txt = await r.text();
    if (!r.ok) {
      return { error: `gnews:${r.status}`, raw: txt, articles: [] };
    }
    const json = JSON.parse(txt);
    const articles = (json.articles || []).map(a => ({
      title: a.title || "",
      description: a.description || a.content || "",
      link: a.url || a.link || "",
      publishedAt: a.publishedAt || null,
      image: a.image || null,
      source: a.source?.name || "GNews"
    }));
    return { articles, raw: null };
  } catch (e) {
    return { error: String(e), raw: null, articles: [] };
  }
}

// ---------------- fetch official site(s) ----------------
async function fetchOfficialSite(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) {
      return { url, status: r.status, items: [] };
    }
    const html = await r.text();

    // find anchors
    const anchors = [...html.matchAll(/<a\b[^>]*href=["']?([^"'\s>]+)[^>]*>([\s\S]*?)<\/a>/gi)];
    const items = [];
    for (const m of anchors) {
      const href = m[1];
      const inner = m[2] ? m[2].replace(/<[^>]+>/g, " ") : "";
      const title = cleanText(inner) || href;
      const abs = canonicalizeUrl(href, url);

      // check surrounding context for keywords (simple approach)
      const snippetMatch = new RegExp(`(.{0,120}${escapeForRegex(title)}.{0,120})`, "i");
      const snippet = snippetMatch.test(html) ? RegExp.$1 : title;

      if (containsKeyword(title) || containsKeyword(snippet)) {
        items.push({
          title: title,
          summary: snippet,
          link: abs,
          publishedAt: null,
          source: url
        });
      }
    }

    // additionally, if the whole page contains keywords, add top-level link
    if (containsKeyword(html)) {
      items.push({
        title: `Update on ${new URL(url).hostname}`,
        summary: cleanText(html.replace(/<[^>]+>/g, " ").slice(0, 300)),
        link: url,
        publishedAt: null,
        source: url
      });
    }

    const uniq = uniqByUrl(items);
    return { url, status: 200, items: uniq };
  } catch (e) {
    return { url, status: "err", error: String(e), items: [] };
  }
}

// ---------------- handler ----------------
export default async function handler(req, res) {
  try {
    // fetch GNews + official sites in parallel
    const [gnewsResult, ...officialResults] = await Promise.all([
      fetchGNews(),
      ...OFFICIAL_SITES.map(u => fetchOfficialSite(u))
    ]);

    // normalize GNews
    let gnewsArticles = [];
    let gnewsDebug = null;
    if (gnewsResult) {
      if (Array.isArray(gnewsResult.articles)) {
        gnewsArticles = gnewsResult.articles.filter(a => containsKeyword(a.title + " " + (a.description || "")));
      } else {
        gnewsDebug = { error: gnewsResult.error, raw: gnewsResult.raw || null };
      }
    }

    // normalize official site items
    const officialItems = [];
    const officialDebug = [];
    for (const r of officialResults) {
      if (!r) continue;
      officialDebug.push({ url: r.url, status: r.status, parsed: (r.items || []).length, error: r.error || null });
      if (Array.isArray(r.items)) {
        for (const it of r.items) {
          officialItems.push({
            title: it.title || it.summary || "Update",
            summary: it.summary || "",
            link: it.link || r.url,
            publishedAt: it.publishedAt || null,
            source: it.source || r.url
          });
        }
      }
    }

    // dedupe
    gnewsArticles = uniqByUrl(gnewsArticles);
    const officialUnique = uniqByUrl(officialItems);

    // Response
    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      gnewsDebug,
      officialDebug,
      gnews: gnewsArticles,
      official: officialUnique
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}