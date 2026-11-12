// Web araması (3. katman): yüklü belgelerde olmayan veya güncel bilgi isteyen sorularda
// İÜC'nin herkese açık, arama motorlarında listelenmiş sayfaları Tavily ile aranır.
//
// - Sadece iuc.edu.tr (ve alt alan adları: fakülte siteleri, cdn PDF'leri)
// - Ücretsiz katman ayda 1.000 arama → günlük sınır Supabase'deki sayaçla korunur
// - Sayfaların tam metni istenmez (çoğu boş geliyor; PDF'lerde ise öğrenci listeleri olabilir);
//   sadece Tavily'nin kısa özetleri kullanılır ve kişisel bilgi kalıpları temizlenir.

import { normallestir } from "./onbellekKurallari.ts";
import { veritabani } from "./veritabani.ts";

// Ölçüm (npm run test:esik): belgede cevabı olan soruların en iyi benzerliği ≥ 0,675;
// olmayanların çoğu ≤ 0,612. Bunun altı "belgeler yetmiyor" sayılır.
export const BENZERLIK_ESIGI = 0.65;

const GUNLUK_LIMIT = Number(process.env.WEB_ARAMA_GUNLUK_LIMIT || 30); // ~1000/ay
const MIN_PUAN = 0.35; // denemede alakasız sonuçların puanı 0,03–0,21 idi
const MAKS_SONUC = 5;
const MAKS_OZET = 1_200; // karakter
const SURE_MS = 8_000;

// Güncel bilgi isteyen sorular: konu yönetmelikte geçse bile (ör. "yatay geçiş SONUÇLARI",
// "akademik TAKVİM") istenen şey güncel duyurudur. Normalleştirilmiş metinde aranır.
const GUNCEL_BILGI =
  /\b(sonuc\w*|ilan\w*|duyuru\w*|takvim\w*|ne zaman|hangi tarih\w*|tarihler\w*|basvuru\w*|kontenjan\w*|liste\w*|aciklan\w*|20\d\d|bu yil\w*|bu donem\w*|bu hafta\w*|guncel\w*|yemek\w*|menu\w*|etkinlik\w*|nerede|adres\w*|iletisim|ulasim|nasil gide\w*)\b/;

export type WebSonuc = {
  baslik: string;
  url: string;
  alan: string; // ör. "veterinermyo.iuc.edu.tr"
  ozet: string;
  puan: number;
  tarih: string | null; // Tavily'nin tahmini yayın tarihi (çoğu sayfada yok)
};

/** Bu soru için web'de arama yapılmalı mı? */
export function webAramasiGerekli(soru: string, enIyiBenzerlik: number): { gerekli: boolean; sebep: string } {
  if (GUNCEL_BILGI.test(normallestir(soru))) return { gerekli: true, sebep: "guncel" };
  if (enIyiBenzerlik < BENZERLIK_ESIGI) return { gerekli: true, sebep: "belge_yetersiz" };
  return { gerekli: false, sebep: "belge_yeterli" };
}

/** Öğrenci no / TC kimlik no, e-posta ve cep telefonu kalıplarını siler (KVKK). */
export function kisiselBilgiyiTemizle(metin: string): string {
  return metin
    .replace(/\S+@\S+\.\S+/g, "[e-posta]")
    .replace(/(\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g, "[telefon]")
    .replace(/\d{7,}/g, "[numara]");
}

/** "Wed, 27 Sep 2023 10:00:00 GMT" → "27.09.2023"; okunamazsa null. */
export function turkceTarih(metin: string | null | undefined): string | null {
  if (!metin) return null;
  const t = new Date(metin);
  return Number.isNaN(t.getTime())
    ? null
    : t.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" });
}

export type WebAramaSonucu =
  | { durum: "ok"; sonuclar: WebSonuc[] }
  | { durum: "kapali" | "kota" | "hata" };

/**
 * İÜC sitelerinde arar. Hiçbir durumda hata fırlatmaz: kapalıysa, günlük sınır dolduysa veya
 * Tavily hata verirse sebebini döner; sohbet sadece belgelerle devam eder.
 */
export async function webAra(sorgu: string): Promise<WebAramaSonucu> {
  const anahtar = process.env.TAVILY_API_KEY;
  const db = veritabani();
  if (!anahtar || !db) return { durum: "kapali" };

  // Günlük sınır (sayaç yoksa veya hata olursa aramıyoruz: kota kontrolsüz harcanmasın).
  const { data: hak, error } = await db
    .rpc("web_arama_hakki", { gunluk_limit: GUNLUK_LIMIT })
    .abortSignal(AbortSignal.timeout(SURE_MS));
  if (error) {
    console.warn("Web arama sayacı okunamadı (arama yapılmadı):", error.message);
    return { durum: "hata" };
  }
  if (hak !== true) return { durum: "kota" };

  try {
    const yanit = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anahtar}` },
      body: JSON.stringify({
        query: sorgu.slice(0, 380),
        include_domains: ["iuc.edu.tr"],
        search_depth: "basic", // 1 kredi
        max_results: 8,
        chunks_per_source: 3,
        include_published_date: true,
      }),
      signal: AbortSignal.timeout(SURE_MS),
    });
    if (!yanit.ok) {
      console.warn(`Tavily hatası: HTTP ${yanit.status}`, (await yanit.text()).slice(0, 200));
      return { durum: yanit.status === 429 || yanit.status === 432 ? "kota" : "hata" };
    }
    const veri = (await yanit.json()) as {
      results?: { title?: string; url?: string; content?: string; score?: number; published_date?: string | null }[];
    };
    const sonuclar = (veri.results ?? [])
      .filter((s) => s.url && (s.score ?? 0) >= MIN_PUAN && /(^|\.)iuc\.edu\.tr$/.test(new URL(s.url).hostname))
      .slice(0, MAKS_SONUC)
      .map((s) => ({
        baslik: kisiselBilgiyiTemizle((s.title ?? "").replace(/\s+/g, " ").trim()).slice(0, 200) || "İÜC sayfası",
        url: s.url!,
        alan: new URL(s.url!).hostname.replace(/^www\./, ""),
        ozet: kisiselBilgiyiTemizle((s.content ?? "").replace(/\s+/g, " ").trim()).slice(0, MAKS_OZET),
        puan: s.score ?? 0,
        tarih: turkceTarih(s.published_date),
      }));
    return { durum: "ok", sonuclar };
  } catch (e) {
    console.warn("Web araması başarısız:", e instanceof Error ? e.message : e);
    return { durum: "hata" };
  }
}
