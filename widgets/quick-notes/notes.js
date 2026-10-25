(async () => {
  await umbra.ready;
  const $ = (id) => document.getElementById(id);
  const MAX = 100000;
  const ed = $("text");
  let notes = await umbra.store.get("notes", []);
  let active = await umbra.store.get("active", 0);
  let timer = null, dirty = false, composing = false;
  let lines = [""];
  let hist = [], hi = -1, histAt = 0;

  const nTabs = () => Math.min(5, Math.max(1, Number(umbra.options.tabs) || 3));
  const LIST = /^(\s*)([-*]|\d+\.)(\s)(.*)$/;
  const HEAD = /^(\s*)(#{1,3})(\s)(.*)$/;

  function drawTabs() {
    const t = nTabs();
    if (active >= t) active = t - 1;
    $("tabs").replaceChildren(...Array.from({ length: t }, (_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tab" + (i === active ? " on" : "") + ((notes[i] || "") && i !== active ? " full" : "");
      b.textContent = String(i + 1);
      b.title = `Note ${i + 1}`;
      b.onclick = async () => { await flush(); active = i; umbra.store.set("active", i); drawTabs(); load(); };
      return b;
    }));
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
    if (m) { d.className = "li"; d.appendChild(span("mk", m[1] + m[2] + m[3])); inline(d, m[4]); return d; }
    inline(d, t);
    return d;
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
    const sel = getSel();
    const next = readLines();
    const joined = next.join("\n");
    if (!allDivs() || next.length !== lines.length || joined.length > MAX) {
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
    next.forEach((t, i) => {
      if (t !== lines[i] || i === caretLine) ed.replaceChild(buildLine(t), ed.childNodes[i]);
    });
    lines = next;
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
          if (m[1].length >= 2) {
            const ln = m[1].slice(2) + m[2] + m[3];
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
      const ls = text.lastIndexOf("\n", sel.s - 1) + 1;
      let le = text.indexOf("\n", sel.s); if (le < 0) le = text.length;
      const line = text.slice(ls, le);
      if (!LIST.test(line)) return;
      ev.preventDefault();
      if (ev.shiftKey) {
        const rm = Math.min(2, /^ */.exec(line)[0].length);
        if (!rm) return;
        edit(text.slice(0, ls) + line.slice(rm) + text.slice(le), Math.max(ls, sel.s - rm), Math.max(ls, sel.e - rm));
      } else {
        edit(text.slice(0, ls) + "  " + line + text.slice(le), sel.s + 2, sel.e + 2);
      }
    }
  });
  ed.addEventListener("blur", flush);
  umbra.store.onChange(async () => { if (dirty) return; notes = await umbra.store.get("notes", []); drawTabs(); load(); });
  umbra.onSettings(() => { drawTabs(); load(); });

  drawTabs(); load();
  umbra.rendered();
})();
