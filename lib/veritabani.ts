// Supabase bağlantısı (sadece sunucuda). Önbellek ve belge araması aynı bağlantıyı kullanır.
//
// Ayarlar yoksa null döner; çağıran kod buna göre özelliği kapatır (sohbet yine çalışır).
// Her çağrıda tekrar bakılır: ayarlar sonradan eklenirse bağlantı kendiliğinden kurulur.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let istemci: SupabaseClient | null = null;
let uyariVerildi = false;

export function veritabani(): SupabaseClient | null {
  if (istemci) return istemci;
  const url = process.env.SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SECRET_KEY;
  if (!url || !anahtar || anahtar.startsWith("sb_publishable_")) {
    if (!uyariVerildi) {
      console.info(
        anahtar?.startsWith("sb_publishable_")
          ? "Veritabanı kapalı: SUPABASE_SECRET_KEY olarak publishable anahtar girilmiş, secret anahtar gerekli."
          : "Veritabanı kapalı: SUPABASE_URL / SUPABASE_SECRET_KEY tanımlı değil.",
      );
      uyariVerildi = true;
    }
    return null;
  }
  istemci = createClient(url, anahtar, { auth: { persistSession: false, autoRefreshToken: false } });
  return istemci;
}
