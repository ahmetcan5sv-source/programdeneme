"""data/src/*.csv dosyalarını data/courses.js dosyasına derler.

Her CSV bir bölümün programıdır (dosya adı = bölüm kodu). Her satır bir ders bloğudur:
    code,section,year,day,start,end,room,instructor
Aynı ders kodu farklı bölümlerde açıldıysa her biri ayrı şube olur.
rektorluk.csv içindeki dersler "Rektörlük ortak dersi" kategorisine girer.

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
DEPARTMENTS = OrderedDict([
    ("CENG", "Bilgisayar Mühendisliği"),
    ("EE", "Elektrik-Elektronik Mühendisliği"),
    ("IE", "Endüstri Mühendisliği"),
    ("ESE", "Enerji Sistemleri Mühendisliği"),
    ("CE", "İnşaat Mühendisliği"),
    ("MCE", "Makine Mühendisliği"),
    ("MATH", "Matematik"),
    ("MSE", "Metalurji ve Malzeme Mühendisliği"),
    ("SENG", "Yazılım Mühendisliği"),
])
DAYS = {"pzt": 0, "sal": 1, "çar": 2, "car": 2, "per": 3, "cum": 4}
COMMON = re.compile(r"^(TDL|TIT|ENG10[1-4])")
ALIASES = {"TT101": "TIT101", "TT102": "TIT102"}


def norm_code(code):
    code = code.strip().upper().replace(" ", "").replace("İ", "I")
    return ALIASES.get(code, code)


def norm_time(t):
    h, m = re.split(r"[:.]", t.strip())
    return f"{int(h):02d}:{int(m):02d}"


def category(code, dept):
    if dept == "rektorluk":
        return "rektorluk"
    if code.startswith("ENGR"):
        return "engr"
    if COMMON.match(code):
        return "ortak"
    return "dept"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    names = {}
    with open(SRC / "names.csv", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            names[norm_code(row["code"])] = row["name"].strip()

    courses = OrderedDict()
    for path in sorted(SRC.glob("*.csv")):
        dept = path.stem
        if dept == "names":
            continue
        with open(path, encoding="utf-8-sig") as f:
            for n, row in enumerate(csv.DictReader(f), start=2):
                code = norm_code(row["code"])
                if not code:
                    continue
                c = courses.setdefault(code, {
                    "code": code,
                    "name": names.get(code, ""),
                    "category": category(code, dept),
                    "sections": OrderedDict(),
                })
                sec_no = (row.get("section") or "").strip()
                sec_id = dept + (f"-{sec_no}" if sec_no else "")
                label = ("Rektörlük" if dept == "rektorluk" else dept) + (f" Ş{sec_no}" if sec_no else "")
                sec = c["sections"].setdefault(sec_id, {
                    "id": sec_id, "label": label, "dept": dept,
                    "instructor": "", "slots": [],
                })
                if row.get("instructor", "").strip():
                    sec["instructor"] = row["instructor"].strip()
                if not row["day"].strip():
                    continue  # saati belli olmayan ders
                day = DAYS.get(row["day"].strip().lower()[:3])
                if day is None:
                    raise SystemExit(f"{path.name}:{n} bilinmeyen gün: {row['day']}")
                s, e = norm_time(row["start"]), norm_time(row["end"])
                if s >= e:
                    raise SystemExit(f"{path.name}:{n} başlangıç bitişten sonra: {s}-{e}")
                sec["slots"].append({"d": day, "s": s, "e": e, "r": row.get("room", "").strip()})

    out = []
    for c in sorted(courses.values(), key=lambda c: c["code"]):
        c["sections"] = list(c["sections"].values())
        out.append(c)
    missing = [c["code"] for c in out if not c["name"]]
    data = {"term": TERM, "departments": DEPARTMENTS, "courses": out}
    OUT.write_text("window.COURSE_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
    print(f"{len(out)} ders, {sum(len(c['sections']) for c in out)} şube -> {OUT.relative_to(ROOT)}")
    if missing:
        print("Adı eksik:", ", ".join(missing))


if __name__ == "__main__":
    main()
