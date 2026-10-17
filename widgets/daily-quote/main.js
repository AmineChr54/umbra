const $ = id => document.getElementById(id);
const LABEL = { quote: { en: "Quote of the day", de: "Zitat des Tages" }, word: { en: "Word of the day", de: "Wort des Tages" } };
let shownDay = null;

// Days since a fixed local epoch, shifted so the day rolls over at dayStart.
function dayNumber(now, startHour) {
  const shifted = new Date(now.getTime() - startHour * 36e5);
  return Math.floor(Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()) / 864e5);
}

function render() {
  const o = umbra.options;
  const mode = o.mode === "word" ? "word" : "quote", lang = o.language === "de" ? "de" : "en";
  const start = Math.max(0, Math.min(23, Math.floor(+o.dayStart || 0)));
  const now = new Date(), n = dayNumber(now, start);
  const list = DATA[mode][lang], [a, b] = list[((n % list.length) + list.length) % list.length];
  shownDay = n;
  $("kind").textContent = LABEL[mode][lang];
  const m = $("main");
  m.className = "main" + (mode === "word" ? " word" : "");
  m.textContent = mode === "word" ? a : `“${a}”`;
  $("sub").textContent = mode === "word" ? b : `— ${b}`;
  const shifted = new Date(now.getTime() - start * 36e5);
  $("date").textContent = shifted.toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
}

(async () => {
  await umbra.ready;
  render();
  umbra.rendered();
  umbra.onSettings(render);
  setInterval(() => {
    const start = Math.max(0, Math.min(23, Math.floor(+umbra.options.dayStart || 0)));
    if (dayNumber(new Date(), start) !== shownDay) render();
  }, 60000);
})();
