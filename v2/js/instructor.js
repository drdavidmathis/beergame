// Instructor screens: create session, lobby, live dashboard, debrief, log.
import * as E from "./engine.js";
import { DEFAULTS, TIERS, TIER_LABELS } from "./config.js";
import { createSession, Host } from "./host.js";
import { esc, $, $$, int, money, money0, tierLabel, tierColor, cssVar, topbar, toast, elapsed, toCSV, download } from "./ui.js";
import * as C from "./charts.js";
import { renderDebrief } from "./debrief.js";

const RECENT = "bg-recent-sessions";
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { return []; } };

export async function mount(root, store, code, banner) {
  if (!code) return renderCreate(root, store, banner);
  return dashboard(root, store, code, banner);
}

// =====================================================================
// Create session
// =====================================================================
function renderCreate(root, store, banner) {
  const d = DEFAULTS;
  const num = (id, label, val, hint = "", step = "1") =>
    `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="number" min="0" step="${step}" value="${val}">${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  const rec = recent();
  root.innerHTML = `${banner}${topbar()}
  <div class="wrap mid stack">
    <h1>New session</h1>
    ${rec.length ? `<div class="card flat"><h3>Your recent sessions</h3><div class="row">${rec.slice(0, 8).map(r =>
      `<a class="btn small" href="#/host/${esc(r.code)}">${esc(r.code)} <span class="tiny">${esc(r.mode)} · ${new Date(r.at).toLocaleDateString()}</span></a>`).join("")}</div></div>` : ""}
    <form id="create" class="card" autocomplete="off">
      <fieldset><legend>Structure</legend>
        <div class="field"><div class="seg" id="modeSeg">
          <button type="button" data-mode="network">One class-wide network</button>
          <button type="button" data-mode="classic">Several classic games</button></div></div>
        <div class="fields" id="netFields">
          ${num("networkDistributors", "Distributor teams", d.networkDistributors)}
          ${num("networkWholesalers", "Wholesaler teams", d.networkWholesalers)}
          ${num("networkRetailers", "Retailer teams", d.networkRetailers)}
        </div>
        <div class="fields" id="classicFields">
          ${num("classicTeamSize", "Students per role-team", d.classicTeamSize, "Games are formed from however many students join.")}
        </div>
      </fieldset>
      <fieldset><legend>Customer demand (per retailer)</legend>
        <div class="fields">
          <div class="field"><label for="demandType">Pattern</label><select id="demandType" name="demandType">
            <option value="step">Step</option><option value="custom">Custom list</option></select></div>
          ${num("demandBase", "Starting demand", d.demandBase)}
          ${num("demandStepWeek", "Step happens in week", d.demandStepWeek)}
          ${num("demandStepTo", "Demand after step", d.demandStepTo)}
        </div>
        <div class="field hidden" id="customWrap"><label for="demandCustom">Weekly demand, comma separated (last value repeats)</label>
          <input id="demandCustom" name="demandCustom" placeholder="4,4,4,4,8,8,8"></div>
      </fieldset>
      <fieldset><legend>Timing</legend>
        <div class="fields">
          ${num("weeks", "Game length (weeks)", d.weeks, "Hidden from students.")}
          ${num("orderDelay", "Order delay (weeks)", d.orderDelay)}
          ${num("shipDelay", "Shipping delay (weeks)", d.shipDelay)}
          ${num("productionDelay", "Brewing time (weeks)", d.productionDelay)}
          ${num("startingInventoryWeeks", "Starting inventory (weeks of flow)", d.startingInventoryWeeks, "", "0.5")}
        </div>
      </fieldset>
      <fieldset><legend>Costs and brewery</legend>
        <div class="fields">
          ${num("holdingCost", "Holding cost $/case/week", d.holdingCost, "", "0.05")}
          ${num("backorderCost", "Backorder cost $/case/week", d.backorderCost, "", "0.05")}
          ${num("normalCapacity", "Brewery normal capacity", 0, "", "1")}
          ${num("surgeCapacity", "Brewery maximum with surge", 0, "", "1")}
          ${num("surgePremium", "Surge cost $/case", d.surgePremium, "", "0.05")}
        </div>
        <p class="tiny" id="capHint"></p>
      </fieldset>
      <fieldset><legend>Order checks</legend>
        <div class="fields">
          ${num("warnMultiple", "Ask to confirm above", d.warnMultiple, "× recent incoming orders", "0.5")}
          ${num("hardMaxRetailer", "Retailer hard max", d.hardMaxRetailer, "× normal weekly flow", "1")}
          ${num("hardMaxWholesaler", "Wholesaler hard max", d.hardMaxWholesaler, "× normal weekly flow", "1")}
          ${num("hardMaxDistributor", "Distributor hard max", d.hardMaxDistributor, "× normal weekly flow", "1")}
        </div>
        <p class="tiny" id="limHint"></p>
      </fieldset>
      <fieldset><legend>Computer players and late arrivals</legend>
        <div class="fields">
          <div class="field"><label for="botStyle">Computer player style</label><select id="botStyle" name="botStyle">
            <option value="steady">Steady: one predictable rule</option>
            <option value="mixed">Mixed: each team gets a different style</option>
            <option value="conservative">Conservative</option>
            <option value="reactive">Reacts strongly to changes</option>
            <option value="forecast">Forecast-based</option></select></div>
          ${num("botSeed", "Random seed", d.botSeed, "Same seed = same mix, for repeatable tests.")}
          <div class="field"><label for="autoPlaceLate">Students who join late</label><select id="autoPlaceLate" name="autoPlaceLate">
            <option value="true">Seat them automatically</option><option value="false">I'll seat them from the Teams tab</option></select></div>
        </div>
      </fieldset>
      <fieldset><legend>Information sharing</legend>
        <div class="field"><select id="sharing" name="sharing">
          <option value="off">Off: each team sees only its own numbers (classic)</option>
          <option value="on">On: everyone also sees customer demand and supply-chain totals</option>
          <option value="split" id="splitOpt">Split: half the games share, half do not</option>
        </select></div>
      </fieldset>
      <div class="row spread"><div class="small muted" id="summary"></div><button class="primary big" type="submit">Create session</button></div>
    </form>
    <div class="row spread"><a class="small" href="#/lab">Simulation lab: run a whole game with computer players and inspect every week</a>
    ${store.local ? `<button class="small danger" id="wipe">Clear all test data in this browser</button>` : ""}</div>
  </div>`;

  let mode = d.mode;
  const touched = new Set();
  const f = $("#create");
  const val = () => {
    const o = { ...DEFAULTS, mode };
    for (const el of f.elements) if (el.name) o[el.name] = el.type === "number" ? Number(el.value) : el.value;
    return o;
  };
  const refresh = () => {
    $$("#modeSeg button").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
    $("#netFields").classList.toggle("hidden", mode !== "network");
    $("#classicFields").classList.toggle("hidden", mode !== "classic");
    $("#splitOpt").disabled = mode !== "classic";
    if (mode !== "classic" && $("#sharing").value === "split") $("#sharing").value = "off";
    $("#customWrap").classList.toggle("hidden", $("#demandType").value !== "custom");
    const c = E.normalizeConfig(val());
    const cap = E.suggestedCapacity(c);
    if (!touched.has("normalCapacity")) f.normalCapacity.value = cap.normal;
    if (!touched.has("surgeCapacity")) f.surgeCapacity.value = cap.surge;
    $("#capHint").textContent = `Peak customer demand reaching the brewery: ${cap.peakDemand} cases/week${mode === "classic" ? " per game" : ""}. Suggested: normal ${cap.normal}, surge up to ${cap.surge}.`;
    const base = c.demandBase, R = c.mode === "classic" ? 1 : c.networkRetailers;
    const wFlow = base * (c.mode === "classic" ? 1 : R / c.networkWholesalers);
    const dFlow = base * (c.mode === "classic" ? 1 : R / c.networkDistributors);
    $("#limHint").textContent = `Hard maximum orders per week: Retailer ${Math.round(c.hardMaxRetailer * base)}, Wholesaler ${Math.round(c.hardMaxWholesaler * wFlow)}, Distributor ${Math.round(c.hardMaxDistributor * dFlow)}. The brewery is limited by its surge capacity.`;
    $("#summary").textContent = mode === "network"
      ? `${1 + c.networkDistributors + c.networkWholesalers + c.networkRetailers} teams in one network.`
      : `Four teams per game; about ${c.classicTeamSize} students per team.`;
  };
  $$("#modeSeg button").forEach(b => b.onclick = () => { mode = b.dataset.mode; refresh(); });
  f.addEventListener("input", e => { if (e.target.name === "normalCapacity" || e.target.name === "surgeCapacity") touched.add(e.target.name); refresh(); });
  f.addEventListener("change", refresh);
  f.onsubmit = async e => {
    e.preventDefault();
    const c = val();
    if (Number(c.surgeCapacity) < Number(c.normalCapacity)) { toast("Surge maximum must be at least the normal capacity."); return; }
    e.submitter.disabled = true;
    const code = await createSession(store, c);
    localStorage.setItem(RECENT, JSON.stringify([{ code, at: Date.now(), mode }, ...recent()].slice(0, 12)));
    location.hash = `#/host/${code}`;
  };
  $("#wipe") && ($("#wipe").onclick = () => {
    if (!confirm("Delete every test session stored in this browser?")) return;
    store.wipe(); localStorage.removeItem(RECENT); toast("Test data cleared."); renderCreate(root, store, banner);
  });
  refresh();
  return () => { };
}

// =====================================================================
// Dashboard
// =====================================================================
function dashboard(root, store, code, banner) {
  const ui = { tab: "live", sel: null, modal: null, audit: [], chatMsgs: [], deb: {} };
  let raf = 0, timer, chatUnsub = null, auditUnsub = null, chatTeam = null, frame = "";
  const P = `sessions/${code}`;
  const joinUrl = `${location.origin}${location.pathname}#/play/${code}`;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  const host = new Host(store, code, schedule);
  host.start();
  timer = setInterval(() => $$("[data-since]").forEach(el => el.textContent = elapsed(Date.now() - Number(el.dataset.since))), 1000);

  const own = () => host.isOwner();
  const running = () => own() && host.session?.status === "running";
  const netsList = () => (host.session?.networks || []).map(n => host.nets[n.id]).filter(Boolean);
  const players = () => host.players;
  const sortTeams = list => list.sort((a, b) => (a.netId || "").localeCompare(b.netId || "", undefined, { numeric: true })
    || TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const teamLabel = t => t.game && t.game !== "Network" ? `${t.game} · ${t.label}` : t.label;

  async function act(fn, ok) {
    try { await fn(); if (ok) toast(ok); } catch (e) { console.error(e); toast(e.message || "Something went wrong."); }
    schedule();
  }

  // ---------------- frame ----------------
  function render() {
    const s = host.session;
    if (!s) {
      frame = "";
      root.innerHTML = `${banner}${topbar()}<div class="wrap narrow"><div class="card"><h2>Loading session ${esc(code)}…</h2><p class="small muted">If this doesn't load, the code may be wrong. <a href="#/host">Start a new session</a>.</p></div></div>`;
      return;
    }
    if (s.status === "lobby") return renderLobby();
    if (frame !== "main") {
      frame = "main";
      root.innerHTML = `${banner}<div id="top"></div><div class="wrap">
        <div id="alerts"></div>
        <div class="tabs" role="tablist">${[["live", "Live"], ["teams", "Teams"], ["debrief", "Debrief"], ["log", "Log"]].map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join("")}</div>
        <div id="body"></div></div><div id="drawer"></div><div id="modal"></div>`;
      $$(".tabs button").forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; debKey = ""; renderBody(); markTabs(); });
    }
    renderTop();
    markTabs();
    renderBody();
    renderDrawer();
  }
  function markTabs() { $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === ui.tab)); }

  function renderTop() {
    const s = host.session;
    const st = s.status === "ended" ? `<span class="pill">Ended</span>` : s.paused ? `<span class="pill warn">Paused</span>` : `<span class="pill good">Running</span>`;
    const weeks = netsList()[0]?.config.weeks;
    $("#top").innerHTML = topbar(`
      <span class="small muted">Session</span><span class="pill accent" style="font-size:1rem;letter-spacing:.08em">${esc(code)}</span>${st}
      ${weeks ? `<span class="small muted" title="Hidden from students">Length: <b>${weeks} weeks</b></span>` : ""}
      ${own() ? `<button class="small" id="extend" title="Add 5 weeks; students are not told">+5 weeks</button>` : ""}
      <button class="small ghost" id="copy" title="${esc(joinUrl)}">Copy join link</button>
      ${running() ? `<button class="small" id="pause">${s.paused ? "Resume" : "Pause"}</button>
      <button class="small" id="settings">Settings</button>
      <button class="small danger" id="end">End game</button>` : ""}
      <button class="small" id="export">Export</button>`);
    $("#copy").onclick = () => { navigator.clipboard?.writeText(joinUrl); toast("Join link copied"); };
    $("#extend") && ($("#extend").onclick = () => act(() => host.extendGame(5), `Game extended to ${weeks + 5} weeks. Students aren't told.`));
    $("#pause") && ($("#pause").onclick = () => act(() => host.setPaused(!s.paused)));
    $("#settings") && ($("#settings").onclick = () => { ui.modal = "settings"; renderModal(); });
    $("#end") && ($("#end").onclick = () => {
      if (!confirm("End the game for everyone now? Students will see the debrief.")) return;
      act(async () => { await host.endGame(); ui.tab = "debrief"; debKey = ""; ui.sel = null; });
    });
    $("#export").onclick = () => { ui.modal = "export"; renderModal(); };
    const alerts = [];
    if (!own()) alerts.push(`<div class="msg warn">This session was created in a different browser, so you can watch but not control it. Open it from the browser you used to create it.</div>`);
    if (host.error) alerts.push(`<div class="msg error"><b>Problem:</b> ${esc(host.error)}</div>`);
    const unseated = players().filter(p => !p.teamId).length;
    if (unseated && s.status === "running") alerts.push(`<div class="msg info">${unseated} student${unseated > 1 ? "s" : ""} not on a team yet. ${host.config?.autoPlaceLate === false ? `Seat them from the <b>Teams</b> tab.` : "Seating automatically…"}</div>`);
    $("#alerts").innerHTML = alerts.length ? `<div class="stack">${alerts.join("")}</div>` : "";
  }

  // ---------------- lobby ----------------
  function renderLobby() {
    frame = "lobby";
    const ps = players(), s = host.session, c = host.config;
    const teams = sortTeams(Object.values(host.teams));
    let plan = "";
    if (c && ps.length && !s.assigned) {
      if (c.mode === "network") {
        const T = 1 + c.networkDistributors + c.networkWholesalers + c.networkRetailers;
        plan = `${T} teams in one network, about ${Math.max(1, Math.round(ps.length / T))} per team${ps.length < T ? "; teams without students are played by the computer" : ""}.`;
      } else {
        const g = Math.max(1, Math.round(ps.length / (4 * c.classicTeamSize)));
        plan = `${g} game${g > 1 ? "s" : ""} of four teams, about ${Math.max(1, Math.round(ps.length / (4 * g)))} students per team.`;
      }
    }
    const typed = $("#rosterSearch")?.value || "";
    root.innerHTML = `${banner}${topbar(`<span class="pill">Lobby</span><button class="small" id="export">Export</button>`)}
      <div class="wrap stack">
        <div class="card joincard">
          <p class="bigline muted" style="margin:0">Go to</p>
          <p style="font-size:1.4rem;font-weight:700;word-break:break-all;margin:.2em 0 .6em">${esc(location.origin + location.pathname)}</p>
          <p class="bigline muted" style="margin:0">and enter code</p>
          <div class="code-big">${esc(code)}</div>
          <p class="muted" style="margin-top:12px">Use your first name and last initial.</p>
        </div>
        <div class="card stack">
          <div class="row spread"><h2 style="margin:0">${ps.length} joined</h2>
            ${own() ? `<div class="row"><button id="assign" ${ps.length ? "" : "disabled"}>${s.assigned ? "Reshuffle teams" : "Auto-assign teams"}</button>
              <button class="primary big" id="start" ${ps.length ? "" : "disabled"}>Start game</button></div>` : ""}</div>
          <p class="small muted" style="margin:0">${s.assigned
            ? "Teams are assigned at random. Adjust anyone below, then start. Students who join now are added to the smallest teams when you start."
            : `${esc(plan)} Auto-assign to see teams and adjust them, or just press Start to assign at random.`}</p>
          ${s.assigned ? teamSummary(teams) : ""}
          ${ps.length ? rosterTable(ps, teams, false) : ""}
        </div>
      </div><div id="modal"></div>`;
    $("#assign") && ($("#assign").onclick = () => {
      if (s.assigned && !confirm("Reshuffle everyone into new random teams?")) return;
      act(() => host.autoAssign());
    });
    $("#start") && ($("#start").onclick = e => { e.target.disabled = true; act(() => host.startGame()); });
    $("#export").onclick = () => { ui.modal = "export"; renderModal(); };
    wireRoster(root);
  }

  function teamSummary(teams) {
    return `<div class="chips">${teams.map(t => {
      const n = Object.keys(t.members || {}).length;
      return `<span class="chip" style="border-left:4px solid ${tierColor(t.tier)}">${esc(teamLabel(t))}: <b>${n}</b>${n ? "" : " (computer)"}</span>`;
    }).join("")}</div>`;
  }

  function teamOptions(teams, current) {
    const groups = {};
    for (const t of teams) (groups[t.netName || t.game || ""] ||= []).push(t);
    const opt = t => `<option value="${t.id}" ${t.id === current ? "selected" : ""}>${esc(t.label)} (${Object.keys(t.members || {}).length})</option>`;
    const g = Object.entries(groups);
    return `<option value="" ${!current ? "selected" : ""}>Unassigned</option>` + (g.length > 1
      ? g.map(([name, ts]) => `<optgroup label="${esc(name)}">${ts.map(opt).join("")}</optgroup>`).join("")
      : g.flatMap(([, ts]) => ts).map(opt).join(""));
  }

  // One row per student: team, captain, remove.
  function rosterTable(ps, teams, live) {
    const sorted = [...ps].sort((a, b) => (a.teamId ? 1 : 0) - (b.teamId ? 1 : 0)
      || (a.teamId || "").localeCompare(b.teamId || "", undefined, { numeric: true }) || a.name.localeCompare(b.name));
    const dup = new Set(ps.map(p => p.name.toLowerCase()).filter((n, i, arr) => arr.indexOf(n) !== i));
    const canEdit = own() && (host.session.status === "lobby" ? host.session.assigned : host.session.status === "running");
    return `<div class="scrollx"><table class="roster"><thead><tr><th>Student</th><th>Team</th><th>Captain</th><th></th></tr></thead><tbody>
      ${sorted.map(p => {
        const t = host.teams[p.teamId];
        const isCap = t && t.captain === p.id;
        return `<tr><td>${esc(p.name)}${dup.has(p.name.toLowerCase()) ? ` <span class="pill warn" title="Two students share this name. If one is a duplicate entry, remove it.">same name</span>` : ""}</td>
          <td>${canEdit ? `<select data-move="${p.id}">${teamOptions(teams, p.teamId)}</select>` : esc(t ? teamLabel(t) : "Unassigned")}</td>
          <td>${t ? (isCap ? `<span class="pill accent">★ Captain</span>` : canEdit ? `<button class="small ghost" data-cap="${p.id}" data-team="${t.id}">Make captain</button>` : "") : ""}</td>
          <td>${own() ? `<button class="small ghost danger" data-remove="${p.id}" title="Remove this entry">Remove</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function wireRoster(scope) {
    $$("[data-move]", scope).forEach(sel => sel.onchange = e => act(() => host.moveStudent(sel.dataset.move, e.target.value || null)));
    $$("[data-cap]", scope).forEach(b => b.onclick = () => act(() => host.setCaptain(b.dataset.team, b.dataset.cap)));
    $$("[data-remove]", scope).forEach(b => b.onclick = () => {
      const p = players().find(x => x.id === b.dataset.remove);
      if (confirm(`Remove ${p?.name}? Use this for duplicate entries or students who left.`)) act(() => host.removeStudent(b.dataset.remove));
    });
  }

  // ---------------- body ----------------
  let debKey = "";
  function renderBody() {
    const body = $("#body");
    if (ui.tab === "live") renderLive(body);
    else if (ui.tab === "teams") renderTeams(body);
    else if (ui.tab === "debrief") {
      const nets = netsList();
      const key = JSON.stringify(nets.map(n => [n.id, n.week, n.status, n.configChanges?.length, n.config.weeks]));
      if (key === debKey) return;
      debKey = key;
      renderDebrief(body, nets, ui.deb);
    } else renderLog(body);
  }

  // ---------------- teams tab ----------------
  function renderTeams(body) {
    if (body.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return; // don't yank a dropdown
    const teams = sortTeams(Object.values(host.teams));
    body.innerHTML = `<div class="stack">
      <div class="card"><h3>Teams</h3><div class="scrollx"><table class="roster"><thead><tr><th>Team</th><th>Students</th><th>Captain</th><th>This week</th><th>Computer plays</th></tr></thead><tbody>
      ${teams.map(t => {
        const net = host.nets[t.netId];
        const st = net ? teamStatus(net, t.id) : { text: "" };
        const mem = Object.entries(t.members || {});
        return `<tr><td><span class="dot" style="background:${tierColor(t.tier)}"></span> ${esc(teamLabel(t))}</td>
          <td class="small">${mem.length ? mem.map(([, n]) => esc(n)).join(", ") : `<span class="muted">none</span>`}</td>
          <td>${running() && mem.length ? `<select data-capteam="${t.id}"><option value="">None</option>${mem.map(([id, n]) => `<option value="${id}" ${t.captain === id ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : esc(t.captainName || "")}</td>
          <td class="small">${esc(st.text)}${st.since ? ` <span data-since="${st.since}">${elapsed(Date.now() - st.since)}</span>` : ""}</td>
          <td>${running() ? `<input type="checkbox" data-bot="${t.id}" ${t.bot ? "checked" : ""} style="width:auto">` : t.bot ? "yes" : ""}</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="tiny">Tick “Computer plays” for a team with no students or an absent team; untick it when a student takes over.</p></div>
      <div class="card"><h3>Students (${players().length})</h3>${rosterTable(players(), teams, true)}</div>
    </div>`;
    wireRoster(body);
    $$("[data-capteam]", body).forEach(sel => sel.onchange = e => act(() => host.setCaptain(sel.dataset.capteam, e.target.value || null)));
    $$("[data-bot]", body).forEach(ck => ck.onchange = e => act(() => host.setBot(ck.dataset.bot, e.target.checked)));
  }

  // ---------------- live tab ----------------
  function teamStatus(net, id) {
    const t = host.teams[id];
    const o = host.orderFor(id, net.week);
    if (net.status !== "playing") return { cls: "", text: "Done" };
    if (o) return { cls: "", text: `✓ ${int(o.qty)}${o.source === "captain" ? "" : o.source === "instructor" ? " (you)" : o.source === "previous" ? " (repeat)" : " (computer)"}` };
    if (t?.bot) return { cls: "", text: "Computer" };
    const wait = Date.now() - net.weekStartedAt;
    return { cls: wait > 90000 ? "late" : "waiting", text: "Waiting", since: net.weekStartedAt };
  }

  function renderLive(body) {
    const nets = netsList();
    if (!nets.length) { body.innerHTML = `<p class="muted">Setting up…</p>`; return; }
    if (body.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    const stalled = stalledHTML(nets);
    if (nets[0].mode === "network") body.innerHTML = stalled + networkHTML(nets[0]);
    else body.innerHTML = stalled + classicHTML(nets);
    wireNet(body);
    $$("[data-id]", body).forEach(n => n.onclick = () => { ui.sel = n.dataset.id; renderDrawer(); markSel(); });
    markSel();
  }

  function stalledHTML(nets) {
    const waiting = nets.filter(n => n.status === "playing").flatMap(n => host.waitingTeams(n).map(id => ({ n, id })));
    if (!waiting.length || !running()) return "";
    const oldest = Math.min(...waiting.map(w => w.n.weekStartedAt));
    return `<div class="card" style="margin-bottom:14px"><div class="row spread"><h3 style="margin:0">Waiting on ${waiting.length} team${waiting.length > 1 ? "s" : ""}</h3>
      <button class="small" data-remindall="1">Remind all waiting teams</button></div>
      <div class="scrollx"><table class="roster" style="margin-top:8px"><tbody>
      ${waiting.sort((a, b) => a.n.weekStartedAt - b.n.weekStartedAt).map(({ n, id }) => {
        const t = n.teams[id], team = host.teams[id];
        const late = Date.now() - n.weekStartedAt > 90000;
        return `<tr><td><span class="dot" style="background:${tierColor(t.tier)}"></span> <b>${esc(teamLabel(team || t))}</b></td>
          <td class="small ${late ? "" : "muted"}" style="${late ? "color:var(--bad);font-weight:700" : ""}">waiting <span data-since="${n.weekStartedAt}">${elapsed(Date.now() - n.weekStartedAt)}</span>${team?.nudgeAt && team.nudgeAt > n.weekStartedAt ? " · reminded" : ""}</td>
          <td class="small muted">${team?.captainName ? "★ " + esc(team.captainName) : "no captain"}</td>
          <td><div class="btnrow">
            <button class="small" data-remind="${id}">Remind</button>
            <button class="small" data-repeat="${id}">Repeat last (${int(t.lastOrder)})</button>
            <button class="small" data-cpu="${id}">Computer decides</button>
            <button class="small ghost" data-id="${id}">Enter…</button></div></td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="tiny">${oldest ? "" : ""}Each of these is logged. The week advances on its own once every team has a decision.</p></div>`;
  }

  function netHeader(net) {
    const waiting = net.status === "playing" ? host.waitingTeams(net) : [];
    const total = Object.keys(net.teams).length;
    return `<div class="row spread">
      <div class="row"><h2 style="margin:0">${esc(net.name)}</h2>
        <span class="pill accent" style="font-size:.95rem">Week ${net.week}${net.status === "done" ? " · finished" : ""}</span>
        ${net.status === "playing" ? `<span class="small muted">${total - waiting.length} of ${total} teams in · this week <span data-since="${net.weekStartedAt}">${elapsed(Date.now() - net.weekStartedAt)}</span></span>` : ""}
      </div>
      ${running() ? netButtons(net, waiting.length) : ""}
    </div>`;
  }
  function netButtons(net, waiting, small = false) {
    const cls = small ? `class="small ghost" style="padding:2px 6px"` : `class="small"`;
    return `<div class="row" style="gap:4px">
      ${net.status === "playing" ? `<button ${cls} data-act="advance" data-net="${net.id}" ${waiting ? "" : "disabled"} title="Teams that haven't submitted repeat last week's order">Advance now</button>` : ""}
      <button ${cls} data-act="undo" data-net="${net.id}" ${net.week > 1 || net.status === "done" ? "" : "disabled"}>Undo last week</button>
      ${small ? "" : `<button class="small danger" data-act="restart" data-net="${net.id}">Restart</button>`}</div>`;
  }

  function wireNet(scope) {
    $$("[data-act]", scope).forEach(b => b.onclick = e => {
      e.stopPropagation();
      const net = host.nets[b.dataset.net], a = b.dataset.act;
      if (a === "advance") {
        const names = host.waitingTeams(net).map(id => net.teams[id].label).join(", ");
        if (confirm(`Advance ${net.name} now? These teams will repeat last week's order: ${names}`)) act(() => host.forceAdvance(net.id));
      } else if (a === "undo") {
        const w = net.status === "playing" ? net.week - 1 : E.completedWeeks(net);
        if (confirm(`Undo week ${w} for ${net.name}? The game pauses so you can fix things, then press Resume.\n\nTo fix a single wrong order, it's usually better to click the team and use "Correct an order".`)) act(() => host.undoWeek(net.id));
      } else if (a === "restart") {
        if (confirm(`Restart ${net.name} from week 1? All orders will be erased.`)) act(() => host.restartNet(net.id));
      }
    });
    $$("[data-remind]", scope).forEach(b => b.onclick = () => act(() => host.remind(b.dataset.remind), "Reminder sent."));
    $$("[data-remindall]", scope).forEach(b => b.onclick = () => act(async () => {
      for (const n of netsList()) for (const id of host.waitingTeams(n)) await host.remind(id);
    }, "Reminders sent."));
    $$("[data-repeat]", scope).forEach(b => b.onclick = () => act(() => host.decideFor(b.dataset.repeat, "previous")));
    $$("[data-cpu]", scope).forEach(b => b.onclick = () => act(() => host.decideFor(b.dataset.cpu, "computer")));
  }

  function networkHTML(net) {
    const B = Object.values(net.teams).find(t => t.tier === "brewery");
    const prev = B.history.filter(e => e.order != null).slice(-1)[0];
    const cfg = net.config;
    const owed = Object.values(B.backlog).reduce((a, b) => a + b, 0);
    const totalCost = Object.values(net.teams).reduce((s, t) => s + t.cost.total, 0);
    const bOrder = host.orderFor(B.id, net.week);
    const pending = (net.configChanges || []).find(c => c.week === net.week + 1);
    return `<div class="stack">
      <div class="card">${netHeader(net)}<div style="margin-top:10px">${networkSVG(net)}</div>
        <div class="legend" style="margin-top:6px"><span>Click a team for details, chat and corrections.</span>
        <span><span class="dot" style="background:var(--warn)"></span> waiting</span><span><span class="dot" style="background:var(--bad)"></span> waiting over 90s</span></div></div>
      <div class="grid2">
        <div class="card"><h3>Brewery</h3>
          <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
            <div class="stat"><div class="k">This week's production</div><div class="v">${bOrder ? int(bOrder.qty) : "—"}</div></div>
            <div class="stat"><div class="k">Last week's production</div><div class="v">${prev ? int(prev.order) : "—"}</div><div class="tiny">${prev ? `${Math.round(100 * prev.order / Math.max(1, cfg.normalCapacity))}% of normal capacity${prev.surge ? `, ${int(prev.surge)} surge` : ""}` : ""}</div></div>
            <div class="stat ${owed ? "bad" : ""}"><div class="k">Backlog owed to distributors</div><div class="v">${int(owed)}</div></div>
            <div class="stat"><div class="k">Being brewed</div><div class="v">${int(B.shipPipe.reduce((a, b) => a + b, 0))}</div><div class="tiny">${B.shipPipe.map(int).join(" · ")}</div></div>
          </div>
          <p class="small muted" style="margin:10px 0 0">Capacity: normal ${int(cfg.normalCapacity)}, surge up to ${int(cfg.surgeCapacity)} at ${money(cfg.surgePremium)}/case.
          ${pending ? `<br><b>From week ${pending.week}:</b> ${Object.entries(pending.changes).map(([k, v]) => `${settingLabel(k)} ${v}`).join(", ")}` : ""}</p>
        </div>
        <div class="card"><h3>Whole supply chain</h3>
          <div class="kpis">
            <div class="stat"><div class="k">Total cost so far</div><div class="v">${money0(totalCost)}</div></div>
            <div class="stat"><div class="k">Customer demand this week</div><div class="v">${int(net.demand[net.demand.length - 1] * Object.values(net.teams).filter(t => t.tier === "retailer").length)}</div></div>
          </div>
          <table style="margin-top:10px"><thead><tr><th>Tier</th><th>Inventory</th><th>Backorders</th><th>Cost</th></tr></thead><tbody>
          ${TIERS.map(t => {
            const ts = Object.values(net.teams).filter(x => x.tier === t);
            return `<tr><td><span class="dot" style="background:${tierColor(t)}"></span> ${tierLabel(t)}${ts.length > 1 ? "s" : ""}</td><td>${int(ts.reduce((s, x) => s + x.inv, 0))}</td><td>${int(ts.reduce((s, x) => s + Object.values(x.backlog).reduce((a, b) => a + b, 0), 0))}</td><td>${money0(ts.reduce((s, x) => s + x.cost.total, 0))}</td></tr>`;
          }).join("")}</tbody></table>
        </div>
      </div></div>`;
  }

  function networkSVG(net) {
    const W = 1000, rowY = { brewery: 16, distributor: 128, wholesaler: 240, retailer: 352 }, h = 82;
    const byTier = Object.fromEntries(TIERS.map(t => [t, Object.keys(net.teams).filter(id => net.teams[id].tier === t).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))]));
    const pos = {};
    for (const t of TIERS) {
      const ids = byTier[t], col = W / ids.length, w = Math.min(150, col - 10);
      ids.forEach((id, i) => pos[id] = { x: col * i + (col - w) / 2, y: rowY[t], w });
    }
    let edges = "", nodes = "";
    for (const id of Object.keys(net.teams)) {
      const t = net.teams[id];
      if (!t.supplier) continue;
      const a = pos[t.supplier], b = pos[id];
      const x1 = a.x + a.w / 2, y1 = a.y + h, x2 = b.x + b.w / 2, y2 = b.y, my = (y1 + y2) / 2;
      edges += `<path class="edge" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
    }
    for (const id of Object.keys(net.teams)) {
      const t = net.teams[id], p = pos[id], team = host.teams[id] || {};
      const st = teamStatus(net, id);
      const owe = Object.values(t.backlog).reduce((a, b) => a + b, 0);
      const n = Object.keys(team.members || {}).length;
      const cap = team.bot ? "" : team.captainName ? `★ ${team.captainName}` : `No captain · ${n} member${n === 1 ? "" : "s"}`;
      const col = st.cls === "late" ? "bad" : "warn";
      nodes += `<g class="node ${st.cls}" data-id="${id}" transform="translate(${p.x},${p.y})">
        <rect class="box" width="${p.w}" height="${h}" rx="8"/><rect width="5" height="${h}" rx="2" fill="${tierColor(t.tier)}"/>
        <text class="lbl" x="12" y="18">${esc(t.label)}</text>
        <text class="sub" x="12" y="35" ${st.cls ? `style="fill:var(--${col});font-weight:700"` : ""}>${esc(st.text)}${st.since ? ` <tspan data-since="${st.since}">${elapsed(Date.now() - st.since)}</tspan>` : ""}</text>
        <text class="sub" x="12" y="52">Inv ${int(t.inv)} · Owes ${int(owe)}</text>
        <text class="sub" x="12" y="69">${esc(cap.length > 22 ? cap.slice(0, 21) + "…" : cap)}</text></g>`;
    }
    return `<svg class="netsvg" viewBox="0 0 ${W} 440" role="img" aria-label="Supply network status">${edges}${nodes}</svg>`;
  }

  function classicHTML(nets) {
    const order = ["brewery", "distributor", "wholesaler", "retailer"];
    return `<div class="card"><div class="row spread"><h2 style="margin:0">${nets.length} game${nets.length > 1 ? "s" : ""}</h2>
      <div class="legend"><span>Brewery → Distributor → Wholesaler → Retailer. Click a team for details.</span></div></div>
      <div class="games" style="margin-top:12px">${nets.map(net => {
        const waiting = net.status === "playing" ? host.waitingTeams(net).length : 0;
        return `<div class="gamerow">
          <div><b>${esc(net.name)}</b><div class="tiny">Week ${net.week}${net.status === "done" ? " · done" : ""}${net.sharing ? " · sharing" : ""}</div>
            <div class="tiny">${money0(Object.values(net.teams).reduce((s, t) => s + t.cost.total, 0))}</div>
            ${running() ? netButtons(net, waiting, true) : ""}</div>
          ${order.map(tier => {
            const id = Object.keys(net.teams).find(k => net.teams[k].tier === tier);
            const t = net.teams[id], team = host.teams[id] || {}, st = teamStatus(net, id);
            const owe = Object.values(t.backlog).reduce((a, b) => a + b, 0);
            return `<div class="tnode ${st.cls}" data-id="${id}" style="border-left:5px solid ${tierColor(tier)}">
              <b>${tierLabel(tier)}</b>
              <span style="${st.cls ? `color:var(--${st.cls === "late" ? "bad" : "warn"});font-weight:700` : "color:var(--ink-2)"}">${esc(st.text)} ${st.since ? `<span data-since="${st.since}">${elapsed(Date.now() - st.since)}</span>` : ""}</span>
              <div class="tiny">Inv ${int(t.inv)} · Owes ${int(owe)}</div>
              <div class="tiny">${team.bot ? "Computer" : team.captainName ? "★ " + esc(team.captainName) : "No captain"}</div></div>`;
          }).join("")}</div>`;
      }).join("")}</div></div>`;
  }

  function markSel() { $$("[data-id]").forEach(n => n.classList.toggle("sel", n.dataset.id === ui.sel)); }

  // ---------------- team drawer ----------------
  let drawerKey = "";
  function renderDrawer() {
    const box = $("#drawer");
    if (!box) return;
    if (!ui.sel || !host.teams[ui.sel] || !host.nets[host.teams[ui.sel].netId]) { box.innerHTML = ""; drawerKey = ""; watchChat(null); return; }
    const team = host.teams[ui.sel], net = host.nets[team.netId], t = net.teams[ui.sel];
    const o = host.orderFor(ui.sel, net.week);
    const key = JSON.stringify([ui.sel, net.week, net.status, team, o, t.history.length, t.history.map(e => e.order), ui.chatMsgs.length, host.session.paused]);
    if (key === drawerKey) return;
    if (box.contains(document.activeElement) && ["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
    drawerKey = key;
    watchChat(ui.sel);
    const live = running() && net.status === "playing";
    const L = net.status === "playing" ? E.limitsFor(net, ui.sel) : null;
    const members = Object.entries(team.members || {});
    const done = E.completedWeeks(net);
    const noun = t.tier === "brewery" ? "production" : "order";
    const srcLabel = { team: "", instructor: "you", previous: "repeat", computer: "computer" };
    box.innerHTML = `<div class="drawer stack">
      <div class="row spread"><div><h2 style="margin:0">${esc(t.label)}</h2><div class="tiny">${esc(net.name)}${t.supplier ? ` · buys from ${esc(net.teams[t.supplier].label)}` : ""}</div></div>
        <button class="ghost" id="close" aria-label="Close">✕</button></div>
      <div><h3>Students</h3>
        ${members.length ? `<div class="chips">${members.map(([id, n]) => `<span class="chip">${id === team.captain ? "★ " : ""}${esc(n)}</span>`).join("")}</div>` : `<span class="muted small">No students</span>`}
        ${running() ? `<div class="row small" style="margin-top:8px">
          ${members.length ? `<label class="small" style="margin:0">Captain <select id="dcap" style="width:auto">${[`<option value="">None</option>`, ...members.map(([id, n]) => `<option value="${id}" ${team.captain === id ? "selected" : ""}>${esc(n)}</option>`)].join("")}</select></label>` : ""}
          <label class="row small" style="font-weight:600;gap:6px;margin:0"><input type="checkbox" id="botck" style="width:auto" ${team.bot ? "checked" : ""}> Computer plays this team</label></div>` : ""}
      </div>
      <div><h3>Week ${net.week} ${noun}</h3>
        ${net.status !== "playing" ? `<p class="muted">Game finished.</p>` : o
          ? `<div class="msg good">${int(o.qty)} cases · ${o.source === "captain" ? `submitted by ${esc(o.byName)}` : o.source === "instructor" ? "entered by you" : o.source === "previous" ? "repeated last week's" : "chosen by the computer"}${o.previousQty != null ? ` (was ${int(o.previousQty)})` : ""}</div>`
          : `<div class="msg ${team.bot ? "info" : "warn"}">${team.bot ? "The computer will decide when the week advances." : "Not submitted yet."}</div>`}
        ${live && !team.bot && !o ? `<div class="btnrow" style="margin-top:8px">
          <button class="small" data-remind="${ui.sel}">Remind team</button>
          <button class="small" data-repeat="${ui.sel}">Repeat last (${int(t.lastOrder)})</button>
          <button class="small" data-cpu="${ui.sel}">Computer decides</button></div>` : ""}
      </div>
      ${running() ? `<div><h3>Enter or correct an ${noun}</h3>
        <form id="ovform" class="stack" autocomplete="off">
          <div class="row">
            <select id="ovweek" style="width:auto">${net.status === "playing" ? `<option value="${net.week}">Week ${net.week} (this week)</option>` : ""}${Array.from({ length: done }, (_, i) => done - i).map(w => `<option value="${w}">Week ${w} (was ${int(t.history[w - 1].order)})</option>`).join("")}</select>
            <input id="ovqty" inputmode="numeric" placeholder="Cases" style="width:90px">
            <button class="small" type="submit">Save</button></div>
          <input id="ovnote" placeholder="Reason (for the log, optional)">
          <div class="tiny">${L ? `Limit ${int(L.max)}. ` : ""}Correcting a past week recalculates every week after it, using the orders teams actually submitted, so inventories and backorders stay consistent. The team gets a note in its chat.</div>
        </form></div>` : ""}
      <div><h3>Recent weeks</h3><div class="scrollx"><table><thead><tr><th>Wk</th><th>Recv</th><th>In</th><th>Ship</th><th>Inv</th><th>Owe</th><th>${t.tier === "brewery" ? "Brew" : "Order"}</th></tr></thead><tbody>
        ${t.history.slice(-8).reverse().map(e => `<tr><td>${e.week}</td><td>${int(e.received)}</td><td>${int(e.incoming)}</td><td>${int(e.shipped)}</td><td>${int(e.inv)}</td><td>${int(e.backlog)}</td><td>${e.order == null ? "—" : int(e.order)}${srcLabel[e.source] ? ` <span class="tiny">${srcLabel[e.source]}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
        <p class="tiny">Total cost ${money(t.cost.total)}${team.bot ? ` · computer style: ${esc(E.BOT_STYLES[t.botStyle]?.label || "steady")}` : ""}</p></div>
      <div><h3>Team chat</h3><div class="chat card flat" style="height:300px"><div class="log" id="dchat">${ui.chatMsgs.map(m => m.kind === "system"
        ? `<div class="sys">${esc(m.text)}</div>` : `<div class="bubble"><div class="who">${esc(m.name)}</div><div class="t">${esc(m.text)}</div></div>`).join("") || `<div class="sys">No messages yet.</div>`}</div></div></div>
    </div>`;
    const dc = $("#dchat"); dc.scrollTop = dc.scrollHeight;
    $("#close").onclick = () => { ui.sel = null; renderDrawer(); markSel(); };
    $("#botck") && ($("#botck").onchange = e => act(() => host.setBot(ui.sel, e.target.checked)));
    $("#dcap") && ($("#dcap").onchange = e => act(() => host.setCaptain(ui.sel, e.target.value || null)));
    wireNet(box);
    $("#ovform") && ($("#ovform").onsubmit = e => {
      e.preventDefault();
      const w = Number($("#ovweek").value), q = $("#ovqty").value, note = $("#ovnote").value;
      const past = !(w === net.week && net.status === "playing");
      if (past && !confirm(`Change ${t.label}'s week ${w} ${noun} to ${q}? Weeks ${w + 1}–${done} will be recalculated for the whole ${net.mode === "network" ? "network" : "game"}.`)) return;
      act(async () => {
        await host.correctOrder(ui.sel, w, q, note);
        drawerKey = "";
        $("#ovqty") && ($("#ovqty").value = "");
      }, past ? "Corrected. Later weeks recalculated." : "Saved.");
    });
  }

  function watchChat(teamId) {
    if (teamId === chatTeam) return;
    chatUnsub?.(); chatUnsub = null; chatTeam = teamId; ui.chatMsgs = [];
    if (!teamId) return;
    chatUnsub = store.watchCol(`${P}/chats/${teamId}/msgs`, ms => { ui.chatMsgs = ms.sort((a, b) => a.at - b.at); renderDrawer(); });
  }

  // ---------------- modals ----------------
  function renderModal() {
    const box = $("#modal");
    if (!ui.modal) { box.innerHTML = ""; return; }
    if (ui.modal === "settings") return settingsModal(box);
    if (ui.modal === "export") return exportModal(box);
  }

  const SETTINGS = [
    ["normalCapacity", "Brewery normal capacity (cases/week)", "1"],
    ["surgeCapacity", "Brewery maximum with surge", "1"],
    ["surgePremium", "Surge cost ($/case)", "0.05"],
    ["holdingCost", "Holding cost ($/case/week)", "0.05"],
    ["backorderCost", "Backorder cost ($/case/week)", "0.05"],
    ["warnMultiple", "Ask to confirm above (× recent incoming)", "0.5"],
    ["hardMaxRetailer", "Retailer hard max (× normal flow)", "1"],
    ["hardMaxWholesaler", "Wholesaler hard max (× normal flow)", "1"],
    ["hardMaxDistributor", "Distributor hard max (× normal flow)", "1"],
  ];
  function settingLabel(k) { return (SETTINGS.find(s => s[0] === k)?.[1] || k).replace(/ \(.*\)$/, ""); }

  function settingsModal(box) {
    const net = netsList().find(n => n.status === "playing") || netsList()[0];
    const pend = (net.configChanges || []).find(c => c.week === net.week + 1);
    const cur = { ...net.config, ...(pend?.changes || {}) };
    box.innerHTML = `<div class="modal-bg"><form class="modal stack" id="setform">
      <h2>Settings</h2>
      <p class="small muted">Changes take effect at the start of next week (week ${net.week + 1}) in every game still running, and are marked on the debrief charts. Lead times can't change mid-game. Use “+5 weeks” in the top bar to lengthen the game.</p>
      <div class="fields">${SETTINGS.map(([k, l, step]) => `<div class="field"><label for="set-${k}">${l}</label><input id="set-${k}" name="${k}" type="number" min="0" step="${step}" value="${cur[k]}"></div>`).join("")}</div>
      <div class="row spread"><button type="button" id="cancel">Cancel</button><button class="primary" type="submit">Save changes</button></div>
    </form></div>`;
    $("#cancel").onclick = () => { ui.modal = null; renderModal(); };
    $("#setform").onsubmit = e => {
      e.preventDefault();
      const changes = {};
      for (const [k] of SETTINGS) {
        const v = Number(e.target.elements[k].value);
        if (!Number.isFinite(v) || v < 0) { toast("Please enter valid numbers."); return; }
        if (v !== cur[k]) changes[k] = ["normalCapacity", "surgeCapacity"].includes(k) ? Math.round(v) : v;
      }
      const nc = changes.normalCapacity ?? cur.normalCapacity, sc = changes.surgeCapacity ?? cur.surgeCapacity;
      if (sc < nc) { toast("Surge maximum must be at least normal capacity."); return; }
      ui.modal = null; renderModal();
      if (Object.keys(changes).length) act(() => host.changeSettings(changes), `Saved. Takes effect in week ${net.week + 1}.`);
    };
  }

  function exportModal(box) {
    box.innerHTML = `<div class="modal-bg"><div class="modal stack">
      <h2>Export</h2>
      <button id="ex-data">Game data (CSV): every team, every week, with who made each decision</button>
      <button id="ex-chat">Team chats (CSV)</button>
      <button id="ex-log">Instructor log (CSV): corrections, reminders, undos, settings changes</button>
      <div class="row" style="justify-content:flex-end"><button class="ghost" id="close">Close</button></div>
    </div></div>`;
    $("#close").onclick = () => { ui.modal = null; renderModal(); };
    $("#ex-data").onclick = () => {
      const rows = netsList().flatMap(n => E.csvRows(E.results(n), { session: code }));
      if (!rows.length) return toast("No game data yet.");
      download(`beergame-${code}-data.csv`, toCSV(rows));
    };
    $("#ex-chat").onclick = () => act(async () => {
      const rows = [];
      for (const t of sortTeams(Object.values(host.teams))) {
        const ms = await store.getCol(`${P}/chats/${t.id}/msgs`);
        for (const m of ms.sort((a, b) => a.at - b.at)) {
          if (m.kind !== "msg") continue; // captain changes and submissions are left out
          rows.push({ session: code, network: t.netName, team: t.label, time: new Date(m.at).toISOString(), name: m.name, message: m.text });
        }
      }
      if (!rows.length) return toast("No chat messages yet.");
      download(`beergame-${code}-chats.csv`, toCSV(rows));
    });
    $("#ex-log").onclick = () => act(async () => {
      const a = await store.getCol(`${P}/audit`);
      download(`beergame-${code}-log.csv`, toCSV(a.sort((x, y) => x.at - y.at).map(e => ({ time: new Date(e.at).toISOString(), action: e.action, detail: e.detail }))));
    });
  }

  // ---------------- log ----------------
  function renderLog(body) {
    if (!auditUnsub) auditUnsub = store.watchCol(`${P}/audit`, a => { ui.audit = a.sort((x, y) => y.at - x.at); if (ui.tab === "log") renderLog($("#body")); });
    body.innerHTML = `<div class="card"><h3>Instructor log</h3><p class="small muted">Every correction, reminder, decision made for a team, undo, restart, settings change and roster change. The game data export also marks who made each weekly decision.</p>
      <div class="scrollx"><table><thead><tr><th>Time</th><th style="text-align:left">Action</th><th style="text-align:left">Details</th></tr></thead><tbody>
      ${ui.audit.map(e => `<tr><td>${new Date(e.at).toLocaleTimeString()}</td><td style="text-align:left">${esc(e.action)}</td><td style="text-align:left;white-space:normal" class="small">${esc(prettyDetail(e.detail))}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }
  function prettyDetail(d) {
    try { const o = JSON.parse(d); return Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`).join(" · "); }
    catch { return d; }
  }

  return () => { host.stop(); clearInterval(timer); chatUnsub?.(); auditUnsub?.(); C.destroyAll("d-"); };
}
