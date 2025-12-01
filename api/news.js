// api/news.js - GNews with stronger dedupe (canonical URL + normalized title)

// ---------------------- helpers ----------------------
function normalizeTitle(t) {
  if (!t) return "";
  return t
    .toString()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "") // smart quotes
    .replace(/[^a-z0-9\s]/g, " ") // remove punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeUrl(u) {
  try {
    if (!u) return "";
    const url = new URL(u);
    // remove query and hash to canonicalize
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, ""); // remove trailing slash
  } catch (e) {
    return (u || "").toString();
  }
}

// ---------------------- filters ----------------------
function filterNEETPG_Strict(items) {
  const include = [
    "neet pg","neet-pg","nbems","nbe","fmge","pg medical","pg counselling",
    "pg entrance","md ms","postgraduate","post graduate","neet ss","dnb"
  ];
  return (items||[]).filter(a=>{
    const t = ((a.title||"") + " " + (a.description||"") + " " + (a.content||"")).toLowerCase();
    return include.some(k=>t.includes(k));
  });
}
function filterNEETPG_Loose(items) {
  return (items||[]).filter(a=>{
    const t = ((a.title||"") + " " + (a.description||"") + " " + (a.content||"")).toLowerCase();
    return (t.includes("neet") || t.includes("counselling") || t.includes("medical") || t.includes("pg"));
  });
}

// ---------------------- fetch raw ----------------------
async function fetchGNewsRaw(query, max=50) {
  const key = process.env.GNEWS_API_KEY || "";
  const url = "https://gnews.io/api/v4/search?q=" + encodeURIComponent(query) + "&lang=en&country=in&max=" + max + "&token=" + encodeURIComponent(key);
  try {
    const res = await fetch(url);
    const text = await res.text().catch(()=>"");
    let json = null;
    try { json = JSON.parse(text); } catch(e) { json = null; }
    return { ok: res.ok, status: res.status, statusText: res.statusText, url, rawText: text.slice(0,2000), json };
  } catch (err) {
    return { ok:false, status:null, error: String(err) };
  }
}

// ---------------------- normalize & dedupe ----------------------
function normalizeAndDedupe(arr) {
  const byCanonicalUrl = new Map();
  const byNormTitle = new Map();

  (arr||[]).forEach(item => {
    // unify fields
    const title = item.title || item.name || "";
    const desc = item.description || item.summary || "";
    const url = item.url || item.link || "";
    const publishedAt = item.publishedAt || item.published || item.pubDate || null;

    const canUrl = canonicalizeUrl(url);
    const normTitle = normalizeTitle(title);

    const obj = {
      id: item.id || canUrl || normTitle,
      title: title,
      description: desc,
      content: item.content || "",
      url: url,
      canonicalUrl: canUrl,
      normalizedTitle: normTitle,
      publishedAt: publishedAt,
      image: item.image || item.imageUrl || item.urlToImage || null,
      source: item.source || item.source?.name || item.source?.title || item.source?.name || null
    };

    // 1) prefer one per canonical URL (keep newest)
    if (canUrl) {
      if (!byCanonicalUrl.has(canUrl)) byCanonicalUrl.set(canUrl, obj);
      else {
        const existing = byCanonicalUrl.get(canUrl);
        const exTime = new Date(existing.publishedAt || 0).getTime();
        const newTime = new Date(obj.publishedAt || 0).getTime();
        if (newTime > exTime) byCanonicalUrl.set(canUrl, obj);
      }
    } else {
      // if no canonical URL, group by normalized title
      if (!byNormTitle.has(normTitle)) byNormTitle.set(normTitle, obj);
      else {
        const existing = byNormTitle.get(normTitle);
        const exTime = new Date(existing.publishedAt || 0).getTime();
        const newTime = new Date(obj.publishedAt || 0).getTime();
        if (newTime > exTime) byNormTitle.set(normTitle, obj);
      }
    }
  });

  // merge maps: if same normalized title appears in different canonical urls, keep newest
  const merged = new Map();

  // start with canonicalUrl items
  for (const [canUrl, item] of byCanonicalUrl) {
    const key = item.normalizedTitle || canUrl;
    if (!merged.has(key)) merged.set(key, item);
    else {
      const ex = merged.get(key);
      const exT = new Date(ex.publishedAt||0).getTime();
      const nT = new Date(item.publishedAt||0).getTime();
      if (nT > exT) merged.set(key, item);
    }
  }

  // then add normTitle-only items
  for (const [norm, item] of byNormTitle) {
    const key = item.normalizedTitle || item.canonicalUrl || norm;
    if (!merged.has(key)) merged.set(key, item);
    else {
      const ex = merged.get(key);
      const exT = new Date(ex.publishedAt||0).getTime();
      const nT = new Date(item.publishedAt||0).getTime();
      if (nT > exT) merged.set(key, item);
    }
  }

  // return array sorted by publishedAt desc (newest first)
  return Array.from(merged.values()).sort((a,b)=>{
    const ta = new Date(a.publishedAt||0).getTime();
    const tb = new Date(b.publishedAt||0).getTime();
    return tb - ta;
  });
}

// ---------------------- main handler ----------------------
export default async function handler(req, res) {
  try {
    const strictQ = 'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR fmge OR "pg medical" OR "pg counselling"';
    const broaderQ = 'neet OR "pg counselling" OR "medical counselling" OR "neet pg" OR "neet-pg" OR "postgraduate"';

    // try strict
    const r1 = await fetchGNewsRaw(strictQ, 50);
    let articles = [];
    if (r1.ok && r1.json && Array.isArray(r1.json.articles)) articles = r1.json.articles;

    let usedQuery = strictQ;
    let fallbackInfo = null;
    if ((!(articles && articles.length)) || !r1.ok) {
      const r2 = await fetchGNewsRaw(broaderQ, 50);
      fallbackInfo = r2;
      if (r2.ok && r2.json && Array.isArray(r2.json.articles)) {
        articles = r2.json.articles;
        usedQuery = broaderQ;
      }
    }

    // normalize + dedupe strongly
    const deduped = normalizeAndDedupe(articles || []);

    // apply strict filter then loose fallback
    let filtered = filterNEETPG_Strict(deduped);
    let usedFilter = "strict";
    if ((!filtered || filtered.length === 0) && (deduped && deduped.length > 0)) {
      filtered = filterNEETPG_Loose(deduped);
      usedFilter = "loose";
    }

    // return final results + debug
    const debug = {
      fetchedAt: new Date().toISOString(),
      usedEnvironmentKeyPresent: !!process.env.GNEWS_API_KEY,
      initialStrictFetch: { ok: r1.ok, status: r1.status, statusText: r1.statusText, sample: (r1.json && r1.json.articles) ? r1.json.articles.slice(0,5).map(a=>({title:a.title,url:a.url})) : [] },
      fallbackFetch: fallbackInfo ? { ok: fallbackInfo.ok, status: fallbackInfo.status, statusText: fallbackInfo.statusText, sample: (fallbackInfo.json && fallbackInfo.json.articles) ? fallbackInfo.json.articles.slice(0,5).map(a=>({title:a.title,url:a.url})) : [] } : null,
      usedQuery,
      usedFilter,
      rawCount: (articles||[]).length,
      dedupedCount: (deduped||[]).length,
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