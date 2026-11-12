// Teşhis: bir soru için Gemini akışındaki BÜTÜN olayları sırayla yazdırır (metin dışı olaylar dahil).
// Kullanım: node --env-file=.env.local scripts/olayDokumu.ts "soru" [model]
import { GoogleGenAI } from "@google/genai";
import { belgeAra } from "../lib/belgeArama.ts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const soru = process.argv[2] || "Çift anadal yapabilir miyim?";
const model = process.argv[3] || "gemini-3.5-flash-lite";
const parcalar = (await belgeAra(ai, soru, 6))!;
const belgeler = parcalar.map((p, i) => `[${i + 1}] ${p.belge_ad} – ${p.etiket}\n${p.metin}`).join("\n\n");
const t0 = Date.now();
const akis = await ai.interactions.create(
  {
    model,
    system_instruction: `Sadece BELGELER'e dayanarak Türkçe kısa cevap ver, her cümleye [n] ekle.\n\nBELGELER:\n${belgeler}`,
    input: soru,
    stream: true,
    store: false,
    generation_config: { thinking_level: "minimal" },
  },
  { signal: AbortSignal.timeout(60_000), maxRetries: 0 },
);
for await (const o of akis as AsyncIterable<Record<string, unknown>>) {
  const kisa = JSON.stringify(o).replace(/"signature":"[^"]{20,}"/g, '"signature":"…"');
  console.log(`${String(Date.now() - t0).padStart(6)} ms  ${kisa.slice(0, 260)}`);
}
