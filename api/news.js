// ================================
// TIME LIMIT (48 HOURS)
// ================================
function within48Hours(dateStr) {
  try {
    const dt = new Date(dateStr);
    const now = Date.now();
    return now - dt.getTime() < 48 * 60 * 60 * 1000;
  } catch {
    return false;
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
// FETCH JSON HELPER
// ================================
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

// ================================
// GNEWS NEET PG ONLY
// ================================
async function fetchGNews() {
  const query =
    'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR fmge OR "pg medical" OR "pg counselling"';

  const key = process.env.GNEWS_API_KEY;

  if (!key) return [];

  const url =
    "https://gnews.io/api/v4/search?q=" +
    encodeURIComponent(query) +
    "&lang=en&country=in&max=50&token=" +
    key;

  const data = await fetchJSON(url);
  if (!data || !data.articles) return [];

  return data.articles.map(a => ({
    title: a.title,
    summary: a.description,
    link: a.url,
    image: a.image,
    publishedAt: a.publishedAt,
    source: a.source?.name || "GNews"
  }));
}

// ================================
// TELEGRAM (RSSHub)
// ================================
async function fetchTelegram() {
  const url = "https://rsshub.app/telegram/channel/zynerdneetpg2025";

  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const block = m[1];
      return {
        title: (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || [])[1],
        summary: (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || [])[1],
        link: (block.match(/<link>(.*?)<\/link>/) || [])[1],
        publishedAt: (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1],
        source: "Telegram"
      };
    });

    return items;
  } catch (e) {
    return [];
  }
}

// ================================
// MAIN API
// ================================
export default async function handler(req, res) {
  try {
    const [gnews, telegram] = await Promise.all([
      fetchGNews(),
      fetchTelegram()
    ]);

    // FILTER 48 HOURS ONLY
    const recentGeneral = (gnews || []).filter(a =>
      within48Hours(a.publishedAt)
    );

    const recentTelegram = (telegram || []).filter(a =>
      within48Hours(a.publishedAt)
    );

    // DEDUPE
    const finalGeneral = dedupe(recentGeneral);
    const finalTelegram = dedupe(recentTelegram);

    res.status(200).json({
      fetchedAt: new Date().toISOString(),
      countGeneral: finalGeneral.length,
      countTelegram: finalTelegram.length,
      generalNews: finalGeneral,
      telegramNews: finalTelegram
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}