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
    const first = (notes[i] || "").split("\n").map((l) => l.replace(/^\s*(#{1,3}|[-*]|\d+\.)\s+/, "").replace(/\*\*/g, "").trim()).find(Boolean);
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
    undoTimer = setTimeout(() => { st.hidden = true; }, 8000);
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
  const span = (cls, t) => { const s = document.createElement("span"); s.className = cls; s.textContent = t; return s; };
  function inline(parent, t) {
    t.split(/(\*\*[^*\n]+\*\*)/).forEach((p) => {
      if (!p) return;
      if (/^\*\*[^*\n]+\*\*$/.test(p)) {
        const b = document.createElement("b");
        b.append(span("mk", "**"), p.slice(2, -2), span("mk", "**"));
        parent.appendChild(b);
      } else parent.appendChild(document.createTextNode(p));
    });
  }
  function buildLine(t) {
    const d = document.createElement("div");
    if (t === "") { d.appendChild(document.createElement("br")); return d; }
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
    const w = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { if (abs <= n.length) return [n, abs]; abs -= n.length; }
    return [div, 0];
  }
  function setSel(s, e) {
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
  }

  // ---- state, saving, history ----
  function count() {
    const n = getText().length;
    $("count").textContent = `${umbra.fmt(n, 0)} character${n === 1 ? "" : "s"}`;
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
    count();
  }

  // Apply a text-level edit, re-render, remember it.
  function edit(text, s, e) {
    if (text.length > MAX) { text = text.slice(0, MAX); s = Math.min(s, MAX); e = Math.min(e == null ? s : e, MAX); }
    fullRender(text, s, e);
    commit(); pushHist(true);
  }

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
    mark(); commit(); pushHist();
  }
  ed.addEventListener("input", onInput);
  ed.addEventListener("compositionstart", () => { composing = true; });
  ed.addEventListener("compositionend", () => { composing = false; onInput(); });
  ed.addEventListener("beforeinput", (ev) => {
    if (ev.inputType === "insertParagraph" || ev.inputType === "insertLineBreak") ev.preventDefault();
    if (ev.inputType === "historyUndo") { ev.preventDefault(); undoRedo(-1); }
    if (ev.inputType === "historyRedo") { ev.preventDefault(); undoRedo(1); }
  });
  ed.addEventListener("paste", (ev) => {
    ev.preventDefault();
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
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
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
  ed.addEventListener("blur", flush);
  umbra.store.onChange(async () => {
    if (dirty || renaming >= 0 || tabDrag) return;
    [notes, names, active] = await Promise.all([umbra.store.get("notes", []), umbra.store.get("names", null), umbra.store.get("active", active)]);
    normalize(); drawTabs(); load();
  });
  umbra.onSettings(() => { drawTabs(); load(); });

  drawTabs(); load(); showActiveTab();
  // The prefix widths depend on the font; measure again once it has loaded.
  document.fonts.ready.then(() => hang(Array.from(ed.childNodes)));
  umbra.rendered();
})();
