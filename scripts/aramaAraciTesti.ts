// Teşhis: Gemini'nin yerleşik Google Arama aracı ücretsiz anahtarla çalışıyor mu, hangi kaynakları veriyor?
// Kullanım: node --env-file=.env.local scripts/aramaAraciTesti.ts "soru" [model]
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const soru = process.argv[2] || "İstanbul Üniversitesi-Cerrahpaşa yatay geçiş sonuçları";
const model = process.argv[3] || "gemini-3.1-flash-lite";
const t0 = Date.now();
try {
  const sonuc = (await ai.interactions.create(
    {
      model,
      system_instruction:
        "Sadece İstanbul Üniversitesi-Cerrahpaşa'nın (iuc.edu.tr) resmi sayfalarındaki bilgilere dayanarak Türkçe kısa cevap ver. İstanbul Üniversitesi (istanbul.edu.tr) farklı bir üniversitedir, onu kullanma. Kişilerin adlarını yazma.",
      input: soru,
      tools: [{ type: "google_search" }],
      store: false,
      generation_config: { thinking_level: "minimal" },
    },
    { signal: AbortSignal.timeout(60_000), maxRetries: 0 },
  )) as unknown as { steps?: unknown[]; outputs?: unknown[]; status?: string };
  console.log(`Model: ${model} | ${Date.now() - t0} ms | durum: ${sonuc.status}`);
  const adimlar = (sonuc.steps ?? sonuc.outputs ?? []) as Record<string, unknown>[];
  for (const a of adimlar) {
    const s = JSON.stringify(a).replace(/"signature":"[^"]{20,}"/g, '"signature":"…"');
    console.log(`- adım ${a.type}: ${s.slice(0, 900)}`);
  }
} catch (e) {
  const h = e as { status?: number; message?: string };
  console.log(`HATA ${Date.now() - t0} ms ${h.status ?? ""} ${String(h.message).slice(0, 300)}`);
}
