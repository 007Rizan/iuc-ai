#!/usr/bin/env python3
"""
İÜC AI – belge yükleyici.

kaynaklar.json'daki herkese açık belgeleri indirir, parçalara böler (yönetmelikte madde madde),
Gemini ile embedding üretir ve Supabase'e yazar. Sadece değişen parçalar yeniden işlenir;
belge hiç değişmediyse hiçbir şey yapılmaz (kota harcanmaz).

Kullanım (proje klasöründen):
  ingest/.venv/bin/python ingest/ingest.py                 # bütün kaynakları yükle/güncelle
  ingest/.venv/bin/python ingest/ingest.py --kuru          # sadece indir + parçala, özet göster
  ingest/.venv/bin/python ingest/ingest.py --kuru --goster madde-21
  ingest/.venv/bin/python ingest/ingest.py --sadece onlisans-lisans-yonetmeligi

Ayarlar ortam değişkenlerinden, yoksa .env.local dosyasından okunur:
  GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.robotparser
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

PROJE = Path(__file__).resolve().parent.parent
KAYNAKLAR = Path(__file__).resolve().parent / "kaynaklar.json"

KULLANICI_AJANI = "iuc-ai-ogrenci-projesi/1.0 (+https://github.com/007Rizan/iuc-ai)"
EMBEDDING_MODELI = "gemini-embedding-001"
EMBEDDING_BOYUTU = 768  # veritabanındaki vector(768) ile aynı olmalı
EMBEDDING_GRUBU = 50  # tek istekte gönderilen parça sayısı
MAKS_PARCA = 3000  # karakter; daha uzun maddeler fıkra sınırlarından bölünür
BEKLEME_SN = 2  # siteleri yormamak için iki indirme arası bekleme

# Yönetmeliğin sonundaki "değişiklik yapan yönetmelikler" tablosu madde metnine karışmasın.
METIN_SONU = re.compile(r"Yönetmeliğin Yayımlandığı Resmî Gazete|Yönetmelikte Değişiklik Yapan", re.I)


@dataclass
class Parca:
    anahtar: str  # belge içinde benzersiz: madde-21, madde-21-2, gecici-madde-1
    sira: int
    bolum: str | None
    etiket: str  # kaynak gösterirken: "Madde 21"
    baslik: str | None  # "Başarı notunun hesaplanması"
    metin: str


# ---------------------------------------------------------------------------
# Yardımcılar
# ---------------------------------------------------------------------------


def ayar(ad: str) -> str:
    """Ortam değişkenini, yoksa .env.local'deki değeri döndürür."""
    if os.environ.get(ad):
        return os.environ[ad]
    dosya = PROJE / ".env.local"
    if dosya.exists():
        for satir in dosya.read_text(encoding="utf-8").splitlines():
            if satir.startswith(ad + "="):
                return satir.split("=", 1)[1].strip()
    sys.exit(f"HATA: {ad} tanımlı değil (ortam değişkeni veya .env.local).")


def bosluk(metin: str) -> str:
    return re.sub(r"\s+", " ", metin.replace("\xa0", " ")).strip()


def ozet(metin: str) -> str:
    return hashlib.sha256(metin.encode("utf-8")).hexdigest()


_robotlar: dict[str, urllib.robotparser.RobotFileParser] = {}


def robots_izin_veriyor(url: str) -> bool:
    """Sitenin robots.txt kurallarına uy."""
    kok = "{0.scheme}://{0.netloc}".format(urlparse(url))
    if kok not in _robotlar:
        rp = urllib.robotparser.RobotFileParser()
        try:
            yanit = requests.get(kok + "/robots.txt", headers={"User-Agent": KULLANICI_AJANI}, timeout=30)
            rp.parse(yanit.text.splitlines() if yanit.ok else [])
        except requests.RequestException:
            rp.parse([])  # robots.txt okunamazsa: kısıtlama yok sayılır
        _robotlar[kok] = rp
    return _robotlar[kok].can_fetch(KULLANICI_AJANI, url)


def indir(url: str) -> bytes:
    if not robots_izin_veriyor(url):
        raise RuntimeError(f"robots.txt bu adresin indirilmesine izin vermiyor: {url}")
    yanit = requests.get(url, headers={"User-Agent": KULLANICI_AJANI}, timeout=60)
    yanit.raise_for_status()
    return yanit.content


# ---------------------------------------------------------------------------
# Ayrıştırıcılar: belge biçimine göre metni parçalara böler
# ---------------------------------------------------------------------------

MADDE_BASI = re.compile(r"^(GEÇİCİ MADDE|Geçici Madde|EK MADDE|Ek Madde|MADDE|Madde)\s+(\d+)\s*[–—-]\s*(.*)$")


def _ortali(p) -> bool:
    stil = (p.get("style") or "").replace(" ", "").lower()
    return p.get("align") == "center" or "text-align:center" in stil


def mevzuat_html(icerik: bytes) -> list[Parca]:
    """mevzuat.gov.tr (Word'den dönüştürülmüş HTML): her <p> bir paragraf.
    Bölüm başlığı: ortalı + kalın. Madde başlığı: kalın paragraf. Madde: 'MADDE n –' ile başlar."""
    soup = BeautifulSoup(icerik, "html.parser")
    maddeler: list[dict] = []
    bolum: str | None = None
    bolum_adi_bekleniyor = False
    bekleyen_baslik: list[str] = []

    for p in soup.find_all("p"):
        metin = bosluk(p.get_text(" "))
        if not metin:
            continue
        if METIN_SONU.search(metin) and maddeler:
            break
        kalin = bosluk(" ".join(b.get_text(" ") for b in p.find_all("b")))
        tamami_kalin = kalin == metin

        m = MADDE_BASI.match(metin)
        ortali_kalin = tamami_kalin and _ortali(p)
        if bolum_adi_bekleniyor and not ortali_kalin:
            bolum_adi_bekleniyor = False  # bölüm adı (birden fazla satır olabilir) bitti

        if m:
            tur, no, govde = m.groups()
            # Dikkat: Python'da "GEÇİCİ".lower() → "geçi̇ci̇" (noktalı i). Türkçe harfleri sadeleştirip karşılaştır.
            tur_sade = tur.replace("İ", "I").replace("ı", "i").lower()
            gecici = tur_sade.startswith("geçici")
            ek = tur_sade.startswith("ek")
            etiket = ("Geçici Madde " if gecici else "Ek Madde " if ek else "Madde ") + no
            anahtar = ("gecici-madde-" if gecici else "ek-madde-" if ek else "madde-") + no
            maddeler.append(
                {
                    "anahtar": anahtar,
                    "etiket": etiket,
                    "baslik": " ".join(bekleyen_baslik) or None,
                    "bolum": bolum,
                    "satirlar": [govde] if govde else [],
                }
            )
            bekleyen_baslik = []
        elif ortali_kalin:
            if "BÖLÜM" in metin.upper():
                bolum, bolum_adi_bekleniyor = metin.title(), True
            elif bolum_adi_bekleniyor:
                bolum = f"{bolum} – {metin}" if " – " not in (bolum or "") else f"{bolum} {metin}"
            # (belge başındaki yönetmelik adı gibi diğer ortalı satırlar atlanır)
        elif tamami_kalin:
            bekleyen_baslik.append(metin)  # madde başlığı adayı (birden fazla satır olabilir)
        elif maddeler:
            # Kalın satırın ardından MADDE değil normal metin geldiyse o satır başlık değildi
            # (ör. not tablosunun kalın başlık satırı): önceki maddenin metnine ait.
            maddeler[-1]["satirlar"].extend(bekleyen_baslik)
            bekleyen_baslik = []
            maddeler[-1]["satirlar"].append(metin)

    parcalar: list[Parca] = []
    for madde in maddeler:
        govde = "\n".join(madde["satirlar"]).strip()
        for i, bolumcuk in enumerate(_uzunsa_bol(govde)):
            parcalar.append(
                Parca(
                    anahtar=madde["anahtar"] + (f"-{i + 1}" if i else ""),
                    sira=len(parcalar),
                    bolum=madde["bolum"],
                    etiket=madde["etiket"],
                    baslik=madde["baslik"],
                    metin=bolumcuk,
                )
            )
    return parcalar


def _uzunsa_bol(metin: str) -> list[str]:
    """Çok uzun maddeleri fıkra ("(1)", "(2)"...) sınırlarından MAKS_PARCA'yı aşmayacak şekilde böler."""
    if len(metin) <= MAKS_PARCA:
        return [metin]
    fikralar = re.split(r"\n(?=\(\d+\))", metin)
    gruplar, simdiki = [], ""
    for f in fikralar:
        if simdiki and len(simdiki) + len(f) + 1 > MAKS_PARCA:
            gruplar.append(simdiki)
            simdiki = f
        else:
            simdiki = f"{simdiki}\n{f}" if simdiki else f
    if simdiki:
        gruplar.append(simdiki)
    return gruplar


AYRISTIRICILAR = {"mevzuat_html": mevzuat_html}


# ---------------------------------------------------------------------------
# Embedding ve veritabanı
# ---------------------------------------------------------------------------


def embedding_metni(kaynak: dict, p: Parca) -> str:
    """Embedding'e giden metin: bağlam (belge, bölüm, madde başlığı) + metin.
    Böylece 'bütünleme' kelimesi geçmeyen bir fıkra da başlığı sayesinde bulunabilir."""
    ust = [kaynak["ad"]]
    if kaynak.get("gecerlilik"):
        ust.append(f"Geçerlilik: {kaynak['gecerlilik']}")
    if p.bolum:
        ust.append(p.bolum)
    ust.append(f"{p.etiket}" + (f" – {p.baslik}" if p.baslik else ""))
    return "\n".join(ust) + "\n\n" + p.metin


def embedding_uret(istemci, metinler: list[str]) -> list[list[float]]:
    from google.genai import types

    sonuc: list[list[float]] = []
    for i in range(0, len(metinler), EMBEDDING_GRUBU):
        grup = metinler[i : i + EMBEDDING_GRUBU]
        for deneme in range(5):
            try:
                yanit = istemci.models.embed_content(
                    model=EMBEDDING_MODELI,
                    contents=grup,
                    config=types.EmbedContentConfig(
                        task_type="RETRIEVAL_DOCUMENT", output_dimensionality=EMBEDDING_BOYUTU
                    ),
                )
                vektorler = [e.values for e in yanit.embeddings]
                if len(vektorler) != len(grup):
                    raise RuntimeError(f"{len(grup)} metin için {len(vektorler)} vektör geldi")
                sonuc.extend(vektorler)
                break
            except Exception as hata:  # kota (429) / yoğunluk (503): bekleyip tekrar dene
                mesaj = str(hata)
                if deneme == 4 or not re.search(r"429|503|RESOURCE_EXHAUSTED|UNAVAILABLE", mesaj):
                    raise
                bekle = 20 * (deneme + 1)
                print(f"   Gemini meşgul/kota ({mesaj[:80]}…), {bekle} sn bekleniyor")
                time.sleep(bekle)
        print(f"   embedding: {min(i + EMBEDDING_GRUBU, len(metinler))}/{len(metinler)}")
    return sonuc


def vektor_metni(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


def belgeyi_yukle(db, gemini, kaynak: dict, parcalar: list[Parca]) -> None:
    metinler = {p.anahtar: embedding_metni(kaynak, p) for p in parcalar}
    meta = json.dumps({k: kaynak.get(k) for k in ("ad", "tur", "kaynak_url", "gecerlilik", "yayin_tarihi")}, sort_keys=True)
    icerik_hash = ozet(meta + "\n" + "\n".join(f"{a}\n{m}" for a, m in metinler.items()))

    eski = db.table("belgeler").select("icerik_hash").eq("id", kaynak["id"]).execute().data
    if eski and eski[0]["icerik_hash"] == icerik_hash:
        print("   değişiklik yok, atlandı")
        return

    mevcut = {
        r["anahtar"]: r["metin_hash"]
        for r in db.table("belge_parcalari").select("anahtar,metin_hash").eq("belge_id", kaynak["id"]).execute().data
    }
    degisen = [p for p in parcalar if mevcut.get(p.anahtar) != ozet(metinler[p.anahtar])]
    silinecek = sorted(set(mevcut) - {p.anahtar for p in parcalar})
    print(f"   {len(parcalar)} parça: {len(degisen)} yeni/değişmiş, {len(silinecek)} silinecek")

    # Önce belge satırı (parçalar ona bağlı); icerik_hash en sonda güncellenir ki yarıda kalırsa tekrar denensin.
    belge_satiri = {
        "id": kaynak["id"],
        "ad": kaynak["ad"],
        "tur": kaynak["tur"],
        "kaynak_url": kaynak.get("kaynak_url") or kaynak["url"],
        "yayin_tarihi": kaynak.get("yayin_tarihi"),
        "gecerlilik": kaynak.get("gecerlilik"),
    }
    db.table("belgeler").upsert({**belge_satiri, "icerik_hash": (eski[0]["icerik_hash"] if eski else "yarim")}).execute()

    if degisen:
        vektorler = embedding_uret(gemini, [metinler[p.anahtar] for p in degisen])
        satirlar = [
            {
                "belge_id": kaynak["id"],
                "anahtar": p.anahtar,
                "sira": p.sira,
                "bolum": p.bolum,
                "etiket": p.etiket,
                "baslik": p.baslik,
                "metin": p.metin,
                "metin_hash": ozet(metinler[p.anahtar]),
                "embedding": vektor_metni(v),
            }
            for p, v in zip(degisen, vektorler)
        ]
        for i in range(0, len(satirlar), 50):
            db.table("belge_parcalari").upsert(satirlar[i : i + 50], on_conflict="belge_id,anahtar").execute()

    # Sırası değişen ama metni aynı kalan parçaların sıra numarasını güncelle.
    for p in parcalar:
        if p not in degisen and p.anahtar in mevcut:
            db.table("belge_parcalari").update({"sira": p.sira}).eq("belge_id", kaynak["id"]).eq("anahtar", p.anahtar).execute()

    if silinecek:
        db.table("belge_parcalari").delete().eq("belge_id", kaynak["id"]).in_("anahtar", silinecek).execute()

    simdi = datetime.now(timezone.utc).isoformat()
    db.table("belgeler").update({"icerik_hash": icerik_hash, "guncelleme": simdi}).eq("id", kaynak["id"]).execute()
    print("   ✅ yüklendi")


# ---------------------------------------------------------------------------


def main() -> None:
    arg = argparse.ArgumentParser(description="İÜC AI belge yükleyici")
    arg.add_argument("--kuru", action="store_true", help="sadece indir ve parçala; Gemini/Supabase kullanma")
    arg.add_argument("--sadece", help="sadece bu kimlikteki kaynağı işle")
    arg.add_argument("--goster", help="--kuru ile: bu anahtardaki parçanın tam metnini göster (ör. madde-21)")
    a = arg.parse_args()

    kaynaklar = json.loads(KAYNAKLAR.read_text(encoding="utf-8"))
    if a.sadece:
        kaynaklar = [k for k in kaynaklar if k["id"] == a.sadece]
        if not kaynaklar:
            sys.exit(f"HATA: '{a.sadece}' kimlikli kaynak yok.")

    db = gemini = None
    if not a.kuru:
        from google import genai
        from supabase import create_client

        db = create_client(ayar("SUPABASE_URL"), ayar("SUPABASE_SECRET_KEY"))
        gemini = genai.Client(api_key=ayar("GEMINI_API_KEY"))

    hatalar = 0
    for i, kaynak in enumerate(kaynaklar):
        if i:
            time.sleep(BEKLEME_SN)
        print(f"📄 {kaynak['ad']}")
        try:
            parcalar = AYRISTIRICILAR[kaynak["bicim"]](indir(kaynak["url"]))
            if not parcalar:
                raise RuntimeError("hiç parça çıkarılamadı (sayfa biçimi değişmiş olabilir)")
            if a.kuru:
                for p in parcalar:
                    print(f"   {p.anahtar:<18} {len(p.metin):>5} kr  {p.etiket}: {p.baslik or '—'}")
                print(f"   toplam {len(parcalar)} parça, {sum(len(p.metin) for p in parcalar)} karakter")
                for p in parcalar:
                    if p.anahtar == a.goster:
                        print("\n" + embedding_metni(kaynak, p))
            else:
                belgeyi_yukle(db, gemini, kaynak, parcalar)
        except Exception as hata:
            hatalar += 1
            print(f"   ❌ HATA: {hata}")

    if db is not None:
        print("Belge sürümü:", db.rpc("belge_surumu").execute().data)
    sys.exit(1 if hatalar else 0)


if __name__ == "__main__":
    main()
