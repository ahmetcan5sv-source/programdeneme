"""Ders verisini data/courses.js dosyasına derler.

Kaynaklar (data/src):
  obs/*.txt        OBS ders seçim ekranından kopyalanan liste (tüm bölümler). Ana kaynak budur.
  rektorluk.csv    Rektörlük ortak seçmeli dersleri
  derslik_*.csv    Derslik bilgisi (OBS listesinde derslik yok); ders+gün+başlangıç ile eşleşir
  names.csv        İsteğe bağlı ders adı düzeltmeleri
  prereq.csv       Ön koşullar
  oneriler.csv     Ozan'ın önerdiği dersler: code,program(boş = herkes),note

CSV satır biçimi: code,section,year,day,start,end,room,instructor[,ects,name]

Kullanım:  python tools/build.py
"""
import csv
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "src"
OUT = ROOT / "data" / "courses.js"

TERM = "2026-2027 Güz"
MUH = "Mühendislik ve Doğa Bilimleri Fakültesi"
ISL = "İşletme Fakültesi"
HUK = "Hukuk Fakültesi"
# OBS program adının başı (büyük harf) -> kısa kod, görünen ad, fakülte
PROGRAMS = OrderedDict([
    ("BİLGİSAYAR", ("CENG", "Bilgisayar Mühendisliği", MUH)),
    ("ELEKTRİK", ("EE", "Elektrik-Elektronik Mühendisliği", MUH)),
    ("ENDÜSTRİ", ("IE", "Endüstri Mühendisliği", MUH)),
    ("ENERJİ", ("ESE", "Enerji Sistemleri Mühendisliği", MUH)),
    ("İNŞAAT", ("CE", "İnşaat Mühendisliği", MUH)),
    ("MAKİNE", ("MCE", "Makine Mühendisliği", MUH)),
    ("MATEMATİK", ("MATH", "Matematik", MUH)),
    ("METALURJİ", ("MSE", "Metalurji ve Malzeme Mühendisliği", MUH)),
    ("YAZILIM", ("SENG", "Yazılım Mühendisliği", MUH)),
    ("FİNANS", ("BF", "Finans ve Bankacılık", ISL)),
    ("İŞLETME", ("BUS", "İşletme", ISL)),
    ("ULUSLARARASI", ("ITB", "Uluslararası Ticaret ve İşletmecilik", ISL)),
    ("YÖNETİM", ("MIS", "Yönetim Bilişim Sistemleri", ISL)),
    ("HUKUK", ("LAW", "Hukuk", HUK)),
])
ENGR_FACULTY = MUH
# Herkesin yalnızca kendi bölümünün şubesinden alabileceği dersler (staj ayrıca açma nedeninden anlaşılır)
OWN_ONLY_CODES = {"ENGR450"}
OWN_ONLY_NAME = re.compile(r"GRADUATION PROJECT|SENIOR PROJECT|BİTİRME", re.I)
DAYS = {"pzt": 0, "sal": 1, "çar": 2, "car": 2, "per": 3, "cum": 4}
COMMON = re.compile(r"^(TDL|TIT|ENG10[1-4])")
# Derslik bilgisi olmayan ama online yapıldığı bilinen dersler
ONLINE = re.compile(r"^(TDL|TIT|ENG103|ENGR206|ENGR213|ENGR251|ENGR265)")
# Açma nedeni "Staj" olanlar zaten muaf; ek olarak çakışma kontrolüne girmeyecek dersler
NO_CLASH = set()
ALIASES = {"TT101": "TIT101", "TT102": "TIT102"}
# Türkçe büyük/küçük harf kuralı yabancı isimleri bozar (DENNIS -> Dennıs); bunları düzelt
NAME_FIX = {
    "Dennıs": "Dennis", "O`keefe": "O'Keefe", "Alvın": "Alvin", "Garcıa": "Garcia",
    "Javanshır": "Javanshir", "Karım": "Karim", "Khıavı": "Khiavi", "Kotık": "Kotik",
    "Musarıa": "Musaria", "Salmanoghlı": "Salmanoghli",
}
ROMAN = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII"}
SMALL_EN = {"and", "of", "in", "the", "for", "to", "with", "on", "a", "an", "at", "by"}
SMALL_TR = {"ve", "ile"}


def norm_code(code):
    code = code.strip().upper().replace(" ", "").replace("İ", "I")
    return ALIASES.get(code, code)


def fmt(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def to_min(t):
    h, m = re.split(r"[:.]", t.strip())
    return int(h) * 60 + int(m)


def lower(word, turkish):
    if turkish:
        return word.replace("I", "ı").replace("İ", "i").lower()
    return word.replace("İ", "I").lower()


def title(text, turkish=False):
    """OBS'deki BÜYÜK HARF adları okunur hale getirir."""
    out = []
    for i, w in enumerate(text.split()):
        if w.upper() in ROMAN or any(ch.isdigit() for ch in w) or "." in w:
            out.append(w)
            continue
        low = lower(w, turkish)
        if i and low in (SMALL_TR if turkish else SMALL_EN):
            out.append(low)
        else:
            first = "İ" if turkish and low[:1] == "i" else low[:1].upper()
            out.append(first + low[1:])
    return " ".join(out)


def person(name):
    # "Doç.Dr. İBRAHİM YILMAZ" -> "Doç.Dr. İbrahim Yılmaz"
    words = (w if "." in w else title(w, turkish=True) for w in name.split())
    return " ".join(NAME_FIX.get(w, w) for w in words)


def parse_slots(text):
    """'Sal 08:00,Sal 09:00,Per 14:00' -> ardışık saatleri birleştirilmiş bloklar."""
    by_day = {}
    for tok in filter(None, (t.strip() for t in text.split(","))):
        day, start = tok.split()
        by_day.setdefault(DAYS[day.lower()[:3]], []).append(to_min(start))
    slots = []
    for d, starts in sorted(by_day.items()):
        starts.sort()
        s = prev = starts[0]
        for t in starts[1:] + [None]:
            if t is not None and t - prev <= 60:
                prev = t
                continue
            slots.append({"d": d, "s": fmt(s), "e": fmt(prev + 50)})
            if t is not None:
                s = prev = t
    return slots


def category(code, source):
    if source == "rektorluk":
        return "rektorluk"
    if code.startswith("ENGR"):
        return "engr"
    if COMMON.match(code):
        return "ortak"
    return "dept"


def read_csv(name):
    path = SRC / name
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


ROW = re.compile(
    r"^(?P<sec>\d+)\t(?P<code>\S+)\t(?P<name>.*?)(?:\s*\[(?P<slots>.*?)\])?\t(?P<zs>[ZS])\t\d+\t\d+\t(?P<ects>\d+)\t"
    r"(?P<instr>.*?)\t(?P<year>\d*)\t(?P<reason>[^\t]*)\t(?P<lang>[^\t]*)")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    names = {norm_code(r["code"]): r["name"].strip() for r in read_csv("names.csv")}
    prereq = {norm_code(r["code"]): r["prereq"].split() for r in read_csv("prereq.csv")}
    recommended = {}
    for r in read_csv("oneriler.csv"):
        recommended.setdefault(norm_code(r["code"]), []).append(
            {"program": (r.get("program") or "").strip().upper(), "note": (r.get("note") or "").strip()})
    rooms = {}
    for path in SRC.glob("derslik_*.csv"):
        for r in read_csv(path.name):
            rooms[(norm_code(r["code"]), DAYS[r["day"].strip().lower()[:3]], to_min(r["start"]))] = r["room"].strip()

    courses = OrderedDict()

    def course(code, name, source, ects):
        return courses.setdefault(code, {
            "code": code, "name": names.get(code) or name, "category": category(code, source),
            "year": None, "ects": ects, "noClash": code in NO_CLASH, "ownOnly": code in OWN_ONLY_CODES,
            "prereq": prereq.get(code, []), "recommended": recommended.get(code, []),
            "programs": {}, "sections": OrderedDict(),
        })

    # ---- OBS listesi ----
    rows = []
    for path in sorted((SRC / "obs").glob("*.txt")):
        lines = path.read_text(encoding="utf-8").replace("\r", "").split("\n")
        prog = None
        for i, line in enumerate(lines):
            if line.strip() == "Program":
                key = next((k for k in PROGRAMS if lines[i + 1].strip().startswith(k)), None)
                if key is None:
                    raise SystemExit(f"Bilinmeyen program: {lines[i + 1].strip()}")
                prog = PROGRAMS[key][0]
            m = ROW.match(line)
            if m:
                rows.append((prog, m))

    for prog, m in rows:
        code = norm_code(m["code"])
        turkish = m["lang"].strip() == "Türkçe"
        c = course(code, title(m["name"].strip(), turkish), "obs", int(m["ects"]))
        year = int(m["year"]) if m["year"] else None
        info = c["programs"].setdefault(prog, {"req": False, "year": year})
        info["req"] = info["req"] or m["zs"] == "Z"
        if m["reason"].strip() == "Staj":
            c["noClash"] = c["ownOnly"] = True
        if OWN_ONLY_NAME.search(m["name"]):
            c["ownOnly"] = True
        slots = parse_slots(m["slots"] or "")
        for sl in slots:
            sl["r"] = rooms.get((code, sl["d"], to_min(sl["s"])), "")
            if not sl["r"] and ONLINE.match(code):
                sl["r"] = "Online"
        c["sections"].setdefault(prog, []).append({
            "no": m["sec"], "instructor": person(m["instr"].strip()), "slots": slots,
        })

    # ---- Ek CSV'ler (OBS listesinde olmayan dersler) ----
    for source in ("ENGR", "rektorluk"):  # ENGR.csv: OBS listesinde olmayan ENGR dersleri (isteğe bağlı)
        for r in read_csv(f"{source}.csv"):
            code = norm_code(r["code"])
            if source == "ENGR" and code in courses and courses[code]["sections"].keys() - {"ENGR"}:
                # OBS listesinde var: yalnızca saatsiz gelen şubelerin saatini doldur
                slot = {"d": DAYS[r["day"].strip().lower()[:3]], "s": fmt(to_min(r["start"])),
                        "e": fmt(to_min(r["end"])), "r": r.get("room", "").strip()}
                for secs in courses[code]["sections"].values():
                    for sec in secs:
                        if not sec["slots"]:
                            sec["slots"].append(slot)
                continue
            c = course(code, (r.get("name") or "").strip(), source, int(r["ects"]) if r.get("ects") else None)
            secs = c["sections"].setdefault(source, [])
            no = (r.get("section") or "").strip() or "1"
            sec = next((s for s in secs if s["no"] == no), None)
            if sec is None:
                sec = {"no": no, "instructor": "", "slots": []}
                secs.append(sec)
            if r.get("instructor", "").strip():
                sec["instructor"] = r["instructor"].strip()
            if r["day"].strip():
                sec["slots"].append({"d": DAYS[r["day"].strip().lower()[:3]], "s": fmt(to_min(r["start"])),
                                     "e": fmt(to_min(r["end"])), "r": r.get("room", "").strip()})

    # ---- Şubeleri düzleştir ----
    out = []
    for c in sorted(courses.values(), key=lambda c: c["code"]):
        sections = []
        for dept, secs in c["sections"].items():
            timed = [s for s in secs if s["slots"]]
            if timed:
                secs = timed  # saati olan şube varken saatsiz şubeleri alma
            for s in sorted(secs, key=lambda s: int(s["no"])):
                multi = len(secs) > 1
                label = f"Ş{s['no']}" if dept == "rektorluk" else dept + (f" Ş{s['no']}" if multi else "")
                sections.append({"id": f"{dept}-{s['no']}" if multi else dept, "label": label, "dept": dept,
                                 "instructor": s["instructor"], "slots": s["slots"]})
        c["sections"] = sections
        years = [p["year"] for p in c["programs"].values() if p["year"]]
        if c["category"] != "rektorluk":
            digit = re.search(r"\d", c["code"])
            c["year"] = min(years) if years else int(digit.group()) if digit else None
        out.append(c)

    programs = OrderedDict((code, {"name": name, "faculty": fac}) for code, name, fac in PROGRAMS.values())
    data = {"term": TERM, "programs": programs, "engrFaculty": ENGR_FACULTY, "courses": out}
    OUT.write_text("window.COURSE_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
    print(f"{len(out)} ders, {sum(len(c['sections']) for c in out)} şube, {len(rows)} OBS satırı -> {OUT.relative_to(ROOT)}")
    untimed = [c["code"] for c in out if not any(s["slots"] for s in c["sections"])]
    if untimed:
        print("Saati olmayan dersler:", ", ".join(untimed))


if __name__ == "__main__":
    main()
