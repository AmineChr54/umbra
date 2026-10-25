// Appearance + Advanced settings (General page) and per-widget refresh/opacity (My widgets).
// Self-contained: builds its own DOM, reads `state` and calls `save` from settings.js.
(function () {
  const g = () => state.settings.general;
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const opts = (list, cur) => list.map(([v, label]) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`).join("");

  const rows = [
    ["Corner radius", "Roundness of cards and tiles in widgets that use the design tokens.", "cornerRadius",
      [["default", "Default"], ["sharp", "Sharp"], ["round", "Round"]]],
    ["Animation speed", "Calm slows motion down; Off disables it (the same as the Animations switch).", "animationSpeed",
      [["normal", "Normal"], ["calm", "Calm"], ["off", "Off"]]],
    ["Interface font", "Font for widgets that use the design tokens.", "uiFont",
      [["default", "Segoe UI Variable"], ["Segoe UI", "Segoe UI"], ["Arial", "Arial"], ["Verdana", "Verdana"], ["Tahoma", "Tahoma"], ["Georgia", "Georgia"], ["Consolas", "Consolas"]]],
    ["Log level", "How much goes into umbra.log.", "logLevel",
      [["errors", "Errors only"], ["normal", "Normal"], ["verbose", "Verbose"]]],
  ];

  function build() {
    const page = document.querySelector('.page[data-page="general"]');
    if (!page || page.querySelector("#prefs-section")) return;
    const sec = el(`<div id="prefs-section"><h2 class="section-title" style="margin:24px 0 8px">Appearance and advanced</h2><div class="group" id="prefs-group"></div></div>`);
    const group = sec.querySelector("#prefs-group");
    const row = (title, sub, control) => el(`<div class="row"><div class="row-text"><div class="row-title">${title}</div><div class="row-sub">${sub}</div></div>${control}</div>`);
    for (const [title, sub, key, list] of rows)
      group.append(row(title, sub, `<select id="pf-${key}" aria-label="${title}"></select>`));
    group.append(row("Default opacity", "Window opacity of widgets without their own. Percent; 20 to 100.", `<input type="number" id="pf-defaultOpacity" min="20" max="100" step="5" style="width:72px" aria-label="Default opacity percent">`));
    group.append(row("Allow notifications", "Default for widgets that can show notifications; each widget can override it.", `<label class="switch"><input type="checkbox" id="pf-defaultNotifications"><span></span></label>`));
    group.append(row("Scale all widgets", "Makes every widget on the desktop bigger or smaller right now, on top of its own size. 50 to 150%.", `<span class="pf-size"><input type="range" class="range" id="pf-size" min="50" max="150" step="5" aria-label="Scale all widgets"><output id="pf-sizeVal"></output></span>`));
    group.append(row("Size of new widgets", "Starting size for widgets you add from now on and for any widget you reset to the default size. Widgets you already sized keep their size. 50 to 300%.", `<input type="number" id="pf-defaultScale" min="50" max="300" step="5" style="width:72px" aria-label="Size of new widgets">`));
    group.append(row("Interface text size", "Percent; 80 to 140. Affects widgets that size text from the design tokens.", `<input type="number" id="pf-fontScale" min="80" max="140" step="5" style="width:72px" aria-label="Interface text size">`));
    group.append(row("Window border", "The hairline around widget windows.", `<span style="display:flex;gap:10px;align-items:center"><input type="color" id="pf-borderColor" aria-label="Border color"><label class="switch"><input type="checkbox" id="pf-borderEnabled"><span></span></label></span>`));
    group.append(row("Match Windows accent", "Follows the accent color of Windows and updates when it changes. Dark accents are lightened to stay readable.", `<label class="switch"><input type="checkbox" id="pf-accentWindows"><span></span></label>`));
    group.append(row("Accent color", "Overrides the theme's accent. Reset to follow the theme.", `<span style="display:flex;gap:10px;align-items:center"><input type="color" id="pf-accent" aria-label="Accent color"><button class="btn" id="pf-accentReset">Reset</button></span>`));
    group.append(row("Light text", "Brighter text colors for busy or bright wallpapers.", `<label class="switch"><input type="checkbox" id="pf-lightText"><span></span></label>`));
    group.append(row("Reduce transparency", "Solid lines and tints, and fully opaque widget windows (ignores per-widget opacity).", `<label class="switch"><input type="checkbox" id="pf-reduceTransparency"><span></span></label>`));
    group.append(row("Developer mode", "Adds Inspect (devtools, console) to the widget right-click menu. Widgets opened after the change; leave off normally.", `<label class="switch"><input type="checkbox" id="pf-developerMode"><span></span></label>`));
    group.append(row("Hardware acceleration", "Turn off if widgets flicker or the GPU misbehaves. Restart Umbra to apply.", `<span style="display:flex;gap:10px;align-items:center"><button class="btn small" id="pf-restart-hw" style="display:none">Restart now</button><label class="switch"><input type="checkbox" id="pf-hardwareAcceleration"><span></span></label></span>`));
    group.append(row("Startup delay", "Seconds to wait after signing in before Umbra starts (0 to 300).", `<input type="number" id="pf-startupDelaySeconds" min="0" max="300" step="1" style="width:72px" aria-label="Startup delay seconds">`));
    group.append(row("Proxy", "system, none, or https://host:port for widget requests and update checks. Restart Umbra to apply.", `<span style="display:flex;gap:10px;align-items:center"><button class="btn small" id="pf-restart-proxy" style="display:none">Restart now</button><input type="text" id="pf-proxy" placeholder="system" style="width:200px" aria-label="Proxy"></span>`));
    group.append(row("Log file", "Opens umbra.log.", `<button class="btn" id="pf-openLog">Open log</button>`));
    page.append(sec);

    const bind = (key, read, write) => {
      const input = sec.querySelector("#pf-" + key);
      input.addEventListener("change", () => { write(g(), input); save(true); });
    };
    for (const [, , key] of rows) bind(key, null, (gen, i) => (gen[key] = i.value));
    bind("defaultScale", null, (gen, i) => { const v = Math.max(50, Math.min(300, Math.round(Number(i.value) || 100))); i.value = v; gen.defaultScale = v / 100; });
    const sizeIn = sec.querySelector("#pf-size");
    const showSize = () => { sec.querySelector("#pf-sizeVal").textContent = sizeIn.value + "%"; sizeIn.style.setProperty("--p", sizeIn.value - 50 + "%"); };
    sizeIn.addEventListener("input", showSize);
    bind("size", null, (gen, i) => { gen.size = Number(i.value) / 100; showSize(); });
    bind("defaultOpacity", null, (gen, i) => { const v = Math.max(20, Math.min(100, Math.round(Number(i.value) || 100))); i.value = v; gen.defaultOpacity = v / 100; });
    bind("defaultNotifications", null, (gen, i) => (gen.defaultNotifications = i.checked));
    bind("fontScale", null, (gen, i) => { const v = Math.max(80, Math.min(140, Math.round(Number(i.value) || 100))); i.value = v; gen.fontScale = v / 100; });
    bind("borderEnabled", null, (gen, i) => (gen.borderEnabled = i.checked));
    bind("borderColor", null, (gen, i) => (gen.borderColor = i.value));
    bind("accent", null, (gen, i) => (gen.accent = i.value));
    bind("accentWindows", null, (gen, i) => (gen.accent = i.checked ? "windows" : ""));
    bind("lightText", null, (gen, i) => (gen.lightText = i.checked));
    bind("reduceTransparency", null, (gen, i) => (gen.reduceTransparency = i.checked));
    sec.querySelector("#pf-accentReset").addEventListener("click", () => { g().accent = ""; save(true); window.prefsRender(); });
    bind("developerMode", null, (gen, i) => (gen.developerMode = i.checked));
    // Both only apply on start: after a change in this session, offer to restart right here.
    const needsRestart = (btn) => { sec.querySelector(btn).style.display = ""; };
    for (const b of ["#pf-restart-hw", "#pf-restart-proxy"])
      sec.querySelector(b).addEventListener("click", () => { flushSave(); post({ type: "restart" }); });
    bind("hardwareAcceleration", null, (gen, i) => { gen.hardwareAcceleration = i.checked; needsRestart("#pf-restart-hw"); });
    bind("startupDelaySeconds", null, (gen, i) => { const v = Math.max(0, Math.min(300, Math.round(Number(i.value) || 0))); i.value = v; gen.startupDelaySeconds = v; });
    bind("proxy", null, (gen, i) => { gen.proxy = i.value.trim() || "system"; needsRestart("#pf-restart-proxy"); });
    sec.querySelector("#pf-openLog").addEventListener("click", () => post({ type: "openLog" }));
  }

  window.prefsRender = function () {
    build();
    const gen = g();
    for (const [, , key, list] of rows) {
      const s = document.getElementById("pf-" + key);
      if (s) s.innerHTML = opts(list, gen[key] || list[0][0]);
    }
    const set = (id, fn) => { const i = document.getElementById("pf-" + id); if (i && document.activeElement !== i) fn(i); };
    set("defaultScale", (i) => (i.value = Math.round((gen.defaultScale || 1) * 100)));
    set("size", (i) => { i.value = Math.round((gen.size || 1) * 100); document.getElementById("pf-sizeVal").textContent = i.value + "%"; i.style.setProperty("--p", i.value - 50 + "%"); });
    set("defaultOpacity", (i) => (i.value = Math.round((gen.defaultOpacity || 1) * 100)));
    set("defaultNotifications", (i) => (i.checked = !!gen.defaultNotifications));
    set("fontScale", (i) => (i.value = Math.round((gen.fontScale || 1) * 100)));
    set("borderEnabled", (i) => (i.checked = gen.borderEnabled !== false));
    set("borderColor", (i) => (i.value = gen.borderColor || "#26282e"));
    const win = String(gen.accent || "").toLowerCase() === "windows";
    set("accentWindows", (i) => (i.checked = win));
    set("accent", (i) => { i.value = win ? state.systemAccent || "#8b93ff" : gen.accent || "#8b93ff"; i.disabled = win; });
    const reset = document.getElementById("pf-accentReset");
    if (reset) reset.disabled = win;
    set("lightText", (i) => (i.checked = !!gen.lightText));
    set("reduceTransparency", (i) => (i.checked = !!gen.reduceTransparency));
    set("developerMode", (i) => (i.checked = !!gen.developerMode));
    set("hardwareAcceleration", (i) => (i.checked = gen.hardwareAcceleration !== false));
    set("startupDelaySeconds", (i) => (i.value = gen.startupDelaySeconds || 0));
    set("proxy", (i) => (i.value = gen.proxy && gen.proxy !== "system" ? gen.proxy : ""));
  };

  // Per-widget host options (#282): Size, Monitor and Start hidden stay visible; refresh, opacity, notifications and
  // the show-when rules sit in one "Advanced" section (markup in the #tpl-installed template, one row pattern for all).
  window.prefsCard = function (card, w) {
    const box = card.querySelector(".hostopts");
    if (!box) return;
    const cur = () => state.settings.widgets[w.id];
    const ws = cur();
    const adv = box.querySelector(".hostadv-src");
    adv.replaceWith(optionSection(w.id, "Advanced", [...adv.children], "host-advanced"));
    const r = box.querySelector(".pw-refresh"), o = box.querySelector(".pw-opacity");
    r.value = ws.refreshSeconds || "";
    o.value = ws.opacity ? Math.round(ws.opacity * 100) : "";
    const nl = box.querySelector(".pw-notif-l"), nt = box.querySelector(".pw-notif");
    nl.hidden = !w.notifications; // the one notifications control; only for widgets that declare the permission
    nt.options[0].textContent = g().defaultNotifications ? "Default (on)" : "Default (off)";
    nt.value = ws.notifications === true ? "on" : ws.notifications === false ? "off" : "";
    nt.addEventListener("change", () => { cur().notifications = nt.value === "" ? null : nt.value === "on"; save(true); });
    r.addEventListener("change", () => {
      const v = r.value === "" ? null : Math.max(30, Math.min(600, Math.round(Number(r.value) || 60)));
      r.value = v === null ? "" : v;
      cur().refreshSeconds = v;
      save(true);
    });
    o.addEventListener("change", () => {
      const v = o.value === "" ? null : Math.max(20, Math.min(100, Math.round(Number(o.value) || 100)));
      o.value = v === null ? "" : v;
      cur().opacity = v === null ? null : v / 100;
      save(true);
    });
    const hid = box.querySelector(".pw-hidden"), from = box.querySelector(".pw-from"), to = box.querySelector(".pw-to"), ac = box.querySelector(".pw-ac");
    const sw = ws.showWhen || {};
    hid.checked = !!ws.startHidden; from.value = sw.from || ""; to.value = sw.to || ""; ac.value = sw.onAc === true ? "ac" : sw.onAc === false ? "battery" : "";
    hid.addEventListener("change", () => { cur().startHidden = hid.checked; save(true); });
    const rules = () => {
      const keep = (cur().showWhen || {}).monitor;
      const r = {};
      if (from.value && to.value) { r.from = from.value; r.to = to.value; }
      if (ac.value) r.onAc = ac.value === "ac";
      if (keep) r.monitor = keep;
      cur().showWhen = Object.keys(r).length ? r : null;
      save(true);
    };
    for (const e of [from, to, ac]) e.addEventListener("change", rules);
  };
})();
