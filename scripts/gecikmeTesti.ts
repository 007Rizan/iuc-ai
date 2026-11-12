// Gecikme teşhisi: Gemini'nin belgeli talimatla ilk kelimeyi ne kadar sürede verdiğini, düşünme
// seviyesine göre doğrudan ölçer (sunucunun kuyruğu ve önbelleği devre dışı). npm run test:gecikme
import { GoogleGenAI } from "@google/genai";
import { belgeAra } from "../lib/belgeArama.ts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const soru = process.argv[2] || "Hazırlık sınıfını geçemezsem ne olur?";
const parcalar = (await belgeAra(ai, soru, 6))!;
const belgeler = parcalar.map((p, i) => `[${i + 1}] ${p.belge_ad} – ${p.etiket}\n${p.metin}`).join("\n\n");
const talimat = `Sadece BELGELER'e dayanarak Türkçe kısa cevap ver, her cümleye [n] ekle; yoksa "Bu konuda bilgim yok" de.\n\nBELGELER:\n${belgeler}`;
console.log(`Soru: ${soru} | talimat uzunluğu: ${talimat.length} karakter`);

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
// MODELLER=model1,model2 verilirse her biri "minimal" düşünmeyle iki kez denenir.
const denemeler: [string, "minimal" | "low" | undefined][] = process.env.MODELLER
  ? process.env.MODELLER.split(",").flatMap((m) => [[m, "minimal"], [m, "minimal"]] as [string, "minimal"][])
  : [
      ["gemini-3.5-flash-lite", "minimal"],
      ["gemini-3.5-flash-lite", undefined],
      ["gemini-3.5-flash-lite", "minimal"],
      ["gemini-3.5-flash-lite", "low"],
    ];

for (const [model, seviye] of denemeler) {
  const t0 = Date.now();
  let ilk = 0;
  let dusunce = 0;
  let metin = "";
  try {
    const akis = await ai.interactions.create(
      {
        model,
        system_instruction: talimat,
        input: soru,
        stream: true,
        store: false,
        ...(seviye ? { generation_config: { thinking_level: seviye } } : {}),
      },
      { signal: AbortSignal.timeout(60_000), maxRetries: 0 },
    );
    for await (const o of akis as AsyncIterable<{
      event_type?: string;
      step?: { type?: string };
      delta?: { type?: string; text?: string };
      error?: unknown;
    }>) {
      if (o.event_type === "step.start" && o.step?.type === "thought") dusunce++;
      if (o.event_type === "step.delta" && o.delta?.type === "text") {
        if (!ilk) ilk = Date.now() - t0;
        metin += o.delta.text ?? "";
      }
      if (o.event_type === "error") throw new Error(JSON.stringify(o.error));
    }
    console.log(
      `${model} düşünme=${seviye ?? "varsayılan"}: ilk kelime ${ilk} ms, toplam ${Date.now() - t0} ms, ` +
        `düşünme adımı ${dusunce} | ${metin.slice(0, 90).replace(/\n/g, " ")}`,
    );
  } catch (e) {
    const h = e as { status?: number; message?: string };
    console.log(`${model} düşünme=${seviye ?? "varsayılan"}: HATA ${Date.now() - t0} ms ${h.status ?? ""} ${String(h.message).slice(0, 120)}`);
  }
  await bekle(5_000);
}
