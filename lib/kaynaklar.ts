// Cevapların sonundaki "Kaynaklar" bölümünün biçimi. Hem sunucu (ekler) hem ekran (gösterir) kullanır.
//
// Sunucu, cevap metni bittikten sonra akışa KAYNAK_AYIRICI + JSON ekler. Ekran bu ayırıcıdan
// böler: öncesi cevap metni, sonrası kaynak listesi. Kaynakları Gemini değil sunucu yazdığı için
// yanlış link veya var olmayan madde numarası gösterilemez.

export const KAYNAK_AYIRICI = "\n\n␞KAYNAKLAR␞"; // ␞ normal metinde geçmeyen bir işaret

export type Kaynak = {
  tur?: "belge" | "web"; // belge: yüklü resmi belge (madde); web: İÜC sitesindeki sayfa/duyuru
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

// Cevaptaki kaynak işaretleri: [3] veya [4, 6, 7] (Gemini bazen birden fazla numarayı tek parantezde yazıyor).
export const KAYNAK_ISARETI = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;

/** "[4, 6, 7]" → [4, 6, 7] */
export function isaretNumaralari(isaret: string): number[] {
  return (isaret.match(/\d{1,2}/g) ?? []).map(Number);
}

/** Cevap metninde geçen [1], [2, 5] gibi kaynak numaralarını sırasıyla (tekrarsız) döndürür. */
export function kullanilanNumaralar(metin: string): number[] {
  const numaralar = [...metin.matchAll(KAYNAK_ISARETI)].flatMap((m) => isaretNumaralari(m[1]));
  return [...new Set(numaralar)];
}
