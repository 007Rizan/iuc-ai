// /api/chat — Sohbet API'si
// Tarayıcıdan gelen mesajları Gemini'ye iletir ve cevabı parça parça (streaming) geri yollar.
// API anahtarı sadece burada, sunucuda kullanılır; tarayıcıya asla gönderilmez.

import { GoogleGenAI } from "@google/genai";

// Vercel'de bu fonksiyonun en fazla kaç saniye çalışabileceği.
export const maxDuration = 60;

// Sırayla denenecek modeller. Biri yoğunsa / kotası dolduysa / geç kalırsa sıradakine geçilir.
// Ücretsiz katmanda Flash modelleri sık sık "yoğun" hatası veriyor; Flash-Lite daha güvenilir.
// İstenirse .env.local içinde GEMINI_MODELS=model1,model2 ile değiştirilebilir.
const MODELLER = (process.env.GEMINI_MODELS || "gemini-3.5-flash-lite,gemini-3.8-flash,gemini-3.1-flash-lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Bir modelden ilk kelime bu süre içinde gelmezse sıradaki modele geçilir.
// İlk modele biraz daha fazla süre tanınır.
const ILK_MODEL_SURESI_MS = 15_000;
const YEDEK_MODEL_SURESI_MS = 10_000;

// Kötüye kullanımı ve ücretsiz kotanın hızla bitmesini önleyen sınırlar.
const MAKS_MESAJ_SAYISI = 20; // geçmişten en fazla bu kadar mesaj gönderilir
const MAKS_MESAJ_UZUNLUGU = 4_000; // karakter

// 1. Aşama: henüz belge veritabanı (RAG) yok. Asistan uydurmasın diye bunu açıkça söylüyoruz.
const SISTEM_TALIMATI = `Sen "İÜC AI" adında, İstanbul Üniversitesi-Cerrahpaşa öğrencilerine yardım eden gayriresmî bir öğrenci asistanısın.
Üniversitenin resmi bir hizmeti değilsin; gerekirse bunu belirt.
Her zaman Türkçe, kısa, net ve samimi cevap ver. Kendini sadece sorulursa tanıt; doğrudan soruya cevap ver.
Düz metin yaz: Markdown işaretleri (**, #, tablo) kullanma; liste gerekiyorsa satır başına "- " koy.
Henüz yönetmelik, akademik takvim, ÇAP/yandal veya Erasmus belgelerine erişimin YOK.
Bu konularda somut bilgi (tarih, madde numarası, kredi, not, süre vb.) ASLA uydurma; bunun yerine
"Bu konuda bilgim yok, öğrenci işlerine danışın" de.
Genel sohbet ve kendini tanıtma gibi konularda normal şekilde yardımcı olabilirsin.`;

type Mesaj = { role: "user" | "assistant"; content: string };

// Gemini'ye giden sohbet geçmişi: kullanıcı mesajları "user_input", asistanınkiler "model_output".
function girdiOlustur(mesajlar: Mesaj[]) {
  return mesajlar.map((m) => ({
    type: m.role === "user" ? ("user_input" as const) : ("model_output" as const),
    content: [{ type: "text" as const, text: m.content }],
  }));
}
type Girdi = ReturnType<typeof girdiOlustur>;

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

  const ai = new GoogleGenAI({ apiKey });
  const girdi = girdiOlustur(mesajlar);

  // Modelleri sırayla dene; ilk kelimeyi gönderen ilk model kazanır.
  const hatalar: SebepliHata[] = [];
  let basari: { olaylar: AsyncIterator<unknown>; ilkParca: string; iptal: AbortController } | null = null;

  for (const [sira, model] of MODELLER.entries()) {
    if (istek.signal.aborted) return hata("İstek iptal edildi.", 499);
    const sure = sira === 0 ? ILK_MODEL_SURESI_MS : YEDEK_MODEL_SURESI_MS;
    try {
      basari = await modeliDene(ai, model, girdi, istek.signal, sure);
      if (sira > 0) console.info(`Yedek model kullanıldı: ${model}`);
      break;
    } catch (e) {
      const sebep = hatayiSiniflandir(e);
      console.warn(`Model başarısız: ${model} → ${sebep.tur}`, sebep.ayrinti);
      hatalar.push(sebep);
      // Anahtar geçersiz veya istek bozuksa başka model denemenin anlamı yok.
      if (sebep.tur === "anahtar" || sebep.tur === "istek") break;
    }
  }

  if (!basari) return sonHata(hatalar);
  const { olaylar, ilkParca, iptal } = basari;

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

// Tek bir modelle akışı başlatır ve ilk metin parçasını bekler.
// Süre dolarsa veya model hata verirse hata fırlatır (bir sonraki model denenir).
async function modeliDene(
  ai: GoogleGenAI,
  model: string,
  girdi: Girdi,
  istekSinyali: AbortSignal,
  sureMs: number,
) {
  const iptal = new AbortController();
  const kullaniciIptali = () => iptal.abort();
  istekSinyali.addEventListener("abort", kullaniciIptali);
  let zamanAsimi = false;
  const zamanlayici = setTimeout(() => {
    zamanAsimi = true;
    iptal.abort();
  }, sureMs);

  try {
    const akis = await ai.interactions.create(
      {
        model,
        system_instruction: SISTEM_TALIMATI,
        input: girdi,
        stream: true,
        store: false, // konuşmalar Google tarafında saklanmasın
      },
      { signal: iptal.signal, maxRetries: 0 },
    );
    const olaylar = akis[Symbol.asyncIterator]();
    const ilkParca = await sonrakiMetin(olaylar);
    if (ilkParca === "") throw new GeminiAkisHatasi("bos_cevap", "Model boş cevap döndürdü");
    return { olaylar, ilkParca, iptal };
  } catch (e) {
    iptal.abort(); // yarım kalan bağlantıyı kapat
    throw zamanAsimi ? new ZamanAsimiHatasi(model) : e;
  } finally {
    clearTimeout(zamanlayici);
  }
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

class ZamanAsimiHatasi extends Error {
  constructor(model: string) {
    super(`${model} zamanında cevap vermedi`);
  }
}

type SebepliHata = { tur: "yogun" | "kota" | "anahtar" | "istek" | "diger"; ayrinti: string };

// Gemini'den gelen hatanın türünü belirler.
function hatayiSiniflandir(e: unknown): SebepliHata {
  const ayrinti = e instanceof Error ? e.message.slice(0, 200) : String(e);
  if (e instanceof ZamanAsimiHatasi) return { tur: "yogun", ayrinti };

  const durum = (e as { status?: number })?.status;
  const kod = e instanceof GeminiAkisHatasi ? e.kod : undefined;

  if (durum === 429 || kod === "resource_exhausted") return { tur: "kota", ayrinti };
  if (durum === 401 || durum === 403) return { tur: "anahtar", ayrinti };
  if (durum === 400) return { tur: "istek", ayrinti };
  if (durum === 503 || kod === "service_unavailable") return { tur: "yogun", ayrinti };
  return { tur: "diger", ayrinti }; // 404, 500 vb. → sıradaki model denenir
}

// Hiçbir model cevap veremediyse kullanıcıya anlaşılır bir Türkçe mesaj döndürür.
function sonHata(hatalar: SebepliHata[]) {
  const turler = new Set(hatalar.map((h) => h.tur));
  if (turler.has("anahtar")) return hata("Sunucu ayarı hatalı: Gemini API anahtarı geçersiz.", 500);
  if (turler.has("istek")) return hata("İstek işlenemedi, lütfen sorunu farklı yazıp tekrar dene.", 400);
  if (turler.size === 1 && turler.has("kota")) {
    return hata("Ücretsiz kullanım sınırına ulaşıldı. Lütfen biraz sonra tekrar deneyin.", 429);
  }
  return hata("Asistan şu an çok yoğun, lütfen birazdan tekrar deneyin.", 503);
}
