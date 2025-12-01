// ================================
// CLEAN CDATA
// ================================
function cleanCDATA(s) {
  if (!s) return s;
  return s.replace(/<!\[CDATA\[(.*?)\]\]>/gi, "$1").trim();
}

// ================================
// FILTER: ONLY NEET PG / PG MEDICAL
// ================================
function filterNEETPG(articles) {
  const include = [
    "neet pg",
    "neet-pg",
    "nbems",
    "nbe",
    "fmge",
    "pg medical",
    "pg counselling",
    "mcc",
    "neet ss",
    "dnb",
    "md ms",
    "pg entrance",
    "postgraduate",
    "post graduate"
  ];

  const exclude = [
    "neet ug",
    "neet-ug",
    "undergraduate",
    "ssc",
    "school",
    "police",
    "constable",
    "upsc",
    "engineering",
    "jkpsc"
  ];

  return (articles || []).filter((a) => {
    const text =
      ((a.title || "") + " " + (a.summary || "") + " " + (a.source || "")).toLowerCase();

    // BLOCK UG + unrelated education
    if (exclude.some((bad) => text.includes(bad))) return false;

    // MUST contain at least 1 PG term
    return include.some((good) => text.includes(good));
  });
}

// ================================
// SIMPLE FETCH JSON
// ================================
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

// ================================
// GNEWS (NEET PG keywords)
// ================================
async function fetchGNews() {
  try {
    const query =
      'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR fmge OR "pg medical" OR "pg counselling"';

    const url =
      "https://gnews.io/api/v4/search?q=" +
      encodeURIComponent(query) +
      "&lang=en&country=in&max=50&token=" +
      process.env.GNEWS_API_KEY;

    const data = await fetchJSON(url);
    return data.articles || [];
  } catch {
    return [];
  }
}

// ================================
// REDDIT (medicalschoolindia)
// ================================
async function fetchReddit() {
  try {
    const url = "https://www.reddit.com/r/medicalschoolindia.json?limit=30";
    const data = await fetchJSON(url);
    if (!data.data) return [];

    return data.data.children.map((p) => ({
      title: p.data.title,
      summary: p.data.selftext,
      source: "Reddit",
      link: "https://reddit.com" + p.data.permalink,
      image: p.data.thumbnail?.startsWith("http") ? p.data.thumbnail : null,
    }));
  } catch {
    return [];
  }
}

// ================================
// RSS: Times of India (Education)
// ================================
async function fetchRSS() {
  try {
    const url = "https://timesofindia.indiatimes.com/rssfeeds/913168846.cms";

    const res = await fetch(url);
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const block = m[1];
      return {
        title: cleanCDATA((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
        summary: cleanCDATA(
          (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1]
        ),
        link: cleanCDATA((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1]),
        publishedAt: (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1],
        source: "TOI",
      };
    });

    return items;
  } catch {
    return [];
  }
}

// ================================
// REMOVE DUPLICATES
// ================================
function dedupe(list) {
  const map = new Map();
  for (const item of list) {
    if (!item || !item.link) continue;
    map.set(item.link, item);
  }
  return [...map.values()];
}

// ================================
// MAIN HANDLER (Vercel)
// ================================
export default async function handler(req, res) {
  try {
    // fetch all sources in parallel
    const [gnews, reddit, rss] = await Promise.all([
      fetchGNews(),
      fetchReddit(),
      fetchRSS(),
    ]);

    // merge + dedupe
    let merged = dedupe([
      ...(gnews || []),
      ...(reddit || []),
      ...(rss || []),
    ]);

    // clean CDATA in links
    merged = merged.map((a) => ({ ...a, link: cleanCDATA(a.link) }));

    // FILTER NEET PG **ONLY**
    merged = filterNEETPG(merged);

    res.status(200).json({
      fetchedAt: new Date().toISOString(),
      count: merged.length,
      articles: merged,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}