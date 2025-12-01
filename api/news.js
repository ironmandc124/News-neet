// api/news.js
// GNews primary fetch with automatic fallback + filter + debug info

function filterNEETPG_Strict(items) {
  const include = [
    "neet pg","neet-pg","nbems","nbe","fmge","pg medical","pg counselling",
    "pg entrance","md ms","postgraduate","post graduate","neet ss","dnb"
  ];
  return (items || []).filter(a => {
    const t = ((a.title||"") + " " + (a.description||"") + " " + (a.content||"")).toLowerCase();
    return include.some(k => t.includes(k));
  });
}

function filterNEETPG_Loose(items) {
  // looser: keep anything that mentions neet or counselling or medical
  return (items || []).filter(a => {
    const t = ((a.title||"") + " " + (a.description||"") + " " + (a.content||"")).toLowerCase();
    return (t.includes("neet") || t.includes("counselling") || t.includes("medical") || t.includes("pg"));
  });
}

async function fetchGNewsRaw(query, max=50) {
  const key = process.env.GNEWS_API_KEY || "";
  const url = "https://gnews.io/api/v4/search?q=" + encodeURIComponent(query) + "&lang=en&country=in&max=" + max + "&token=" + encodeURIComponent(key);
  try {
    const res = await fetch(url);
    const text = await res.text().catch(()=>"");
    let json = null;
    try { json = JSON.parse(text); } catch(e) { json = null; }
    return { ok: res.ok, status: res.status, statusText: res.statusText, url, rawText: text.slice(0, 2000), json };
  } catch (err) {
    return { ok:false, status: null, error: String(err) };
  }
}

// remove duplicate by URL, keep newest first if publishedAt present
function normalizeAndDedupe(arr) {
  const map = new Map();
  (arr || []).forEach(a => {
    const key = (a.url || a.link || a.id || a.title||"").toString();
    if (!key) return;
    // keep last occurrence (we will sort after)
    map.set(key, a);
  });
  return Array.from(map.values()).sort((a,b)=>{
    const da = new Date(a.publishedAt || a.published || a.publishedAt || 0).getTime();
    const db = new Date(b.publishedAt || b.published || b.publishedAt || 0).getTime();
    return db - da;
  });
}

export default async function handler(req, res) {
  try {
    // Queries
    const strictQ = 'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR fmge OR "pg medical" OR "pg counselling"';
    const broaderQ = 'neet OR "pg counselling" OR "medical counselling" OR "neet pg" OR "neet- pg" OR "neet-pg"';

    // 1) Try strict query
    const r1 = await fetchGNewsRaw(strictQ, 50);

    // If r1.ok and json present, extract articles
    let articles = [];
    if (r1.ok && r1.json && Array.isArray(r1.json.articles)) {
      articles = r1.json.articles;
    }

    // 2) If no articles from strict, try broader query
    let usedQuery = strictQ;
    let fallbackInfo = null;
    if ((!articles || articles.length === 0) || !r1.ok) {
      const r2 = await fetchGNewsRaw(broaderQ, 50);
      fallbackInfo = r2;
      if (r2.ok && r2.json && Array.isArray(r2.json.articles)) {
        articles = r2.json.articles;
        usedQuery = broaderQ;
      }
    }

    // normalize/dedupe
    articles = normalizeAndDedupe(articles);

    // 3) Apply strict filter first
    let filtered = filterNEETPG_Strict(articles || []);

    // 4) If strict filtered list empty but raw articles exist, apply loose filter
    let usedFilter = "strict";
    if ((!filtered || filtered.length === 0) && (articles && articles.length > 0)) {
      filtered = filterNEETPG_Loose(articles);
      usedFilter = "loose";
    }

    // Prepare response with debug info so you can see why results are empty
    const debug = {
      fetchedAt: new Date().toISOString(),
      usedEnvironmentKeyPresent: !!process.env.GNEWS_API_KEY,
      initialStrictFetch: {
        ok: r1.ok,
        status: r1.status,
        statusText: r1.statusText,
        sample: (r1.json && r1.json.articles) ? r1.json.articles.slice(0,5).map(a=>({title:a.title, url:a.url})) : []
      },
      fallbackFetch: fallbackInfo ? {
        ok: fallbackInfo.ok,
        status: fallbackInfo.status,
        statusText: fallbackInfo.statusText,
        sample: (fallbackInfo.json && fallbackInfo.json.articles) ? fallbackInfo.json.articles.slice(0,5).map(a=>({title:a.title,url:a.url})) : []
      } : null,
      usedQuery,
      usedFilter,
      rawCount: (articles||[]).length,
      finalCount: (filtered||[]).length
    };

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      count: filtered.length,
      articles: filtered,
      debug
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}