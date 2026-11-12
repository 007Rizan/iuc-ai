// Web araması kararının ve kişisel bilgi temizliğinin testleri. Çalıştırmak için: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BENZERLIK_ESIGI, kisiselBilgiyiTemizle, turkceTarih, webAramasiGerekli } from "./webArama.ts";

const YUKSEK = 0.75; // belgede güçlü eşleşme
const DUSUK = 0.58; // belgede alakalı parça yok

test("belgede olan yönetmelik soruları web'e gitmez (kredi harcanmaz)", () => {
  for (const s of ["Bütünleme sınavına kimler girebilir?", "DD aldım, dersi geçmiş sayılır mıyım?", "Kayıt dondurma şartları neler?"]) {
    assert.equal(webAramasiGerekli(s, YUKSEK).gerekli, false, s);
  }
});

test("güncel bilgi isteyen sorular, konu yönetmelikte geçse bile web'e gider", () => {
  for (const s of [
    "Yatay geçiş sonuçları açıklandı mı?",
    "2025-2026 akademik takvimi nedir?",
    "Erasmus başvuruları ne zaman?",
    "Bugün yemekte ne var?",
    "Rektörlük nerede?",
  ]) {
    const k = webAramasiGerekli(s, YUKSEK);
    assert.equal(k.gerekli, true, s);
    assert.equal(k.sebep, "guncel", s);
  }
});

test("belgede alakalı parça yoksa web'e gider", () => {
  assert.ok(DUSUK < BENZERLIK_ESIGI);
  const k = webAramasiGerekli("Kampüste otopark var mı?", DUSUK);
  assert.deepEqual(k, { gerekli: true, sebep: "belge_yetersiz" });
});

test("kişisel bilgi temizliği: öğrenci no, TC, e-posta, cep telefonu", () => {
  const temiz = kisiselBilgiyiTemizle("Ali 1306190045 numaralı, TC 12345678901, ali@ornek.com, 0532 123 45 67");
  assert.ok(!/\d{7,}/.test(temiz), temiz);
  assert.ok(!temiz.includes("@"), temiz);
  assert.ok(!temiz.includes("123 45 67"), temiz);
  assert.match(temiz, /\[numara\].*\[numara\].*\[e-posta\].*\[telefon\]/);
});

test("kişisel bilgi temizliği: tarih, yıl ve sabit telefon bozulmaz", () => {
  const metin = "2025-2026 Güz yarıyılı, başvurular 14.02.2025 tarihinde, bilgi: 0212 404 03 00";
  assert.equal(kisiselBilgiyiTemizle(metin), metin);
});

test("Tavily tarihleri Türkçe biçime çevrilir", () => {
  assert.equal(turkceTarih("Wed, 27 Sep 2023 10:00:00 GMT"), "27.09.2023");
  assert.equal(turkceTarih(null), null);
  assert.equal(turkceTarih("geçersiz"), null);
});
