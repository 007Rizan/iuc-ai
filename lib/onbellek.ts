// Cevap önbelleğinin veritabanı (Supabase) tarafı.
//
// Kural: önbellek hiçbir zaman sohbeti bozmamalı. Supabase ayarlı değilse, yavaşsa veya
// hata verirse önbellek sessizce atlanır ve soru normal şekilde Gemini'ye gider.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { OnbellekBilgisi } from "./onbellekKurallari";

const OKUMA_SURESI_MS = 2_000; // önbellek bundan uzun sürerse beklemeden Gemini'ye git
const TEMIZLIK_OLASILIGI = 0.05; // her 20 kayıttan birinde süresi dolmuş kayıtlar silinir

let istemci: SupabaseClient | null = null;
let uyariVerildi = false;

function istemciAl(): SupabaseClient | null {
  if (istemci) return istemci;
  const url = process.env.SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SECRET_KEY;
  if (!url || !anahtar || anahtar.startsWith("sb_publishable_")) {
    // Her istekte tekrar bakılır: ayarlar sonradan eklenirse önbellek kendiliğinden açılır.
    if (!uyariVerildi) {
      console.info(
        anahtar?.startsWith("sb_publishable_")
          ? "Cevap önbelleği kapalı: SUPABASE_SECRET_KEY olarak publishable anahtar girilmiş, secret anahtar gerekli."
          : "Cevap önbelleği kapalı: SUPABASE_URL / SUPABASE_SECRET_KEY tanımlı değil.",
      );
      uyariVerildi = true;
    }
    return null;
  }
  istemci = createClient(url, anahtar, { auth: { persistSession: false, autoRefreshToken: false } });
  return istemci;
}

/** Önbellek açık mı? (Supabase ayarları tanımlı mı?) */
export function onbellekAcikMi(): boolean {
  return istemciAl() !== null;
}

/** Geçerli bir kayıtlı cevap varsa döndürür; yoksa (veya hata olursa) null. */
export async function onbellektenGetir(bilgi: OnbellekBilgisi): Promise<string | null> {
  const db = istemciAl();
  if (!db) return null;
  try {
    const { data, error } = await db
      .rpc("onbellek_getir", { p_anahtar: bilgi.anahtar })
      .abortSignal(AbortSignal.timeout(OKUMA_SURESI_MS));
    if (error) throw error;
    return typeof data === "string" && data.length > 0 ? data : null;
  } catch (e) {
    console.warn("Önbellek okunamadı (atlanıyor):", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Cevabı önbelleğe yazar. Hata olursa sadece kayda geçer. */
export async function onbellegeKaydet(bilgi: OnbellekBilgisi, cevap: string, model: string): Promise<void> {
  const db = istemciAl();
  if (!db) return;
  try {
    const { error } = await db.from("cevap_onbellegi").upsert({
      anahtar: bilgi.anahtar,
      soru: bilgi.soru,
      cevap,
      zaman_turu: bilgi.tur,
      model,
      son_kullanma: bilgi.sonKullanma.toISOString(),
    });
    if (error) throw error;

    if (Math.random() < TEMIZLIK_OLASILIGI) {
      const { data, error: temizlikHatasi } = await db.rpc("onbellek_temizle");
      if (temizlikHatasi) throw temizlikHatasi;
      if (data) console.info(`Önbellek temizliği: ${data} eski kayıt silindi.`);
    }
  } catch (e) {
    console.warn("Önbelleğe yazılamadı:", e instanceof Error ? e.message : e);
  }
}
