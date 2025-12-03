/*
 api/news.js
 Serve cached news from news-cache.json (populated by /api/cron).
 Always returns a valid JSON response.
*/
import { promises as fs } from "fs";
import path from "path";

const CACHE_FILE = path.join(process.cwd(), "news-cache.json");

export default async function handler(req, res) {
  // Set cache headers for optimal performance
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300"
  );
  res.setHeader("Content-Type", "application/json");

  try {
    const data = await fs.readFile(CACHE_FILE, "utf8");
    const json = JSON.parse(data);
    
    return res.status(200).json({
      count: json.count || 0,
      articles: json.articles || [],
      fetchedAt: json.fetchedAt || null,
      usedSource: json.usedSource || null,
      debug: json.debug || null
    });
  } catch (error) {
    // Cache file doesn't exist yet or is invalid
    // Return safe default response
    return res.status(200).json({
      count: 0,
      articles: [],
      fetchedAt: null,
      usedSource: null,
      debug: {
        error: "Cache not initialized",
        message: "Run /api/cron first to generate cache"
      }
    });
  }
}