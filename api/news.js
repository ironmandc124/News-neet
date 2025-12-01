// DEBUG news endpoint - shows request URLs, status, small body preview, parsed counts
export default async function handler(req, res) {
  const debug = { time: new Date().toISOString() };

  // --- GNews request ---
  const gnewsKey = process.env.GNEWS_API_KEY || "";
  debug.gnews_key_present = !!gnewsKey;
  const gnewsQuery = 'neet pg OR "neet pg 2025" OR nbems OR fmge OR "pg counselling"';
  const gnewsUrl = "https://gnews.io/api/v4/search?q=" + encodeURIComponent(gnewsQuery) + "&lang=en&country=in&max=50&token=" + encodeURIComponent(gnewsKey);
  debug.gnews_request = gnewsUrl;

  try {
    const gRes = await fetch(gnewsUrl);
    debug.gnews_status = gRes.status + " " + (gRes.statusText || "");
    const gText = await gRes.text().catch(()=>"(no body)");
    debug.gnews_preview = gText.slice(0, 1500);
    try { debug.gnews_json = JSON.parse(gText); } catch(e){ debug.gnews_json = null; debug.gnews_json_parse_error = String(e); }
  } catch (e) {
    debug.gnews_error = String(e);
  }

  // --- Telegram RSS request ---
  const tgUrl = "https://rsshub.app/telegram/channel/zynerdneetpg2025";
  debug.telegram_request = tgUrl;
  try {
    const tRes = await fetch(tgUrl);
    debug.telegram_status = tRes.status + " " + (tRes.statusText || "");
    const tText = await tRes.text().catch(()=>"(no body)");
    debug.telegram_preview = tText.slice(0, 1500);
    // quick parse count of <item>
    const items = [...tText.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    debug.telegram_item_count = items.length;
    // sample first item raw
    debug.telegram_first_item_raw = items[0] ? items[0][1].slice(0,1000) : null;
  } catch (e) {
    debug.telegram_error = String(e);
  }

  // --- Post-processing simulation (what your real code would do) ---
  // parse gnews json articles count if available
  try {
    if (debug.gnews_json && Array.isArray(debug.gnews_json.articles)) {
      debug.gnews_articles_count = debug.gnews_json.articles.length;
      // sample first article keys
      debug.gnews_sample = debug.gnews_json.articles.slice(0,5).map(a => ({ title: a.title, url: a.url, publishedAt: a.publishedAt }));
    } else {
      debug.gnews_articles_count = 0;
    }
  } catch (e) {
    debug.gnews_parse_error = String(e);
  }

  // --- quick timezone / date check for expiry logic ---
  debug.now = new Date().toISOString();
  // find latest publishedAt in gnews sample if any
  try {
    const arr = debug.gnews_json && Array.isArray(debug.gnews_json.articles) ? debug.gnews_json.articles : [];
    if (arr.length) {
      const latest = arr.map(a => a.publishedAt).filter(Boolean).sort().reverse()[0];
      debug.gnews_latest_publishedAt = latest || null;
    } else debug.gnews_latest_publishedAt = null;
  } catch(e){ debug.gnews_latest_publishedAt_error = String(e); }

  // --- return full debug object ---
  return res.status(200).json({ debug });
}