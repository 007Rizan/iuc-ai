# İÜC AI – Öğrenci Destek Asistanı

İstanbul Üniversitesi-Cerrahpaşa öğrencilerinin yönetmelik, akademik takvim, ÇAP/yandal, Erasmus gibi
sorularını cevaplamayı amaçlayan yapay zekâ asistanı.

> **Gayriresmî bir öğrenci projesidir.** İÜC'nin resmi bir hizmeti değildir. Cevaplar hatalı olabilir;
> önemli konularda öğrenci işlerine danışın.

## Durum

- ✅ Türkçe sohbet ekranı, Gemini ile canlı (streaming) cevaplar
- ✅ Yoğunluk yönetimi: model başına kota takibi, sıra sistemi, kişi başı hız sınırı
- ✅ Akıllı cevap önbelleği (Supabase): "bugün", "bu hafta" gibi zamana bağlı sorular gün/hafta sonunda geçersiz olur
- ⏳ Yönetmelik belgeleri ve kaynak gösterme (RAG)
- ⏳ Akademik takvim, ÇAP/yandal, Erasmus belgeleri; PWA

Asistan henüz belgelere bağlı olmadığı için üniversite kurallarıyla ilgili sorulara
"Bu konuda bilgim yok, öğrenci işlerine danışın" der; bilgi uydurmaz.

## Teknolojiler

Next.js (App Router, TypeScript) · Vercel · Supabase (Postgres) · Google Gemini API — hepsi ücretsiz katmanda.

## Yerelde çalıştırma

```bash
npm install
cp .env.example .env.local   # sonra değerleri doldur
npm run dev                  # http://localhost:3000
npm test                     # birim testleri
```

Supabase'de `supabase/migrations/001_cevap_onbellegi.sql` dosyasını SQL Editor'de bir kez çalıştırın.
Supabase ayarları girilmezse önbellek kendiliğinden kapalı kalır, sohbet yine çalışır.

## Gizlilik

- Öğrencilerin kişisel verileri (OBS vb.) kullanılmaz.
- Konuşmalar Gemini tarafında saklanmaz (`store: false`).
- Önbelleğe sadece kişisel bilgi içermeyen, sohbetin ilk sorusu yazılır.
