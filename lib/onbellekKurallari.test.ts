// Önbellek kurallarının testleri. Çalıştırmak için: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cevapKaydedilebilirMi,
  gecerlilik,
  kisiselBilgiVarMi,
  normallestir,
  onbellekBilgisi,
  zamanTuru,
} from "./onbellekKurallari.ts";

// İstanbul saati = UTC+3. Örn. "2026-11-11T21:00:00Z" = 12 Kasım 2026 Perşembe 00:00 (İstanbul).
const an = (iso: string) => new Date(iso);
const soru = (content: string) => [{ role: "user" as const, content }];

test("normalleştirme: büyük/küçük harf, Türkçe harfler, noktalama", () => {
  assert.equal(normallestir("Bütünleme NE ZAMAN??"), "butunleme ne zaman");
  assert.equal(normallestir("  İSTANBUL   ıIı  "), "istanbul iii");
  assert.equal(normallestir("Çift anadal (ÇAP) başvurusu!"), "cift anadal cap basvurusu");
});

test("aynı sorunun farklı yazımları aynı anahtarı üretir", () => {
  const simdi = an("2026-11-12T10:00:00Z");
  const a = onbellekBilgisi(soru("Bütünleme sınavına kimler girebilir?"), "v1", simdi);
  const b = onbellekBilgisi(soru("Merhaba, butunleme sinavina kimler girebilir acaba"), "v1", simdi);
  assert.ok(a && b);
  assert.equal(a.anahtar, b.anahtar);
});

test("zaman türleri", () => {
  assert.equal(zamanTuru(normallestir("Kütüphane şu an açık mı?")), "anlik");
  assert.equal(zamanTuru(normallestir("Bugün yemek ne?")), "gunluk");
  assert.equal(zamanTuru(normallestir("Yemekhanede ne var?")), "gunluk");
  assert.equal(zamanTuru(normallestir("Yarınki sınav nerede?")), "gunluk");
  assert.equal(zamanTuru(normallestir("Bu hafta sınav var mı?")), "haftalik");
  assert.equal(zamanTuru(normallestir("Bu dönem ders kaydı ne zaman?")), "aylik");
  assert.equal(zamanTuru(normallestir("Bütünlemeye kimler girebilir?")), "kalici");
  assert.equal(zamanTuru(normallestir("Dünya tarihi dersi kaç kredi?")), "kalici"); // "dünya" ≠ "dün"
});

test("ÖRNEK: çarşamba kaydedilen 'bugün yemek ne' cevabı perşembe kullanılmaz", () => {
  const carsamba = an("2026-11-11T09:00:00Z"); // 11 Kasım Çarşamba 12:00 İstanbul
  const persembe = an("2026-11-12T09:00:00Z"); // 12 Kasım Perşembe 12:00 İstanbul
  const c = onbellekBilgisi(soru("Bugün yemek ne?"), "v1", carsamba);
  const p = onbellekBilgisi(soru("Bugün yemek ne?"), "v1", persembe);
  assert.ok(c && p);
  assert.notEqual(c.anahtar, p.anahtar); // farklı günler → farklı kayıt
  // Çarşamba kaydı, çarşamba gece 00:00'da (İstanbul) = 11 Kasım 21:00 UTC'de sona erer.
  assert.equal(c.sonKullanma.toISOString(), "2026-11-11T21:00:00.000Z");
  // Aynı gün içinde aynı kayıt kullanılır.
  const carsambaAksam = onbellekBilgisi(soru("bugün yemek ne"), "v1", an("2026-11-11T20:59:00Z"));
  assert.equal(carsambaAksam?.anahtar, c.anahtar);
});

test("gece yarısı sınırı İstanbul saatine göre", () => {
  // 11 Kasım 22:30 UTC = 12 Kasım 01:30 İstanbul → artık perşembe
  const g = gecerlilik("gunluk", an("2026-11-11T22:30:00Z"));
  assert.equal(g.kova, "2026-11-12");
  assert.equal(g.sonKullanma.toISOString(), "2026-11-12T21:00:00.000Z");
});

test("haftalık: pazar gecesi biter, yeni hafta yeni kayıt", () => {
  const persembe = gecerlilik("haftalik", an("2026-11-12T09:00:00Z"));
  assert.equal(persembe.kova, "hafta-2026-11-09"); // o haftanın pazartesisi
  assert.equal(persembe.sonKullanma.toISOString(), "2026-11-15T21:00:00.000Z"); // 16 Kasım Pzt 00:00 İst.
  const pazar = gecerlilik("haftalik", an("2026-11-15T20:00:00Z")); // pazar 23:00 İst.
  assert.equal(pazar.kova, persembe.kova);
  const pazartesi = gecerlilik("haftalik", an("2026-11-15T21:30:00Z")); // pazartesi 00:30 İst.
  assert.equal(pazartesi.kova, "hafta-2026-11-16");
});

test("aylık: ay sonunu veya 7 günü geçmez", () => {
  const ayBasi = gecerlilik("aylik", an("2026-11-02T09:00:00Z"));
  assert.equal(ayBasi.sonKullanma.toISOString(), "2026-11-09T09:00:00.000Z"); // 7 gün
  const aySonu = gecerlilik("aylik", an("2026-11-28T09:00:00Z"));
  assert.equal(aySonu.sonKullanma.toISOString(), "2026-11-30T21:00:00.000Z"); // 1 Aralık 00:00 İst.
  // Yıl sonu geçişi
  const aralik = gecerlilik("aylik", an("2026-12-30T09:00:00Z"));
  assert.equal(aralik.kova, "ay-2026-12");
  assert.equal(aralik.sonKullanma.toISOString(), "2026-12-31T21:00:00.000Z");
});

test("kalıcı: 7 gün", () => {
  const k = gecerlilik("kalici", an("2026-11-12T09:00:00Z"));
  assert.equal(k.kova, "");
  assert.equal(k.sonKullanma.toISOString(), "2026-11-19T09:00:00.000Z");
});

test("saklanmayanlar: anlık, sohbet, takip sorusu, kişisel bilgi, çok uzun", () => {
  const simdi = an("2026-11-12T09:00:00Z");
  assert.equal(onbellekBilgisi(soru("Kütüphane şu an açık mı?"), "v1", simdi), null);
  assert.equal(onbellekBilgisi(soru("Merhaba!"), "v1", simdi), null);
  assert.equal(onbellekBilgisi(soru("Neler yapabilirsin?"), "v1", simdi), null);
  assert.equal(onbellekBilgisi(soru("Teşekkürler"), "v1", simdi), null);
  assert.equal(
    onbellekBilgisi(
      [
        { role: "user", content: "Bütünleme ne zaman?" },
        { role: "assistant", content: "..." },
        { role: "user", content: "Peki ya final?" },
      ],
      "v1",
      simdi,
    ),
    null,
  );
  assert.equal(onbellekBilgisi(soru("Öğrenci numaram 1234567890, notum ne?"), "v1", simdi), null);
  assert.equal(onbellekBilgisi(soru("x".repeat(301) + " soru"), "v1", simdi), null);
});

test("kişisel bilgi filtresi", () => {
  assert.ok(kisiselBilgiVarMi("TC kimlik no ile giriş"));
  assert.ok(kisiselBilgiVarMi("mailim ali@ornek.com"));
  assert.ok(kisiselBilgiVarMi("beni 0532 123 45 67'den ara"));
  assert.ok(kisiselBilgiVarMi("Benim adım Ayşe, ÇAP'a başvurabilir miyim?"));
  assert.ok(kisiselBilgiVarMi("OBS şifremi unuttum"));
  assert.ok(!kisiselBilgiVarMi("2025-2026 akademik takvimi ne zaman açıklanır?"));
  assert.ok(!kisiselBilgiVarMi("Erasmus başvurusu nasıl yapılır?"));
});

test("sürüm değişince anahtar değişir (talimat/belge güncellemesi)", () => {
  const simdi = an("2026-11-12T09:00:00Z");
  const v1 = onbellekBilgisi(soru("Erasmus başvurusu nasıl yapılır?"), "v1", simdi);
  const v2 = onbellekBilgisi(soru("Erasmus başvurusu nasıl yapılır?"), "v2", simdi);
  assert.notEqual(v1?.anahtar, v2?.anahtar);
});

test("cevap kaydedilebilir mi", () => {
  assert.ok(cevapKaydedilebilirMi("Bu konuda bilgim yok, öğrenci işlerine danışın."));
  assert.ok(!cevapKaydedilebilirMi("   "));
  assert.ok(!cevapKaydedilebilirMi("Yarım cevap\n\n⚠️ Cevap yarıda kesildi, lütfen tekrar deneyin."));
  assert.ok(!cevapKaydedilebilirMi("a".repeat(8001)));
});
