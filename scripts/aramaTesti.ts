// Arama kalitesi testi: öğrencilerin gündelik dille sorabileceği sorularda doğru madde
// kaçıncı sırada bulunuyor? Çalıştırmak için: npm run test:arama
//
// Beklenen maddeler yönetmeliğin gerçek metnine bakılarak belirlendi (o konuyu düzenleyen madde).
// Sorulardan herhangi bir beklenen madde ilk N sonuçta çıkarsa "bulundu" sayılır.

import { GoogleGenAI } from "@google/genai";
import { belgeAra } from "../lib/belgeArama.ts";

const TEST_SETI: { soru: string; beklenen: string[] }[] = [
  { soru: "Bütünleme sınavına kimler girebilir?", beklenen: ["Madde 20", "Madde 24", "Madde 26"] },
  { soru: "DD aldım, dersi geçmiş sayılır mıyım?", beklenen: ["Madde 21"] },
  { soru: "Genel not ortalamam nasıl hesaplanıyor?", beklenen: ["Madde 22"] },
  { soru: "Okulu bir dönem dondurmak istiyorum, ne yapmalıyım?", beklenen: ["Madde 29"] },
  { soru: "Derslere yüzde kaç devam etmek zorundayım?", beklenen: ["Madde 19"] },
  { soru: "Okulu en fazla kaç yılda bitirmem gerekiyor?", beklenen: ["Madde 28"] },
  { soru: "Sınav notuma itiraz edebilir miyim?", beklenen: ["Madde 27"] },
  { soru: "Yüksek onur öğrencisi olmak için ortalamam kaç olmalı?", beklenen: ["Madde 34"] },
  { soru: "Çift anadal yapabilir miyim?", beklenen: ["Madde 10"] },
  { soru: "Daha önce aldığım derslerden muaf olabilir miyim?", beklenen: ["Madde 11"] },
  { soru: "Hazırlık sınıfını geçemezsem ne olur?", beklenen: ["Madde 18"] },
  { soru: "Öğrenci kartımı kaybettim", beklenen: ["Madde 7"] },
  { soru: "Harcı ödemezsem kaydım yenilenir mi?", beklenen: ["Madde 8", "Madde 9"] },
  { soru: "Ara sınava giremezsem mazeret sınavı var mı?", beklenen: ["Madde 24", "Madde 25"] },
  { soru: "Mezun olmak için 3 dersim kaldı, ne yapabilirim?", beklenen: ["Madde 24", "Madde 21", "Madde 28"] },
  { soru: "Lisansı bırakırsam ön lisans diploması alabilir miyim?", beklenen: ["Madde 32"] },
  { soru: "Yurt dışında aldığım dersler sayılır mı?", beklenen: ["Madde 35"] },
  { soru: "Finalden en az kaç almam lazım?", beklenen: ["Madde 21"] },
  { soru: "Yaz okulu var mı?", beklenen: ["Madde 14"] },
  { soru: "Dersten kalırsam tekrar almak zorunda mıyım?", beklenen: ["Madde 23", "Madde 20"] },
  { soru: "Okuldan kaydımı nasıl sildirebilirim?", beklenen: ["Madde 30"] },
  { soru: "Okulun bana gönderdiği bildirimler nereye gelir?", beklenen: ["Madde 39"] },
];

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const sayac = { 1: 0, 3: 0, 6: 0 } as Record<number, number>;
const kacirilan: string[] = [];
const sureler: number[] = [];

for (const { soru, beklenen } of TEST_SETI) {
  const t0 = Date.now();
  const sonuc = (await belgeAra(ai, soru, 6)) ?? [];
  sureler.push(Date.now() - t0);
  const etiketler = sonuc.map((p) => p.etiket);
  const sira = etiketler.findIndex((e) => beklenen.includes(e)) + 1; // 0 = bulunamadı
  for (const n of [1, 3, 6]) if (sira > 0 && sira <= n) sayac[n]++;
  const isaret = sira === 1 ? "✅" : sira > 0 ? `🟡${sira}` : "❌";
  console.log(`${isaret.padEnd(3)} ${soru}\n     bulunan: ${etiketler.join(", ")} | beklenen: ${beklenen.join("/")}`);
  if (sira === 0) kacirilan.push(soru);
}

const n = TEST_SETI.length;
const yuzde = (x: number) => `${x}/${n} (%${Math.round((100 * x) / n)})`;
sureler.sort((a, b) => a - b);
console.log("\n──── Sonuç ────");
console.log(`İlk sırada doğru madde : ${yuzde(sayac[1])}`);
console.log(`İlk 3'te doğru madde   : ${yuzde(sayac[3])}`);
console.log(`İlk 6'da doğru madde   : ${yuzde(sayac[6])}   ← asistana verilen parça sayısı`);
console.log(`Arama süresi (ortanca) : ${sureler[Math.floor(n / 2)]} ms`);
if (kacirilan.length) console.log("Bulunamayanlar:", kacirilan);
