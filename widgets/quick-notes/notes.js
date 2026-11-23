(async () => {
  await umbra.ready;
  const $ = (id) => document.getElementById(id);
  const MAX = 100000;
  const ed = $("text");
  const MAX_TABS = 12;
  const strip = $("tabs");
  // One note per tab: "notes" holds the texts and "names" the names you gave them ("" = named after the first line).
  let notes = await umbra.store.get("notes", []);
  let names = await umbra.store.get("names", null);
  let active = await umbra.store.get("active", 0);
  let timer = null, dirty = false, composing = false;
  let lines = [""];
  let hist = [], hi = -1, histAt = 0;
  let renaming = -1, tabDrag = null, tabsStale = false, undoTimer = null;

  const LIST = /^(\s*)([-*]|\d+\.)(\s)(.*)$/;
  const HEAD = /^(\s*)(#{1,3})(\s)(.*)$/;
  const TAB = "    ";

  /** Notes and names line up one per tab, at least one tab. */
  function normalize() {
    if (!Array.isArray(notes)) notes = [];
    notes = notes.map((n) => (typeof n === "string" ? n : ""));
    if (!Array.isArray(names)) {
      // Before 1.3 the number of tabs was an option (1-5). Keep that many, and every tab that has text.
      const last = notes.reduce((n, t, i) => (t ? i + 1 : n), 0);
      const count = Math.max(last, Math.min(5, Math.max(1, Number(umbra.options.tabs) || 3)));
      notes = Array.from({ length: count }, (_, i) => notes[i] || "");
      names = notes.map(() => "");
      umbra.store.set("names", names).catch(() => {});
    }
    names = notes.map((_, i) => (typeof names[i] === "string" ? names[i] : ""));
    if (!notes.length) { notes = [""]; names = [""]; }
    active = Math.max(0, Math.min(notes.length - 1, Number(active) || 0));
  }
  normalize();

  /** The tab's own name, else the first line of its note without markdown, else "Note N". */
  function label(i) {
    if ((names[i] || "").trim()) return names[i].trim();
    const first = (notes[i] || "").split("\n").filter((l) => !isImg(l)).map((l) => plain(l.replace(/^\s*(#{1,3}|[-*]|\d+\.)\s+/, "")).trim()).find(Boolean);
    return first ? first.slice(0, 40) : `Note ${i + 1}`;
  }

  async function saveTabs() {
    try { await Promise.all([umbra.store.set("notes", notes), umbra.store.set("names", names), umbra.store.set("active", active)]); }
    catch { $("status").textContent = "Could not save (too large)"; }
  }

  function drawTabs() {
    // Never rebuild the strip under a rename field or a tab being dragged; catch up afterwards.
    if (renaming >= 0 || tabDrag?.live) { tabsStale = true; return; }
    tabsStale = false;
    const els = notes.map((text, i) => {
      const t = document.createElement("div");
      t.className = "tab" + (i === active ? " on" : "") + (text && i !== active ? " full" : "");
      t.dataset.i = String(i);
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(i === active));
      t.title = `${label(i)}\nDouble-click to rename, drag to move, middle-click to delete`;
      t.append(Object.assign(document.createElement("span"), { className: "name", textContent: label(i) }));
      if (notes.length > 1) {
        const x = document.createElement("button");
        x.type = "button"; x.className = "x"; x.title = "Delete tab"; x.setAttribute("aria-label", `Delete ${label(i)}`);
        x.innerHTML = '<svg viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg>';
        t.append(x);
      }
      return t;
    });
    if (notes.length < MAX_TABS) {
      const add = document.createElement("button");
      add.type = "button"; add.className = "add"; add.title = "New tab"; add.setAttribute("aria-label", "New tab");
      add.innerHTML = '<svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8"/></svg>';
      els.push(add);
    }
    const x = strip.scrollLeft;
    strip.replaceChildren(...els);
    strip.scrollLeft = x;
  }

  function showActiveTab() {
    strip.querySelector(".tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  async function selectTab(i) {
    if (i === active || i < 0 || i >= notes.length) return;
    await flush();
    active = i;
    umbra.store.set("active", i).catch(() => {});
    drawTabs(); load(); showActiveTab();
  }

  async function addTab() {
    if (notes.length >= MAX_TABS) return;
    await flush();
    notes.push(""); names.push("");
    active = notes.length - 1;
    drawTabs(); load(); showActiveTab();
    saveTabs();
    // The + was just pressed, so Umbra lets the widget take the keyboard: start typing straight away.
    umbra.requestFocus();
    ed.focus();
  }

  async function deleteTab(i) {
    if (notes.length < 2 || i < 0 || i >= notes.length) return;
    await flush();
    const gone = { i, text: notes[i], name: names[i], wasActive: i === active, label: label(i) };
    notes.splice(i, 1); names.splice(i, 1);
    if (i < active || (i === active && active === notes.length)) active--;
    drawTabs(); load(); showActiveTab();
    saveTabs();
    if (gone.text || gone.name) offerUndo(gone);
  }

  /** A tab that had text can come back for a few seconds. */
  function offerUndo(gone) {
    const st = $("undo");
    clearTimeout(undoTimer);
    pendingUndo = gone;
    st.hidden = false;
    st.replaceChildren(`Deleted “${gone.label.slice(0, 20)}” · `);
    const b = Object.assign(document.createElement("button"), { type: "button", className: "undo", textContent: "Undo" });
    b.onclick = async () => {
      clearTimeout(undoTimer);
      st.hidden = true;
      if (notes.length >= MAX_TABS) { $("status").textContent = "Too many tabs to bring it back"; return; }
      await flush();
      const at = Math.min(gone.i, notes.length);
      notes.splice(at, 0, gone.text); names.splice(at, 0, gone.name);
      if (gone.wasActive || at <= active) active = gone.wasActive ? at : active + 1;
      drawTabs(); load(); showActiveTab();
      await saveTabs();
    };
    st.append(b);
    undoTimer = setTimeout(() => { st.hidden = true; pendingUndo = null; }, 8000);
  }

  function renameTab(i) {
    const tab = strip.querySelector(`.tab[data-i="${i}"]`);
    if (!tab || renaming >= 0) return;
    // Umbra hands over the keyboard by focusing the whole view, which blurs the field for a moment: only ask when needed.
    if (!document.hasFocus()) umbra.requestFocus();
    renaming = i;
    const field = Object.assign(document.createElement("input"), { className: "rename", value: names[i] || label(i), maxLength: 40, spellcheck: false });
    field.setAttribute("aria-label", "Tab name");
    tab.classList.add("editing");
    tab.querySelector(".name").replaceWith(field);
    field.focus(); field.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      renaming = -1;
      if (keep) {
        const v = field.value.replace(/\s+/g, " ").trim();
        // Typing the automatic name back (or nothing) keeps it automatic.
        names[i] = !v || (!names[i] && v === label(i)) ? "" : v;
        umbra.store.set("names", names).catch(() => {});
      }
      drawTabs();
      if (document.hasFocus()) ed.focus({ preventScroll: true });
    };
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    // Only a real move of focus ends it (see the note above): Umbra's own refocus gives the field back within a moment.
    field.addEventListener("blur", () => setTimeout(() => {
      if (done) return;
      if (document.activeElement !== field) finish(true);
      else if (!document.hasFocus()) setTimeout(() => { if (!done && !(document.hasFocus() && document.activeElement === field)) finish(true); }, 1500);
    }, 200));
  }

  // ---- tab strip input: click, double-click, middle-click, wheel, drag ----
  const tabAt = (e) => e.target.closest(".tab");
  strip.addEventListener("click", (e) => {
    if (tabDrag?.moved) return;
    if (e.target.closest(".add")) { addTab(); return; }
    const t = tabAt(e);
    if (!t || t.classList.contains("editing")) return;
    if (e.target.closest(".x")) deleteTab(Number(t.dataset.i));
    else selectTab(Number(t.dataset.i));
  });
  strip.addEventListener("dblclick", (e) => {
    const t = tabAt(e);
    if (t && !e.target.closest(".x, .rename")) renameTab(Number(t.dataset.i));
  });
  strip.addEventListener("auxclick", (e) => {
    const t = tabAt(e);
    if (e.button === 1 && t && !t.classList.contains("editing")) { e.preventDefault(); deleteTab(Number(t.dataset.i)); }
  });
  strip.addEventListener("wheel", (e) => {
    if (strip.scrollWidth <= strip.clientWidth) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY || e.deltaX;
  }, { passive: false });

  strip.addEventListener("pointerdown", (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll circle on middle-click
    const t = tabAt(e);
    if (e.button !== 0 || !t || renaming >= 0 || e.target.closest(".x") || notes.length < 2) return;
    tabDrag = { el: t, from: Number(t.dataset.i), x0: e.clientX, x: e.clientX, grab: 0, id: e.pointerId, live: false, moved: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!tabDrag || e.pointerId !== tabDrag.id) return;
    if (!(e.buttons & 1)) { endTabDrag(false); return; }
    tabDrag.x = e.clientX;
    if (!tabDrag.live) {
      if (Math.abs(e.clientX - tabDrag.x0) < 5) return;
      tabDrag.live = tabDrag.moved = true;
      tabDrag.grab = tabDrag.x0 - tabDrag.el.getBoundingClientRect().left;
      tabDrag.el.classList.add("lifted");
      strip.classList.add("sorting");
      try { strip.setPointerCapture(e.pointerId); } catch { /* gone already */ }
    }
    const { el, x } = tabDrag;
    const others = [...strip.querySelectorAll(".tab")].filter((t) => t !== el);
    const next = others.find((t) => { const b = t.getBoundingClientRect(); return x < b.left + b.width / 2; }) || null;
    const last = others[others.length - 1];
    if (next ? el.nextElementSibling !== next : el.previousElementSibling !== last) {
      const before = new Map(others.map((t) => [t, t.getBoundingClientRect().left]));
      if (next) next.before(el); else last.after(el);
      if (document.documentElement.dataset.motion !== "off") for (const [t, left] of before) {
        const d = left - t.getBoundingClientRect().left;
        if (!d) continue;
        t.style.transition = "none"; t.style.transform = `translateX(${d}px)`;
        requestAnimationFrame(() => { t.style.transition = ""; t.style.transform = ""; });
      }
    }
    el.style.transform = "";
    const natural = el.getBoundingClientRect().left;
    const tabs = [...strip.querySelectorAll(".tab")];
    const lo = tabs[0].getBoundingClientRect().left, hi = tabs[tabs.length - 1].getBoundingClientRect().right - el.offsetWidth;
    el.style.transform = `translateX(${Math.max(lo, Math.min(hi, x - tabDrag.grab)) - natural}px)`;
  });
  window.addEventListener("pointerup", (e) => { if (tabDrag && e.pointerId === tabDrag.id) endTabDrag(true); });
  window.addEventListener("pointercancel", () => endTabDrag(false));
  window.addEventListener("blur", () => endTabDrag(false));

  function endTabDrag(drop) {
    if (!tabDrag) return;
    const d = tabDrag;
    // Keep tabDrag.moved until the click that follows the release has been ignored.
    setTimeout(() => { if (tabDrag === d) tabDrag = null; }, 0);
    d.live = false;
    if (!d.moved) { tabDrag = null; return; }
    d.el.classList.remove("lifted");
    strip.classList.remove("sorting");
    for (const t of strip.querySelectorAll(".tab")) { t.style.transition = ""; t.style.transform = ""; }
    if (drop) {
      const order = [...strip.querySelectorAll(".tab")].map((t) => Number(t.dataset.i));
      if (order.some((v, i) => v !== i)) {
        const activeWas = active;
        notes = order.map((i) => notes[i]);
        names = order.map((i) => names[i]);
        active = order.indexOf(activeWas);
        saveTabs();
      }
    }
    drawTabs();
  }

  // ---- rendering: one div per line, raw markdown kept as text, markers dimmed ----
  // Inline formats are kept as text markers. The line with the caret shows them dimmed; other lines fold them away (CSS).
  const span = (cls, t) => { const s = document.createElement("span"); s.className = cls; s.textContent = t; return s; };
  const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"];
  // Earliest match wins; at the same spot the longer marker (** before *) does.
  const TOKEN = new RegExp([
    `\\{(${COLORS.join("|")}):([^{}\\n]+?)\\}`,
    // A closing marker isn't followed by one more of its character, so ***x*** reads as bold around italic.
    "\\*\\*(?=\\S)(.+?)(?<=\\S)\\*\\*(?!\\*)",
    "__(?=\\S)(.+?)(?<=\\S)__(?!_)",
    "~~(?=\\S)(.+?)(?<=\\S)~~(?!~)",
    "==(?=\\S)(.+?)(?<=\\S)==(?!=)",
    "(?<![*\\w])\\*(?![\\s*])(.+?)(?<![\\s*])\\*(?![*\\w])",
  ].join("|"), "g");
  const FORMATS = { b: ["**", "**", "b"], i: ["*", "*", "i"], u: ["__", "__", "u"], s: ["~~", "~~", "s"], h: ["==", "==", "mark"] };
  /** Top-level formatted runs of one line: { kind, color?, start, end, open, close, inner }. */
  function tokens(t) {
    const out = [];
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(t))) {
      const [all] = m;
      let tok;
      if (m[1]) tok = { kind: "c", color: m[1], open: `{${m[1]}:`, close: "}", inner: m[2] };
      else if (m[3] !== undefined) tok = { kind: "b", inner: m[3] };
      else if (m[4] !== undefined) tok = { kind: "u", inner: m[4] };
      else if (m[5] !== undefined) tok = { kind: "s", inner: m[5] };
      else if (m[6] !== undefined) tok = { kind: "h", inner: m[6] };
      else tok = { kind: "i", inner: m[7] };
      if (tok.kind !== "c") { tok.open = FORMATS[tok.kind][0]; tok.close = FORMATS[tok.kind][1]; }
      tok.start = m.index; tok.end = m.index + all.length;
      out.push(tok);
    }
    return out;
  }
  /** The text with every format marker removed. */
  const plain = (t) => { let o = "", at = 0; for (const k of tokens(t)) { o += t.slice(at, k.start) + plain(k.inner); at = k.end; } return o + t.slice(at); };
  function inline(parent, t) {
    let at = 0;
    for (const k of tokens(t)) {
      if (k.start > at) parent.appendChild(document.createTextNode(t.slice(at, k.start)));
      // Markers sit outside the styled element, so an underline or highlight never runs under them.
      const el = document.createElement(k.kind === "c" ? "span" : FORMATS[k.kind][2]);
      if (k.kind === "c") el.className = `c-${k.color}`;
      inline(el, k.inner);
      parent.append(span("mk fm", k.open), el, span("mk fm", k.close));
      at = k.end;
    }
    if (at < t.length) parent.appendChild(document.createTextNode(t.slice(at)));
  }

  // Pasted images: their own line "![](img:<id> <width>)"; the picture is in the "images" store key as a data URL.
  const IMG = /^!\[\]\(img:([a-z0-9]{6,16})(?: (\d{1,4}))?\)$/;
  const MIN_IMG = 40;
  let images = await umbra.store.get("images", {});
  if (!images || typeof images !== "object" || Array.isArray(images)) images = {};
  const isImg = (t) => IMG.test(t);
  // umbra.store holds 1 MB per widget for everything: notes, names and pictures. Stay a little under it.
  const STORE_LIMIT = 1024 * 1024, SAFE = 980 * 1024;
  let imgBytes = JSON.stringify(images).length;
  const usedBytes = () => imgBytes + notes.reduce((n, t) => n + new Blob([t]).size + 8, 0) + JSON.stringify(names).length + 256;
  /** The widest an image may be: the editor's text width. */
  const maxImg = () => Math.max(MIN_IMG, ed.clientWidth - 24);
  function buildImage(d, t) {
    const [, id, w] = IMG.exec(t);
    d.className = "img";
    d.appendChild(span("mk src", t));
    const box = document.createElement("span");
    box.className = "imgbox"; box.contentEditable = "false"; box.dataset.noDrag = "";
    if (images[id]) {
      const img = new Image();
      img.src = images[id]; img.alt = ""; img.draggable = false;
      if (w) img.style.width = `${Math.min(Number(w), maxImg())}px`;
      const grip = document.createElement("span");
      grip.className = "grip"; grip.title = "Drag to resize";
      box.append(img, grip);
    } else box.append(span("missing", "Image not found"));
    d.appendChild(box);
    return d;
  }

  function buildLine(t) {
    const d = document.createElement("div");
    if (t === "") { d.appendChild(document.createElement("br")); return d; }
    if (isImg(t)) return buildImage(d, t);
    let m = HEAD.exec(t);
    if (m) { d.className = "h" + m[2].length; d.appendChild(span("mk", m[1] + m[2] + m[3])); inline(d, m[4]); return d; }
    m = LIST.exec(t);
    if (m) {
      d.className = "li";
      // The prefix (indent, marker, space) sits in one span so hang() can line wrapped text up under the text after it.
      const pre = span("pre", "");
      if (m[1]) pre.appendChild(span("mk", m[1]));
      // A "-" or "*" stays in the text, so saving and the caret see it; notes.css paints it as a dot.
      pre.append(span(/\d/.test(m[2]) ? "mk" : "mk dot", m[2]), span("mk", m[3]));
      d.appendChild(pre);
      inline(d, m[4]);
      return d;
    }
    m = /^([ \t]+)(\S.*)$/.exec(t);
    if (m) { d.className = "ind"; d.appendChild(span("pre", m[1])); inline(d, m[2]); return d; }
    inline(d, t);
    return d;
  }
  /** Hanging indent: a wrapped list (or indented) line continues under its text, not at the left edge. */
  function hang(divs) {
    const rows = divs.filter((d) => d.firstChild && d.firstChild.className === "pre");
    const max = ed.clientWidth * 0.6;
    const w = rows.map((d) => Math.min(max, d.firstChild.getBoundingClientRect().width));
    rows.forEach((d, i) => d.style.setProperty("--hang", `${w[i]}px`));
  }

  // ---- text <-> DOM ----
  const allDivs = () => Array.from(ed.childNodes).every((c) => c.nodeName === "DIV");
  const readLines = () => { const o = Array.from(ed.childNodes, (c) => c.textContent); return o.length ? o : [""]; };
  const getText = () => lines.join("\n");

  function lineOf(node, off) {
    let ln = node;
    while (ln && ln.parentNode !== ed) ln = ln.parentNode;
    if (!ln) return { line: 0, ch: 0 };
    const r = document.createRange();
    r.selectNodeContents(ln); r.setEnd(node, off);
    return { line: Array.prototype.indexOf.call(ed.childNodes, ln), ch: r.toString().length };
  }
  function toAbs(p) {
    let n = 0;
    const L = Math.max(0, Math.min(p.line, lines.length - 1));
    for (let i = 0; i < L; i++) n += lines[i].length + 1;
    return n + Math.min(p.ch, lines[L].length);
  }
  function getSel() {
    const s = getSelection();
    if (!s.rangeCount || !ed.contains(s.anchorNode) || !ed.contains(s.focusNode)) return null;
    const a = toAbs(s.anchorNode === ed ? { line: s.anchorOffset, ch: 0 } : lineOf(s.anchorNode, s.anchorOffset));
    const f = toAbs(s.focusNode === ed ? { line: s.focusOffset, ch: 0 } : lineOf(s.focusNode, s.focusOffset));
    return { s: Math.min(a, f), e: Math.max(a, f) };
  }
  function point(abs) {
    let i = 0;
    while (i < lines.length - 1 && abs > lines[i].length) { abs -= lines[i].length + 1; i++; }
    const div = ed.childNodes[i];
    // A picture's line: its text is never shown, and the browser moves a caret out of hidden text, so the caret goes
    // before or after the picture itself.
    if (isImg(lines[i]) && div) return abs > 0 ? [div, div.childNodes.length] : [div, 0];
    const w = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { if (abs <= n.length) return [n, abs]; abs -= n.length; }
    return [div, 0];
  }
  function setSel(s, e = s) {
    if (document.activeElement !== ed) return;
    const [a, ao] = point(s), [b, bo] = point(e);
    const r = document.createRange();
    r.setStart(a, ao); r.setEnd(b, bo);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  function mark() { ed.toggleAttribute("data-empty", lines.length === 1 && lines[0] === ""); }
  function fullRender(text, s, e) {
    lines = text.split("\n");
    ed.replaceChildren(...lines.map(buildLine));
    hang(Array.from(ed.childNodes));
    if (s != null) setSel(s, e == null ? s : e);
    mark();
    markCur();
  }

  /**
   * The line holding the caret gets "cur": its format markers show (dimmed) so they can be edited; elsewhere they fold away.
   * A caret on an image line selects that image (outline; Backspace or Delete removes it).
   */
  let curLine = null;
  function markCur() {
    const s = getSelection();
    let ln = null;
    if (document.activeElement === ed && s.rangeCount && ed.contains(s.focusNode)) {
      ln = s.focusNode;
      while (ln && ln.parentNode !== ed) ln = ln.parentNode;
    }
    if (ln === curLine && (!ln || ln.classList.contains("cur"))) return;
    if (curLine) curLine.classList.remove("cur");
    curLine = ln;
    if (ln) ln.classList.add("cur");
  }
  document.addEventListener("selectionchange", markCur);
  ed.addEventListener("focus", markCur);
  ed.addEventListener("blur", () => { if (curLine) curLine.classList.remove("cur"); curLine = null; });
  /** Index of the line holding the caret when the selection is collapsed, else -1. */
  function caretLine() {
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed || !ed.contains(s.focusNode)) return -1;
    return s.focusNode === ed ? Math.min(s.focusOffset, lines.length - 1) : lineOf(s.focusNode, s.focusOffset).line;
  }
  const lineStartAbs = (i) => toAbs({ line: i, ch: 0 });
  const lineEndAbs = (i) => toAbs({ line: i, ch: lines[i].length });

  // ---- state, saving, history ----
  function count() {
    const n = lines.filter((l) => !isImg(l)).join("\n").length;
    const pics = lines.filter(isImg).length;
    const pct = Math.min(100, Math.round((usedBytes() / STORE_LIMIT) * 100));
    $("count").textContent = `${umbra.fmt(n, 0)} character${n === 1 ? "" : "s"}`
      + (pics ? ` · ${pics} image${pics > 1 ? "s" : ""}` : "") + (imgBytes && pct >= 5 ? ` · ${pct}% full` : "");
  }
  function commit() {
    notes[active] = getText();
    dirty = true; $("status").textContent = "Saving...";
    count(); drawTabs();
    clearTimeout(timer); timer = setTimeout(flush, 600);
  }
  function pushHist(force) {
    const sel = getSel() || { s: 0, e: 0 };
    const ent = { text: getText(), s: sel.s, e: sel.e };
    const now = Date.now();
    if (!force && hi === hist.length - 1 && hist.length > 1 && now - histAt < 700) hist[hi] = ent;
    else { hist = hist.slice(0, hi + 1); hist.push(ent); if (hist.length > 200) hist.shift(); hi = hist.length - 1; }
    histAt = now;
  }
  function undoRedo(dir) {
    const j = hi + dir;
    if (j < 0 || j >= hist.length) return;
    hi = j;
    const h = hist[hi];
    fullRender(h.text, h.s, h.e); commit();
  }
  async function flush() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    try { await umbra.store.set("notes", notes); $("status").textContent = "Saved"; }
    catch { $("status").textContent = "Could not save (too large)"; }
  }
  function load() {
    ed.style.fontSize = `${Number(umbra.options.fontSize) || 14}px`;
    fullRender((notes[active] || "").slice(0, MAX));
    hist = []; hi = -1; pushHist(true);
    gcImages();
    count();
  }

  // Apply a text-level edit, re-render, remember it.
  function edit(text, s, e) {
    if (text.length > MAX) { text = text.slice(0, MAX); s = Math.min(s, MAX); e = Math.min(e == null ? s : e, MAX); }
    fullRender(text, s, e);
    commit(); pushHist(true);
  }

  // ---- formatting: everything goes through the text, so saving, undo and the caret model stay as they are ----
  /** The line index holding absolute offset `abs`. */
  function lineAtAbs(abs) {
    let i = 0;
    while (i < lines.length - 1 && abs > lines[i].length) { abs -= lines[i].length + 1; i++; }
    return i;
  }
  /** Characters at the start of a line that belong to its list/heading marker (and indent). */
  function prefixLen(l) {
    const m = LIST.exec(l) || HEAD.exec(l);
    if (m) return m[1].length + m[2].length + m[3].length;
    return /^\s*/.exec(l)[0].length;
  }
  /** Every format run of a line, nested ones too, as absolute offsets: { kind, color, start, end, a, b } (a-b is the inner text). */
  function allTokens(t, base) {
    const out = [];
    for (const k of tokens(t)) {
      const a = base + k.start + k.open.length, b = base + k.end - k.close.length;
      out.push({ ...k, start: base + k.start, end: base + k.end, a, b });
      out.push(...allTokens(k.inner, a));
    }
    return out;
  }
  const tokensOfLine = (i) => allTokens(lines[i], lineStartAbs(i));
  /** The selection split per line, without list/heading markers, image lines or spaces at either end. */
  function segments(text, s, e) {
    const out = [];
    for (let i = lineAtAbs(s), last = lineAtAbs(e); i <= last; i++) {
      const l = lines[i];
      if (isImg(l)) continue;
      const ls = lineStartAbs(i);
      let a = Math.max(s, ls + prefixLen(l)), b = Math.min(e, ls + l.length);
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (a < b) out.push({ line: i, a, b });
    }
    return out;
  }
  /** The word around `pos` (letters, digits, _ ' -), or null. */
  function wordAt(text, pos) {
    const W = /[\p{L}\p{N}_'’-]/u;
    let a = pos, b = pos;
    while (a > 0 && W.test(text[a - 1])) a--;
    while (b < text.length && W.test(text[b])) b++;
    return a < b ? { s: a, e: b } : null;
  }
  /** A run of this kind that holds the segment (its inner text covers it, or the selection is the whole run). */
  function enclosing(seg, kind) {
    const list = tokensOfLine(seg.line).filter((k) => k.kind === kind && ((k.a <= seg.a && seg.b <= k.b) || (k.start === seg.a && k.end === seg.b)));
    return list.sort((x, y) => (x.end - x.start) - (y.end - y.start))[0] || null;
  }

  /** Edits on a copy of the text that keep the selection where it belongs. */
  function editor(text, s, e) {
    const st = { text, s, e };
    // An opening marker pushes a selection edge that sits on it; a closing marker doesn't.
    st.insert = (at, str, opening) => {
      st.text = st.text.slice(0, at) + str + st.text.slice(at);
      const mv = (p) => (p > at || (opening && p === at) ? p + str.length : p);
      st.s = mv(st.s); st.e = mv(st.e);
    };
    st.remove = (at, n) => {
      st.text = st.text.slice(0, at) + st.text.slice(at + n);
      const mv = (p) => (p >= at + n ? p - n : p > at ? at : p);
      st.s = mv(st.s); st.e = mv(st.e);
    };
    return st;
  }

  /** Bold, italic, underline, strike, highlight (kind b/i/u/s/h) or a color (kind "c", color or null for none): toggles. */
  function applyFormat(kind, color, sel = getSel()) {
    if (!sel) return;
    const text = getText();
    let { s, e } = sel;
    if (s === e) {
      const w = isImg(lines[lineAtAbs(s)]) ? null : wordAt(text, s);
      if (w) ({ s, e } = w);
      else {
        // Nothing to format yet: an empty pair with the caret inside, ready to type into.
        if (kind === "c" && !color) return;
        const open = kind === "c" ? `{${color}:` : FORMATS[kind][0], close = kind === "c" ? "}" : FORMATS[kind][1];
        edit(text.slice(0, s) + open + close + text.slice(s), s + open.length);
        return;
      }
    }
    const segs = segments(text, s, e);
    if (!segs.length) return;
    const enc = segs.map((g) => enclosing(g, kind));
    const removing = kind === "c" ? !color || enc.every((k) => k && k.color === color) : enc.every(Boolean);
    const st = editor(text, sel.s === sel.e ? s : sel.s, sel.s === sel.e ? e : sel.e);
    // Last segment first, so the offsets of the earlier ones stay right.
    for (let i = segs.length - 1; i >= 0; i--) {
      const g = segs[i], k = enc[i];
      if (k && (removing || kind === "c")) {
        st.remove(k.end - k.close.length, k.close.length);
        st.remove(k.start, k.open.length);
        if (kind === "c" && !removing) { st.insert(k.b - k.open.length, "}", false); st.insert(k.start, `{${color}:`, true); }
      } else if (!removing && !k) {
        const open = kind === "c" ? `{${color}:` : FORMATS[kind][0], close = kind === "c" ? "}" : FORMATS[kind][1];
        st.insert(g.b, close, false);
        st.insert(g.a, open, true);
      }
    }
    edit(st.text, st.s, st.e);
  }

  /** Strip every format from the selection (from the runs it touches), or from the caret's line. */
  function clearFormat(sel = getSel()) {
    if (!sel) return;
    const text = getText();
    let { s, e } = sel;
    if (s === e) { const i = lineAtAbs(s); s = lineStartAbs(i); e = lineEndAbs(i); }
    const st = editor(text, sel.s, sel.e);
    for (let i = lineAtAbs(e); i >= lineAtAbs(s); i--) {
      const ls = lineStartAbs(i);
      const top = tokens(lines[i]).map((k) => ({ ...k, start: ls + k.start, end: ls + k.end })).filter((k) => k.start < e && k.end > s);
      for (const k of top.reverse()) {
        // Remove markers from the end of the run backwards, nested ones included.
        const inside = allTokens(lines[i], ls).filter((t) => t.start >= k.start && t.end <= k.end);
        const cuts = inside.flatMap((t) => [[t.end - t.close.length, t.close.length], [t.start, t.open.length]]).sort((x, y) => y[0] - x[0]);
        for (const [at, n] of cuts) st.remove(at, n);
      }
    }
    if (st.text !== text) edit(st.text, st.s, st.e);
  }

  /** Heading 1-3, normal text, bulleted or numbered list for the lines in the selection (toggles). */
  function setBlock(type, sel = getSel()) {
    if (!sel) return;
    const first = lineAtAbs(sel.s), last = lineAtAbs(sel.e);
    const idx = [];
    for (let i = first; i <= last; i++) if (!isImg(lines[i])) idx.push(i);
    if (!idx.length) return;
    const bare = (l) => { const m = LIST.exec(l) || HEAD.exec(l); return m ? { ind: m[1], body: m[4] } : { ind: /^\s*/.exec(l)[0], body: l.replace(/^\s*/, "") }; };
    const is = (l) => (type === "ul" ? /^\s*[-*]\s/.test(l) : type === "ol" ? /^\s*\d+\.\s/.test(l) : /^h\d$/.test(type) ? new RegExp(`^\\s*#{${type[1]}}\\s`).test(l) && !/^\s*#{4}/.test(l) : false);
    const off = type !== "p" && idx.every((i) => is(lines[i]));
    const out = lines.slice();
    const delta = new Map();
    let n = 0;
    for (const i of idx) {
      const { ind, body } = bare(lines[i]);
      let pre = "";
      if (!off) pre = type === "ul" ? "- " : type === "ol" ? `${++n}. ` : type[0] === "h" ? `${"#".repeat(Number(type[1]))} ` : "";
      out[i] = ind + pre + body;
      delta.set(i, { old: prefixLen(lines[i]), now: ind.length + pre.length });
    }
    // Keep the caret on the same character of its line.
    const place = (abs) => {
      const i = lineAtAbs(abs), ch = abs - lineStartAbs(i), d = delta.get(i);
      const nch = d ? Math.max(d.now, ch - d.old + d.now) : ch;
      let p = 0;
      for (let j = 0; j < i; j++) p += out[j].length + 1;
      return p + Math.min(nch, out[i].length);
    };
    edit(out.join("\n"), place(sel.s), place(sel.e));
  }

  /** Text of the selection without format markers or image lines (for pasting elsewhere). */
  function plainOf(sel) {
    return getText().slice(sel.s, sel.e).split("\n").filter((l) => !isImg(l)).map(plain).join("\n");
  }

  // ---- images: paste or drop a picture; it is shrunk to fit the 1 MB store and gets its own line ----
  const newImgId = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");
  /** Shrink to at most 1000 px and re-encode (WebP, or JPEG where the engine can't write WebP) until it is small. */
  async function compressImage(blob) {
    const bmp = await createImageBitmap(blob);
    let best = null;
    try {
      for (const [side, q] of [[1000, 0.8], [800, 0.72], [640, 0.62], [480, 0.55]]) {
        const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0, w, h);
        let url = c.toDataURL("image/webp", q);
        if (!url.startsWith("data:image/webp")) {
          g.globalCompositeOperation = "destination-over"; g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
          url = c.toDataURL("image/jpeg", q);
        }
        best = { url, w, h };
        if (url.length <= 110 * 1024) break;
      }
    } finally { bmp.close?.(); }
    return best;
  }
  function setStatus(t) { $("status").textContent = t; }
  async function insertImages(files, sel) {
    let text = getText();
    sel = sel || getSel() || { s: text.length, e: text.length };
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue;
      if (f.size > 30 * 1024 * 1024) { setStatus("That image is too large"); continue; }
      setStatus("Adding image...");
      let pic;
      try { pic = await compressImage(f); } catch { setStatus("Couldn't read that image"); continue; }
      if (!pic || usedBytes() + pic.url.length + 64 > SAFE) { setStatus("No room for this image: notes hold 1 MB in all. Delete an image to make room."); return; }
      const id = newImgId();
      images[id] = pic.url;
      imgBytes = JSON.stringify(images).length;
      try { await umbra.store.set("images", images); }
      catch { delete images[id]; imgBytes = JSON.stringify(images).length; setStatus("No room for this image: notes hold 1 MB in all."); return; }
      // Its own line: replaces an empty line, else goes after the caret's line; a line after it to type on.
      text = getText();
      const i = lineAtAbs(Math.min(sel.s, text.length));
      const line = `![](img:${id} ${Math.round(Math.min(220, pic.w, maxImg()))})`;
      const ls = lineStartAbs(i), le = lineEndAbs(i);
      let next, caret;
      if (lines[i] === "") { next = text.slice(0, ls) + line + text.slice(le); caret = ls + line.length; }
      else { next = text.slice(0, le) + "\n" + line + text.slice(le); caret = le + 1 + line.length; }
      // The caret goes to a text line after the picture: the next one, or a new empty one.
      const after = next.slice(caret + 1).split("\n")[0];
      if (caret >= next.length || isImg(after)) next = next.slice(0, caret) + "\n" + next.slice(caret);
      caret += 1;
      if (next.length > MAX) { delete images[id]; imgBytes = JSON.stringify(images).length; umbra.store.set("images", images).catch(() => {}); setStatus("This note is full"); return; }
      edit(next, caret);
      sel = { s: caret, e: caret };
    }
  }
  /** Drop pictures no tab (or this tab's undo, or a deleted tab's Undo) still shows. */
  let pendingUndo = null;
  function gcImages() {
    const keep = new Set();
    const scan = (t) => { for (const l of String(t || "").split("\n")) { const m = IMG.exec(l); if (m) keep.add(m[1]); } };
    notes.forEach(scan); hist.forEach((h) => scan(h.text)); scan(getText());
    if (pendingUndo) scan(pendingUndo.text);
    const gone = Object.keys(images).filter((id) => !keep.has(id));
    if (!gone.length) return;
    for (const id of gone) delete images[id];
    imgBytes = JSON.stringify(images).length;
    umbra.store.set("images", images).catch(() => {});
  }

  // Click a picture to select it; drag its corner to resize (never wider than the note).
  ed.addEventListener("click", (e) => {
    const box = e.target.closest(".imgbox");
    if (!box || e.target.closest(".grip")) return;
    const i = Array.prototype.indexOf.call(ed.childNodes, box.parentNode);
    if (i < 0) return;
    ed.focus({ preventScroll: true });
    setSel(lineEndAbs(i));
    markCur();
  });
  ed.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".grip");
    if (!grip || e.button !== 0) return;
    e.preventDefault();
    const img = grip.parentNode.querySelector("img");
    const div = grip.closest(".img");
    const i = Array.prototype.indexOf.call(ed.childNodes, div);
    const m = IMG.exec(lines[i] || "");
    if (!img || !m) return;
    const x0 = e.clientX, w0 = img.getBoundingClientRect().width;
    let w = w0;
    div.classList.add("sizing");
    try { grip.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
    const move = (ev) => { w = Math.max(MIN_IMG, Math.min(maxImg(), w0 + ev.clientX - x0)); img.style.width = `${w}px`; };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      div.classList.remove("sizing");
      if (Math.round(w) === Math.round(w0)) return;
      const out = lines.slice();
      out[i] = `![](img:${m[1]} ${Math.round(w)})`;
      ed.focus({ preventScroll: true });
      let p = 0; for (let j = 0; j <= i; j++) p += out[j].length + (j < i ? 1 : 0);
      edit(out.join("\n"), p);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });
  ed.addEventListener("dragover", (e) => { if (Array.from(e.dataTransfer?.items || []).some((x) => x.kind === "file")) e.preventDefault(); });
  ed.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    let sel = null;
    if (r && ed.contains(r.startContainer)) { const p = toAbs(r.startContainer === ed ? { line: r.startOffset, ch: 0 } : lineOf(r.startContainer, r.startOffset)); sel = { s: p, e: p }; }
    insertImages(files, sel);
  });

  // ---- right-click menu: formats for the selection (Shift+right-click still opens Umbra's own menu) ----
  const menu = document.createElement("div");
  menu.className = "fmenu"; menu.hidden = true; menu.setAttribute("role", "menu"); menu.dataset.noDrag = "";
  const ICON = {
    b: '<b>B</b>', i: '<i>I</i>', u: '<u>U</u>', s: '<s>S</s>', h: '<span class="hl">H</span>',
  };
  menu.innerHTML = `
    <div class="frow">${["b", "i", "u", "s", "h"].map((k) => `<button type="button" class="fbtn" data-f="${k}" title="${{ b: "Bold (Ctrl+B)", i: "Italic (Ctrl+I)", u: "Underline (Ctrl+U)", s: "Strikethrough (Ctrl+Shift+X)", h: "Highlight (Ctrl+Shift+H)" }[k]}">${ICON[k]}</button>`).join("")}</div>
    <div class="frow colors">${COLORS.map((c) => `<button type="button" class="sw c-${c}" data-c="${c}" title="${c[0].toUpperCase() + c.slice(1)} text"><span></span></button>`).join("")}<button type="button" class="sw none" data-c="" title="No colour"><span></span></button></div>
    <div class="fsep"></div>
    <div class="frow blocks"><button type="button" class="fbtn wide" data-blk="h1" title="Heading 1">H1</button><button type="button" class="fbtn wide" data-blk="h2" title="Heading 2">H2</button><button type="button" class="fbtn wide" data-blk="h3" title="Heading 3">H3</button><button type="button" class="fbtn wide" data-blk="p" title="Normal text">Aa</button></div>
    <button type="button" class="fitem" data-blk="ul"><span class="ico">•</span>Bulleted list</button>
    <button type="button" class="fitem" data-blk="ol"><span class="ico">1.</span>Numbered list</button>
    <div class="fsep"></div>
    <button type="button" class="fitem" data-act="clear"><span class="ico">⌫</span>Clear formatting</button>
    <button type="button" class="fitem" data-act="copy"><span class="ico">⧉</span>Copy as plain text</button>`;
  document.querySelector(".notes").appendChild(menu);
  let menuSel = null;
  function openMenu(x, y) {
    menuSel = getSel();
    if (!menuSel) return;
    // Show what's already applied at the selection.
    const segs = segments(getText(), menuSel.s, menuSel.e);
    const probe = segs.length ? segs : [{ line: lineAtAbs(menuSel.s), a: menuSel.s, b: menuSel.e }];
    for (const b of menu.querySelectorAll("[data-f]")) b.classList.toggle("on", probe.every((g) => enclosing(g, b.dataset.f)));
    const col = probe.map((g) => enclosing(g, "c")?.color || "");
    for (const b of menu.querySelectorAll("[data-c]")) b.classList.toggle("on", col.every((c) => c === b.dataset.c) && !!b.dataset.c);
    const ln = lines[lineAtAbs(menuSel.s)] || "";
    const blk = /^\s*#\s/.test(ln) ? "h1" : /^\s*##\s/.test(ln) ? "h2" : /^\s*###\s/.test(ln) ? "h3" : /^\s*[-*]\s/.test(ln) ? "ul" : /^\s*\d+\.\s/.test(ln) ? "ol" : "p";
    for (const b of menu.querySelectorAll("[data-blk]")) b.classList.toggle("on", b.dataset.blk === blk);
    menu.querySelector('[data-act="copy"]').disabled = menuSel.s === menuSel.e;
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  }
  function closeMenu() { menu.hidden = true; menuSel = null; }
  ed.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    // A right-click outside the selection moves the caret there first (as the browser does).
    openMenu(e.clientX, e.clientY);
  });
  menu.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor's focus and selection
  menu.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || !menuSel) return;
    const sel = menuSel;
    closeMenu();
    if (document.activeElement !== ed) ed.focus({ preventScroll: true });
    setSel(sel.s, sel.e);
    if (b.dataset.f) applyFormat(b.dataset.f, null, sel);
    else if (b.dataset.c !== undefined) applyFormat("c", b.dataset.c || null, sel);
    else if (b.dataset.blk) setBlock(b.dataset.blk, sel);
    else if (b.dataset.act === "clear") clearFormat(sel);
    else if (b.dataset.act === "copy") {
      const t = plainOf(sel);
      try { await navigator.clipboard.writeText(t); setStatus("Copied"); } catch { setStatus("Couldn't copy"); }
    }
  });
  window.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  window.addEventListener("blur", closeMenu);
  ed.addEventListener("scroll", closeMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { e.preventDefault(); closeMenu(); } }, true);

  // ---- input ----
  function onInput() {
    if (composing) return;
    const prev = lines;
    const next = lines = readLines();
    // Measured against the new text: the old line is one character short, which would clamp the caret left of what was just typed.
    const sel = getSel();
    const joined = next.join("\n");
    if (!allDivs() || next.length !== prev.length || joined.length > MAX) {
      const text = joined.slice(0, MAX);
      fullRender(text, sel ? Math.min(sel.s, text.length) : text.length);
      commit(); pushHist(); return;
    }
    if (sel && sel.s === sel.e && joined.slice(Math.max(0, sel.s - 2), sel.s) === "->") {
      fullRender(joined.slice(0, sel.s - 2) + "→" + joined.slice(sel.s), sel.s - 1);
      commit(); pushHist(true); return;
    }
    const fn = getSelection().focusNode;
    const caretLine = sel && fn ? lineOf(fn, 0).line : -1;
    const built = [];
    next.forEach((t, i) => {
      if (t !== prev[i] || i === caretLine) { const d = buildLine(t); ed.replaceChild(d, ed.childNodes[i]); built.push(d); }
    });
    hang(built);
    if (sel) setSel(sel.s, sel.e);
    mark(); markCur(); commit(); pushHist();
  }
  ed.addEventListener("input", onInput);
  ed.addEventListener("compositionstart", () => { composing = true; });
  ed.addEventListener("compositionend", () => { composing = false; onInput(); });
  ed.addEventListener("beforeinput", (ev) => {
    if (ev.inputType === "insertParagraph" || ev.inputType === "insertLineBreak") ev.preventDefault();
    if (ev.inputType === "historyUndo") { ev.preventDefault(); undoRedo(-1); }
    if (ev.inputType === "historyRedo") { ev.preventDefault(); undoRedo(1); }
    if (ev.inputType.startsWith("format")) { ev.preventDefault(); return; } // the browser's own bold/italic: formats are text here
    if (ev.defaultPrevented) return;
    // Typing on a picture's line starts a new line after it.
    const cl = caretLine();
    if (cl >= 0 && isImg(lines[cl]) && (ev.inputType === "insertText" || ev.inputType === "insertReplacementText")) {
      ev.preventDefault();
      const at = lineEndAbs(cl), text = getText(), ins = "\n" + (ev.data || "");
      edit(text.slice(0, at) + ins + text.slice(at), at + ins.length);
      return;
    }
    // A selection that takes in a picture: replace whole picture lines through the text, never half of one.
    const sel = getSel();
    if (sel && sel.s !== sel.e && /^(delete|insertText$|insertReplacementText$)/.test(ev.inputType) && ev.inputType !== "deleteByCut" && touchesImg(sel)) {
      ev.preventDefault();
      const r = snapToImages(sel), text = getText(), ins = ev.inputType.startsWith("insert") ? (ev.data || "") : "";
      edit(text.slice(0, r.s) + ins + text.slice(r.e), r.s + ins.length);
    }
  });
  function touchesImg(sel) {
    for (let i = lineAtAbs(sel.s), last = lineAtAbs(sel.e); i <= last; i++) if (isImg(lines[i])) return true;
    return false;
  }
  /** Widen a selection so a picture line it touches is taken whole. */
  function snapToImages(sel) {
    let { s, e } = sel;
    const a = lineAtAbs(s), b = lineAtAbs(e);
    if (isImg(lines[a])) s = lineStartAbs(a);
    if (isImg(lines[b])) e = lineEndAbs(b);
    return { s, e };
  }
  ed.addEventListener("cut", (ev) => {
    const sel = getSel();
    if (!sel || sel.s === sel.e || !touchesImg(sel)) return;
    ev.preventDefault();
    const r = snapToImages(sel), text = getText();
    ev.clipboardData.setData("text/plain", text.slice(r.s, r.e));
    edit(text.slice(0, r.s) + text.slice(r.e), r.s);
  });
  ed.addEventListener("paste", (ev) => {
    ev.preventDefault();
    // A picture (a screenshot, an image copied in the browser) wins over any text that comes with it.
    const pics = Array.from(ev.clipboardData.files || []).filter((f) => f.type.startsWith("image/"));
    if (pics.length) { insertImages(pics, getSel()); return; }
    const t = (ev.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    if (!t) return;
    const text = getText();
    const sel = getSel() || { s: text.length, e: text.length };
    const room = MAX - (text.length - (sel.e - sel.s));
    const ins = t.slice(0, Math.max(0, room));
    edit(text.slice(0, sel.s) + ins + text.slice(sel.e), sel.s + ins.length);
  });

  ed.addEventListener("keydown", (ev) => {
    if (ev.isComposing || composing) return;
    const k = ev.key;
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && /^[zy]$/i.test(k)) {
      ev.preventDefault();
      undoRedo(k.toLowerCase() === "y" || ev.shiftKey ? 1 : -1);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
      const f = { b: "b", i: "i", u: "u" }[k.toLowerCase()];
      const fs = { x: "s", h: "h" }[k.toLowerCase()];
      if (f && !ev.shiftKey) { ev.preventDefault(); applyFormat(f); return; }
      if (fs && ev.shiftKey) { ev.preventDefault(); applyFormat(fs); return; }
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (imageKeys(ev, k)) return;
    const sel = getSel();
    if (!sel) return;
    const text = getText();
    if (k === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      const t2 = text.slice(0, sel.s) + text.slice(sel.e);
      const s = sel.s;
      const ls = t2.lastIndexOf("\n", s - 1) + 1;
      let le = t2.indexOf("\n", s); if (le < 0) le = t2.length;
      const m = LIST.exec(t2.slice(ls, le));
      if (m && s >= ls + m[1].length + m[2].length + m[3].length) {
        if (m[4].trim() === "") {
          if (m[1]) {
            const ln = m[1].slice(TAB.length) + m[2] + m[3];
            edit(t2.slice(0, ls) + ln + t2.slice(le), ls + ln.length);
          } else edit(t2.slice(0, ls) + t2.slice(le), ls);
        } else {
          const nm = /^\d+\.$/.test(m[2]) ? (parseInt(m[2], 10) + 1) + "." : m[2];
          const ins = "\n" + m[1] + nm + m[3];
          edit(t2.slice(0, s) + ins + t2.slice(s), s + ins.length);
        }
      } else edit(t2.slice(0, s) + "\n" + t2.slice(s), s + 1);
      return;
    }
    if (k === "Tab") {
      ev.preventDefault();
      const ls = sel.s ? text.lastIndexOf("\n", sel.s - 1) + 1 : 0;
      let le = text.indexOf("\n", sel.e); if (le < 0) le = text.length;
      const block = text.slice(ls, le).split("\n");
      if (ev.shiftKey) {
        const rm = block.map((l) => Math.min(TAB.length, /^ */.exec(l)[0].length));
        const total = rm.reduce((a, b) => a + b, 0);
        if (!total) return;
        const out = block.map((l, i) => l.slice(rm[i])).join("\n");
        const lastLine = ls + out.lastIndexOf("\n") + 1;
        edit(text.slice(0, ls) + out + text.slice(le), Math.max(ls, sel.s - rm[0]), Math.max(lastLine, sel.e - total));
      } else if (block.length === 1 && !LIST.test(block[0])) {
        edit(text.slice(0, sel.s) + TAB + text.slice(sel.e), sel.s + TAB.length);
      } else {
        edit(text.slice(0, ls) + block.map((l) => TAB + l).join("\n") + text.slice(le), sel.s + TAB.length, sel.e + TAB.length * block.length);
      }
    }
  });
  /** Keys around pictures: the caret on a picture's line selects it; arrows step over it, Backspace/Delete remove it. */
  function imageKeys(ev, k) {
    const cl = caretLine();
    if (cl < 0) return false;
    const text = getText();
    const removeLine = (i, caretOn) => {
      const out = lines.slice(); out.splice(i, 1);
      if (!out.length) out.push("");
      const t = out.join("\n");
      let p = 0; for (let j = 0; j < caretOn; j++) p += out[j].length + 1;
      edit(t, Math.min(t.length, p + (caretOn < out.length ? out[caretOn].length : 0)));
    };
    if (isImg(lines[cl])) {
      if (k === "Backspace" || k === "Delete") { ev.preventDefault(); removeLine(cl, Math.max(0, cl - 1)); return true; }
      if ((k === "ArrowLeft" || k === "ArrowUp") && !ev.shiftKey) { ev.preventDefault(); if (cl > 0) setSel(lineEndAbs(cl - 1)); return true; }
      if ((k === "ArrowRight" || k === "ArrowDown") && !ev.shiftKey) { ev.preventDefault(); if (cl < lines.length - 1) setSel(lineStartAbs(cl + 1)); return true; }
      if (k === "Enter") { ev.preventDefault(); const at = lineEndAbs(cl); edit(text.slice(0, at) + "\n" + text.slice(at), at + 1); return true; }
      if (k === "Home" || k === "End") { ev.preventDefault(); return true; }
      return false;
    }
    const ch = getSel().s - lineStartAbs(cl);
    if (k === "Backspace" && ch === 0 && cl > 0 && isImg(lines[cl - 1])) {
      ev.preventDefault();
      if (lines[cl] === "") removeLine(cl, cl - 1); else setSel(lineEndAbs(cl - 1));
      return true;
    }
    if (k === "Delete" && ch === lines[cl].length && cl < lines.length - 1 && isImg(lines[cl + 1])) {
      ev.preventDefault();
      if (lines[cl] === "") removeLine(cl, cl); else setSel(lineEndAbs(cl + 1));
      return true;
    }
    if (k === "ArrowRight" && !ev.shiftKey && ch === lines[cl].length && isImg(lines[cl + 1] || "")) { ev.preventDefault(); setSel(lineEndAbs(cl + 1)); return true; }
    if (k === "ArrowLeft" && !ev.shiftKey && ch === 0 && cl > 0 && isImg(lines[cl - 1])) { ev.preventDefault(); setSel(lineEndAbs(cl - 1)); return true; }
    return false;
  }

  ed.addEventListener("blur", flush);
  umbra.store.onChange(async () => {
    if (dirty || renaming >= 0 || tabDrag) return;
    images = await umbra.store.get("images", {});
    if (!images || typeof images !== "object" || Array.isArray(images)) images = {};
    imgBytes = JSON.stringify(images).length;
    [notes, names, active] = await Promise.all([umbra.store.get("notes", []), umbra.store.get("names", null), umbra.store.get("active", active)]);
    normalize(); drawTabs(); load();
  });
  umbra.onSettings(() => { drawTabs(); load(); });

  drawTabs(); load(); showActiveTab();
  // The prefix widths depend on the font; measure again once it has loaded.
  document.fonts.ready.then(() => hang(Array.from(ed.childNodes)));
  umbra.rendered();
})();
