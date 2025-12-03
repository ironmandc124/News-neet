cat > api/cron.js <<'JS'
/*
 api/cron.js
 Fetch GNews once and save to news-cache.json (called by Vercel Cron).
 Simple, file-based cache (works with Vercel deployments).
*/
import { promises as fs } from "fs";
import path from "path";

const GNEWS_KEY = process.env.GNEWS_API_KEY || "";

const STRICT_QUERY = 'neet pg OR "neet pg 2025" OR nbems OR fmge OR "pg medical" OR "pg counselling"';
const BROAD_QUERY = 'neet OR "pg counselling" OR "medical counselling" OR "neet pg" OR "postgraduate"';

function dedupeByUrl(items){
  const m = new Map();
  for(const it of items||[]){
    if(!it || !it.url) continue;
    const k = String(it.url).split("#")[0].split("?")[0];
    if(!m.has(k)) m.set(k, it);
  }
  return Array.from(m.values());
}

async function fetchGnews(q){
  if(!GNEWS_KEY) return { ok:false, error:"missing_key" };
  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&country=in&max=50&token=${encodeURIComponent(GNEWS_KEY)}`;
  try{
    const r = await fetch(url);
    const txt = await r.text();
    let json = null;
    try{ json = JSON.parse(txt); }catch{}
    if(!r.ok) return { ok:false, status:r.status, body: json || txt };
    const articles = (json?.articles || []).map(a=>({
      title: a.title || "",
      description: a.description || a.content || "",
      url: a.url || a.link || "",
      image: a.image || null,
      publishedAt: a.publishedAt || null,
      source: a.source?.name || "GNews"
    }));
    return { ok:true, articles };
  }catch(e){
    return { ok:false, error: String(e) };
  }
}

export default async function handler(req, res){
  try{
    // try strict
    const r1 = await fetchGnews(STRICT_QUERY);
    let articles = [];
    let used = STRICT_QUERY;

    if(r1.ok && Array.isArray(r1.articles) && r1.articles.length>0){
      articles = r1.articles;
    } else {
      const r2 = await fetchGnews(BROAD_QUERY);
      used = BROAD_QUERY;
      if(r2.ok && Array.isArray(r2.articles)) articles = r2.articles;
      else {
        // Save empty cache with debug
        const payload = { fetchedAt: new Date().toISOString(), count:0, articles:[], debug:{ strict:r1, broad:r2 } };
        const p = path.join(process.cwd(),"news-cache.json");
        await fs.writeFile(p, JSON.stringify(payload, null, 2), "utf8");
        return res.status(200).json({ ok:true, saved:0, debug: payload.debug });
      }
    }

    const deduped = dedupeByUrl(articles);
    const payload = { fetchedAt: new Date().toISOString(), count: deduped.length, articles: deduped, usedQuery: used };
    const p = path.join(process.cwd(),"news-cache.json");
    await fs.writeFile(p, JSON.stringify(payload, null, 2), "utf8");
    return res.status(200).json({ ok:true, saved: deduped.length, usedQuery: used });
  }catch(e){
    return res.status(500).json({ ok:false, error: String(e) });
  }
}
JS