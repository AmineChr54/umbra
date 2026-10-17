// Application tracker: data in umbra.store ("apps"), no network.
const q = (id) => document.getElementById(id);
const STATUS = [
  { key: "saved", label: "Saved", color: "var(--flat)" },
  { key: "applied", label: "Applied", color: "var(--accent)" },
  { key: "interview", label: "Interview", color: "#ffb35c" },
  { key: "offer", label: "Offer", color: "var(--up)" },
  { key: "rejected", label: "Rejected", color: "var(--down)" },
];
const SBY = Object.fromEntries(STATUS.map((s) => [s.key, s]));
let apps = [], filter = "all", draft = null, deleteArmed = false;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isKey = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => keyOf(new Date());
const dayNum = (k) => { const [y, m, d] = k.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const fmtDay = new Intl.DateTimeFormat([], { day: "numeric", month: "short" });
const show = (k) => fmtDay.format(new Date(dayNum(k) * 864e5 + new Date().getTimezoneOffset() * 6e4));

const save = () => umbra.store.set("apps", apps).catch((e) => console.error("Tracker: could not save", e));
const valid = (a) => a && typeof a.company === "string" && SBY[a.status];

/** "due" (today or overdue), "soon" (within the option's days), or "" for open applications with a follow-up. */
function followState(a) {
  if (!isKey(a.follow) || a.status === "rejected" || a.status === "offer") return "";
  const diff = dayNum(a.follow) - dayNum(today());
  if (diff <= 0) return "due";
  return diff <= (Number(umbra.options.soonDays) || 0) ? "soon" : "";
}
const followText = (a) => {
  const diff = dayNum(a.follow) - dayNum(today());
  return diff < 0 ? `Overdue ${-diff}d` : diff === 0 ? "Follow up today" : `Follow up ${show(a.follow)}`;
};

function sorted(list) {
  const rank = { due: 0, soon: 1, "": 2 };
  return [...list].sort((a, b) => rank[followState(a)] - rank[followState(b)]
    || (a.follow && b.follow ? a.follow.localeCompare(b.follow) : a.follow ? -1 : b.follow ? 1 : 0)
    || (b.date || "").localeCompare(a.date || ""));
}

function render() {
  q("title").textContent = umbra.options.title || "Applications";
  const count = (k) => apps.filter((a) => a.status === k).length;
  const due = apps.filter((a) => followState(a) === "due").length;
  q("chips").innerHTML = [{ key: "all", label: "All", color: "var(--accent)", n: apps.length }, ...STATUS.map((s) => ({ ...s, n: count(s.key) }))]
    .map((c) => `<button class="chip" data-f="${c.key}" style="--c:${c.color}" aria-pressed="${filter === c.key}">${c.label} <b class="num">${c.n}</b></button>`).join("");
  const list = sorted(apps.filter((a) => filter === "all" || a.status === filter));
  q("list").innerHTML = list.length ? list.map((a) => {
    const st = SBY[a.status], fs = followState(a);
    return `<div class="item ${fs}" data-id="${a.id}" tabindex="0" style="--c:${st.color}">
      <span class="company">${esc(a.company)}</span><span class="status">${st.label}</span>
      <span class="role">${esc(a.role || "No role")}</span>
      <span class="dates num">${isKey(a.follow) ? `<span class="follow">${followText(a)}</span>` : isKey(a.date) ? `Applied ${show(a.date)}` : ""}</span>
    </div>`;
  }).join("") : `<div class="empty"><strong>${apps.length ? "Nothing with this status" : "No applications yet"}</strong>
      <span>${apps.length ? "Pick another filter above." : "Add the roles you are tracking and set a follow-up date."}</span>
      ${apps.length ? "" : '<button class="btn primary" id="empty-add" data-no-drag>Add application</button>'}</div>`;
  if (due && filter === "all") q("title").title = `${due} follow-up(s) due`;
}

// ---------- sheet ----------

function openSheet(a) {
  draft = a ? { ...a } : { id: uid(), company: "", role: "", status: "applied", date: today(), follow: "" };
  q("sheet-title").textContent = a ? "Edit application" : "New application";
  q("f-company").value = draft.company; q("f-role").value = draft.role || "";
  q("f-date").value = draft.date || ""; q("f-follow").value = draft.follow || "";
  q("delete").hidden = !a; deleteArmed = false; q("delete").textContent = "Delete"; q("delete").classList.remove("armed");
  q("f-status").innerHTML = STATUS.map((s) => `<button type="button" role="radio" data-s="${s.key}" style="--c:${s.color}" aria-checked="${draft.status === s.key}">${s.label}</button>`).join("");
  q("f-company").classList.remove("invalid");
  q("sheet").hidden = false;
  umbra.requestFocus(); q("f-company").focus();
}
const closeSheet = () => { q("sheet").hidden = true; draft = null; };

q("f-status").onclick = (e) => {
  const b = e.target.closest("[data-s]"); if (!b) return;
  draft.status = b.dataset.s;
  q("f-status").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
};
q("clear-follow").onclick = () => { q("f-follow").value = ""; };
q("close").onclick = q("cancel").onclick = closeSheet;
q("add").onclick = () => openSheet(null);
q("sheet").onsubmit = async (e) => {
  e.preventDefault();
  const company = q("f-company").value.trim();
  if (!company) { q("f-company").classList.add("invalid"); q("f-company").focus(); return; }
  Object.assign(draft, { company, role: q("f-role").value.trim(), date: isKey(q("f-date").value) ? q("f-date").value : "", follow: isKey(q("f-follow").value) ? q("f-follow").value : "" });
  const i = apps.findIndex((a) => a.id === draft.id);
  if (i >= 0) apps[i] = draft; else apps.push(draft);
  closeSheet(); render(); await save();
};
q("delete").onclick = async () => {
  if (!deleteArmed) { deleteArmed = true; q("delete").textContent = "Confirm delete"; q("delete").classList.add("armed"); return; }
  apps = apps.filter((a) => a.id !== draft.id);
  closeSheet(); render(); await save();
};
q("chips").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render(); } };
q("list").onclick = (e) => {
  if (e.target.closest("#empty-add")) return openSheet(null);
  const it = e.target.closest("[data-id]"); if (it) openSheet(apps.find((a) => a.id === it.dataset.id));
};
q("list").onkeydown = (e) => { if (e.key === "Enter") e.target.click?.(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !q("sheet").hidden) closeSheet(); });

umbra.onSettings(render);
umbra.store.onChange?.(async () => { apps = (await umbra.store.get("apps", [])).filter(valid); render(); });

(async () => {
  await umbra.ready;
  const stored = await umbra.store.get("apps", []);
  apps = Array.isArray(stored) ? stored.filter(valid) : [];
  render();
  umbra.rendered();
  setInterval(() => { if (q("sheet").hidden) render(); }, 3600e3);
})();
