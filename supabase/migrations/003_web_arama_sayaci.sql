-- Web araması (Tavily) için günlük sayaç. Ücretsiz katman ayda 1.000 arama veriyor;
-- günlük sınır sayesinde kota ay ortasında bitmez.
-- Supabase panelinde: SQL Editor → bu dosyanın tamamını yapıştır → Run.

create table if not exists public.web_arama_sayaci (
  gun   date primary key,       -- Türkiye saatine göre gün
  sayi  integer not null default 0
);

alter table public.web_arama_sayaci enable row level security;
revoke all on table public.web_arama_sayaci from anon, authenticated;

-- Bugün için sınır dolmadıysa sayacı 1 artırır ve true döner; dolduysa false.
-- Tek bir SQL ifadesiyle yapılır: aynı anda gelen istekler sınırı aşamaz.
create or replace function public.web_arama_hakki(gunluk_limit integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  bugun date := (now() at time zone 'Europe/Istanbul')::date;
  yeni_sayi integer;
begin
  if gunluk_limit <= 0 then
    return false; -- sınır 0 = web araması kapalı
  end if;
  insert into public.web_arama_sayaci as s (gun, sayi)
  values (bugun, 1)
  on conflict (gun) do update set sayi = s.sayi + 1
  where s.sayi < gunluk_limit
  returning s.sayi into yeni_sayi;
  return yeni_sayi is not null;
end;
$$;

revoke all on function public.web_arama_hakki(integer) from public, anon, authenticated;
grant execute on function public.web_arama_hakki(integer) to service_role;

notify pgrst, 'reload schema';
