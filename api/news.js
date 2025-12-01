// ============================
// FILTER: ONLY NEET PG
// ============================
function filterNEETPG(articles) {
  const include = [
    "neet pg",
    "neet-pg",
    "nbems",
    "nbe",
    "fmge",
    "pg medical",
    "pg counselling",
    "pg entrance",
    "md ms",
    "postgraduate",
    "post graduate",
    "neet ss",
    "dnb"
  ];

  const exclude = [
    "neet ug",
    "neet-ug",
    "school",
    "police",
    "ssc",
    "upsc",
    "constable",
    "engineering"
  ];

  return (articles || []).filter(a => {
    const t = ((a.title || "") + " " + (a.description || "")).toLowerCase();

    if (exclude.some(bad => t.includes(bad))) return false;
    return include.some(good => t.includes(good));
  });
}

// ============================
// FETCH GNEWS ONLY
// ============================
async function fetchGNews() {
  try {
    const query =
      'neet pg OR "neet pg 2025" OR "neet pg 2026" OR nbems OR fmge OR "pg medical" OR "pg counselling"';

    const url =
      "https://gnews.io/api/v4/search?q=" +
      encodeURIComponent(query) +
      "&lang=en&country=in&max=50&token=" +
      process.env.GNEWS_API_KEY;

    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    return data.articles || [];
  } catch (e) {
    return [];
  }
}

// ============================
// MAIN HANDLER
// ============================
export default async function handler(req, res) {
  try {
    // fetch from GNews only
    const gnews = await fetchGNews();

    // filter NEET PG only
    const filtered = filterNEETPG(gnews);

    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      count: filtered.length,
      articles: filtered
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}