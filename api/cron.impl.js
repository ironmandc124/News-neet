/*
 api/cron.impl.js
 Full implementation moved from cron.js. This file contains the heavy imports and logic.
*/
import { promises as fs } from "fs";
import path from "path";
import Parser from "rss-parser";

const GNEWS_KEY = process.env.GNEWS_API_KEY || "";
const CACHE_FILE = path.join(process.cwd(), "news-cache.json");

// Strict NEET-PG keywords
const STRICT_KEYWORDS = [
  "neet pg", "neet-pg", "nbems", "nbe", "fmge",
  "pg counselling", "pg medical", "md ms", "dnb",
  "postgraduate medical", "neet ss",
  "Gujarat NEET PG", "Tamil Nadu NEET PG",
  "Karnataka NEET PG", "Delhi NEET PG", "Maharashtra NEET PG",
  "Rajasthan NEET PG", "Haryana NEET PG", "Punjab NEET PG"
];

// Broad fallback keywords
const BROAD_KEYWORDS = [
  "neet", "medical counselling", "postgraduate",
  "medical admissions", "pg admissions"
];

// RSS sources for fallback
const RSS_SOURCES = [
  "https://www.news-medical.net/news/Medical-News-feed.aspx",
  "https://feeds.bloomberg.com/markets/news.rss",
  "https://feeds.reuters.com/reuters/healthNews"
];

/**
 * Build GNews query from keywords
 */
function buildQuery(keywords) {
  return keywords.map(k => `"${k}"`).join(" OR ");
}

/**
 * Check if article matches NEET-PG related content
 */
function isNeetPgRelated(article) {
  const text = (
    (article.title || "") + " " +
    (article.description || "") + " " +
    (article.content || "")
  ).toLowerCase();
  
  // Check strict keywords first
  for (const kw of STRICT_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      return true;
    }
  }
  
  // Fallback to broad keywords
  for (const kw of BROAD_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

/**
 * Normalize title for deduplication
 */
function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deduplicate articles by URL and normalized title
 */
function deduplicateArticles(articles) {
  const seen = new Map();
  const result = [];

  for (const article of articles) {
    if (!article || !article.url) continue;

    // Normalize URL: remove query params and hash
    const urlKey = article.url
      .split("#")[0]
      .split("?")[0]
      .toLowerCase();

    // Normalize title
    const titleKey = normalizeTitle(article.title);

    // Create composite key
    const compositeKey = `${urlKey}|${titleKey}`;

    if (!seen.has(compositeKey)) {
      seen.set(compositeKey, true);
      result.push(article);
    }
  }

  return result;
}

/**
 * Fetch news from GNews API
 */
async function fetchGnews(query) {
  if (!GNEWS_KEY) {
    return { ok: false, error: "missing_key" };
  }

  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(
    query
  )}&lang=en&country=in&max=100&token=${encodeURIComponent(GNEWS_KEY)}`;

  try {
    const response = await fetch(url);
    const contentType = response.headers.get("content-type");

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        error: `GNews error: ${response.status} ${response.statusText}`
      };
    }

    const data = await response.json();
    const articles = (data.articles || []).map(a => ({
      title: a.title || "",
      description: a.description || a.content || "",
      url: a.url || "",
      image: a.image || null,
      publishedAt: a.publishedAt || null,
      source: a.source?.name || "GNews"
    }));

    return { ok: true, articles };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Fetch news from RSS sources
 */
async function fetchRssSources() {
  const parser = new Parser({
    customFields: {
      item: [["content:encoded", "content"]]
    }
  });

  const allArticles = [];

  for (const source of RSS_SOURCES) {
    try {
      const feed = await parser.parseURL(source);
      const articles = (feed.items || [])
        .slice(0, 30)
        .map(item => ({
          title: item.title || "",
          description: item.contentSnippet || item.content || "",
          url: item.link || "",
          image: item.enclosure?.url || null,
          publishedAt: item.pubDate || null,
          source: feed.title || "RSS Feed"
        }));
      
      allArticles.push(...articles);
    } catch (error) {
      // Silently skip failed RSS sources
      console.error(`RSS fetch error for ${source}:`, error.message);
    }
  }

  return allArticles;
}

/**
 * Load the last cached results
 */
async function loadLastCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Save cache to file
 */
async function saveCache(data) {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("Cache write error:", error);
    return false;
  }
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  const startTime = Date.now();
  const debug = {
    strict: null,
    broad: null,
    rss: null,
    final: null
  };

  try {
    // Step 1: Try strict GNews query
    const strictQuery = buildQuery(STRICT_KEYWORDS);
    const strictResult = await fetchGnews(strictQuery);
    debug.strict = {
      ok: strictResult.ok,
      status: strictResult.status || null,
      count: strictResult.articles?.length || 0,
      error: strictResult.error || null
    };

    let articles = [];
    let usedSource = "strict_gnews";

    if (strictResult.ok && strictResult.articles.length > 0) {
      articles = strictResult.articles.filter(isNeetPgRelated);
    }

    // Step 2: If strict returned empty, try broad GNews query
    if (articles.length === 0) {
      const broadQuery = buildQuery(BROAD_KEYWORDS);
      const broadResult = await fetchGnews(broadQuery);
      debug.broad = {
        ok: broadResult.ok,
        status: broadResult.status || null,
        count: broadResult.articles?.length || 0,
        error: broadResult.error || null
      };

      if (broadResult.ok && broadResult.articles.length > 0) {
        articles = broadResult.articles.filter(isNeetPgRelated);
        usedSource = "broad_gnews";
      }
    }

    // Step 3: If GNews failed or returned no results, try RSS fallback
    if (articles.length === 0) {
      const rssArticles = await fetchRssSources();
      debug.rss = {
        ok: rssArticles.length > 0,
        count: rssArticles.length
      };

      if (rssArticles.length > 0) {
        articles = rssArticles.filter(isNeetPgRelated);
        usedSource = "rss_fallback";
      }
    }

    // Step 4: If all sources failed, load last cache
    if (articles.length === 0) {
      const lastCache = await loadLastCache();
      if (lastCache && lastCache.articles && lastCache.articles.length > 0) {
        articles = lastCache.articles;
        usedSource = "last_cache";
        debug.final = "Returning last cached results";
      }
    }

    // Step 5: Deduplicate and build final payload
    const deduped = deduplicateArticles(articles);
    const payload = {
      fetchedAt: new Date().toISOString(),
      count: deduped.length,
      articles: deduped.slice(0, 100), // Limit to 100 articles
      usedSource,
      debug
    };

    // Save cache
    await saveCache(payload);

    const duration = Date.now() - startTime;
    return res.status(200).json({
      ok: true,
      saved: deduped.length,
      usedSource,
      durationMs: duration,
      debug
    });
  } catch (error) {
    console.error("Cron handler error:", error);
    
    // Even on error, try to return last cache
    const lastCache = await loadLastCache();
    if (lastCache && lastCache.articles.length > 0) {
      return res.status(200).json({
        ok: true,
        saved: lastCache.articles.length,
        usedSource: "last_cache_on_error",
        error: String(error)
      });
    }

    return res.status(500).json({
      ok: false,
      error: String(error),
      debug
    });
  }
}
