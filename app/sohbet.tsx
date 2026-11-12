"use client";
// Sohbet ekranı. "use client" = bu bileşen tarayıcıda çalışır (tıklama, yazma gibi etkileşimler için gerekli).

import { useEffect, useRef, useState } from "react";
import { cevabiAyir } from "@/lib/kaynaklar";

type Mesaj = { role: "user" | "assistant"; content: string };

const ORNEK_SORULAR = [
  "Bütünleme sınavına kimler girebilir?",
  "DD aldım, dersi geçmiş sayılır mıyım?",
  "Kayıt dondurma şartları neler?",
];

// Asistan cevabı: [1] gibi işaretler tıklanabilir rozet olur, altta kaynak listesi gösterilir.
function AsistanMesaji({ icerik }: { icerik: string }) {
  const { metin, kaynaklar } = cevabiAyir(icerik);
  return (
    <>
      {metin.split(/(\[\d{1,2}\])/g).map((parca, i) => {
        const no = /^\[(\d{1,2})\]$/.exec(parca)?.[1];
        if (!no) return <span key={i}>{parca}</span>;
        const k = kaynaklar.find((k) => k.numaralar.includes(Number(no)));
        // Kaynak listesi henüz gelmediyse (cevap akarken) işaret olduğu gibi kalır.
        if (!k) return kaynaklar.length ? null : <span key={i} className="text-zinc-400">{parca}</span>;
        return (
          <a
            key={i}
            href={k.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${k.etiket}${k.baslik ? ` – ${k.baslik}` : ""}`}
            className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-indigo-100 px-1 align-super text-[10px] font-semibold text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/60 dark:text-indigo-300 dark:hover:bg-indigo-900"
          >
            {k.no}
          </a>
        );
      })}
      {kaynaklar.length > 0 && (
        <div className="mt-3 whitespace-normal border-t border-zinc-200 pt-2 text-xs leading-relaxed text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Kaynaklar</p>
          <ol className="space-y-1">
            {kaynaklar.map((k) => (
              <li key={k.no} className="flex gap-1.5">
                <span className="font-semibold text-indigo-700 dark:text-indigo-300">[{k.no}]</span>
                <span>
                  <a
                    href={k.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-zinc-300 underline-offset-2 hover:text-indigo-700 dark:decoration-zinc-600 dark:hover:text-indigo-300"
                  >
                    {k.belge} – {k.etiket}
                    {k.baslik ? ` (${k.baslik})` : ""}
                  </a>
                  {k.gecerlilik && <span> · {k.gecerlilik}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

const MAKS_UZUNLUK = 4000; // API'deki sınırla aynı
const GECMIS_MESAJ_SAYISI = 8; // API'ye gönderilen son mesaj sayısı (API'deki sınırla aynı)
// Cevap beklerken gösterilen durum yazıları: önce "inceleniyor", uzarsa "yoğunluk var".
const BEKLEME_YAZILARI: [number, string][] = [
  [3_000, "Belgeler inceleniyor…"],
  [20_000, "Şu an yoğunluk var, sıradasın. Cevabın birazdan gelecek…"],
];

// Kişi başı hız sınırı için bu tarayıcıya özel rastgele bir kimlik (kişisel bilgi içermez).
function tarayiciKimligi(): string {
  try {
    let kimlik = localStorage.getItem("iuc-ai-kimlik");
    if (!kimlik) {
      kimlik = crypto.randomUUID();
      localStorage.setItem("iuc-ai-kimlik", kimlik);
    }
    return kimlik;
  } catch {
    return ""; // gizli sekme vb. → sunucu IP adresine göre sınırlar
  }
}

export default function Sohbet() {
  const [mesajlar, setMesajlar] = useState<Mesaj[]>([]);
  const [girdi, setGirdi] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [beklemeYazisi, setBeklemeYazisi] = useState<string | null>(null);

  const iptalRef = useRef<AbortController | null>(null);
  const oturumRef = useRef(0); // "Yeni sohbet"e basılınca eski isteğin sonucu ekrana yazılmasın diye
  const altRef = useRef<HTMLDivElement>(null);
  const girdiRef = useRef<HTMLTextAreaElement>(null);

  // Yeni mesaj veya yeni parça geldikçe en alta kaydır.
  useEffect(() => {
    altRef.current?.scrollIntoView({ block: "end" });
  }, [mesajlar, hata]);

  // Yazı kutusu, yazdıkça (en fazla ~6 satıra kadar) uzasın.
  useEffect(() => {
    const kutu = girdiRef.current;
    if (!kutu) return;
    kutu.style.height = "auto";
    kutu.style.height = `${Math.min(kutu.scrollHeight, 160)}px`;
  }, [girdi]);

  async function gonder(metin: string) {
    const soru = metin.trim();
    if (!soru || yukleniyor) return;

    const oncekiMesajlar = mesajlar;
    const gonderilecek: Mesaj[] = [...oncekiMesajlar, { role: "user", content: soru }];
    const oturum = oturumRef.current;

    // Kullanıcının mesajını ve boş bir asistan balonunu hemen ekrana koy.
    setMesajlar([...gonderilecek, { role: "assistant", content: "" }]);
    setGirdi("");
    setHata(null);
    setYukleniyor(true);

    const iptal = new AbortController();
    iptalRef.current = iptal;
    let alinan = ""; // Gemini'den şimdiye kadar gelen cevap
    let hataMesaji: string | null = null;

    try {
      const cevap = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Istemci-Kimlik": tarayiciKimligi() },
        // Önceki cevapların kaynak listesi sunucuya geri gönderilmez, sadece metinleri.
        body: JSON.stringify({
          messages: gonderilecek
            .slice(-GECMIS_MESAJ_SAYISI)
            .map((m) => (m.role === "assistant" ? { ...m, content: cevabiAyir(m.content).metin } : m)),
        }),
        signal: iptal.signal,
      });

      if (!cevap.ok || !cevap.body) {
        const veri = await cevap.json().catch(() => null);
        throw new Error(veri?.error ?? "Bir hata oluştu, lütfen tekrar deneyin.");
      }

      // Cevabı parça parça oku ve her parçada ekranı güncelle (streaming).
      const okuyucu = cevap.body.getReader();
      const cozucu = new TextDecoder();
      while (true) {
        const { value, done } = await okuyucu.read();
        if (done) break;
        alinan += cozucu.decode(value, { stream: true });
        if (oturum !== oturumRef.current) return;
        const guncel = alinan;
        setMesajlar([...gonderilecek, { role: "assistant", content: guncel }]);
      }
    } catch (e) {
      if (!iptal.signal.aborted) {
        hataMesaji =
          e instanceof TypeError
            ? "Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene."
            : e instanceof Error
              ? e.message
              : "Bir hata oluştu, lütfen tekrar deneyin.";
      }
    } finally {
      if (oturum === oturumRef.current) {
        if (alinan.trim() === "") {
          // Hiç cevap gelmediyse: mesajı geri al, yazı kutusuna geri koy ki tekrar gönderilebilsin.
          setMesajlar(oncekiMesajlar);
          setGirdi(soru);
          if (!iptal.signal.aborted) {
            setHata(hataMesaji ?? "Cevap alınamadı, lütfen tekrar deneyin.");
          }
        } else if (hataMesaji) {
          setHata(hataMesaji); // cevap yarıda kaldıysa gelen kısım ekranda kalır
        }
        setYukleniyor(false);
        iptalRef.current = null;
      }
    }
  }

  function yeniSohbet() {
    oturumRef.current += 1;
    iptalRef.current?.abort();
    iptalRef.current = null;
    setMesajlar([]);
    setGirdi("");
    setHata(null);
    setYukleniyor(false);
    girdiRef.current?.focus();
  }

  function tusaBasildi(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = gönder, Shift+Enter = yeni satır. (Türkçe klavyede harf birleştirirken gönderme.)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      gonder(girdi);
    }
  }

  const sonMesaj = mesajlar[mesajlar.length - 1];
  const yaziyor = yukleniyor && sonMesaj?.role === "assistant" && sonMesaj.content === "";

  // Cevap gecikirse sırayla durum yazılarını göster.
  useEffect(() => {
    if (!yaziyor) return;
    const zamanlayicilar = BEKLEME_YAZILARI.map(([ms, yazi]) => setTimeout(() => setBeklemeYazisi(yazi), ms));
    return () => {
      zamanlayicilar.forEach(clearTimeout);
      setBeklemeYazisi(null);
    };
  }, [yaziyor]);

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Üst bar */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-base font-semibold leading-tight">İÜC AI</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Gayriresmî öğrenci asistanı</p>
          </div>
          {mesajlar.length > 0 && (
            <button
              type="button"
              onClick={yeniSohbet}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Yeni sohbet
            </button>
          )}
        </div>
      </header>

      {/* Mesajlar */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
          {mesajlar.length === 0 && (
            <div className="mt-8 flex flex-col items-center gap-6 text-center sm:mt-16">
              <div>
                <h2 className="text-2xl font-semibold">Merhaba! 👋</h2>
                <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                  Sınavlar, notlar, devam, kayıt dondurma, mezuniyet gibi konularda İÜC Önlisans ve Lisans
                  Eğitim ve Öğretim Yönetmeliği&apos;ne dayanarak, kaynak göstererek cevap veriyorum. Erasmus,
                  akademik takvim gibi diğer konular yakında eklenecek.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto">
                {ORNEK_SORULAR.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => gonder(s)}
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700 dark:hover:bg-zinc-800"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mesajlar.map((m, i) =>
            m.role === "assistant" && m.content === "" ? null : (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-white"
                      : "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900"
                  }
                >
                  {m.role === "assistant" ? <AsistanMesaji icerik={m.content} /> : m.content}
                </div>
              </div>
            ),
          )}

          {yaziyor && (
            <div className="flex flex-col items-start gap-1.5" aria-label="Asistan yazıyor">
              <div className="flex gap-1 rounded-2xl rounded-bl-md border border-zinc-200 bg-white px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
              </div>
              {beklemeYazisi && (
                <p role="status" className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {beklemeYazisi}
                </p>
              )}
            </div>
          )}

          {hata && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
            >
              {hata}
            </div>
          )}

          <div ref={altRef} />
        </div>
      </main>

      {/* Yazı kutusu */}
      <footer className="border-t border-zinc-200 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-zinc-800 dark:bg-zinc-900">
        <form
          className="mx-auto flex max-w-2xl items-end gap-2 px-4"
          onSubmit={(e) => {
            e.preventDefault();
            gonder(girdi);
          }}
        >
          <textarea
            ref={girdiRef}
            value={girdi}
            onChange={(e) => setGirdi(e.target.value)}
            onKeyDown={tusaBasildi}
            placeholder="Sorunu yaz…"
            rows={1}
            maxLength={MAKS_UZUNLUK}
            autoFocus
            aria-label="Mesajın"
            className="max-h-40 flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-base outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950"
          />
          {yukleniyor ? (
            <button
              type="button"
              onClick={() => iptalRef.current?.abort()}
              className="h-11 shrink-0 rounded-xl border border-zinc-300 px-4 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Durdur
            </button>
          ) : (
            <button
              type="submit"
              disabled={!girdi.trim()}
              className="h-11 shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Gönder
            </button>
          )}
        </form>
        <p className="mx-auto mt-2 max-w-2xl px-4 text-center text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
          Gayriresmî bir öğrenci projesidir, İÜC&apos;nin resmi hizmeti değildir. Cevaplar hatalı olabilir; önemli
          konularda öğrenci işlerine danış.
        </p>
      </footer>
    </div>
  );
}
