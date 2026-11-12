-- 2. Aşama: belgeler ve aranabilir belge parçaları (RAG).
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.

-- Vektör (embedding) desteği.
create extension if not exists vector with schema extensions;

-- Belgeler: her belge için bir satır.
create table if not exists public.belgeler (
  id            text primary key,          -- kısa kimlik, ör. 'onlisans-lisans-yonetmeligi'
  ad            text not null,             -- kullanıcıya gösterilen tam ad
  tur           text not null check (tur in ('yonetmelik', 'yonerge', 'sss', 'ilan', 'takvim', 'diger')),
  kaynak_url    text not null,             -- kaynak gösterirken verilen link
  yayin_tarihi  date,                      -- belgenin tarihi (biliniyorsa)
  gecerlilik    text,                      -- zamana bağlı belgeler için, ör. '2025-2026 akademik yılı'
  icerik_hash   text not null,             -- belgenin tüm metninin özeti; metin değişince değişir
  guncelleme    timestamptz not null default now()
);

-- Belge parçaları: yönetmelikte madde, SSS'de soru, ilanda bölüm.
create table if not exists public.belge_parcalari (
  id          bigint generated always as identity primary key,
  belge_id    text not null references public.belgeler (id) on delete cascade,
  anahtar     text not null,               -- belge içinde benzersiz, ör. 'madde-22' veya 'madde-22-2'
  sira        integer not null,            -- belgedeki sırası
  bolum       text,                        -- ör. 'Üçüncü Bölüm – Sınavlar'
  etiket      text not null,               -- kaynak gösterirken: 'Madde 22', 'Soru: Kimler başvurabilir?'
  baslik      text,                        -- ör. 'Bütünleme sınavı'
  metin       text not null,
  metin_hash  text not null,               -- sadece değişen parçaların yeniden işlenmesi için
  embedding   extensions.vector(768) not null,
  arama       tsvector generated always as (
                to_tsvector('turkish', coalesce(baslik, '') || ' ' || coalesce(etiket, '') || ' ' || metin)
              ) stored,
  unique (belge_id, anahtar)
);

create index if not exists belge_parcalari_embedding_idx
  on public.belge_parcalari using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists belge_parcalari_arama_idx
  on public.belge_parcalari using gin (arama);

-- Güvenlik: sadece sunucu (gizli anahtar) erişebilir.
alter table public.belgeler enable row level security;
alter table public.belge_parcalari enable row level security;
revoke all on table public.belgeler from anon, authenticated;
revoke all on table public.belge_parcalari from anon, authenticated;

-- Hibrit arama: anlam benzerliği (embedding) + kelime eşleşmesi (Türkçe kök bulma).
-- İki listedeki sıralar "Reciprocal Rank Fusion" ile birleştirilir: iki aramada da üst sıralarda
-- çıkan parça en yüksek puanı alır.
create or replace function public.parca_ara(
  sorgu_metni      text,
  sorgu_embedding  extensions.vector(768),
  adet             integer default 6,
  belge_filtre     text[] default null
)
returns table (
  id            bigint,
  belge_id      text,
  belge_ad      text,
  belge_tur     text,
  kaynak_url    text,
  gecerlilik    text,
  yayin_tarihi  date,
  etiket        text,
  baslik        text,
  bolum         text,
  metin         text,
  benzerlik     double precision,
  puan          double precision
)
language sql
stable
set search_path = ''
as $$
  with
  -- Sorudaki kelimelerden herhangi biri geçsin (VE değil VEYA): "bütünleme | sınav | gir"
  sorgu as (
    select nullif(replace(plainto_tsquery('turkish', sorgu_metni)::text, '&', '|'), '')::tsquery as q
  ),
  anlam as (
    select p.id,
           row_number() over (order by p.embedding operator(extensions.<=>) sorgu_embedding) as sira,
           1 - (p.embedding operator(extensions.<=>) sorgu_embedding) as benzerlik
      from public.belge_parcalari p
     where belge_filtre is null or p.belge_id = any (belge_filtre)
     order by p.embedding operator(extensions.<=>) sorgu_embedding
     limit 30
  ),
  kelime as (
    select p.id,
           row_number() over (order by ts_rank_cd(p.arama, s.q) desc) as sira
      from public.belge_parcalari p, sorgu s
     where s.q is not null
       and p.arama @@ s.q
       and (belge_filtre is null or p.belge_id = any (belge_filtre))
     order by ts_rank_cd(p.arama, s.q) desc
     limit 30
  )
  select p.id, p.belge_id, b.ad, b.tur, b.kaynak_url, b.gecerlilik, b.yayin_tarihi,
         p.etiket, p.baslik, p.bolum, p.metin,
         coalesce(a.benzerlik, 1 - (p.embedding operator(extensions.<=>) sorgu_embedding)) as benzerlik,
         coalesce(1.0 / (60 + a.sira), 0) + coalesce(1.0 / (60 + k.sira), 0) as puan
    from public.belge_parcalari p
    join public.belgeler b on b.id = p.belge_id
    left join anlam a on a.id = p.id
    left join kelime k on k.id = p.id
   where a.id is not null or k.id is not null
   order by puan desc
   limit adet;
$$;

-- Bütün belgelerin içeriğinden üretilen kısa sürüm kodu.
-- Bir belge eklenince/değişince bu kod değişir → önbellekteki eski cevaplar kullanılmaz olur.
create or replace function public.belge_surumu()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(left(md5(string_agg(id || ':' || icerik_hash, ',' order by id)), 12), 'bos')
    from public.belgeler;
$$;

revoke all on function public.parca_ara(text, extensions.vector, integer, text[]) from public, anon, authenticated;
revoke all on function public.belge_surumu() from public, anon, authenticated;
grant execute on function public.parca_ara(text, extensions.vector, integer, text[]) to service_role;
grant execute on function public.belge_surumu() to service_role;

-- Supabase API'nin yeni fonksiyonları hemen görmesi için.
notify pgrst, 'reload schema';
