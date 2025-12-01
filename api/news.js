/*
  api/news.js - use global fetch (Node 18+ on Vercel), no node-fetch required
*/
const RSSParser = require('rss-parser');
const parser = new RSSParser();

const GNEWS_KEY = "831bd2aeeed811b91e4b860f2ebb1770";
const REDDIT_SUBS = ['studytips','productivity','medicalschool','neet'];
const RSS_FEEDS = [
  'https://timesofindia.indiatimes.com/rssfeeds/913168846.cms',
  'https://www.indiatoday.in/education-today/rss'
];

let cache = { ts: 0, data: null };
const TTL = 1000 * 60 * 30; // 30 min

function normalize(a){
  return {
    id: a.id || a.link || Math.random().toString(36).slice(2),
    title: a.title || '',
    summary: a.summary || '',
    source: a.source || '',
    publishedAt: a.publishedAt || new Date().toISOString(),
    image: a.image || null,
    link: a.link || null,
    tags: a.tags || []
  };
}

async function fetchGNews(){
  try {
    const q = encodeURIComponent('neet pg OR medical education OR nbems OR counselling OR "neet"');
    const url = `https://gnews.io/api/v4/search?q=${q}&lang=en&country=in&token=${GNEWS_KEY}`;
    const res = await fetch(url);
    if (!res.ok) { console.log('GNews status', res.status); return []; }
    const j = await res.json().catch(()=>null);
    if (!j || !j.articles) return [];
    return j.articles.map(a => normalize({
      id: a.url,
      title: a.title,
      summary: a.description,
      image: a.image,
      publishedAt: a.publishedAt,
      link: a.url,
      source: a.source?.name || 'GNews',
      tags: ['gnews']
    }));
  } catch (e) {
    console.log('GNews error', e && e.message);
    return [];
  }
}

async function fetchReddit(){
  const items = [];
  for (const sub of REDDIT_SUBS){
    const url = `https://www.reddit.com/r/${sub}/top.json?limit=20&t=week`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'news-app/1.0' }});
      if (!res.ok) { continue; }
      const j = await res.json().catch(()=>null);
      if (!j) continue;
      (j.data?.children || []).forEach(c=>{
        const d = c.data || {};
        items.push(normalize({
          id: d.id,
          title: d.title,
          summary: d.selftext || '',
          link: d.permalink ? `https://reddit.com${d.permalink}` : null,
          source: `reddit/${sub}`,
          publishedAt: d.created_utc ? new Date(d.created_utc*1000).toISOString() : new Date().toISOString(),
          image: (d.preview?.images?.[0]?.source?.url || (d.thumbnail && d.thumbnail.startsWith('http') ? d.thumbnail : null)) || null,
          tags: [sub]
        }));
      });
    } catch (e) {
      console.log('reddit err', sub, e && e.message);
    }
  }
  return items;
}

async function fetchRSS(){
  const all = [];
  for (const feed of RSS_FEEDS){
    try {
      const parsed = await parser.parseURL(feed);
      (parsed.items || []).forEach(i=>{
        all.push(normalize({
          id: i.guid || i.link,
          title: i.title || '',
          summary: i.contentSnippet || i.content || '',
          source: parsed.title || '',
          publishedAt: i.pubDate || new Date().toISOString(),
          image: (i.enclosure && i.enclosure.url) || null,
          link: i.link || null
        }));
      });
    } catch (e) {
      console.log('rss err', feed, e && e.message);
    }
  }
  return all;
}

function dedupe(items){
  const map = new Map();
  for (const it of items){
    const key = (it.title||'').toLowerCase().slice(0,120);
    if (!map.has(key)) map.set(key, it);
    else {
      const ex = map.get(key);
      if (new Date(it.publishedAt) > new Date(ex.publishedAt)) map.set(key, it);
    }
  }
  return Array.from(map.values()).sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
}

async function fetchAll(){
  if (cache.data && (Date.now()-cache.ts) < TTL) return cache.data;
  const [gnews, reddit, rss] = await Promise.all([fetchGNews(), fetchReddit(), fetchRSS()]);
  const merged = dedupe([...(gnews||[]), ...(reddit||[]), ...(rss||[])]);
  cache = { ts: Date.now(), data: merged };
  return merged;
}

module.exports = async (req, res) => {
  try {
    const articles = await fetchAll();
    res.setHeader('Cache-Control','public, s-maxage=1800, stale-while-revalidate=600');
    res.status(200).json({ fetchedAt: new Date(cache.ts).toISOString(), count: articles.length, articles });
  } catch (e) {
    console.error('handler error', e && (e.stack||e.message));
    res.status(500).json({ error: 'server_error', message: (e && e.message) || 'unknown' });
  }
};
