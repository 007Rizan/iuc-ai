// Cevap önbelleğinin kuralları: hangi soru saklanır, aynı soru nasıl tanınır,
// cevap ne kadar süre geçerli kalır?
//
// Bu dosya veritabanına dokunmaz; sadece karar verir. Böylece kolayca test edilebilir
// (bkz. onbellekKurallari.test.ts).

import { createHash } from "node:crypto";

/** Bir sorunun cevabının ne kadar süre geçerli olduğu. */
export type ZamanTuru = "anlik" | "gunluk" | "haftalik" | "aylik" | "kalici";

export type OnbellekBilgisi = {
  anahtar: string; // veritabanındaki kayıt anahtarı
  soru: string; // normalleştirilmiş soru
  tur: Exclude<ZamanTuru, "anlik">;
  sonKullanma: Date; // bu andan sonra cevap kullanılmaz
};

const KALICI_SURE_MS = 7 * 24 * 60 * 60 * 1000; // "kalıcı" cevaplar en fazla 7 gün
const MAKS_SORU_UZUNLUGU = 300; // daha uzun sorular genelde kişiye özeldir, saklanmaz
const MAKS_CEVAP_UZUNLUGU = 8_000;

// Türkiye 2016'dan beri yaz/kış saati uygulamıyor: her zaman UTC+3.
const ISTANBUL_FARK_MS = 3 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 1) Soruyu normalleştirme: "Bütünleme NE ZAMAN??" = "butunleme ne zaman"
// ---------------------------------------------------------------------------

const TURKCE_HARFLER: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** Küçük harf (Türkçe kurallarıyla), Türkçe harfleri sadeleştir, noktalamayı ve fazla boşlukları at. */
export function normallestir(metin: string): string {
  return metin
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîû]/g, (h) => TURKCE_HARFLER[h])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // kalan şapka/nokta işaretleri
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Sorunun başındaki/içindeki anlamı değiştirmeyen kelimeler (eşleşmeyi kolaylaştırır).
const SELAMLAMA_BASI = /^((merhaba|merhabalar|selam|selamlar|slm|mrb|hey|hocam|gunaydin|iyi gunler|iyi aksamlar)\s+)+/;
const DOLGU_KELIMELER = /\b(acaba|lutfen|rica etsem|bir sey soracagim|bir sey sorabilir miyim)\b/g;

// Sohbet / kendini tanıtma: ucuz ve kişiye göre değişebilir, saklanmaz.
const SOHBET =
  /^(sen )?(kimsin|nesin|ne yapabilirsin|neler yapabilirsin|nasilsin|naber|ne haber|tesekkur\w*|sagol\w*|eyvallah|tamam\w*|ok|iyi geceler|gorusuruz|hosca kal)$/;

// ---------------------------------------------------------------------------
// 2) Zaman türü: "bugün yemek ne?" → günlük, "şu an açık mı?" → anlık
// ---------------------------------------------------------------------------

// \b ile çevrili tam kelimeler veya "kok\w*" biçiminde kelime kökleri (normalleştirilmiş metinde).
const ANLIK = /\b(simdi\w*|su an\w*|suan\w*|saat kac|acik mi|kapali mi|hala|bu saatte|canli|son dakika|hava durumu|hava nasil)\b/;
const GUNLUK =
  /\b(bugun\w*|yarin\w*|dun|dunku|dunun|bu aksam|bu sabah|bu gece|bu ogle\w*|yemek\w*|yemeg\w*|menu\w*|duyuru\w*|en son|guncel\w*)\b/;
const HAFTALIK = /\b(bu hafta\w*|haftaya|hafta ?sonu\w*|gelecek hafta\w*|onumuzdeki hafta\w*|gecen hafta\w*)\b/;
const AYLIK =
  /\b(bu ay|bu ayki|bu ayin|gelecek ay\w*|onumuzdeki ay\w*|gecen ay\w*|bu donem\w*|bu yariyil\w*|bu yil\w*|bu sene\w*|bu akademik yil\w*|bu egitim ogretim yil\w*)\b/;

/** Sorudaki kelimelere göre cevabın ne kadar süre geçerli olacağına karar verir. */
export function zamanTuru(normalSoru: string): ZamanTuru {
  if (ANLIK.test(normalSoru)) return "anlik";
  if (GUNLUK.test(normalSoru)) return "gunluk";
  if (HAFTALIK.test(normalSoru)) return "haftalik";
  if (AYLIK.test(normalSoru)) return "aylik";
  return "kalici";
}

// ---------------------------------------------------------------------------
// 3) Kişisel bilgi filtresi (KVKK): bunları içeren sorular veritabanına yazılmaz
// ---------------------------------------------------------------------------

const UZUN_SAYI = /\d{7,}/; // öğrenci no, TC kimlik no vb.
const TELEFON = /(\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;
const EPOSTA = /\S+@\S+\.\S+/;
const KISISEL_KELIME =
  /\b(benim adim|adim|ismim|soyadim|ogrenci no\w*|ogrenci numara\w*|numaram|tc|tckn|kimlik no\w*|sifre\w*|parola\w*|telefonum|adresim)\b/;

/** Soru kişisel bilgi içeriyor olabilir mi? (Emin değilse "evet" der.) */
export function kisiselBilgiVarMi(hamSoru: string): boolean {
  return (
    UZUN_SAYI.test(hamSoru) || TELEFON.test(hamSoru) || EPOSTA.test(hamSoru) || KISISEL_KELIME.test(normallestir(hamSoru))
  );
}

// ---------------------------------------------------------------------------
// 4) Geçerlilik süresi: Türkiye saatine göre gün / hafta / ay sonu
// ---------------------------------------------------------------------------

/** Türkiye saatine göre takvim bilgisi. */
function istanbulTarihi(an: Date) {
  const t = new Date(an.getTime() + ISTANBUL_FARK_MS); // UTC alanları artık İstanbul saatini gösterir
  return { yil: t.getUTCFullYear(), ay: t.getUTCMonth(), gun: t.getUTCDate(), haftaGunu: (t.getUTCDay() + 6) % 7 }; // 0 = pazartesi
}

/** İstanbul saatiyle verilen günün 00:00'ı (gerçek zaman olarak). */
function istanbulGeceYarisi(yil: number, ay: number, gun: number): Date {
  return new Date(Date.UTC(yil, ay, gun) - ISTANBUL_FARK_MS);
}

function tarihMetni(yil: number, ay: number, gun: number): string {
  return new Date(Date.UTC(yil, ay, gun)).toISOString().slice(0, 10);
}

/**
 * Kayıt "kovası" ve son kullanma anı.
 * Kova anahtara eklenir: çarşamba kaydedilen "bugün yemek ne?" cevabı, perşembe sorulan
 * aynı soruyla zaten eşleşmez. Son kullanma anı da veritabanındaki kaydın silinmesini sağlar.
 */
export function gecerlilik(tur: Exclude<ZamanTuru, "anlik">, simdi: Date): { kova: string; sonKullanma: Date } {
  const { yil, ay, gun, haftaGunu } = istanbulTarihi(simdi);
  const yediGunSonra = new Date(simdi.getTime() + KALICI_SURE_MS);

  switch (tur) {
    case "gunluk":
      return { kova: tarihMetni(yil, ay, gun), sonKullanma: istanbulGeceYarisi(yil, ay, gun + 1) };
    case "haftalik": {
      const pazartesi = gun - haftaGunu;
      return { kova: `hafta-${tarihMetni(yil, ay, pazartesi)}`, sonKullanma: istanbulGeceYarisi(yil, ay, pazartesi + 7) };
    }
    case "aylik": {
      const aySonu = istanbulGeceYarisi(yil, ay + 1, 1);
      return { kova: `ay-${tarihMetni(yil, ay, 1).slice(0, 7)}`, sonKullanma: aySonu < yediGunSonra ? aySonu : yediGunSonra };
    }
    case "kalici":
      return { kova: "", sonKullanma: yediGunSonra };
  }
}

// ---------------------------------------------------------------------------
// 5) Hepsini birleştir
// ---------------------------------------------------------------------------

type Mesaj = { role: "user" | "assistant"; content: string };

/**
 * Bu istek önbellekten cevaplanabilir / önbelleğe yazılabilir mi?
 * Evet ise kayıt anahtarını ve son kullanma anını döner; hayır ise null.
 *
 * @param surum Sistem talimatı ve belge sürümünden üretilen kısa kod. Talimat veya belgeler
 *              değişince anahtarlar da değişir, eski cevaplar kendiliğinden kullanılmaz olur.
 */
export function onbellekBilgisi(mesajlar: Mesaj[], surum: string, simdi: Date): OnbellekBilgisi | null {
  // Sadece sohbetin ilk sorusu: önceki mesajlara bağlı sorular ("peki ya ikincisi?") tek başına anlamsız.
  if (mesajlar.length !== 1 || mesajlar[0].role !== "user") return null;

  const ham = mesajlar[0].content;
  if (ham.length > MAKS_SORU_UZUNLUGU || kisiselBilgiVarMi(ham)) return null;

  const soru = normallestir(ham).replace(SELAMLAMA_BASI, "").replace(DOLGU_KELIMELER, " ").replace(/\s+/g, " ").trim();
  if (soru.split(" ").length < 2 || SOHBET.test(soru)) return null;

  const tur = zamanTuru(soru);
  if (tur === "anlik") return null;

  const { kova, sonKullanma } = gecerlilik(tur, simdi);
  const anahtar = createHash("sha256").update(`${surum}|${tur}|${kova}|${soru}`).digest("hex");
  return { anahtar, soru, tur, sonKullanma };
}

/** Bu cevap saklanmaya uygun mu? (Boş, çok uzun veya yarıda kesilmiş cevaplar saklanmaz.) */
export function cevapKaydedilebilirMi(cevap: string): boolean {
  const c = cevap.trim();
  return c.length > 0 && c.length <= MAKS_CEVAP_UZUNLUGU && !c.includes("Cevap yarıda kesildi");
}

/** Sistem talimatı + belge sürümünden kısa bir sürüm kodu üretir. */
export function surumHesapla(...parcalar: string[]): string {
  return createHash("sha256").update(parcalar.join("\u0000")).digest("hex").slice(0, 12);
}
