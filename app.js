"use strict";

const DATA = window.COURSE_DATA;
const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];
const DAYS_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum"];
const CATEGORY_LABEL = { dept: "Seçmeli", engr: "ENGR", rektorluk: "Rektörlük", ortak: "Ortak" };
const DEFAULT_PROGRAM = "IE";
const COLORS = ["#a5c8ff", "#ffc9a3", "#b8e6b0", "#f3b3d6", "#d7c4ff", "#ffe08a", "#9fe3e0", "#f5b2a8", "#c9d99a", "#c7d0dc"];
const MAX_RESULTS = 20000;

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const isOnline = (slot) => /online|aybuzem|onl\./i.test(slot.r || "");
const $ = (id) => document.getElementById(id);

const courses = new Map(DATA.courses.map((c) => [c.code, c]));
const courseOfSection = new Map(DATA.courses.flatMap((c) => c.sections.map((s) => [s, c])));

// Grid range derived from the data, rounded to the half hour
let gridStart = Infinity, gridEnd = 0;
for (const c of DATA.courses) for (const s of c.sections) for (const sl of s.slots) {
  gridStart = Math.min(gridStart, toMin(sl.s));
  gridEnd = Math.max(gridEnd, toMin(sl.e));
}
gridStart = Math.floor(gridStart / 60) * 60 + (gridStart % 60 >= 30 ? 30 : 0);
gridEnd = Math.ceil((gridEnd - 30) / 60) * 60 + 30;

const state = {
  selected: [],          // [{ code, excluded: [sectionId, ...], clash: bool }]
  freeDays: [],
  blocked: [],           // ["day:minute"] hour cells the user wants kept free
  minStart: null,        // null = no limit
  maxEnd: null,
  ignoreOnline: true,
  sortBy: "freedays",
  program: DEFAULT_PROGRAM,  // student's department
  ownSections: true,         // for shared courses (MATH101...) only use the student's department section
};
let schedules = [];
let current = 0;

// ---------- persistence ----------
function save() {
  const json = JSON.stringify(state);
  try { localStorage.setItem("aybu-state", json); } catch (_) {}
  history.replaceState(null, "", "#" + btoa(unescape(encodeURIComponent(json))));
}
function load() {
  let raw = null;
  if (location.hash.length > 1) {
    try { raw = decodeURIComponent(escape(atob(location.hash.slice(1)))); } catch (_) {}
  }
  if (!raw) { try { raw = localStorage.getItem("aybu-state"); } catch (_) {} }
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    Object.assign(state, s);
    state.selected = state.selected.filter((x) => courses.has(x.code));
    state.blocked = state.blocked || [];
    if (!DATA.programs[state.program]) state.program = DEFAULT_PROGRAM;
    // Drop time limits that are no longer offered (e.g. saved when the grid started at 08:30)
    for (const k of ["minStart", "maxEnd"]) {
      const v = state[k];
      if (v != null && (v < gridStart || v > gridEnd || (v - gridStart) % 60)) state[k] = null;
    }
  } catch (_) {}
}

// Saved schedules live only in this browser
function loadFavs() {
  try { return JSON.parse(localStorage.getItem("aybu-favs")) || []; } catch (_) { return []; }
}
function storeFavs(favs) {
  try { localStorage.setItem("aybu-favs", JSON.stringify(favs)); } catch (_) {}
  renderFavs();
}

// ---------- program-relative course info ----------
const progInfo = (c) => c.programs[state.program];
const isRequired = (c) => !!progInfo(c)?.req;
const yearOf = (c) => progInfo(c)?.year ?? c.year;
const isOtherDept = (c) => !progInfo(c) && (c.category === "dept" || c.category === "ortak");
const deptsOf = (c) => [...new Set(c.sections.map((s) => s.dept))];
const facultyOf = (dept) => DATA.programs[dept]?.faculty;
const deptName = (dept) => DATA.programs[dept]?.name || dept;
// Departments that open the course (for ENGR courses this is what students want to know)
const offeredBy = (c) => deptsOf(c).filter((d) => DATA.programs[d]);
const myFaculty = () => facultyOf(state.program);

// Can a student of the selected program take this course at all?
function available(c) {
  if (c.category === "rektorluk" || progInfo(c)) return true;
  if (c.ownOnly) return false;                       // projects, internships, ENGR450: own department only
  if (c.category === "engr") return myFaculty() === DATA.engrFaculty;
  return c.sections.some((s) => facultyOf(s.dept) === myFaculty());
}

function typeLabel(c) {
  if (isRequired(c)) return "Zorunlu";
  if (isOtherDept(c)) return `Diğer bölüm (${deptsOf(c).join(", ")})`;
  return CATEGORY_LABEL[c.category];
}

// Sections the generator may use, before the user's own exclusions
function candidateSections(c) {
  let secs = c.sections.filter((s) => s.dept === "rektorluk" || s.dept === "ENGR" || facultyOf(s.dept) === myFaculty());
  if (c.ownOnly || (state.ownSections && secs.some((s) => s.dept === state.program))) {
    secs = secs.filter((s) => s.dept === state.program);
  }
  return secs;
}

// ---------- search / selection ----------
function matchesType(c, type) {
  if (type === "zorunlu") return isRequired(c);
  if (type === "secmeli") return !!progInfo(c) && !isRequired(c) && (c.category === "dept" || c.category === "ortak");
  if (type === "diger") return isOtherDept(c);
  if (type) return c.category === type;
  return true;
}

function typeTag(c) {
  const offer = c.category === "engr" && offeredBy(c).length
    ? `<span class="tag" title="${offeredBy(c).map(deptName).join(", ")}">${offeredBy(c).join(", ")}</span>` : "";
  if (isRequired(c)) return `<span class="tag req">Zorunlu</span>${offer}`;
  if (isOtherDept(c)) return `<span class="tag other">${deptsOf(c).join(", ")}</span>`;
  return `<span class="tag">${CATEGORY_LABEL[c.category]}</span>${offer}`;
}

// Own department first, then ENGR, rektörlük and other departments
function rank(c) {
  if (progInfo(c)) return 0;
  return { engr: 1, rektorluk: 2 }[c.category] ?? 3;
}

function initFilters() {
  $("freeDays").innerHTML = `<span class="small muted" style="width:100%">Boş olsun:</span>` +
    DAYS_SHORT.map((d, i) => `<label><input type="checkbox" value="${i}">${d}</label>`).join("");

  const opts = [];
  for (let m = gridStart; m <= gridEnd; m += 60) opts.push(m);
  const html = `<option value="">Sınır yok</option>` + opts.map((m) => `<option value="${m}">${fmt(m)}</option>`).join("");
  $("minStart").innerHTML = html;
  $("maxEnd").innerHTML = html;
}

function searchCourses() {
  const q = $("search").value.trim().toLocaleUpperCase("tr").replace(/\s+/g, "");
  const year = +$("yearFilter").value;
  const type = $("typeFilter").value;
  const list = DATA.courses.filter((c) => {
    if (!available(c)) return false;
    if (year && yearOf(c) !== year && type !== "rektorluk") return false;
    if (!matchesType(c, type)) return false;
    if (!q) return true;
    const norm = (t) => t.toLocaleUpperCase("tr").replace(/\s+/g, "");
    return c.code.includes(q) || norm(c.name).includes(q) || c.sections.some((s) => norm(s.instructor).includes(q));
  }).sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));

  $("results").innerHTML = list.map((c) => `
    <li data-code="${c.code}">
      <span><span class="code">${c.code}</span> ${c.name}</span>
      <span class="tags">${typeTag(c)}</span>
    </li>`).join("") || `<li class="muted">Sonuç yok</li>`;

  const btn = $("addRequired");
  const required = requiredFor(year);
  btn.hidden = !year || !required.length;
  btn.textContent = `${year}. sınıf zorunlu derslerini ekle (${required.length})`;
}

function requiredFor(year) {
  return DATA.courses.filter((c) => isRequired(c) && yearOf(c) === year && c.sections.length &&
    !state.selected.some((s) => s.code === c.code));
}

function addCourse(code) {
  if (state.selected.some((s) => s.code === code)) return;
  const c = courses.get(code);
  if (!available(c)) return;
  if (c.category === "rektorluk") {
    const other = state.selected.find((s) => courses.get(s.code).category === "rektorluk");
    if (other) { showWarn(`Rektörlük ortak dersinden en fazla 1 tane alınabilir (${other.code} zaten seçili).`); return; }
  }
  state.selected.push({ code, excluded: [] });
  update();
}

function showWarn(msg) {
  const w = $("warn");
  w.textContent = msg; w.hidden = !msg;
}

function colorOf(code) {
  return COLORS[state.selected.findIndex((s) => s.code === code) % COLORS.length];
}

function sectionLabel(s) {
  return s.label || s.id;
}

function slotText(sl) {
  return `${DAYS_SHORT[sl.d]} ${sl.s}-${sl.e}`;
}

function renderSelected() {
  const known = state.selected.map((s) => courses.get(s.code).ects).filter((x) => x != null);
  const unknown = state.selected.length - known.length;
  $("selCount").textContent = state.selected.length ? `(${state.selected.length})` : "";
  $("ects").textContent = state.selected.length
    ? `Toplam ${known.reduce((a, b) => a + b, 0)} AKTS${unknown ? ` (+${unknown} dersin AKTS'si bilinmiyor)` : ""}`
    : "";
  $("selected").innerHTML = state.selected.map((sel) => {
    const c = courses.get(sel.code);
    const cand = candidateSections(c);
    const secs = cand.length > 1 ? `<div class="secs">` + cand.map((s) => `
      <label title="${s.slots.map(slotText).join(", ")}${s.instructor ? " — " + s.instructor : ""}">
        <input type="checkbox" data-code="${c.code}" data-sec="${s.id}" ${sel.excluded.includes(s.id) ? "" : "checked"}>
        ${sectionLabel(s)}${s.instructor ? ` <span class="who">· ${s.instructor.split(" ").pop()}</span>` : ""}
      </label>`).join("") + `</div>` : "";
    return `<li style="border-color:${colorOf(c.code)}">
      <div class="head"><span><b>${c.code}</b> ${c.name}${c.category === "engr" && offeredBy(c).length
        ? ` <span class="small muted">· ${offeredBy(c).map(deptName).join(", ")}</span>` : ""}</span>
      <button class="rm" data-rm="${c.code}" aria-label="Kaldır">×</button></div>${secs}
      ${c.prereq?.length ? `<div class="small prereq">Ön koşul: ${c.prereq.join(", ")} dersini geçmiş olmalısın</div>` : ""}
      ${c.noClash ? `<span class="small muted clashbox">Çakışmadan muaf</span>` : `<label class="small muted clashbox">
        <input type="checkbox" data-clash="${c.code}" ${sel.clash ? "checked" : ""}> Çakışabilir</label>`}</li>`;
  }).join("");
}

// ---------- schedule generation ----------
function hitsBlocked(sl) {
  const s = toMin(sl.s), e = toMin(sl.e);
  return state.blocked.some((k) => {
    const [d, m] = k.split(":").map(Number);
    return d === sl.d && s < m + 60 && m < e;
  });
}

// Why a slot is filtered out, or null if it is allowed
function slotProblem(sl) {
  if (isOnline(sl) && state.ignoreOnline) return null;
  if (state.freeDays.includes(sl.d)) return `${DAYS[sl.d]} boş olsun filtresi`;
  if (state.minStart != null && toMin(sl.s) < state.minStart) return `en erken başlangıç ${fmt(state.minStart)}`;
  if (state.maxEnd != null && toMin(sl.e) > state.maxEnd) return `en geç bitiş ${fmt(state.maxEnd)}`;
  if (hitsBlocked(sl)) return `engellenen saat (${DAYS_SHORT[sl.d]} ${sl.s})`;
  return null;
}

function sectionUsable(sec) {
  return sec.slots.every((sl) => !slotProblem(sl));
}

function emptyReason(sel) {
  const c = courses.get(sel.code);
  const cand = candidateSections(c);
  if (!cand.length) return "bölümün için açılmış şubesi yok";
  const open = cand.filter((s) => !sel.excluded.includes(s.id));
  if (!open.length) return "tüm şubeleri hariç tutuldu";
  const reasons = new Set(open.map((s) => s.slots.map(slotProblem).find(Boolean)));
  return [...reasons].join(", ");
}

function countedSlots(sec) {
  return sec.slots.filter((sl) => !(state.ignoreOnline && isOnline(sl)));
}

function toIntervals(sec, sel) {
  if (sel.clash || courseOfSection.get(sec).noClash) return [];
  return countedSlots(sec).map((sl) => [sl.d, toMin(sl.s), toMin(sl.e)]);
}

function clashes(a, b) {
  for (const x of a) for (const y of b) if (x[0] === y[0] && x[1] < y[2] && y[1] < x[2]) return true;
  return false;
}

function generate() {
  const items = state.selected.map((sel) => {
    const c = courses.get(sel.code);
    const secs = candidateSections(c).filter((s) => !sel.excluded.includes(s.id) && sectionUsable(s))
      .map((s) => ({ course: c, sec: s, iv: toIntervals(s, sel) }));
    return { code: c.code, secs, sel };
  });

  const emptyItems = items.filter((i) => i.secs.length === 0);
  if (emptyItems.length) {
    return {
      list: [], empty: emptyItems.map((i) => i.code), pairs: [],
      reasons: emptyItems.map((i) => `${i.code}: ${emptyReason(i.sel)}`),
    };
  }

  items.sort((a, b) => a.secs.length - b.secs.length);
  const list = [];
  const chosen = [];
  (function bt(i) {
    if (list.length >= MAX_RESULTS) return;
    if (i === items.length) { list.push(chosen.slice()); return; }
    for (const opt of items[i].secs) {
      if (chosen.some((c) => clashes(c.iv, opt.iv))) continue;
      chosen.push(opt); bt(i + 1); chosen.pop();
    }
  })(0);

  // No result: name the course pairs that clash in every section combination
  const pairs = [];
  if (!list.length) {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (items[i].secs.every((a) => items[j].secs.every((b) => clashes(a.iv, b.iv)))) {
        pairs.push(`${items[i].code} – ${items[j].code}`);
      }
    }
  }
  return { list, empty: [], pairs, reasons: [] };
}

function score(sch) {
  const byDay = [[], [], [], [], []];
  for (const o of sch) for (const sl of countedSlots(o.sec)) byDay[sl.d].push([toMin(sl.s), toMin(sl.e)]);
  let freeDays = 0, gaps = 0, lastEnd = 0, firstStart = 0, minutes = 0, earliest = Infinity, latest = 0;
  for (const day of byDay) {
    if (!day.length) { freeDays++; continue; }
    day.sort((a, b) => a[0] - b[0]);
    // Gaps between the end of the busy period so far and the next class
    let busyEnd = day[0][1];
    for (let i = 1; i < day.length; i++) {
      gaps += Math.max(0, day[i][0] - busyEnd - 10);   // 10 min breaks are not gaps
      busyEnd = Math.max(busyEnd, day[i][1]);
    }
    for (const [s, e] of day) minutes += e - s + 10;   // a 50 min period counts as one hour
    lastEnd += busyEnd;
    firstStart += day[0][0];
    earliest = Math.min(earliest, day[0][0]);
    latest = Math.max(latest, busyEnd);
  }
  return { freeDays, gaps, lastEnd, firstStart, minutes, earliest, latest };
}

const avgStart = (k) => k.firstStart / Math.max(1, 5 - k.freeDays);

function sortSchedules() {
  const scored = schedules.map((s) => ({ s, k: score(s) }));
  const cmp = {
    freedays: (a, b) => b.k.freeDays - a.k.freeDays || a.k.gaps - b.k.gaps,
    gaps: (a, b) => a.k.gaps - b.k.gaps || b.k.freeDays - a.k.freeDays,
    early: (a, b) => a.k.lastEnd - b.k.lastEnd || a.k.gaps - b.k.gaps,
    late: (a, b) => avgStart(b.k) - avgStart(a.k) || a.k.gaps - b.k.gaps,
  }[state.sortBy];
  schedules = scored.sort(cmp).map((x) => x.s);
}

// ---------- grid ----------
function renderGrid() {
  const rows = (gridEnd - gridStart) / 60;
  let html = `<div class="hd"></div>` + DAYS.map((d, i) => `<div class="hd"><span class="full">${d}</span></div>`).join("");
  html += `<div>` + Array.from({ length: rows }, (_, i) => `<div class="tm">${fmt(gridStart + i * 60)}</div>`).join("") + `</div>`;

  const sch = schedules[current] || [];
  for (let d = 0; d < 5; d++) {
    html += `<div class="col">` + Array.from({ length: rows }, (_, i) => {
      const key = `${d}:${gridStart + i * 60}`;
      return `<div class="cell${state.blocked.includes(key) ? " blocked" : ""}" data-key="${key}"></div>`;
    }).join("");
    // Overlapping blocks (online or "çakışabilir" courses) share the column side by side
    const items = [];
    for (const o of sch) for (const sl of o.sec.slots) {
      if (sl.d === d) items.push({ o, sl, s: toMin(sl.s), e: toMin(sl.e) });
    }
    items.sort((a, b) => a.s - b.s || b.e - a.e);
    const laneEnds = [];
    for (const it of items) {
      it.lane = laneEnds.findIndex((end) => end <= it.s);
      if (it.lane === -1) it.lane = laneEnds.length;
      laneEnds[it.lane] = it.e;
    }
    for (const it of items) {
      const overlapping = items.filter((x) => x.s < it.e && it.s < x.e);
      it.lanes = Math.max(...overlapping.map((x) => x.lane)) + 1;
    }

    for (const { o, sl, s, e, lane, lanes } of items) {
      const top = (s - gridStart) / 60;
      const h = (e - s) / 60;
      const clash = lanes > 1;
      const pos = lanes > 1 ? `left:calc(${(lane / lanes) * 100}% + 1px);right:auto;width:calc(${100 / lanes}% - 2px);` : "";
      html += `<div class="blk${clash ? " clash" : ""}" data-code="${o.course.code}" data-sec="${o.sec.id}" style="${pos}top:calc(var(--row-h) * ${top});height:calc(var(--row-h) * ${h} - 2px);background:${colorOf(o.course.code)}"
        title="${o.course.code} ${o.course.name}\n${sectionLabel(o.sec)}${o.sec.instructor ? " — " + o.sec.instructor : ""}\n${sl.s}-${sl.e} ${sl.r || ""}">
        <b>${o.course.code}</b>${o.course.sections.length > 1 || o.course.category === "engr" ? sectionLabel(o.sec) + "<br>" : ""}${sl.r || ""}</div>`;
    }
    html += `</div>`;
  }
  $("grid").innerHTML = html;
  renderStats(sch);
  if (previewCode) drawPreview(previewCode);
  renderFits();

  const noSlot = sch.filter((o) => o.sec.slots.length === 0).map((o) => o.course.code);
  $("unscheduled").textContent = noSlot.length ? `Saati belli olmayan dersler: ${noSlot.join(", ")}` : "";
}

function renderCounter(empty) {
  const n = schedules.length;
  $("prev").disabled = current <= 0;
  $("next").disabled = current >= n - 1;
  if (!state.selected.length) $("counter").textContent = "Ders seç";
  else if (empty.length) $("counter").textContent = `${empty.join(", ")} için uygun şube yok`;
  else if (!n) $("counter").textContent = "Çakışmasız program yok";
  else $("counter").textContent = `${current + 1} / ${n}${n >= MAX_RESULTS ? "+" : ""}`;
}

let lastEmpty = [];
const undoStack = [];
let snapshot = null;

function update() {
  const now = JSON.stringify({ selected: state.selected, blocked: state.blocked, freeDays: state.freeDays,
    minStart: state.minStart, maxEnd: state.maxEnd, ignoreOnline: state.ignoreOnline,
    program: state.program, ownSections: state.ownSections });
  if (snapshot && snapshot !== now) {
    undoStack.push(snapshot);
    if (undoStack.length > 50) undoStack.shift();
  }
  snapshot = now;
  $("undo").disabled = !undoStack.length;
  save();
  renderSelected();
  searchCourses();
  const r = generate();
  schedules = r.list; lastEmpty = r.empty;
  $("clashInfo").textContent = r.reasons.length ? `Elenme sebebi — ${r.reasons.join("; ")}`
    : r.pairs.length ? `Her şubesi çakışan dersler: ${r.pairs.join(", ")}` : "";
  sortSchedules();
  current = 0;
  renderCounter(lastEmpty);
  renderGrid();
}

// ---------- events ----------
function bind() {
  $("search").addEventListener("input", searchCourses);
  $("yearFilter").addEventListener("change", searchCourses);
  $("typeFilter").addEventListener("change", searchCourses);
  $("addRequired").addEventListener("click", () => {
    for (const c of requiredFor(+$("yearFilter").value)) state.selected.push({ code: c.code, excluded: [] });
    update();
  });
  $("results").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-code]");
    if (li) addCourse(li.dataset.code);
  });
  $("selected").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { state.selected = state.selected.filter((s) => s.code !== rm.dataset.rm); showWarn(""); update(); }
  });
  $("selected").addEventListener("change", (e) => {
    const cb = e.target;
    if (cb.dataset.clash) {
      state.selected.find((s) => s.code === cb.dataset.clash).clash = cb.checked;
      update();
      return;
    }
    if (!cb.dataset.sec) return;
    const sel = state.selected.find((s) => s.code === cb.dataset.code);
    sel.excluded = cb.checked ? sel.excluded.filter((x) => x !== cb.dataset.sec) : [...sel.excluded, cb.dataset.sec];
    update();
  });
  $("freeDays").addEventListener("change", () => {
    state.freeDays = [...$("freeDays").querySelectorAll("input:checked")].map((i) => +i.value);
    update();
  });
  $("minStart").addEventListener("change", (e) => { state.minStart = e.target.value ? +e.target.value : null; update(); });
  $("maxEnd").addEventListener("change", (e) => { state.maxEnd = e.target.value ? +e.target.value : null; update(); });
  $("ignoreOnline").addEventListener("change", (e) => { state.ignoreOnline = e.target.checked; update(); });
  $("ownSections").addEventListener("change", (e) => { state.ownSections = e.target.checked; update(); });
  $("programSel").addEventListener("change", (e) => { state.program = e.target.value; update(); });
  $("sortBy").addEventListener("change", (e) => { state.sortBy = e.target.value; sortSchedules(); current = 0; renderCounter(lastEmpty); renderGrid(); save(); });
  $("prev").addEventListener("click", () => { if (current > 0) { current--; renderCounter(lastEmpty); renderGrid(); } });
  $("next").addEventListener("click", () => { if (current < schedules.length - 1) { current++; renderCounter(lastEmpty); renderGrid(); } });
  $("undo").addEventListener("click", undo);
  $("grid").addEventListener("click", (e) => {
    const blk = e.target.closest(".blk:not(.ghost)");
    if (blk) openDetail(blk.dataset.code, blk.dataset.sec);
  });
  $("closeDetail").addEventListener("click", () => $("detail").close());
  $("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });
  $("removeCourse").addEventListener("click", () => {
    state.selected = state.selected.filter((s) => s.code !== detailOf.code);
    $("detail").close();
    update();
  });
  $("lockSec").addEventListener("click", () => {
    const sel = state.selected.find((s) => s.code === detailOf.code);
    sel.excluded = candidateSections(courses.get(detailOf.code)).map((s) => s.id).filter((id) => id !== detailOf.sec);
    $("detail").close();
    update();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.matches("input[type=search], input[type=date]")) {
      e.preventDefault();
      undo();
      return;
    }
    if (e.target.matches("input, select")) return;
    if (e.key === "ArrowLeft") $("prev").click();
    if (e.key === "ArrowRight") $("next").click();
  });
  $("grid").addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    const k = cell.dataset.key;
    state.blocked = state.blocked.includes(k) ? state.blocked.filter((x) => x !== k) : [...state.blocked, k];
    update();
  });
  $("clearBlocked").addEventListener("click", () => { state.blocked = []; update(); });
  $("saveFav").addEventListener("click", () => {
    const sch = schedules[current];
    if (!sch) return;
    const favs = loadFavs();
    const picks = sch.map((o) => ({
      code: o.course.code, sec: o.sec.id,
      clash: !!state.selected.find((x) => x.code === o.course.code)?.clash,
    }));
    const same = favs.find((f) => JSON.stringify(f.picks) === JSON.stringify(picks));
    if (!same) favs.push({ name: `Program ${favs.length + 1}`, picks });
    storeFavs(favs);
    $("saveFav").textContent = same ? "Zaten kayıtlı" : "Kaydedildi";
    setTimeout(() => ($("saveFav").textContent = "Kaydet"), 1500);
  });
  $("favs").addEventListener("click", (e) => {
    const favs = loadFavs();
    const rm = e.target.closest("[data-rmfav]");
    if (rm) { favs.splice(+rm.dataset.rmfav, 1); storeFavs(favs); return; }
    const li = e.target.closest("[data-fav]");
    if (!li) return;
    state.selected = favs[+li.dataset.fav].picks.filter((p) => courses.has(p.code)).map((p) => ({
      code: p.code,
      excluded: courses.get(p.code).sections.map((s) => s.id).filter((id) => id !== p.sec),
      clash: !!p.clash,
    }));
    update();
  });
  $("png").addEventListener("click", downloadPng);
  $("print").addEventListener("click", () => window.print());
  $("icsBtn").addEventListener("click", downloadIcs);
  $("theme").addEventListener("click", () => {
    const order = ["auto", "light", "dark"];
    applyTheme(order[(order.indexOf(currentTheme()) + 1) % order.length]);
  });
  $("fits").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-code]");
    if (li) addCourse(li.dataset.code);
  });
  // Preview only for mouse users; on touch a tap adds the course directly
  $("results").addEventListener("mouseover", (e) => {
    const li = e.target.closest("li[data-code]");
    const code = li ? li.dataset.code : null;
    if (code !== previewCode) { previewCode = code; renderGrid(); }
  });
  $("results").addEventListener("mouseleave", () => { if (previewCode) { previewCode = null; renderGrid(); } });
  $("share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); $("share").textContent = "Kopyalandı"; }
    catch (_) { prompt("Linki kopyala:", location.href); }
    setTimeout(() => ($("share").textContent = "Linki kopyala"), 1500);
  });
}

function renderFavs() {
  const favs = loadFavs();
  $("favSection").hidden = !favs.length;
  $("favs").innerHTML = favs.map((f, i) => `
    <li data-fav="${i}"><span><b>${f.name}</b> <span class="muted small">${f.picks.map((p) => p.code).join(", ")}</span></span>
    <button class="rm" data-rmfav="${i}" aria-label="Sil">×</button></li>`).join("");
}

async function downloadPng() {
  if (!window.html2canvas || !schedules[current]) return;
  const grid = $("grid");
  const canvas = await html2canvas(grid, {
    scale: 2,
    width: grid.scrollWidth,
    windowWidth: Math.max(document.documentElement.clientWidth, grid.scrollWidth + 400),
    backgroundColor: getComputedStyle(document.querySelector(".main")).backgroundColor,
  });
  const a = document.createElement("a");
  a.download = "ders-programi.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
}

// ---------- undo / stats / detail ----------
function undo() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  Object.assign(state, JSON.parse(prev));
  snapshot = null;          // do not record the undo itself as a change
  syncControls();
  update();
  $("undo").disabled = !undoStack.length;
}

function renderStats(sch) {
  const k = sch && sch.length ? score(sch) : null;
  if (!k || !k.minutes) { $("stats").textContent = ""; return; }
  const h = (m) => (m / 60).toLocaleString("tr", { maximumFractionDigits: 1 });
  $("stats").textContent = [
    `Haftada ${h(k.minutes)} ders saati`,
    `${5 - k.freeDays} gün okulda`,
    `En erken ${fmt(k.earliest)}, en geç ${fmt(k.latest)}`,
    k.gaps ? `Toplam boşluk ${h(k.gaps)} saat` : "Arada boşluk yok",
  ].join(" · ");
}

let detailOf = null;
function openDetail(code, secId) {
  const c = courses.get(code);
  const sec = c.sections.find((s) => s.id === secId);
  detailOf = { code, sec: secId };
  const rows = [
    ["Tür", typeLabel(c)],
    offeredBy(c).length ? ["Açan bölüm", offeredBy(c).map(deptName).join(", ")] : null,
    DATA.programs[sec.dept] && offeredBy(c).length > 1 ? ["Bu şube", deptName(sec.dept)] : null,
    ["AKTS", c.ects ?? "bilinmiyor"],
    c.sections.length > 1 ? ["Şube", `${sectionLabel(sec)} (${c.sections.length} şubeden biri)`] : null,
    ["Hoca", sec.instructor || "belirtilmemiş"],
    ["Saatler", sec.slots.map((sl) => `${DAYS[sl.d]} ${sl.s}–${sl.e}${sl.r ? ` · ${sl.r}` : ""}`).join("<br>")],
    c.prereq?.length ? ["Ön koşul", c.prereq.join(", ")] : null,
    c.noClash ? ["Not", "Çakışma kontrolünden muaf"] : null,
  ].filter(Boolean);
  $("detailBody").innerHTML = `<h3>${c.code}</h3><div class="muted">${c.name}</div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const cand = candidateSections(c);
  const excluded = state.selected.find((s) => s.code === code).excluded;
  $("lockSec").hidden = cand.filter((s) => !excluded.includes(s.id)).length < 2;
  $("detail").showModal();
}

// ---------- preview / fits ----------
let previewCode = null;

function drawPreview(code) {
  if (state.selected.some((s) => s.code === code)) return;
  const c = courses.get(code);
  const cols = $("grid").querySelectorAll(".col");
  for (const sec of c.sections) for (const sl of sec.slots) {
    const el = document.createElement("div");
    el.className = "blk ghost";
    el.style.top = `calc(var(--row-h) * ${(toMin(sl.s) - gridStart) / 60})`;
    el.style.height = `calc(var(--row-h) * ${(toMin(sl.e) - toMin(sl.s)) / 60} - 2px)`;
    el.innerHTML = `<b>${c.code}</b>${c.sections.length > 1 ? sectionLabel(sec) : ""}`;
    cols[sl.d].appendChild(el);
  }
}

function renderFits() {
  const sch = schedules[current];
  $("fitsSection").hidden = !sch;
  if (!sch) return;
  const taken = sch.flatMap((o) => toIntervals(o.sec, state.selected.find((x) => x.code === o.course.code) || {}));
  const hasRektorluk = state.selected.some((s) => courses.get(s.code).category === "rektorluk");
  const list = DATA.courses.filter((c) => {
    if (state.selected.some((s) => s.code === c.code) || !c.sections.length || !available(c)) return false;
    if (hasRektorluk && c.category === "rektorluk") return false;
    return candidateSections(c).some((sec) => sectionUsable(sec) && !clashes(taken, toIntervals(sec, {})));
  });
  $("fits").innerHTML = list.map((c) => `
    <li data-code="${c.code}">
      <span><span class="code">${c.code}</span> ${c.name}</span>
      <span class="tags">${typeTag(c)}</span>
    </li>`).join("") || `<li class="muted">Sığan ders yok</li>`;
}

// ---------- calendar export ----------
function downloadIcs() {
  const sch = schedules[current];
  const start = $("icsStart").value, end = $("icsEnd").value;
  $("icsWarn").textContent = "";
  if (!sch) { $("icsWarn").textContent = "Önce bir program oluştur."; return; }
  if (!start || !end || end < start) { $("icsWarn").textContent = "Geçerli bir başlangıç ve bitiş tarihi seç."; return; }

  // Turkey is UTC+3 all year, so times are written in UTC
  const utc = (date, hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), h - 3, m));
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };
  const esc = (t) => String(t).replace(/[\\;,]/g, (x) => "\\" + x);
  const first = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  const until = utc(last, "23:59");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AYBU Program Yapici//TR", "CALSCALE:GREGORIAN"];
  let n = 0;
  for (const o of sch) for (const sl of o.sec.slots) {
    const day = new Date(first);
    day.setDate(day.getDate() + ((sl.d + 1 - day.getDay() + 7) % 7));
    if (day > last) continue;
    lines.push("BEGIN:VEVENT",
      `UID:${o.course.code}-${o.sec.id}-${sl.d}-${sl.s.replace(":", "")}-${n++}@aybu-program`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(day, sl.s)}`,
      `DTEND:${utc(day, sl.e)}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${until}`,
      `SUMMARY:${esc(`${o.course.code} ${o.course.name}`.trim())}`,
      `LOCATION:${esc(sl.r || "")}`,
      `DESCRIPTION:${esc([sectionLabel(o.sec), o.sec.instructor].filter(Boolean).join(" - "))}`,
      "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" }));
  a.download = "ders-programi.ics";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- theme ----------
function currentTheme() {
  try { return localStorage.getItem("aybu-theme") || "auto"; } catch (_) { return "auto"; }
}
function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem("aybu-theme", t); } catch (_) {}
  $("theme").textContent = `Tema: ${{ auto: "Otomatik", light: "Açık", dark: "Koyu" }[t]}`;
}

function syncControls() {
  $("minStart").value = state.minStart ?? "";
  $("maxEnd").value = state.maxEnd ?? "";
  $("ignoreOnline").checked = state.ignoreOnline;
  $("ownSections").checked = state.ownSections;
  $("programSel").value = state.program;
  $("sortBy").value = state.sortBy;
  for (const cb of $("freeDays").querySelectorAll("input")) cb.checked = state.freeDays.includes(+cb.value);
}

$("programSel").innerHTML = [...new Set(Object.values(DATA.programs).map((p) => p.faculty))].map((fac) =>
  `<optgroup label="${fac}">` + Object.entries(DATA.programs).filter(([, p]) => p.faculty === fac)
    .map(([code, p]) => `<option value="${code}">${p.name}</option>`).join("") + `</optgroup>`).join("");
$("term").textContent = DATA.term;
initFilters();
load();
syncControls();
bind();
applyTheme(currentTheme());
renderFavs();
update();
