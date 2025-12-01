// --- Simple NEET PG Filter Function ---
function filterNEETPG(articles) {
  const keywords = [
    "neet pg",
    "neet-pg",
    "nbems",
    "nbe",
    "fmge",
    "mcc",
    "counselling",
    "pg medical",
    "neet ss",
    "pg entrance",
    "dnb",
    "md ms",
    "postgraduate medical",
    "medical entrance",
    "neet pg 2025",
    "neet pg 2026"
  ];

  return (articles || []).filter(a => {
    const t = ((a.title || "") + " " + (a.summary || "")).toLowerCase();
    return keywords.some(k => t.includes(k));
  });
}

// --- Simple HTTP Fetch Helper ---
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

// --- Fetch GNews ---
async function fetchGNews() {
  try {
    const query =
      'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR nbe OR fmge OR mcc counselling OR pg medical';

    const url =
      "https://gnews.io/api/v4/search?q=" +
      encodeURIComponent(query) +
      "&lang=en&country=in&max=50&token=" + process.env.GNEWS_API_KEY;

    const data = await fetchJSON(url);
    return data.articles || [];
  } catch (e) {
    return [];
  }
}

// --- Fetch Reddit (NEET PG Related Subreddits) ---
async function fetchReddit() {
  try {
    const url = "https://www.reddit.com/r/medicalschoolindia.json?limit=30";
    const data = await fetchJSON(url);

    if (!data.data) return [];

    return data.data.children.map(p => ({
      title: p.data.title,
      summary: p.data.selftext,
      source: "Reddit",
      link: "https://reddit.com" + p.data.permalink,
      image: p.data.thumbnail?.startsWith("http") ? p.data.thumbnail : null
    }));
  } catch {
    return [];
  }
}

// --- Fetch RSS (Times of India - Education) ---
async function fetchRSS() {
  try {
    const url =
      "https://timesofindia.indiatimes.com/rssfeeds/913168846.cms"; // Education feed

    const res = await fetch(url);
    const text = await res.text();

    // Simple XML → JSON parse
    const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const block = m[1];
      return {
        title: (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || [])[1],
        summary:
          (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
            [])[1],
        link: (block.match(/<link>(.*?)<\/link>/) || [])[1],
        publishedAt: (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1],
        source: "TOI"
      };
    });

    return items;
  } catch {
    return [];
  }
}

// --- Remove Duplicates ---
function dedupe(list) {
  const map = new Map();
  for (let item of list) {
    if (!item || !item.link) continue;
    if (!map.has(item.link)) map.set(item.link, item);
  }
  return [...map.values()];
}

// --- MAIN FUNCTION (runs when /api/news is called) ---
export default async function handler(req, res) {
  try {
    const [gnews, reddit, rss] = await Promise.all([
      fetchGNews(),
      fetchReddit(),
      fetchRSS()
    ]);

    // merge
    let merged = dedupe([
      ...(gnews || []),
      ...(reddit || []),
      ...(rss || [])
    ]);

    // filter NEET PG
    merged = filterNEETPG(merged);

    res.status(200).json({
      fetchedAt: new Date().toISOString(),
      count: merged.length,
      articles: merged
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}