// debug-inspector api/news.js
export default async function handler(req, res) {
  const RSS_SOURCES = [
    "https://education.economictimes.indiatimes.com/rss/topstories",
    "https://www.indiatoday.in/education-today/rss",
    "https://speciality.medicaldialogues.in/rss-feed",
    "https://www.freepressjournal.in/rss/section/education",
    "https://rsshub.app/telegram/channel/zynerdneetpg2025"
  ];

  function cleanCDATA(s){ if(!s) return ""; return s.replace(/<!\[CDATA\[(.*?)\]\]>/gi,"$1").trim(); }

  async function fetchRSSFeed(url){
    try{
      const r = await fetch(url);
      if(!r.ok) return { url, status: r.status, items: [], raw: await r.text().catch(()=>"") };
      const xml = await r.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>{
        const block = m[1];
        return {
          title: cleanCDATA((block.match(/<title>([\s\S]*?)<\/title>/)||[])[1]||""),
          description: cleanCDATA((block.match(/<description>([\s\S]*?)<\/description>/)||[])[1]||""),
          link: cleanCDATA((block.match(/<link>([\s\S]*?)<\/link>/)||[])[1]||""),
          pubDate: (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)||[])[1] || (block.match(/<dc:date>([\s\S]*?)<\/dc:date>/)||[])[1] || null,
        };
      });
      return { url, status: 200, items, sampleRaw: xml.slice(0,1500) };
    }catch(e){
      return { url, status: "err", error: String(e), items: [] };
    }
  }

  try {
    const results = await Promise.all(RSS_SOURCES.map(u => fetchRSSFeed(u)));

    // Build a compact inspect payload
    const inspect = results.map(r => ({
      url: r.url,
      status: r.status,
      parsedCount: (r.items||[]).length,
      first3: (r.items||[]).slice(0,3).map(i => ({ title: i.title.slice(0,140), link: i.link, pubDate: i.pubDate }))
    }));

    return res.status(200).json({ fetchedAt: new Date().toISOString(), inspect, raw: results });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}