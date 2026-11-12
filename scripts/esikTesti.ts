// Eşik ayarı: belgelerde cevabı OLAN ve OLMAYAN sorularda en iyi parçanın anlam benzerliği ne kadar?
// İki grubu ayıran bir eşik varsa, "belgeler yetmiyor → web'de ara" kararı bu eşikle verilir.
// Kullanım: npm run test:esik
import { GoogleGenAI } from "@google/genai";
import { belgeAra } from "../lib/belgeArama.ts";

const BELGEDE_VAR = [
  "Bütünleme sınavına kimler girebilir?",
  "DD aldım, dersi geçmiş sayılır mıyım?",
  "Genel not ortalamam nasıl hesaplanıyor?",
  "Okulu bir dönem dondurmak istiyorum, ne yapmalıyım?",
  "Derslere yüzde kaç devam etmek zorundayım?",
  "Okulu en fazla kaç yılda bitirmem gerekiyor?",
  "Sınav notuma itiraz edebilir miyim?",
  "Yüksek onur öğrencisi olmak için ortalamam kaç olmalı?",
  "Çift anadal yapabilir miyim?",
  "Daha önce aldığım derslerden muaf olabilir miyim?",
  "Hazırlık sınıfını geçemezsem ne olur?",
  "Öğrenci kartımı kaybettim",
  "Harcı ödemezsem kaydım yenilenir mi?",
  "Ara sınava giremezsem mazeret sınavı var mı?",
  "Mezun olmak için 3 dersim kaldı, ne yapabilirim?",
  "Lisansı bırakırsam ön lisans diploması alabilir miyim?",
  "Yurt dışında aldığım dersler sayılır mı?",
  "Finalden en az kaç almam lazım?",
  "Yaz okulu var mı?",
  "Dersten kalırsam tekrar almak zorunda mıyım?",
  "Okuldan kaydımı nasıl sildirebilirim?",
  "Okulun bana gönderdiği bildirimler nereye gelir?",
];

const BELGEDE_YOK = [
  "Yatay geçiş sonuçları açıklandı mı?",
  "Bugün yemekhanede ne var?",
  "Erasmus başvurusu nasıl yapılır?",
  "Kampüste otopark var mı?",
  "Avcılar kampüsüne nasıl giderim?",
  "Burs başvuruları ne zaman?",
  "2025-2026 akademik takvimi nedir?",
  "Kütüphane kaçta kapanıyor?",
  "Mühendislik fakültesi dekanı kim?",
  "Yurt başvurusu nasıl yapılır?",
  "Öğrenci kulübü nasıl kurulur?",
  "Bilgisayar mühendisliği taban puanı kaç?",
];

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function enIyi(soru: string) {
  const sonuc = (await belgeAra(ai, soru, 3)) ?? [];
  const en = sonuc.reduce((a, b) => (b.benzerlik > a.benzerlik ? b : a), sonuc[0]);
  return { benzerlik: en?.benzerlik ?? 0, etiket: en?.etiket ?? "-" };
}

const var_ = [];
for (const s of BELGEDE_VAR) var_.push({ s, ...(await enIyi(s)) });
const yok = [];
for (const s of BELGEDE_YOK) yok.push({ s, ...(await enIyi(s)) });

const yaz = (x: { s: string; benzerlik: number; etiket: string }) =>
  console.log(`  ${x.benzerlik.toFixed(3)}  ${x.etiket.padEnd(14)} ${x.s}`);
console.log("BELGEDE VAR (yüksek olmalı):");
[...var_].sort((a, b) => a.benzerlik - b.benzerlik).forEach(yaz);
console.log("BELGEDE YOK (düşük olmalı):");
[...yok].sort((a, b) => b.benzerlik - a.benzerlik).forEach(yaz);

const enDusukVar = Math.min(...var_.map((x) => x.benzerlik));
const enYuksekYok = Math.max(...yok.map((x) => x.benzerlik));
console.log(`\nBelgede olanların en düşüğü: ${enDusukVar.toFixed(3)} | olmayanların en yükseği: ${enYuksekYok.toFixed(3)}`);
console.log(
  enDusukVar > enYuksekYok
    ? `✅ İki grup ayrışıyor. Eşik ~${((enDusukVar + enYuksekYok) / 2).toFixed(3)}`
    : "⚠️ Gruplar iç içe: benzerlik tek başına yetmez; anahtar kelimeyle birlikte kullanılmalı.",
);
