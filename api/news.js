import fetch from 'node-fetch';
import RSSParser from 'rss-parser';

const parser = new RSSParser();

// Unlimited sources
const REDDIT_SUBS = ['studytips','productivity','medicalschool','neet'];
const RSS_FEEDS = [
  'https://timesofindia.indiatimes.com/rssfeeds/913168846.cms',
  'https://www.indiatoday.in/education-today/rss'
];

// Cache
let cache = { ts: 0, data: null };
const TTL = 1000 * 60 * 30; // 30 min

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

async function fetchReddit() {
  const items = [];
  for (const sub of REDDIT_SUBS) {
    try {
      const url = `https://www.reddit.com/r/${sub}/top.json?limit=20&t=week`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'news-app/1.0' }
      });
      const data = await res.json();
      data.data.children.forEach(post => {
        const d = post.data;
        items.push(normalize({
          id: d.id,
          title: d.title,
          summary: d.selftext,
          link: `https://reddit.com${d.permalink}`,
          source: `reddit/${sub}`,
          publishedAt: new Date(d.created_utc * 1000).toISOString(),
          image: d.thumbnail && d.thumbnail.startsWith('http') ? d.thumbnail : null,
          tags: [sub]
        }));
      });
    } catch (e) {
      console.log("Reddit error:", e.message);
    }
  }
  return items;
}

async function fetchRSS() {
  const all = [];
  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed);
      parsed.items.forEach(i => {
        all.push(normalize({
          id: i.guid || i.link,
          title: i.title,
          summary: i.contentSnippet,
          source: parsed.title,
          publishedAt: i.pubDate,
          image: i.enclosure?.url || null,
          link: i.link
        }));
      });
    } catch (e) {
      console.log("RSS error:", e.message);
    }
  }
  return all;
}

function dedupe(items) {
  const map = new Map();
  for (const i of items) {
    const key = i.title.toLowerCase().slice(0, 100);
    if (!map.has(key)) {
      map.set(key, i);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
}

async function fetchAll() {
  // return cached if fresh
  if (cache.data && (Date.now() - cache.ts) < TTL) {
    return cache.data;
  }

  const [reddit, rss] = await Promise.all([fetchReddit(), fetchRSS()]);
  const merged = dedupe([...reddit, ...rss]);

  cache = { ts: Date.now(), data: merged };
  return merged;
}

// Vercel API route
export default async function handler(req, res) {
  const all = await fetchAll();
  res.status(200).json({
    fetchedAt: new Date(cache.ts).toISOString(),
    count: all.length,
    articles: all
  });
}