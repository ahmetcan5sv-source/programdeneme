"use strict";

const DATA = window.COURSE_DATA;
const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];
const DAYS_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum"];
const CATEGORY_LABEL = { dept: "Seçmeli", engr: "ENGR", rektorluk: "Rektörlük", ortak: "Ortak" };
const COLORS = ["#a5c8ff", "#ffc9a3", "#b8e6b0", "#f3b3d6", "#d7c4ff", "#ffe08a", "#9fe3e0", "#f5b2a8", "#c9d99a", "#c7d0dc"];
const MAX_RESULTS = 20000;

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const isOnline = (slot) => /online|aybuzem|onl\./i.test(slot.r || "");
const $ = (id) => document.getElementById(id);

const courses = new Map(DATA.courses.map((c) => [c.code, c]));

// Grid range derived from the data, rounded to the half hour
let gridStart = Infinity, gridEnd = 0;
for (const c of DATA.courses) for (const s of c.sections) for (const sl of s.slots) {
  gridStart = Math.min(gridStart, toMin(sl.s));
  gridEnd = Math.max(gridEnd, toMin(sl.e));
}
gridStart = Math.floor(gridStart / 60) * 60 + (gridStart % 60 >= 30 ? 30 : 0);
gridEnd = Math.ceil((gridEnd - 30) / 60) * 60 + 30;

const state = {
  selected: [],          // [{ code, excluded: [sectionId, ...] }]
  freeDays: [],
  minStart: gridStart,
  maxEnd: gridEnd,
  ignoreOnline: true,
  sortBy: "freedays",
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
  } catch (_) {}
}

// ---------- search / selection ----------
function matchesType(c, type) {
  if (type === "zorunlu") return c.required;
  if (type === "secmeli") return !c.required && (c.category === "dept" || c.category === "ortak");
  if (type) return c.category === type;
  return true;
}

function typeTag(c) {
  if (c.required) return `<span class="tag req">Zorunlu</span>`;
  return `<span class="tag">${CATEGORY_LABEL[c.category]}</span>`;
}

function initFilters() {
  $("freeDays").innerHTML = `<span class="small muted" style="width:100%">Boş olsun:</span>` +
    DAYS_SHORT.map((d, i) => `<label><input type="checkbox" value="${i}">${d}</label>`).join("");

  const opts = [];
  for (let m = gridStart; m <= gridEnd; m += 60) opts.push(m);
  $("minStart").innerHTML = opts.map((m) => `<option value="${m}">${fmt(m)}</option>`).join("");
  $("maxEnd").innerHTML = opts.map((m) => `<option value="${m}">${fmt(m)}</option>`).join("");
}

function searchCourses() {
  const q = $("search").value.trim().toLocaleUpperCase("tr").replace(/\s+/g, "");
  const year = +$("yearFilter").value;
  const type = $("typeFilter").value;
  const list = DATA.courses.filter((c) => {
    if (year && c.year !== year) return false;
    if (!matchesType(c, type)) return false;
    if (!q) return true;
    return c.code.includes(q) || c.name.toLocaleUpperCase("tr").replace(/\s+/g, "").includes(q);
  });

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
  return DATA.courses.filter((c) => c.required && c.year === year && c.sections.length &&
    !state.selected.some((s) => s.code === c.code));
}

function addCourse(code) {
  if (state.selected.some((s) => s.code === code)) return;
  const c = courses.get(code);
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
  $("selCount").textContent = state.selected.length ? `(${state.selected.length})` : "";
  $("selected").innerHTML = state.selected.map((sel) => {
    const c = courses.get(sel.code);
    const secs = c.sections.length > 1 ? `<div class="secs">` + c.sections.map((s) => `
      <label title="${s.slots.map(slotText).join(", ")}${s.instructor ? " — " + s.instructor : ""}">
        <input type="checkbox" data-code="${c.code}" data-sec="${s.id}" ${sel.excluded.includes(s.id) ? "" : "checked"}>
        ${sectionLabel(s)}
      </label>`).join("") + `</div>` : "";
    return `<li style="border-color:${colorOf(c.code)}">
      <div class="head"><span><b>${c.code}</b> ${c.name}</span>
      <button class="rm" data-rm="${c.code}" aria-label="Kaldır">×</button></div>${secs}</li>`;
  }).join("");
}

// ---------- schedule generation ----------
function sectionUsable(sec) {
  return sec.slots.every((sl) => {
    if (isOnline(sl) && state.ignoreOnline) return true;
    return !state.freeDays.includes(sl.d) && toMin(sl.s) >= state.minStart && toMin(sl.e) <= state.maxEnd;
  });
}

function toIntervals(sec) {
  return sec.slots
    .filter((sl) => !(state.ignoreOnline && isOnline(sl)))
    .map((sl) => [sl.d, toMin(sl.s), toMin(sl.e)]);
}

function clashes(a, b) {
  for (const x of a) for (const y of b) if (x[0] === y[0] && x[1] < y[2] && y[1] < x[2]) return true;
  return false;
}

function generate() {
  const items = state.selected.map((sel) => {
    const c = courses.get(sel.code);
    const secs = c.sections.filter((s) => !sel.excluded.includes(s.id) && sectionUsable(s))
      .map((s) => ({ course: c, sec: s, iv: toIntervals(s) }));
    return { code: c.code, secs };
  });

  const empty = items.filter((i) => i.secs.length === 0).map((i) => i.code);
  if (empty.length) return { list: [], empty, pairs: [] };

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
  return { list, empty: [], pairs };
}

function score(sch) {
  const byDay = [[], [], [], [], []];
  for (const o of sch) for (const [d, s, e] of o.iv) byDay[d].push([s, e]);
  let freeDays = 0, gaps = 0, lastEnd = 0;
  for (const day of byDay) {
    if (!day.length) { freeDays++; continue; }
    day.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < day.length; i++) gaps += Math.max(0, day[i][0] - day[i - 1][1]);
    lastEnd += Math.max(...day.map((x) => x[1]));
  }
  return { freeDays, gaps, lastEnd };
}

function sortSchedules() {
  const scored = schedules.map((s) => ({ s, k: score(s) }));
  const cmp = {
    freedays: (a, b) => b.k.freeDays - a.k.freeDays || a.k.gaps - b.k.gaps,
    gaps: (a, b) => a.k.gaps - b.k.gaps || b.k.freeDays - a.k.freeDays,
    early: (a, b) => a.k.lastEnd - b.k.lastEnd || a.k.gaps - b.k.gaps,
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
    html += `<div class="col">` + `<div class="cell"></div>`.repeat(rows);
    for (const o of sch) for (const sl of o.sec.slots) {
      if (sl.d !== d) continue;
      const top = (toMin(sl.s) - gridStart) / 60;
      const h = (toMin(sl.e) - toMin(sl.s)) / 60;
      const clash = isOnline(sl) && sch.some((p) => p !== o && p.sec.slots.some((q) =>
        q.d === d && toMin(q.s) < toMin(sl.e) && toMin(sl.s) < toMin(q.e)));
      html += `<div class="blk${clash ? " clash" : ""}" style="top:calc(var(--row-h) * ${top});height:calc(var(--row-h) * ${h} - 2px);background:${colorOf(o.course.code)}"
        title="${o.course.code} ${o.course.name}\n${sectionLabel(o.sec)}${o.sec.instructor ? " — " + o.sec.instructor : ""}\n${sl.s}-${sl.e} ${sl.r || ""}">
        <b>${o.course.code}</b>${o.course.sections.length > 1 ? sectionLabel(o.sec) + "<br>" : ""}${sl.r || ""}</div>`;
    }
    html += `</div>`;
  }
  $("grid").innerHTML = html;

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
function update() {
  save();
  renderSelected();
  searchCourses();
  const r = generate();
  schedules = r.list; lastEmpty = r.empty;
  $("clashInfo").textContent = r.pairs.length ? `Her şubesi çakışan dersler: ${r.pairs.join(", ")}` : "";
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
    if (!cb.dataset.sec) return;
    const sel = state.selected.find((s) => s.code === cb.dataset.code);
    sel.excluded = cb.checked ? sel.excluded.filter((x) => x !== cb.dataset.sec) : [...sel.excluded, cb.dataset.sec];
    update();
  });
  $("freeDays").addEventListener("change", () => {
    state.freeDays = [...$("freeDays").querySelectorAll("input:checked")].map((i) => +i.value);
    update();
  });
  $("minStart").addEventListener("change", (e) => { state.minStart = +e.target.value; update(); });
  $("maxEnd").addEventListener("change", (e) => { state.maxEnd = +e.target.value; update(); });
  $("ignoreOnline").addEventListener("change", (e) => { state.ignoreOnline = e.target.checked; update(); });
  $("sortBy").addEventListener("change", (e) => { state.sortBy = e.target.value; sortSchedules(); current = 0; renderCounter(lastEmpty); renderGrid(); save(); });
  $("prev").addEventListener("click", () => { if (current > 0) { current--; renderCounter(lastEmpty); renderGrid(); } });
  $("next").addEventListener("click", () => { if (current < schedules.length - 1) { current++; renderCounter(lastEmpty); renderGrid(); } });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select")) return;
    if (e.key === "ArrowLeft") $("prev").click();
    if (e.key === "ArrowRight") $("next").click();
  });
  $("share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); $("share").textContent = "Kopyalandı"; }
    catch (_) { prompt("Linki kopyala:", location.href); }
    setTimeout(() => ($("share").textContent = "Linki kopyala"), 1500);
  });
}

function syncControls() {
  $("minStart").value = state.minStart;
  $("maxEnd").value = state.maxEnd;
  $("ignoreOnline").checked = state.ignoreOnline;
  $("sortBy").value = state.sortBy;
  for (const cb of $("freeDays").querySelectorAll("input")) cb.checked = state.freeDays.includes(+cb.value);
}

$("program").textContent = DATA.program.name;
$("term").textContent = DATA.term;
initFilters();
load();
syncControls();
bind();
update();
