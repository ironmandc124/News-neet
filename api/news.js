// api/news.js (CommonJS, uses global fetch)
const RSSParser = require('rss-parser');
const parser = new RSSParser();

// Your GNews API key (server-side ONLY)
const GNEWS_KEY = "831bd2aeeed811b91e4b860f2ebb1770";

// Sources
const REDDIT_SUBS = ['studytips','productivity','medicalschool','neet'];
const RSS_FEEDS = [
  'https://timesofindia.indiatimes.com/rssfeeds/913168846.cms',
  'https://www.indiatoday.in/education-today/rss'
];

// Cache (30 minutes)
let cache = { ts: 0, data: null };
const TTL = 1000 * 60 * 30;

// Normalize helper
function normalize(a) {
  return {
    id: a.id || a.link || Math.random().toString(36).slice(2),
    title: a.title || "",
    summary: a.summary || "",
    source: a.source || "",
    publishedAt: a.publishedAt || new Date().toISOString(),
    image: a.image || null,
    link: a.link || null,
    tags: a.tags || []
  };
}

// GNews search for NEET PG + medical education
async function fetchGNews() {
  try {
    const q = encodeURIComponent(
      'neet pg OR medical education OR nbems OR medical entrance OR counselling'
    );
    const url = `https://gnews.io/api/v4/search?q=${q}&lang=en&country=in&token=${GNEWS_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.log("GNews fetch failed", res.status);
      return [];
    }

    const j = await res.json();
    if (!j.articles) return [];

    return j.articles.map(a =>
      normalize({
        id: a.url,
        title: a.title,
        summary: a.description,
        image: a.image,
        publishedAt: a.publishedAt,
        link: a.url,
        source: a.source?.name || "GNews",
        tags: ["gnews"]
      })
    );
  } catch (e) {
    console.log("GNews error:", e.message);
    return [];
  }
}

// Reddit
async function fetchReddit() {
  const items = [];
  for (const sub of REDDIT_SUBS) {
    const url = `https://www.reddit.com/r/${sub}/top.json?limit=20&t=week`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'news-app' } });
      let data;
      try { data = await res.json(); }
      catch { continue; }
      (data?.data?.children || []).forEach(post => {
        const d = post.data;
        items.push(normalize({
          id: d.id,
          title: d.title,
          summary: d.selftext,
          link: d.permalink ? `https://reddit.com${d.permalink}` : null,
          source: `reddit/${sub}`,
          publishedAt: new Date(d.created_utc * 1000).toISOString(),
          image: d.thumbnail && d.thumbnail.startsWith("http") ? d.thumbnail : null,
          tags: [sub]
        }));
      });
    } catch {}
  }
  return items;
}

// RSS feeds
async function fetchRSS() {
  const all = [];
  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed);
      (parsed.items || []).forEach(i => {
        all.push(normalize({
          id: i.guid || i.link,
          title: i.title,
          summary: i.contentSnippet,
          source: parsed.title,
          link: i.link,
          publishedAt: i.pubDate,
          image: (i.enclosure && i.enclosure.url) || null
        }));
      });
    } catch {}
  }
  return all;
}

// Merge + dedupe
function dedupe(items) {
  const map = new Map();
  for (const it of items) {
    const key = (it.title || "").toLowerCase().slice(0, 120);
    if (!map.has(key)) map.set(key, it);
  }
  return Array.from(map.values()).sort((a,b) =>
    new Date(b.publishedAt) - new Date(a.publishedAt)
  );
}

// Main fetch
async function fetchAll() {
  if (cache.data && (Date.now() - cache.ts) < TTL) return cache.data;

  const [gnews, reddit, rss] = await Promise.all([
    fetchGNews(),
    fetchReddit(),
    fetchRSS()
  ]);

  const merged = dedupe([...gnews, ...reddit, ...rss]);

  cache = { ts: Date.now(), data: merged };
  return merged;
}

module.exports = async (req, res) => {
  try {
    const items = await fetchAll();
    res.status(200).json({
      fetchedAt: new Date(cache.ts).toISOString(),
      count: items.length,
      articles: items
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};