// Cevapların sonundaki "Kaynaklar" bölümünün biçimi. Hem sunucu (ekler) hem ekran (gösterir) kullanır.
//
// Sunucu, cevap metni bittikten sonra akışa KAYNAK_AYIRICI + JSON ekler. Ekran bu ayırıcıdan
// böler: öncesi cevap metni, sonrası kaynak listesi. Kaynakları Gemini değil sunucu yazdığı için
// yanlış link veya var olmayan madde numarası gösterilemez.

export const KAYNAK_AYIRICI = "\n\n␞KAYNAKLAR␞"; // ␞ normal metinde geçmeyen bir işaret

export type Kaynak = {
  no: number; // listede gösterilen numara (cevaptaki ilk [no] işareti)
  numaralar: number[]; // bu kaynağa işaret eden bütün [n]'ler (aynı maddenin farklı parçaları olabilir)
  belge: string; // "İÜC Önlisans ve Lisans Eğitim ve Öğretim Yönetmeliği"
  etiket: string; // "Madde 24"
  baslik: string | null; // "Sınavlar"
  url: string;
  gecerlilik: string | null; // zamana bağlı belgelerde, ör. "2025-2026 akademik yılı"
};

/** Cevap metnini ve kaynak listesini birbirinden ayırır. */
export function cevabiAyir(icerik: string): { metin: string; kaynaklar: Kaynak[] } {
  const i = icerik.indexOf(KAYNAK_AYIRICI);
  if (i === -1) return { metin: icerik, kaynaklar: [] };
  try {
    const kaynaklar = JSON.parse(icerik.slice(i + KAYNAK_AYIRICI.length));
    return { metin: icerik.slice(0, i), kaynaklar: Array.isArray(kaynaklar) ? kaynaklar : [] };
  } catch {
    return { metin: icerik.slice(0, i), kaynaklar: [] }; // JSON henüz tam gelmediyse (akış sürerken)
  }
}

/** Cevap metninde geçen [1], [2] gibi kaynak numaralarını sırasıyla döndürür. */
export function kullanilanNumaralar(metin: string): number[] {
  const numaralar = [...metin.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
  return [...new Set(numaralar)];
}
