// Kişi başı hız sınırı: bir kullanıcının (veya botun) kısa sürede çok soru sorup
// herkesin ortak Gemini kotasını tüketmesini önler.
//
// Sunucu belleğinde tutulur (Vercel'de birden fazla sunucu kopyası olursa yaklaşık çalışır).
// 2. Aşama'da Supabase'e taşınabilir.

const kayitlar = new Map<string, number[]>();
let sonTemizlik = Date.now();

/**
 * `anahtar` için son `pencereMs` içinde `limit`ten fazla istek varsa,
 * kaç ms sonra tekrar deneyebileceğini döner. Sınır aşılmadıysa 0 döner ve isteği kaydeder.
 */
export function hizKontrol(anahtar: string, limit: number, pencereMs = 60_000): number {
  const simdi = Date.now();
  eskileriTemizle(simdi, pencereMs);

  const zamanlar = (kayitlar.get(anahtar) ?? []).filter((t) => t > simdi - pencereMs);
  if (zamanlar.length >= limit) {
    kayitlar.set(anahtar, zamanlar);
    return zamanlar[0] + pencereMs - simdi;
  }
  zamanlar.push(simdi);
  kayitlar.set(anahtar, zamanlar);
  return 0;
}

// Bellek şişmesin diye ara sıra süresi geçmiş kayıtları sil.
function eskileriTemizle(simdi: number, pencereMs: number) {
  if (simdi - sonTemizlik < pencereMs) return;
  sonTemizlik = simdi;
  for (const [anahtar, zamanlar] of kayitlar) {
    if (zamanlar.length === 0 || zamanlar[zamanlar.length - 1] <= simdi - pencereMs) {
      kayitlar.delete(anahtar);
    }
  }
}
