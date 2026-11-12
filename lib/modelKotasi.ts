// Gemini modellerinin dakikalık kotasını takip eder.
//
// Google ücretsiz katmanda her model için dakikada sınırlı sayıda istek kabul ediyor
// (ör. gemini-3.5-flash-lite: 15/dk). Kotayı aşan istek reddedilir (HTTP 429).
// Burada son 60 saniyede her modele kaç istek gönderdiğimizi sayıyoruz; kota doluysa
// o modele hiç istek atmadan sıradakine geçiyor ya da kısa süre bekliyoruz.
// Ayrıca hata veren ("yoğunum", "kota doldu", cevap vermedi) bir modeli bir süre dinlendiriyoruz.
//
// Not: Bu sayaç sunucunun belleğinde tutulur. Vercel aynı anda birden fazla sunucu kopyası
// çalıştırırsa sayaçlar birbirini görmez; o durumda Google'ın 429 cevabı yine yakalanır ve
// model dinlendirilir. Yani sayaç kesin değil ama boşa istek atmayı büyük ölçüde önler.

const DAKIKA_MS = 60_000;

type ModelDurumu = {
  gonderimler: number[]; // son 60 sn'deki isteklerin zamanları (eskiden yeniye)
  dinlenmeBitis: number; // bu zamana kadar modele istek atılmaz
};

const durumlar = new Map<string, ModelDurumu>();

function durumAl(model: string): ModelDurumu {
  let d = durumlar.get(model);
  if (!d) {
    d = { gonderimler: [], dinlenmeBitis: 0 };
    durumlar.set(model, d);
  }
  // 60 saniyeden eski kayıtları at.
  const sinir = Date.now() - DAKIKA_MS;
  while (d.gonderimler.length > 0 && d.gonderimler[0] <= sinir) d.gonderimler.shift();
  return d;
}

/** Model kaç ms sonra kullanılabilir? 0 = hemen. */
export function musaitOlana(model: string, dakikalikLimit: number): number {
  const d = durumAl(model);
  const simdi = Date.now();
  let bekle = Math.max(0, d.dinlenmeBitis - simdi);
  if (d.gonderimler.length >= dakikalikLimit) {
    // En eski istek 60 sn'yi doldurunca bir yer açılır.
    bekle = Math.max(bekle, d.gonderimler[0] + DAKIKA_MS - simdi);
  }
  return bekle;
}

/** Model müsaitse bir istek hakkı ayırır ve true döner. */
export function yerAyir(model: string, dakikalikLimit: number): boolean {
  if (musaitOlana(model, dakikalikLimit) > 0) return false;
  durumAl(model).gonderimler.push(Date.now());
  return true;
}

/** Hata veren modeli belirtilen süre boyunca dinlendirir. */
export function dinlendir(model: string, ms: number) {
  const d = durumAl(model);
  d.dinlenmeBitis = Math.max(d.dinlenmeBitis, Date.now() + ms);
}
