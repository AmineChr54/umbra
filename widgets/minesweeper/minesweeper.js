// Minesweeper UI. Rules live in engine.js (MinesEngine). Saved in umbra.store:
//   "game"  { diff, g, elapsed }  the board in progress (or just finished) and its clock
//   "stats" { beginner: { plays, wins, best }, ... }  best is the fastest win in ms
const E = MinesEngine;
const q = (id) => document.getElementById(id);
const app = q("app"), board = q("board"), field = q("field");

const LEVELS = {
  beginner: "Beginner · 9×9",
  intermediate: "Intermediate · 16×16",
  expert: "Expert · 30×16",
};
const FLAG = '<svg viewBox="0 0 16 16"><path class="cloth" d="M5 2.2l7 3.4-7 3.4z"/><path class="pole" d="M5 2v11M2.6 13.4h5.6"/></svg>';
const MINE = '<svg viewBox="0 0 16 16"><path class="spike" d="M8 1v14M1 8h14M3.2 3.2l9.6 9.6M12.8 3.2l-9.6 9.6"/><circle class="bomb" cx="8" cy="8" r="4.6"/><circle class="shine" cx="6.5" cy="6.5" r="1.2"/></svg>';
const WRONG = MINE.replace("</svg>", '<path class="cross" d="M2 2l12 12M14 2L2 14"/></svg>');

let g = null, diff = "beginner", marks = true;
let base = 0, anchor = 0, clockTimer = null; // clock = base + time since anchor
let stats = {};
let cells = [], shown = [], held = false;

const optDiff = () => (LEVELS[umbra.options.difficulty] ? umbra.options.difficulty : "beginner");
const optMarks = () => umbra.options.marks !== false;
const elapsed = () => base + (anchor ? Date.now() - anchor : 0);
const pad = (n, w) => String(n).padStart(w, "0");
const fmtMs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const rec = (d) => (stats[d] = stats[d] || { plays: 0, wins: 0, best: null });

const persist = () => {
  umbra.store.set("game", { diff, g, elapsed: Math.round(elapsed()) }).catch(() => {});
};
const persistStats = () => { umbra.store.set("stats", stats).catch(() => {}); };

function startClock() {
  if (anchor || g.status !== "playing") return;
  anchor = Date.now();
  clockTimer = setInterval(drawClock, 250);
}
function stopClock() {
  base = elapsed();
  anchor = 0;
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

function drawClock() {
  const s = Math.min(999, Math.floor(elapsed() / 1000));
  const t = pad(s, 3);
  if (q("clock").textContent !== t) q("clock").textContent = t;
}

function buildBoard() {
  const w = field.clientWidth || 300, h = field.clientHeight || 280;
  const cell = Math.max(8, Math.floor(Math.min(w / g.cols, h / g.rows)));
  board.style.setProperty("--cell", cell + "px");
  board.style.setProperty("--fs", Math.max(11, Math.round(cell * 0.58)) + "px");
  board.style.gridTemplateColumns = `repeat(${g.cols}, ${cell}px)`;
  board.textContent = "";
  cells = []; shown = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < g.cols * g.rows; i++) {
    const d = document.createElement("div");
    d.dataset.i = String(i);
    cells.push(d); shown.push("");
    frag.appendChild(d);
  }
  board.appendChild(frag);
}

function drawCell(i) {
  const v = E.cellView(g, i);
  if (shown[i] === v) return;
  shown[i] = v;
  const d = cells[i];
  d.className = "c " + v;
  if (v === "flag") d.innerHTML = FLAG;
  else if (v === "mine" || v === "boom") d.innerHTML = MINE;
  else if (v === "wrong") d.innerHTML = WRONG;
  else if (v === "mark") d.textContent = "?";
  else if (v[0] === "n" && v !== "n0") d.textContent = v.slice(1);
  else d.textContent = "";
}

function render() {
  for (let i = 0; i < cells.length; i++) drawCell(i);
  const left = E.minesLeft(g);
  q("mines").textContent = left < 0 ? "-" + pad(Math.min(99, -left), 2) : pad(Math.min(999, left), 3);
  drawClock();
  app.dataset.face = held && g.status !== "won" && g.status !== "lost" ? "oh" : g.status === "won" ? "won" : g.status === "lost" ? "lost" : "smile";
  const lv = q("level");
  lv.textContent = LEVELS[diff] + (g.status === "won" ? " · Cleared" : g.status === "lost" ? " · Boom" : "");
  lv.className = "level" + (g.status === "won" || g.status === "lost" ? " " + g.status : "");
  const r = rec(diff);
  q("best").textContent = r.best ? `Best ${fmtMs(r.best)}` : "Best --";
  q("record").textContent = `Won ${r.wins} of ${r.plays}`;
}

function newGame() {
  stopClock();
  base = 0;
  g = E.createLevel(diff);
  buildBoard();
  render();
  persist();
}

function finish() {
  stopClock();
  const r = rec(diff);
  r.plays++;
  if (g.status === "won") {
    r.wins++;
    if (!r.best || base < r.best) r.best = Math.max(1, Math.round(base));
  }
  persistStats();
}

// Run one rules action, then do the bookkeeping that follows any move.
function act(fn) {
  const before = g.status;
  if (!fn()) return;
  if (before !== "playing" && g.status === "playing") startClock();
  if (before === "playing" && (g.status === "won" || g.status === "lost")) finish();
  render();
  persist();
}

const cellOf = (e) => {
  const c = e.target.closest ? e.target.closest(".c") : null;
  return c ? Number(c.dataset.i) : -1;
};

board.addEventListener("click", (e) => { const i = cellOf(e); if (i >= 0) act(() => E.reveal(g, i)); });
board.addEventListener("dblclick", (e) => { const i = cellOf(e); if (i >= 0) act(() => E.chord(g, i)); });
board.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const i = cellOf(e);
  if (i >= 0) act(() => E.toggleMark(g, i, marks));
});
board.addEventListener("mousedown", (e) => {
  if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
  if (e.button === 0 || e.button === 1) { held = true; render(); }
});
board.addEventListener("mouseup", (e) => {
  if (e.button !== 1) return;
  const i = cellOf(e);
  if (i >= 0) act(() => E.chord(g, i));
});
board.addEventListener("auxclick", (e) => e.preventDefault());
window.addEventListener("mouseup", () => { if (held) { held = false; if (g) render(); } });
window.addEventListener("blur", () => { if (held) { held = false; if (g) render(); } });
document.addEventListener("contextmenu", (e) => e.preventDefault());
q("reset").addEventListener("click", () => newGame());

umbra.onSettings(() => {
  if (!g) return;
  const d = optDiff();
  marks = optMarks();
  if (d !== diff) { diff = d; newGame(); return; }
  if (!marks && E.clearMarks(g)) { render(); persist(); return; }
});

(async () => {
  await umbra.ready;
  diff = optDiff();
  marks = optMarks();
  stats = (await umbra.store.get("stats", {})) || {};
  const saved = await umbra.store.get("game", null);
  const restored = saved && saved.diff === diff ? E.restore(saved.g) : null;
  if (restored) {
    g = restored;
    if (!marks) E.clearMarks(g);
    base = Math.max(0, Number(saved.elapsed) || 0);
    buildBoard();
    render();
    startClock();
  } else {
    newGame();
  }
  requestAnimationFrame(() => umbra.rendered());
})();
