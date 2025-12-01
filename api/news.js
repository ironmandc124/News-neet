// api/news.js → Return cached news

import { promises as fs } from "fs";
import path from "path";

export default async function handler(req, res) {
  try {
    const file = path.join(process.cwd(), "news-cache.json");
    const text = await fs.readFile(file, "utf8");
    const data = JSON.parse(text);
    return res.status(200).json(data);
  } catch {
    return res.status(200).json({
      count: 0,
      articles: [],
      fetchedAt: null,
      error: "Cache not ready yet"
    });
  }
}