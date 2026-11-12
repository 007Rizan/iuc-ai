// Belge araması (RAG'in "R"si): soruya en alakalı belge parçalarını bulur.
//
// 1) Soru Gemini ile embedding'e (anlamı temsil eden 768 sayıya) çevrilir.
// 2) Supabase'deki parca_ara fonksiyonu hem anlam benzerliğine hem kelime eşleşmesine bakar,
//    iki sonucu birleştirip en alakalı parçaları döndürür.

import type { GoogleGenAI } from "@google/genai";
import { veritabani } from "./veritabani.ts";

// ingest/ingest.py ve veritabanındaki vector(768) ile aynı olmalı.
export const EMBEDDING_MODELI = "gemini-embedding-001";
export const EMBEDDING_BOYUTU = 768;
const SURE_MS = 8_000;

export type BulunanParca = {
  id: number;
  belge_id: string;
  belge_ad: string;
  belge_tur: string;
  kaynak_url: string;
  gecerlilik: string | null;
  yayin_tarihi: string | null;
  etiket: string; // "Madde 21"
  baslik: string | null; // "Başarı notunun hesaplanması"
  bolum: string | null;
  metin: string;
  benzerlik: number; // 0-1 arası anlam benzerliği
  puan: number; // birleşik sıralama puanı
};

// Öğrencilerin gündelik dili → belgelerdeki resmi terimler.
// Ölçüm: "Finalden en az kaç almam lazım?" sorusunda yönetmelikteki "yarıyıl sonu sınavı" maddesi
// bulunamıyordu; çünkü belgede "final" kelimesi hiç geçmiyor. Eşleşme kelime başında aranır
// ("finalden", "vizeye" de yakalanır).
const OGRENCI_DILI: [RegExp, string][] = [
  [/\bfinal/i, "yarıyıl sonu sınavı bitirme sınavı"],
  [/\bvize/i, "ara sınav"],
  [/\bbüt\b|\bbütte|\bbüte/i, "bütünleme sınavı"],
  [/\bharç|\bharc/i, "öğrenci katkı payı öğrenim ücreti"],
  [/\bdondur/i, "kayıt dondurma"],
  [/kayd\w* sil|kayıt sil|okulu bırak|ayrılmak/i, "ilişik kesme kendi isteğiyle ayrılma"],
  [/\bçap\b/i, "çift anadal programı"],
  [/\bortalama/i, "AGNO ağırlıklı genel not ortalaması"],
  [/\bkart/i, "öğrenci kimlik kartı"],
  [/\bdevamsızlı/i, "devam zorunluluğu"],
  [/\bmezun/i, "mezuniyet diploma"],
  [/\bbildirim|\btebli/i, "tebligat"],
];

/** Sorudaki öğrenci ağzı kelimelere karşılık gelen resmi terimleri sorgunun sonuna ekler. */
export function sorguyuGenislet(sorgu: string): string {
  const ekler = OGRENCI_DILI.filter(([kalip]) => kalip.test(sorgu)).map(([, terim]) => terim);
  return ekler.length ? `${sorgu} (${ekler.join(", ")})` : sorgu;
}

/** Veritabanı ayarlı değilse null döner. Embedding veya arama başarısız olursa hata fırlatır. */
export async function belgeAra(ai: GoogleGenAI, soru: string, adet = 6): Promise<BulunanParca[] | null> {
  const db = veritabani();
  if (!db) return null;
  const sorgu = sorguyuGenislet(soru);

  const yanit = await ai.models.embedContent({
    model: EMBEDDING_MODELI,
    contents: sorgu,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_BOYUTU,
      abortSignal: AbortSignal.timeout(SURE_MS),
    },
  });
  const vektor = yanit.embeddings?.[0]?.values;
  if (!vektor || vektor.length !== EMBEDDING_BOYUTU) throw new Error("Soru için embedding üretilemedi");

  const { data, error } = await db
    .rpc("parca_ara", { sorgu_metni: sorgu, sorgu_embedding: JSON.stringify(vektor), adet })
    .abortSignal(AbortSignal.timeout(SURE_MS));
  if (error) throw new Error(`Belge araması başarısız: ${error.message}`);
  return (data ?? []) as BulunanParca[];
}

/** Bütün belgelerin içeriğinden üretilen sürüm kodu (belgeler değişince değişir). Hata olursa null. */
export async function belgeSurumu(): Promise<string | null> {
  const db = veritabani();
  if (!db) return null;
  const { data, error } = await db.rpc("belge_surumu").abortSignal(AbortSignal.timeout(SURE_MS));
  return error || typeof data !== "string" ? null : data;
}
