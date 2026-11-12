# İÜC AI – Öğrenci Destek Asistanı

## Proje
İstanbul Üniversitesi-Cerrahpaşa (İÜC) öğrencilerinin yönetmelik, akademik takvim,
ÇAP/yandal, Erasmus vb. sorularını cevaplayan bir yapay zeka asistanı.
Araştırma projesi değil, gerçek öğrencilerin kullanacağı bir ürün.
Gayriresmî bir öğrenci projesidir; üniversitenin logosu resmi bir şeymiş gibi kullanılmaz.

## Temel kurallar
- Tamamen ücretsiz kalmalı: sadece ücretsiz katmanlar (Vercel, Supabase, Gemini API, GitHub Actions).
- Yerelde değil bulutta çalışır; telefonda ve bilgisayarda tarayıcıdan hızlı açılmalı (PWA).
- Asistan SADECE veritabanındaki belgelere dayanarak cevap verir. Bilgi yoksa
  "Bu konuda bilgim yok, öğrenci işlerine danışın" der. Uydurma yasak.
- Her cevabın sonunda kaynak gösterir (belge adı + madde no + link).
- Arayüz ve cevaplar Türkçe.
- Sadece herkese açık belgeler kullanılır; öğrenci kişisel verisi (OBS vb.) yok (KVKK).

## Mimari
- Arayüz + API: Next.js (App Router, TypeScript), Vercel'de barınır, cevaplar streaming ile gelir.
- Veritabanı: Supabase Postgres + pgvector (belge parçaları + embedding'ler).
- LLM ve embedding: Google Gemini API.
- Veri toplama: Python scraper (ingest/ klasörü) → belgeleri "MADDE X" bazında
  parçalar → Supabase'e yazar. GitHub Actions ile haftada bir otomatik çalışır.
- API anahtarları sadece .env.local / Vercel ortam değişkenlerinde; asla koda yazılmaz, asla commit edilmez.

## Yol haritası
1. Aşama: Next.js sohbet ekranı Vercel'de canlı, Gemini'ye bağlı (henüz RAG yok).
2. Aşama: Eğitim-Öğretim ve Sınav Yönetmeliği tek belge olarak Supabase'e yüklenir, RAG + kaynak gösterme.
3. Aşama: Akademik takvim, ÇAP/yandal, Erasmus belgeleri; scraper GitHub Actions'ta; PWA.
4. Aşama: Arkadaşlarla test, 👍/👎 geri bildirim butonu ve loglama.

## Benimle çalışırken
- Programlamada deneyimim az: her adımda ne yaptığını kısaca Türkçe açıkla.
- Küçük adımlarla ilerle; her adımın sonunda nasıl test edeceğimi söyle.
- Yeni bir kavram (embedding, deploy, env değişkeni vb.) çıktığında 1-2 cümleyle anlat.
- Büyük değişikliklerden önce plan göster, onayımı al.
- Her çalışan adımdan sonra anlamlı bir mesajla git commit at.
