(async () => {
  await umbra.ready;
  const $ = (id) => document.getElementById(id);
  const MAX = 100000;
  let notes = await umbra.store.get("notes", []);
  let active = await umbra.store.get("active", 0);
  let timer = null, dirty = false;

  const nTabs = () => Math.min(5, Math.max(1, Number(umbra.options.tabs) || 3));

  function count() {
    const n = $("text").value.length;
    $("count").textContent = `${umbra.fmt(n, 0)} character${n === 1 ? "" : "s"}`;
  }
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
  function load() {
    $("text").value = notes[active] || "";
    $("text").style.fontSize = `${Number(umbra.options.fontSize) || 14}px`;
    count();
  }
  async function flush() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    try { await umbra.store.set("notes", notes); $("status").textContent = "Saved"; }
    catch { $("status").textContent = "Could not save (too large)"; }
  }
  $("text").maxLength = MAX;
  $("text").addEventListener("input", () => {
    notes[active] = $("text").value;
    dirty = true; $("status").textContent = "Saving...";
    count(); drawTabs();
    clearTimeout(timer); timer = setTimeout(flush, 600);
  });
  $("text").addEventListener("blur", flush);
  umbra.store.onChange(async () => { if (dirty) return; notes = await umbra.store.get("notes", []); drawTabs(); load(); });
  umbra.onSettings(() => { drawTabs(); load(); });

  drawTabs(); load();
  umbra.rendered();
})();
