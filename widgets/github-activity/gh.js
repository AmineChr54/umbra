(async () => {
  await umbra.ready;
  const $ = (id) => document.getElementById(id);
  const MIN_AGE = 15 * 60 * 1000;     // 5 requests per refresh: stays far below 60 per hour
  const COOLDOWN = 30 * 60 * 1000;    // after a rate-limit error
  const API = "https://api.github.com/repos/";
  let state = await umbra.store.get("cache", null); // { repo, at, data, retryAt, error }

  const repoOpt = () => {
    const r = String(umbra.options.repo || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
    return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null;
  };
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const ago = (iso) => {
    const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
    return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const link = (url) => () => umbra.openUrl(url);

  async function load(repo) {
    const get = (p) => umbra.fetchJson(API + repo + p);
    const [info, pulls, issues, runs] = await Promise.all([
      get(""), get("/pulls?state=open&per_page=6"), get("/issues?state=open&per_page=30"), get("/actions/runs?per_page=1"),
    ]);
    let release = null;
    try { release = await get("/releases/latest"); } catch (e) { if (!/404/.test(String(e))) throw e; }
    const run = runs.workflow_runs && runs.workflow_runs[0];
    return {
      url: info.html_url,
      pulls: pulls.map((p) => ({ n: p.number, t: p.title, u: p.html_url, at: p.updated_at })),
      issues: issues.filter((i) => !i.pull_request).map((i) => ({ n: i.number, t: i.title, u: i.html_url, at: i.updated_at })),
      prCount: pulls.length,
      issueCount: Math.max(0, info.open_issues_count - pulls.length),
      ci: run ? { status: run.status, conclusion: run.conclusion, u: run.html_url, name: run.name } : null,
      release: release ? { tag: release.tag_name, u: release.html_url, at: release.published_at } : null,
    };
  }

  function render() {
    const repo = repoOpt();
    $("repo").textContent = repo || "Set a repository";
    const note = $("note");
    note.className = "note";
    if (!repo) { note.textContent = "Enter owner/name in the widget options."; $("stats").replaceChildren(); $("list").replaceChildren(); return; }
    const d = state && state.repo === repo ? state.data : null;
    if (state && state.retryAt > Date.now()) { note.textContent = `Rate limited, retrying after ${hhmm(state.retryAt)}${d ? " - showing last data" : ""}`; note.classList.add("warn"); }
    else if (state && state.error && state.repo === repo) { note.textContent = (d ? "Offline - showing data from " + hhmm(state.at) : state.error); note.classList.add("warn"); }
    else if (d) note.textContent = "Updated " + hhmm(state.at);
    else note.textContent = "Loading...";
    if (!d) { $("stats").replaceChildren(); $("list").replaceChildren(); return; }

    const ci = d.ci, ciTxt = !ci ? "none" : ci.status !== "completed" ? "running" : ci.conclusion === "success" ? "passing" : ci.conclusion || "unknown";
    const ciCls = !ci ? "flat" : ci.status !== "completed" ? "flat" : ci.conclusion === "success" ? "up" : "down";
    const stat = (k, v, cls, url) => { const b = el("button", "stat"); b.type = "button"; b.append(el("div", "k", k), el("div", "v num " + cls, v)); b.onclick = link(url); return b; };
    $("stats").replaceChildren(
      stat("Pull requests", String(d.prCount) + (d.prCount >= 6 ? "+" : ""), "", d.url + "/pulls"),
      stat("Issues", String(d.issueCount), "", d.url + "/issues"),
      stat("CI", ciTxt, ciCls, ci ? ci.u : d.url + "/actions"));

    const rows = Math.min(6, Math.max(1, Number(umbra.options.rows) || 3));
    const list = $("list"); list.replaceChildren();
    const section = (title, items) => {
      list.append(el("div", "sec", title));
      if (!items.length) list.append(el("div", "empty", "None open"));
      for (const i of items.slice(0, rows)) {
        const b = el("button", "row"); b.type = "button"; b.onclick = link(i.u); b.title = i.t;
        b.append(el("span", "n num", "#" + i.n), el("span", "t", i.t), el("span", "w num", ago(i.at)));
        list.append(b);
      }
    };
    section("Pull requests", d.pulls);
    section("Issues", d.issues);
    list.append(el("div", "sec", "Latest release"));
    if (d.release) {
      const b = el("button", "row"); b.type = "button"; b.onclick = link(d.release.u);
      b.append(el("span", "t num", d.release.tag), el("span", "w num", ago(d.release.at)));
      list.append(b);
    } else list.append(el("div", "empty", "No releases"));
  }

  async function refresh(force) {
    const repo = repoOpt();
    if (!repo) return render();
    const same = state && state.repo === repo;
    if (same && !force) {
      if (state.retryAt > Date.now()) return render();
      if (state.data && !state.error && Date.now() - state.at < MIN_AGE) return render();
    }
    try {
      const data = await load(repo);
      state = { repo, at: Date.now(), data };
    } catch (e) {
      const msg = String(e && e.message || e);
      const prev = same ? state.data : null;
      state = { repo, at: same ? state.at : 0, data: prev, error: /404/.test(msg) ? "Repository not found" : "Could not reach GitHub" };
      if (/403|429|rate limit/i.test(msg)) state.retryAt = Date.now() + COOLDOWN;
    }
    umbra.store.set("cache", state).catch(() => {});
    render();
  }

  render();
  umbra.every(async () => { await refresh(false); umbra.rendered(); });
  umbra.onSettings(() => { if (state && state.repo !== repoOpt()) refresh(true); else render(); });
})();
