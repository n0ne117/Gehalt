/* Gehalt – salary tracker (migration of Gehalt.xlsx)
 *
 * The server stores only raw values (12 Brutto + 12 Netto months, the KV rate,
 * and the raise month). Every derived column – Total, year-over-year difference,
 * and the "Gehaltserhöhung" (€ / % / % KV) block – is computed here, mirroring
 * the original spreadsheet's formulas:
 *   Total (Brutto/Netto) = SUM(months)
 *   Ø pro Monat          = Netto-Total / 12
 *   Δ Vorjahr            = this year's Total − previous year's Total (same row)
 *   Erhöhung €           = value(raiseMonth) − value(raiseMonth − 1)
 *                          (raise in Jänner: compared with last December)
 *   Erhöhung %           = Erhöhung €(Brutto) / Brutto(raiseMonth − 1)
 */

const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONTHS_SHORT = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// "Today" – used to gently highlight the current year and month.
const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1; // 1..12

let dataset = { schemaVersion: 1, months: MONTHS.slice(), years: [] };

// --------------------------------------------------------------------------- //
// Formatting helpers (Austrian / German conventions)
// --------------------------------------------------------------------------- //
const eur = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
const pct = new Intl.NumberFormat("de-AT", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec2 = new Intl.NumberFormat("de-AT", { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtEuro(v) { return v == null ? "–" : eur.format(v); }
function fmtPct(v) { return v == null ? "–" : pct.format(v); }

// Format a stored number for display inside an editable input: comma decimal,
// no thousands separator, empty for null.
function fmtInput(v) { return v == null ? "" : dec2.format(v); }

// Parse user input into a number (or null). Accepts both German ("1.234,56")
// and plain ("1234.56" / "1234,56") notation.
function parseNum(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === "") return null;
  s = s.replace(/\s|€/g, "");
  const hasDot = s.includes("."), hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // Both present -> dot is thousands separator, comma is decimal.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// --------------------------------------------------------------------------- //
// Derived-value computations
// --------------------------------------------------------------------------- //
function sum(arr) {
  return arr.reduce((a, x) => a + (typeof x === "number" ? x : 0), 0);
}
function bruttoTotal(y) { return sum(y.brutto); }
function nettoTotal(y) { return sum(y.netto); }
function avgMonth(y) { return nettoTotal(y) / 12; }

// Value just before the raise month. For a raise in Jänner that is the
// previous year's December.
function beforeRaise(idx, row) {
  const y = dataset.years[idx], i = y.raiseMonth - 1;
  if (i > 0) return y[row][i - 1];
  const prev = prevYear(idx);
  return prev && prev.year === y.year - 1 ? prev[row][11] : null;
}

// Raise = value in the raise month minus the value in the preceding month.
function raiseEuro(idx, row) {
  const cur = dataset.years[idx][row][dataset.years[idx].raiseMonth - 1];
  const before = beforeRaise(idx, row);
  if (typeof cur !== "number" || typeof before !== "number") return null;
  return cur - before;
}
function raisePct(idx) {
  const before = beforeRaise(idx, "brutto");
  const r = raiseEuro(idx, "brutto");
  if (r == null || typeof before !== "number" || before === 0) return null;
  return r / before;
}

// Previous year's row (dataset is kept sorted by year).
function prevYear(idx) { return idx > 0 ? dataset.years[idx - 1] : null; }

// All computed values for one year, keyed by the data-k attribute of the cell
// that shows them.
function derived(idx) {
  const y = dataset.years[idx], prev = prevYear(idx);
  const bt = bruttoTotal(y), nt = nettoTotal(y), av = avgMonth(y);
  return {
    bt, nt, av,
    dbt: prev ? bt - bruttoTotal(prev) : null,
    dnt: prev ? nt - nettoTotal(prev) : null,
    dav: prev ? av - avgMonth(prev) : null,
    reb: raiseEuro(idx, "brutto"),
    ren: raiseEuro(idx, "netto"),
    rpct: raisePct(idx),
  };
}

// --------------------------------------------------------------------------- //
// Rendering
// --------------------------------------------------------------------------- //
function buildHead() {
  const head = document.getElementById("gridHead");
  const cells = [];
  cells.push(`<th class="col-year sticky-col-1">Jahr</th>`);
  cells.push(`<th class="col-type sticky-col-2">Typ</th>`);
  for (let m = 0; m < 12; m++) {
    const cur = m + 1 === CUR_MONTH ? " col-month-current" : "";
    cells.push(`<th class="col-month${cur}" title="${MONTHS[m]}">${MONTHS_SHORT[m]}</th>`);
  }
  cells.push(`<th class="col-total">Total</th>`);
  cells.push(`<th class="col-diff">Δ Vorjahr</th>`);
  cells.push(`<th class="col-raise raise-sep">Erhöhung €</th>`);
  cells.push(`<th class="col-raise">Erhöhung %</th>`);
  cells.push(`<th class="col-raise">% KV</th>`);
  cells.push(`<th class="col-actions"></th>`);
  head.innerHTML = `<tr>${cells.join("")}</tr>`;
}

function monthInput(yearIdx, rowType, m, value) {
  return `<input class="cell-input" type="text" inputmode="decimal"
    data-year="${yearIdx}" data-row="${rowType}" data-month="${m}"
    value="${fmtInput(value)}" aria-label="${rowType} ${MONTHS[m]}" />`;
}

function buildBody() {
  const body = document.getElementById("gridBody");
  body.innerHTML = "";
  document.getElementById("emptyHint").hidden = dataset.years.length > 0;

  dataset.years.forEach((y, idx) => {
    const d = derived(idx);
    const raiseOn = y.kv != null;
    const isCurrent = y.year === CUR_YEAR;
    const cur = (m) => (isCurrent && m + 1 === CUR_MONTH) ? " cell-current-month" : "";

    // ---- Brutto row ----
    const brutto = document.createElement("tr");
    brutto.className = "row-brutto year-start" + (isCurrent ? " is-current-year" : "");
    let c = [];
    c.push(`<td class="col-year sticky-col-1" rowspan="3">${y.year}</td>`);
    c.push(`<td class="col-type sticky-col-2">Brutto</td>`);
    for (let m = 0; m < 12; m++) c.push(`<td class="col-month${cur(m)}">${monthInput(idx, "brutto", m, y.brutto[m])}</td>`);
    c.push(calcCell(idx, "bt", "col-total num", fmtEuro(d.bt)));
    c.push(diffCell(idx, "dbt", d.dbt));
    if (raiseOn) {
      c.push(calcCell(idx, "reb", "col-raise raise-sep num", fmtEuro(d.reb)));
      c.push(calcCell(idx, "rpct", "col-raise num", fmtPct(d.rpct)));
      c.push(`<td class="col-raise"><input class="cell-input kv-input" type="text" inputmode="decimal"
        data-year="${idx}" data-field="kv" value="${y.kv == null ? "" : dec2.format(y.kv * 100)}" aria-label="KV %" /></td>`);
    } else {
      c.push(`<td class="col-raise raise-sep"><button class="btn-link add-raise" data-year="${idx}" type="button">+ Erhöhung</button></td>`);
      c.push(`<td class="col-raise"></td>`);
      c.push(`<td class="col-raise"></td>`);
    }
    c.push(`<td class="col-actions" rowspan="3"><button class="btn-icon del-year" data-year="${idx}" title="Jahr löschen" type="button">✕</button></td>`);
    brutto.innerHTML = c.join("");
    body.appendChild(brutto);

    // ---- Netto row ----
    const netto = document.createElement("tr");
    netto.className = "row-netto" + (isCurrent ? " is-current-year" : "");
    c = [];
    c.push(`<td class="col-type sticky-col-2">Netto</td>`);
    for (let m = 0; m < 12; m++) c.push(`<td class="col-month${cur(m)}">${monthInput(idx, "netto", m, y.netto[m])}</td>`);
    c.push(calcCell(idx, "nt", "col-total num", fmtEuro(d.nt)));
    c.push(diffCell(idx, "dnt", d.dnt));
    if (raiseOn) {
      c.push(calcCell(idx, "ren", "col-raise raise-sep num", fmtEuro(d.ren)));
      c.push(`<td class="col-raise"></td>`);
      c.push(`<td class="col-raise"></td>`);
    } else {
      c.push(`<td class="col-raise raise-sep"></td><td class="col-raise"></td><td class="col-raise"></td>`);
    }
    netto.innerHTML = c.join("");
    body.appendChild(netto);

    // ---- Ø pro Monat row ----
    const avg = document.createElement("tr");
    avg.className = "row-avg" + (isCurrent ? " is-current-year" : "");
    c = [];
    c.push(`<td class="col-type sticky-col-2">Ø pro Monat</td>`);
    c.push(`<td class="col-month" colspan="12"></td>`);
    c.push(calcCell(idx, "av", "col-total num", fmtEuro(d.av)));
    c.push(diffCell(idx, "dav", d.dav));
    if (raiseOn) {
      c.push(`<td class="col-raise raise-sep raise-month" colspan="3">Erhöhung ab: ${monthSelect(idx, y.raiseMonth)}
        <button class="btn-link remove-raise" data-year="${idx}" type="button" title="Erhöhung entfernen">entfernen</button></td>`);
    } else {
      c.push(`<td class="col-raise raise-sep" colspan="3"></td>`);
    }
    avg.innerHTML = c.join("");
    body.appendChild(avg);
  });
}

function calcCell(idx, key, cls, text) {
  return `<td class="${cls}" data-y="${idx}" data-k="${key}">${text}</td>`;
}

function diffClass(v) {
  return "col-diff num " + (v == null ? "diff-none" : v >= 0 ? "diff-up" : "diff-down");
}
function fmtDiff(v) {
  if (v == null) return "–";
  return `${v >= 0 ? "+" : "−"} ${eur.format(Math.abs(v))}`;
}
function diffCell(idx, key, v) {
  return calcCell(idx, key, diffClass(v), fmtDiff(v));
}

// Refresh only the computed cells. Inputs stay in the DOM, so focus, Tab
// navigation and clicks on neighbouring buttons are not disturbed by edits.
function updateDerived() {
  const cache = {};
  document.querySelectorAll("#gridBody [data-k]").forEach((el) => {
    const idx = +el.dataset.y, key = el.dataset.k;
    const v = (cache[idx] ||= derived(idx))[key];
    if (key.startsWith("d")) {
      el.className = diffClass(v);
      el.textContent = fmtDiff(v);
    } else {
      el.textContent = key === "rpct" ? fmtPct(v) : fmtEuro(v);
    }
  });
}

function monthSelect(yearIdx, selected) {
  const opts = MONTHS.map((name, i) =>
    `<option value="${i + 1}" ${i + 1 === selected ? "selected" : ""}>${name}</option>`).join("");
  return `<select class="raise-month-select" data-year="${yearIdx}" data-field="raiseMonth">${opts}</select>`;
}

function render() {
  buildHead();
  buildBody();
}

// --------------------------------------------------------------------------- //
// Editing + persistence
// --------------------------------------------------------------------------- //
let saveTimer = null;
let saving = null;      // promise of the PUT currently in flight
let dirty = false;      // local edits not yet sent to the server
let readOnly = false;   // set when loading failed – never overwrite server data then

function setStatus(state, text) {
  const el = document.getElementById("saveStatus");
  el.dataset.state = state;
  el.textContent = text;
}

function scheduleSave() {
  if (readOnly) return;
  dirty = true;
  setStatus("dirty", "Ungespeichert…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

// Saves run strictly one after another so an older request can never land
// after a newer one. Edits made while a save is in flight are picked up by the
// next round of the loop.
async function save() {
  clearTimeout(saveTimer);
  if (saving) return saving;
  saving = (async () => {
    while (dirty) {
      dirty = false;
      setStatus("saving", "Speichern…");
      try {
        const res = await fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dataset),
        });
        if (!res.ok) throw new Error(await res.text());
      } catch (err) {
        dirty = true;
        setStatus("error", "Fehler beim Speichern");
        toast("Speichern fehlgeschlagen: " + err.message);
        return;
      }
    }
    setStatus("saved", "Gespeichert ✓");
  })().finally(() => { saving = null; });
  return saving;
}

// Event delegation for all inputs / buttons.
function wireEvents() {
  const body = document.getElementById("gridBody");

  // Month value + KV edits: parse on change (blur / Enter).
  body.addEventListener("change", (e) => {
    const t = e.target;
    if (t.classList.contains("cell-input") && t.dataset.row) {
      const y = dataset.years[+t.dataset.year];
      const val = parseNum(t.value);
      y[t.dataset.row][+t.dataset.month] = val;
      t.value = fmtInput(val);
      updateAndSave();
    } else if (t.dataset.field === "kv") {
      const y = dataset.years[+t.dataset.year];
      const p = parseNum(t.value);
      y.kv = p == null ? 0 : p / 100;
      t.value = dec2.format(y.kv * 100);
      updateAndSave();
    } else if (t.dataset.field === "raiseMonth") {
      const y = dataset.years[+t.dataset.year];
      y.raiseMonth = +t.value;
      updateAndSave();
    }
  });

  // Enter commits the value (like leaving a spreadsheet cell).
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const t = e.target;
    if (t.classList && t.classList.contains("cell-input") && t.dataset.row) {
      e.preventDefault();
      t.blur();
    }
  });

  body.addEventListener("click", (e) => {
    const t = e.target;
    if (t.classList.contains("del-year")) {
      const idx = +t.dataset.year;
      if (confirm(`Jahr ${dataset.years[idx].year} wirklich löschen?`)) {
        dataset.years.splice(idx, 1);
        recomputeAndSave();
      }
    } else if (t.classList.contains("add-raise")) {
      dataset.years[+t.dataset.year].kv = 0;
      recomputeAndSave();
    } else if (t.classList.contains("remove-raise")) {
      dataset.years[+t.dataset.year].kv = null;
      recomputeAndSave();
    }
  });

  document.getElementById("addYearBtn").addEventListener("click", addYear);
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);

  // Flush pending edits when the tab is hidden and warn before losing them.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty) save();
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty || saving) e.preventDefault();
  });
}

// --------------------------------------------------------------------------- //
// Theme (light / dark)
// --------------------------------------------------------------------------- //
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("gehalt-theme", theme); } catch (_) { /* private mode */ }
  const btn = document.getElementById("themeToggle");
  // Icon shows the mode you'd switch TO.
  btn.textContent = theme === "dark" ? "☀︎" : "☾";
  btn.setAttribute("aria-label", theme === "dark" ? "Zu hellem Modus wechseln" : "Zu dunklem Modus wechseln");
}
function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}

// Structural change (year added/removed, raise block toggled): rebuild table.
function recomputeAndSave() {
  render();
  scheduleSave();
}

// Value change: refresh computed cells only.
function updateAndSave() {
  updateDerived();
  scheduleSave();
}

function addYear() {
  if (readOnly) return;
  const last = dataset.years[dataset.years.length - 1];
  const nextYear = last ? last.year + 1 : new Date().getFullYear();
  dataset.years.push({
    year: nextYear,
    brutto: Array(12).fill(null),
    netto: Array(12).fill(null),
    kv: null,
    raiseMonth: 7,
  });
  recomputeAndSave();
  // Scroll the new year into view and focus its first month.
  const rows = document.querySelectorAll("#gridBody tr.year-start");
  const el = rows[rows.length - 1];
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

// --------------------------------------------------------------------------- //
// Boot
// --------------------------------------------------------------------------- //
async function boot() {
  try {
    const res = await fetch("/api/data");
    if (!res.ok) throw new Error(await res.text());
    dataset = await res.json();
    if (!Array.isArray(dataset.years)) dataset.years = [];
  } catch (err) {
    // Editing an empty dataset would overwrite everything on the server with
    // the next save, so stay read-only until the page is reloaded.
    readOnly = true;
    toast("Daten konnten nicht geladen werden: " + err.message);
  }
  render();
  wireEvents();
  applyTheme(currentTheme()); // sets the toggle icon to match the pre-set theme
  if (readOnly) {
    setStatus("error", "Nicht geladen – bitte neu laden");
    document.getElementById("addYearBtn").disabled = true;
    document.getElementById("gridBody").inert = true;
  } else {
    setStatus("idle", "Bereit");
  }
}

boot();
