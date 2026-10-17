// Minesweeper rules: pure functions on a plain JSON-able state, no DOM, no timers.
// Browser: window.MinesEngine. Node: module.exports. Mines are placed on the first reveal so the first click
// (and every cell around it) is always safe. The random source is injected: pass any () => [0,1) function,
// e.g. mulberry32(seed) for reproducible boards. Math.random is the default.
(function (root) {
  "use strict";

  const HIDDEN = 0, OPEN = 1, FLAG = 2, MARK = 3; // cell states in g.st

  const DIFFICULTIES = {
    beginner: { cols: 9, rows: 9, mines: 10 },
    intermediate: { cols: 16, rows: 16, mines: 40 },
    expert: { cols: 30, rows: 16, mines: 99 },
  };

  // Small seedable generator (mulberry32).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function blank(cols, rows, mines) {
    const n = cols * rows;
    return {
      cols, rows, mines,
      status: "ready",           // ready (before the first reveal) | playing | won | lost
      placed: false,             // mines are on the board
      mine: new Array(n).fill(0),
      adj: new Array(n).fill(0), // mines around each cell
      st: new Array(n).fill(HIDDEN),
      opened: 0,                 // revealed safe cells
      exploded: -1,              // index of the mine that ended the game
    };
  }

  function create(cols, rows, mines) {
    cols = Math.floor(cols); rows = Math.floor(rows); mines = Math.floor(mines);
    if (!(cols >= 2 && rows >= 2 && cols <= 100 && rows <= 100)) throw new RangeError("bad board size");
    // At least one safe cell must exist.
    mines = Math.max(1, Math.min(mines || 1, cols * rows - 1));
    return blank(cols, rows, mines);
  }

  function createLevel(name) {
    const d = DIFFICULTIES[name] || DIFFICULTIES.beginner;
    return create(d.cols, d.rows, d.mines);
  }

  function neighbors(g, i) {
    const x = i % g.cols, y = (i - x) / g.cols, out = [];
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= g.rows) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((dx || dy) && nx >= 0 && nx < g.cols) out.push(ny * g.cols + nx);
      }
    }
    return out;
  }

  function countAdj(g) {
    for (let i = 0; i < g.mine.length; i++) {
      let c = 0;
      for (const j of neighbors(g, i)) c += g.mine[j];
      g.adj[i] = c;
    }
  }

  // A board with known mines (tests, replays). Mines are placed, nothing is revealed yet.
  function fromMines(cols, rows, mineIndexes) {
    const g = blank(cols, rows, 0);
    for (const i of mineIndexes) {
      if (!(i >= 0 && i < g.mine.length)) throw new RangeError("mine outside the board");
      g.mine[i] = 1;
    }
    g.mines = g.mine.reduce((a, b) => a + b, 0);
    if (g.mines >= g.mine.length) throw new RangeError("no safe cell");
    g.placed = true;
    countAdj(g);
    return g;
  }

  // Put the mines down, never on `safe` or (when the board has room) on its neighbours.
  function place(g, safe, rng) {
    const n = g.mine.length;
    const around = new Set(neighbors(g, safe));
    around.add(safe);
    let banned = around;
    if (n - around.size < g.mines) banned = new Set([safe]);
    const pool = [];
    for (let i = 0; i < n; i++) if (!banned.has(i)) pool.push(i);
    for (let k = 0; k < g.mines; k++) { // partial Fisher-Yates
      const r = k + Math.floor(rng() * (pool.length - k));
      const tmp = pool[k]; pool[k] = pool[r]; pool[r] = tmp;
      g.mine[pool[k]] = 1;
    }
    g.placed = true;
    countAdj(g);
  }

  // Open one hidden/marked cell and flood through zeros. Flags are never opened. Returns true if a mine was hit.
  function openAt(g, start) {
    if (g.st[start] === OPEN || g.st[start] === FLAG) return false;
    if (g.mine[start]) {
      g.st[start] = OPEN;
      if (g.exploded < 0) g.exploded = start;
      return true;
    }
    const stack = [start];
    g.st[start] = OPEN; g.opened++;
    while (stack.length) {
      const i = stack.pop();
      if (g.adj[i] !== 0) continue;
      for (const j of neighbors(g, i)) {
        if (g.st[j] === HIDDEN || g.st[j] === MARK) {
          g.st[j] = OPEN; g.opened++;
          stack.push(j);
        }
      }
    }
    return false;
  }

  function settle(g, hit) {
    if (hit) { g.status = "lost"; return; }
    if (g.opened >= g.mine.length - g.mines) {
      g.status = "won";
      for (let i = 0; i < g.mine.length; i++) if (g.mine[i]) g.st[i] = FLAG;
    }
  }

  // Left click. Returns true if anything changed.
  function reveal(g, i, rng) {
    if (g.status === "won" || g.status === "lost") return false;
    if (!(i >= 0 && i < g.mine.length)) return false;
    if (g.st[i] === OPEN || g.st[i] === FLAG) return false;
    if (!g.placed) place(g, i, rng || Math.random);
    g.status = "playing";
    settle(g, openAt(g, i));
    return true;
  }

  // Right click: hidden -> flag -> (? when useMarks) -> hidden. Allowed before the first reveal.
  function toggleMark(g, i, useMarks) {
    if (g.status === "won" || g.status === "lost") return false;
    if (!(i >= 0 && i < g.mine.length)) return false;
    const s = g.st[i];
    if (s === OPEN) return false;
    g.st[i] = s === HIDDEN ? FLAG : s === FLAG ? (useMarks ? MARK : HIDDEN) : HIDDEN;
    return true;
  }

  // Chord on an opened number whose flag count matches: open every other neighbour. Returns true if anything changed.
  function chord(g, i) {
    if (g.status !== "playing") return false;
    if (!(i >= 0 && i < g.mine.length) || g.st[i] !== OPEN || g.adj[i] === 0) return false;
    const nb = neighbors(g, i);
    let flags = 0;
    for (const j of nb) if (g.st[j] === FLAG) flags++;
    if (flags !== g.adj[i]) return false;
    let hit = false, did = false;
    for (const j of nb) {
      if (g.st[j] === HIDDEN || g.st[j] === MARK) { did = true; if (openAt(g, j)) hit = true; }
    }
    if (did) settle(g, hit);
    return did;
  }

  function flagCount(g) {
    let c = 0;
    for (const s of g.st) if (s === FLAG) c++;
    return c;
  }

  // What the counter shows: mines minus flags (can go negative).
  const minesLeft = (g) => g.mines - flagCount(g);

  // Drop question marks (the option was switched off).
  function clearMarks(g) {
    let n = 0;
    for (let i = 0; i < g.st.length; i++) if (g.st[i] === MARK) { g.st[i] = HIDDEN; n++; }
    return n;
  }

  // How to draw cell i: hidden | flag | mark | wrong (flag on a safe cell after a loss) | boom | mine | n0..n8.
  function cellView(g, i) {
    const s = g.st[i], over = g.status === "lost";
    if (over) {
      if (g.mine[i]) return i === g.exploded ? "boom" : s === FLAG ? "flag" : "mine";
      if (s === FLAG) return "wrong";
    }
    if (s === FLAG) return "flag";
    if (s === MARK) return "mark";
    if (s === HIDDEN) return "hidden";
    return "n" + g.adj[i];
  }

  // Validate a saved state (from umbra.store); returns a clean copy or null.
  function restore(o) {
    try {
      if (!o || typeof o !== "object") return null;
      const { cols, rows } = o;
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 100 || rows > 100) return null;
      const n = cols * rows;
      if (!["ready", "playing", "won", "lost"].includes(o.status)) return null;
      for (const k of ["mine", "adj", "st"]) if (!Array.isArray(o[k]) || o[k].length !== n) return null;
      if (!o.st.every((v) => v === 0 || v === 1 || v === 2 || v === 3)) return null;
      if (!o.mine.every((v) => v === 0 || v === 1)) return null;
      const g = blank(cols, rows, 0);
      g.mine = o.mine.slice();
      g.st = o.st.slice();
      g.placed = !!o.placed;
      g.status = o.status;
      g.exploded = Number.isInteger(o.exploded) && o.exploded >= -1 && o.exploded < n ? o.exploded : -1;
      g.mines = Number.isInteger(o.mines) && o.mines >= 1 && o.mines < n ? o.mines : 0;
      if (g.placed) {
        const m = g.mine.reduce((a, b) => a + b, 0);
        if (m !== g.mines) return null;
        countAdj(g);
      } else if (g.mines === 0 || o.status !== "ready") return null;
      g.opened = 0;
      for (let i = 0; i < n; i++) if (g.st[i] === OPEN && !g.mine[i]) g.opened++;
      return g;
    } catch (e) { return null; }
  }

  const api = {
    HIDDEN, OPEN, FLAG, MARK, DIFFICULTIES, mulberry32,
    create, createLevel, fromMines, neighbors, reveal, toggleMark, chord,
    flagCount, minesLeft, clearMarks, cellView, restore,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MinesEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
