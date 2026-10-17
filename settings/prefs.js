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
    group.append(row("Default size for new widgets", "Percent; 50 to 300.", `<input type="number" id="pf-defaultScale" min="50" max="300" step="5" style="width:72px" aria-label="Default size">`));
    group.append(row("Developer mode", "Right-click a widget for devtools (inspect, console). Widgets opened after the change; leave off normally.", `<label class="switch"><input type="checkbox" id="pf-developerMode"><span></span></label>`));
    group.append(row("Hardware acceleration", "Turn off if widgets flicker or the GPU misbehaves. Restart Umbra to apply.", `<label class="switch"><input type="checkbox" id="pf-hardwareAcceleration"><span></span></label>`));
    group.append(row("Startup delay", "Seconds to wait after signing in before Umbra starts (0 to 300).", `<input type="number" id="pf-startupDelaySeconds" min="0" max="300" step="1" style="width:72px" aria-label="Startup delay seconds">`));
    group.append(row("Proxy", "system, none, or https://host:port for widget requests and update checks. Restart Umbra to apply.", `<input type="text" id="pf-proxy" placeholder="system" style="width:200px" aria-label="Proxy">`));
    group.append(row("Log file", "Opens umbra.log.", `<button class="btn" id="pf-openLog">Open log</button>`));
    page.append(sec);

    const bind = (key, read, write) => {
      const input = sec.querySelector("#pf-" + key);
      input.addEventListener("change", () => { write(g(), input); save(true); });
    };
    for (const [, , key] of rows) bind(key, null, (gen, i) => (gen[key] = i.value));
    bind("defaultScale", null, (gen, i) => { const v = Math.max(50, Math.min(300, Math.round(Number(i.value) || 100))); i.value = v; gen.defaultScale = v / 100; });
    bind("developerMode", null, (gen, i) => (gen.developerMode = i.checked));
    bind("hardwareAcceleration", null, (gen, i) => (gen.hardwareAcceleration = i.checked));
    bind("startupDelaySeconds", null, (gen, i) => { const v = Math.max(0, Math.min(300, Math.round(Number(i.value) || 0))); i.value = v; gen.startupDelaySeconds = v; });
    bind("proxy", null, (gen, i) => (gen.proxy = i.value.trim() || "system"));
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
    set("developerMode", (i) => (i.checked = !!gen.developerMode));
    set("hardwareAcceleration", (i) => (i.checked = gen.hardwareAcceleration !== false));
    set("startupDelaySeconds", (i) => (i.value = gen.startupDelaySeconds || 0));
    set("proxy", (i) => (i.value = gen.proxy && gen.proxy !== "system" ? gen.proxy : ""));
  };

  // Per-widget refresh interval and opacity, appended to a card's option fields.
  window.prefsCard = function (card, w) {
    const fields = card.querySelector(".fields");
    if (!fields) return;
    const cur = () => state.settings.widgets[w.id];
    const ws = cur();
    const box = el(`<div class="prefs-widget" style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;align-items:center">
      <label>Refresh (s) <input type="number" class="pw-refresh" min="30" max="600" step="10" style="width:72px" placeholder="global" aria-label="Own refresh interval seconds"></label>
      <label>Opacity (%) <input type="number" class="pw-opacity" min="20" max="100" step="5" style="width:72px" aria-label="Opacity percent"></label></div>`);
    const r = box.querySelector(".pw-refresh"), o = box.querySelector(".pw-opacity");
    r.value = ws.refreshSeconds || "";
    o.value = Math.round((ws.opacity || 1) * 100);
    r.addEventListener("change", () => {
      const v = r.value === "" ? null : Math.max(30, Math.min(600, Math.round(Number(r.value) || 60)));
      r.value = v === null ? "" : v;
      cur().refreshSeconds = v;
      save(true);
    });
    o.addEventListener("change", () => {
      const v = Math.max(20, Math.min(100, Math.round(Number(o.value) || 100)));
      o.value = v;
      cur().opacity = v >= 100 ? null : v / 100;
      save(true);
    });
    fields.after(box);
  };
})();
