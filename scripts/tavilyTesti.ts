// Deneme: Tavily, İÜC'nin sayfalarını ne kadar iyi buluyor? (Her soru 1 kredi harcar.)
// Kullanım: npm run test:tavily            → hazır 10 soru
//           npm run test:tavily -- "soru"   → tek soru
export {}; // dosyayı modül yapar (en üst seviyede await için)

const ANAHTAR = process.env.TAVILY_API_KEY;
if (!ANAHTAR) {
  console.error("TAVILY_API_KEY tanımlı değil (.env.local).");
  process.exit(1);
}

const SORULAR = process.argv[2]
  ? [process.argv[2]]
  : [
      "yatay geçiş sonuçları",
      "2025-2026 akademik takvim",
      "Erasmus başvuru",
      "burs başvurusu",
      "yemek listesi",
      "yaz okulu 2026",
      "Avcılar kampüsü ulaşım",
      "ders kayıt tarihleri",
      "çift anadal yandal başvuru ilanı",
      "mezuniyet töreni",
    ];

for (const soru of SORULAR) {
  const t0 = Date.now();
  const yanit = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANAHTAR}` },
    body: JSON.stringify({
      query: soru,
      include_domains: ["iuc.edu.tr"],
      search_depth: "basic",
      max_results: 5,
      include_raw_content: "text",
      include_published_date: true,
      include_usage: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const veri = (await yanit.json()) as {
    results?: { title: string; url: string; content: string; raw_content?: string; published_date?: string; score: number }[];
    usage?: unknown;
    detail?: unknown;
  };
  console.log(`\n══ "${soru}" → HTTP ${yanit.status}, ${Date.now() - t0} ms, ${veri.results?.length ?? 0} sonuç`);
  if (!yanit.ok) {
    console.log("   ", JSON.stringify(veri).slice(0, 300));
    continue;
  }
  for (const s of veri.results ?? []) {
    const ham = (s.raw_content ?? "").replace(/\s+/g, " ");
    console.log(`  ${s.score.toFixed(2)} ${s.published_date?.slice(0, 10) ?? "tarih yok "} ${s.url.slice(0, 95)}`);
    console.log(`       başlık: ${s.title.slice(0, 80)}`);
    console.log(`       özet  : ${s.content.replace(/\s+/g, " ").slice(0, 160)}`);
    console.log(`       içerik: ${ham.length} karakter${ham ? " | " + ham.slice(0, 120) : ""}`);
  }
}
