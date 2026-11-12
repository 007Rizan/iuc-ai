// /api/chat — Sohbet API'si
// Tarayıcıdan gelen mesajları Gemini'ye iletir ve cevabı parça parça (streaming) geri yollar.
// API anahtarı sadece burada, sunucuda kullanılır; tarayıcıya asla gönderilmez.

import { GoogleGenAI } from "@google/genai";

// Vercel'de bu fonksiyonun en fazla kaç saniye çalışabileceği.
export const maxDuration = 60;

// İstenirse .env.local içinde GEMINI_MODEL=... ile değiştirilebilir.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Gemini'den ilk kelime bu süre içinde gelmezse vazgeçip kullanıcıya haber veriyoruz.
const ILK_CEVAP_SURESI_MS = 25_000;

// Kötüye kullanımı ve ücretsiz kotanın hızla bitmesini önleyen sınırlar.
const MAKS_MESAJ_SAYISI = 20; // geçmişten en fazla bu kadar mesaj gönderilir
const MAKS_MESAJ_UZUNLUGU = 4_000; // karakter

// 1. Aşama: henüz belge veritabanı (RAG) yok. Asistan uydurmasın diye bunu açıkça söylüyoruz.
const SISTEM_TALIMATI = `Sen "İÜC AI" adında, İstanbul Üniversitesi-Cerrahpaşa öğrencilerine yardım eden gayriresmî bir öğrenci asistanısın.
Üniversitenin resmi bir hizmeti değilsin; gerekirse bunu belirt.
Her zaman Türkçe, kısa, net ve samimi cevap ver.
Düz metin yaz: Markdown işaretleri (**, #, tablo) kullanma; liste gerekiyorsa satır başına "- " koy.
Henüz yönetmelik, akademik takvim, ÇAP/yandal veya Erasmus belgelerine erişimin YOK.
Bu konularda somut bilgi (tarih, madde numarası, kredi, not, süre vb.) ASLA uydurma; bunun yerine
"Bu konuda bilgim yok, öğrenci işlerine danışın" de.
Genel sohbet ve kendini tanıtma gibi konularda normal şekilde yardımcı olabilirsin.`;

type Mesaj = { role: "user" | "assistant"; content: string };

// Hata durumunda tarayıcıya Türkçe mesajlı bir JSON cevabı döndürür.
function hata(mesaj: string, durum: number) {
  return Response.json({ error: mesaj }, { status: durum });
}

// Gelen isteğin gövdesinin beklediğimiz biçimde olduğunu kontrol eder.
function mesajlariDogrula(govde: unknown): Mesaj[] | null {
  if (!govde || typeof govde !== "object") return null;
  const mesajlar = (govde as { messages?: unknown }).messages;
  if (!Array.isArray(mesajlar) || mesajlar.length === 0) return null;

  for (const m of mesajlar) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      m.content.trim() === "" ||
      m.content.length > MAKS_MESAJ_UZUNLUGU
    ) {
      return null;
    }
  }
  // Son mesaj kullanıcıdan gelmeli (soruyu o soruyor).
  if (mesajlar[mesajlar.length - 1].role !== "user") return null;

  return (mesajlar as Mesaj[]).slice(-MAKS_MESAJ_SAYISI);
}

export async function POST(istek: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return hata("Sunucu ayarı eksik: GEMINI_API_KEY tanımlı değil.", 500);
  }

  let govde: unknown;
  try {
    govde = await istek.json();
  } catch {
    return hata("Geçersiz istek.", 400);
  }
  const mesajlar = mesajlariDogrula(govde);
  if (!mesajlar) {
    return hata(
      `Geçersiz mesaj. Mesajlar boş olamaz ve en fazla ${MAKS_MESAJ_UZUNLUGU} karakter olabilir.`,
      400,
    );
  }

  // Google cevap vermezse isteği kesebilmek için. Kullanıcı sayfayı kapatırsa da kesilir.
  const iptal = new AbortController();
  istek.signal.addEventListener("abort", () => iptal.abort());
  const zamanlayici = setTimeout(() => iptal.abort(), ILK_CEVAP_SURESI_MS);

  const ai = new GoogleGenAI({ apiKey });

  let olaylar: AsyncIterator<unknown>;
  let ilkParca: string;
  try {
    const akis = await ai.interactions.create(
      {
        model: MODEL,
        system_instruction: SISTEM_TALIMATI,
        // Sohbet geçmişi: kullanıcı mesajları "user_input", asistanınkiler "model_output".
        input: mesajlar.map((m) => ({
          type: m.role === "user" ? ("user_input" as const) : ("model_output" as const),
          content: [{ type: "text" as const, text: m.content }],
        })),
        stream: true,
        store: false, // konuşmalar Google tarafında saklanmasın
      },
      { signal: iptal.signal, maxRetries: 0 },
    );
    olaylar = akis[Symbol.asyncIterator]();

    // İlk metin parçasını bekle. Hata varsa cevap başlamadan anlaşılır ve düzgün mesaj gösterilir.
    ilkParca = await sonrakiMetin(olaylar);
  } catch (e) {
    clearTimeout(zamanlayici);
    return gemininHatasi(e, iptal.signal.aborted && !istek.signal.aborted);
  }
  clearTimeout(zamanlayici);

  // Cevabı geldikçe tarayıcıya ilet.
  const kodlayici = new TextEncoder();
  const govdeAkisi = new ReadableStream<Uint8Array>({
    async start(kontrol) {
      if (ilkParca) kontrol.enqueue(kodlayici.encode(ilkParca));
      try {
        while (true) {
          const parca = await sonrakiMetin(olaylar);
          if (parca === "") break; // akış bitti
          kontrol.enqueue(kodlayici.encode(parca));
        }
      } catch (e) {
        console.error("Gemini akışı yarıda kesildi:", e);
        kontrol.enqueue(kodlayici.encode("\n\n⚠️ Cevap yarıda kesildi, lütfen tekrar deneyin."));
      }
      kontrol.close();
    },
    cancel() {
      iptal.abort();
    },
  });

  return new Response(govdeAkisi, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Akıştan bir sonraki metin parçasını döndürür; akış bittiyse "" döndürür.
// Metin dışındaki olayları (başladı, bitti vb.) atlar, hata olayında hata fırlatır.
async function sonrakiMetin(olaylar: AsyncIterator<unknown>): Promise<string> {
  while (true) {
    const { value, done } = await olaylar.next();
    if (done) return "";
    const olay = value as {
      event_type?: string;
      delta?: { type?: string; text?: string };
      error?: { code?: string; message?: string };
    };
    if (olay.event_type === "error") {
      throw new GeminiAkisHatasi(olay.error?.code, olay.error?.message);
    }
    if (olay.event_type === "step.delta" && olay.delta?.type === "text" && olay.delta.text) {
      return olay.delta.text;
    }
  }
}

class GeminiAkisHatasi extends Error {
  constructor(
    public kod?: string,
    mesaj?: string,
  ) {
    super(mesaj || kod || "Bilinmeyen Gemini hatası");
  }
}

// Gemini'den gelen hatayı kullanıcıya anlaşılır bir Türkçe mesaja çevirir.
function gemininHatasi(e: unknown, zamanAsimi: boolean) {
  console.error("Gemini hatası:", e);
  const yogun = "Asistan şu an çok yoğun, lütfen birazdan tekrar deneyin.";

  if (zamanAsimi) return hata(yogun, 504);

  const durum = (e as { status?: number })?.status;
  const kod = e instanceof GeminiAkisHatasi ? e.kod : undefined;

  if (durum === 429 || kod === "resource_exhausted") {
    return hata("Günlük/dakikalık ücretsiz kullanım sınırına ulaşıldı. Lütfen biraz sonra tekrar deneyin.", 429);
  }
  if (durum === 503 || kod === "service_unavailable") return hata(yogun, 503);
  if (durum === 401 || durum === 403) {
    return hata("Sunucu ayarı hatalı: Gemini API anahtarı geçersiz.", 500);
  }
  return hata("Beklenmeyen bir hata oluştu, lütfen tekrar deneyin.", 502);
}
