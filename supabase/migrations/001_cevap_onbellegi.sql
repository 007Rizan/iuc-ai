-- Cevap önbelleği tablosu.
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.

create table if not exists public.cevap_onbellegi (
  anahtar          text primary key,          -- sha256(sürüm | zaman türü | gün/hafta/ay | normalleştirilmiş soru)
  soru             text not null,             -- normalleştirilmiş soru (kişisel bilgi filtresinden geçmiş)
  cevap            text not null,
  zaman_turu       text not null check (zaman_turu in ('gunluk', 'haftalik', 'aylik', 'kalici')),
  model            text,                      -- cevabı üreten Gemini modeli
  olusturma        timestamptz not null default now(),
  son_kullanma     timestamptz not null,      -- bu andan sonra cevap kullanılmaz
  kullanim_sayisi  integer not null default 0 -- önbellekten kaç kez verildi (popüler sorular)
);

create index if not exists cevap_onbellegi_son_kullanma_idx on public.cevap_onbellegi (son_kullanma);

-- Güvenlik: tabloya sadece sunucu (gizli anahtar) erişebilir.
-- RLS açık + hiç kural yok = tarayıcıdan (publishable/anon anahtarla) okuma/yazma yasak.
alter table public.cevap_onbellegi enable row level security;
revoke all on table public.cevap_onbellegi from anon, authenticated;

-- Geçerli bir cevap varsa döndürür ve kullanım sayısını 1 artırır; yoksa null.
create or replace function public.onbellek_getir(p_anahtar text)
returns text
language sql
set search_path = ''
as $$
  update public.cevap_onbellegi
     set kullanim_sayisi = kullanim_sayisi + 1
   where anahtar = p_anahtar
     and son_kullanma > now()
  returning cevap;
$$;

-- Süresi dolmuş kayıtları siler; silinen kayıt sayısını döndürür.
create or replace function public.onbellek_temizle()
returns integer
language sql
set search_path = ''
as $$
  with silinen as (
    delete from public.cevap_onbellegi where son_kullanma <= now() returning 1
  )
  select count(*)::integer from silinen;
$$;

revoke all on function public.onbellek_getir(text) from public, anon, authenticated;
revoke all on function public.onbellek_temizle() from public, anon, authenticated;
grant execute on function public.onbellek_getir(text) to service_role;
grant execute on function public.onbellek_temizle() to service_role;
