// Instructor screens: create session, lobby, live dashboard, debrief, log.
import * as E from "./engine.js";
import { DEFAULTS, TIERS, TIER_LABELS } from "./config.js";
import { createSession, startSession, Host } from "./host.js";
import { esc, $, $$, int, money, money0, tierLabel, tierColor, cssVar, topbar, toast, elapsed, toCSV, download } from "./ui.js";
import * as C from "./charts.js";
import { fmtRatio } from "./student.js";

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
      <fieldset><legend>Information sharing</legend>
        <div class="field"><select id="sharing" name="sharing">
          <option value="off">Off: each team sees only its own numbers (classic)</option>
          <option value="on">On: everyone also sees customer demand and supply-chain totals</option>
          <option value="split" id="splitOpt">Split: half the games share, half do not</option>
        </select></div>
      </fieldset>
      <div class="row spread"><div class="small muted" id="summary"></div><button class="primary big" type="submit">Create session</button></div>
    </form>
    ${store.local ? `<div class="row"><button class="small danger" id="wipe">Clear all test data in this browser</button></div>` : ""}
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
  const ui = { tab: "live", sel: null, dnet: null, dtier: "retailer", modal: null, audit: [], chatMsgs: [] };
  let host, raf = 0, timer, chatUnsub = null, auditUnsub = null, chatTeam = null;
  const P = `sessions/${code}`;
  const joinUrl = `${location.origin}${location.pathname}#/play/${code}`;

  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  host = new Host(store, code, schedule);
  host.start();
  timer = setInterval(updateTimers, 1000);

  function isOwner() { return host.session && host.session.ownerUid === store.uid(); }
  function netsList() { return (host.session?.networks || []).map(n => host.nets[n.id]).filter(Boolean); }

  // ---------------- frame ----------------
  let frame = "";
  function render() {
    const s = host.session;
    if (!s) {
      root.innerHTML = `${banner}${topbar()}<div class="wrap narrow"><div class="card"><h2>Loading session ${esc(code)}…</h2><p class="small muted">If this doesn't load, the code may be wrong. <a href="#/host">Start a new session</a>.</p></div></div>`;
      frame = ""; return;
    }
    if (s.status === "lobby") return renderLobby();
    if (frame !== "main") {
      frame = "main";
      root.innerHTML = `${banner}<div id="top"></div><div class="wrap">
        <div id="alerts"></div>
        <div class="tabs" role="tablist">
          <button data-tab="live">Live</button><button data-tab="debrief">Debrief</button><button data-tab="log">Log</button>
        </div>
        <div id="body"></div></div><div id="drawer"></div><div id="modal"></div>`;
      $$(".tabs button").forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; frame = "main"; renderBody(true); markTabs(); });
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
    const own = isOwner();
    $("#top").innerHTML = topbar(`
      <span class="small muted">Session</span><span class="pill accent" style="font-size:1rem;letter-spacing:.08em">${esc(code)}</span>${st}
      <button class="small ghost" id="copy" title="${esc(joinUrl)}">Copy join link</button>
      ${own && s.status === "running" ? `<button class="small" id="pause">${s.paused ? "Resume" : "Pause"}</button>
      <button class="small" id="settings">Settings</button>
      <button class="small danger" id="end">End game</button>` : ""}
      <button class="small" id="export">Export</button>`);
    $("#copy").onclick = () => { navigator.clipboard?.writeText(joinUrl); toast("Join link copied"); };
    $("#pause") && ($("#pause").onclick = () => act(() => host.setPaused(!s.paused)));
    $("#settings") && ($("#settings").onclick = () => { ui.modal = "settings"; renderModal(); });
    $("#end") && ($("#end").onclick = () => confirm("End the game for everyone now? Students will see the debrief.") && act(() => host.endGame()));
    $("#export").onclick = () => { ui.modal = "export"; renderModal(); };
    const alerts = [];
    if (!own) alerts.push(`<div class="msg warn">This session was created in a different browser, so you can watch but not control it. Open it from the browser you used to create it.</div>`);
    if (host.error) alerts.push(`<div class="msg error"><b>Problem:</b> ${esc(host.error)}</div>`);
    const unseated = host.players.filter(p => !p.teamId && !p.replacedBy).length;
    if (unseated && s.status === "running") alerts.push(`<div class="msg info">${unseated} student${unseated > 1 ? "s" : ""} joining…</div>`);
    $("#alerts").innerHTML = alerts.join("");
  }

  async function act(fn) {
    try { await fn(); } catch (e) { console.error(e); toast(e.message || "Something went wrong."); }
    schedule();
  }

  // ---------------- lobby ----------------
  function renderLobby() {
    frame = "lobby";
    const ps = host.players.filter(p => !p.replacedBy);
    const c = host.settings?.config;
    let plan = "";
    if (c && ps.length) {
      if (c.mode === "network") {
        const T = 1 + c.networkDistributors + c.networkWholesalers + c.networkRetailers;
        plan = `${T} teams in one network, about ${Math.max(1, Math.round(ps.length / T))} per team${ps.length < T ? ". Teams without students are played by the computer (retailers first)" : ""}.`;
      } else {
        const g = Math.max(1, Math.round(ps.length / (4 * c.classicTeamSize)));
        plan = `${g} game${g > 1 ? "s" : ""} of four teams, about ${Math.max(1, Math.round(ps.length / (4 * g)))} students per team.`;
      }
    }
    root.innerHTML = `${banner}${topbar(`<span class="pill">Lobby</span><button class="small" id="export">Export</button>`)}
      <div class="wrap stack">
        <div class="card joincard">
          <p class="bigline muted" style="margin:0">Go to</p>
          <p style="font-size:1.4rem;font-weight:700;word-break:break-all;margin:.2em 0 .6em">${esc(location.origin + location.pathname)}</p>
          <p class="bigline muted" style="margin:0">and enter code</p>
          <div class="code-big">${esc(code)}</div>
          <p class="muted" style="margin-top:12px">Use your first name and last initial.</p>
        </div>
        <div class="card">
          <div class="row spread"><h2 style="margin:0">${ps.length} joined</h2>
            ${isOwner() ? `<button class="primary big" id="start" ${ps.length ? "" : "disabled"}>Form teams and start</button>` : ""}</div>
          <p class="small muted" style="margin-top:6px">${esc(plan)} Students who arrive later are added automatically.</p>
          <div class="chips">${ps.map(p => `<span class="chip">${esc(p.name)}</span>`).join("")}</div>
        </div>
      </div><div id="modal"></div>`;
    $("#start") && ($("#start").onclick = e => { e.target.disabled = true; act(() => startSession(store, code)); });
    $("#export").onclick = () => { ui.modal = "export"; renderModal(); };
  }

  // ---------------- body ----------------
  let bodyKey = "";
  function renderBody(force) {
    const body = $("#body");
    if (ui.tab === "live") renderLive(body);
    else if (ui.tab === "debrief") renderDebrief(body, force);
    else renderLog(body, force);
  }

  function teamStatus(net, id) {
    const t = host.teams[id];
    const o = host.orderFor(id, net.week);
    if (net.status !== "playing") return { cls: "", text: "Done" };
    if (t?.bot) return { cls: "", text: "Computer" };
    if (o) return { cls: "", text: `✓ ${int(o.qty)}${o.source === "instructor" ? " (you)" : ""}` };
    const wait = Date.now() - net.weekStartedAt;
    return { cls: wait > 90000 ? "late" : "waiting", text: "Waiting", since: net.weekStartedAt };
  }

  function renderLive(body) {
    const nets = netsList();
    if (!nets.length) { body.innerHTML = `<p class="muted">Setting up…</p>`; return; }
    if (nets[0].mode === "network") return renderNetworkLive(body, nets[0]);
    renderClassicLive(body, nets);
  }

  function netHeader(net) {
    const waiting = net.status === "playing" ? host.waitingTeams(net) : [];
    const total = Object.keys(net.teams).length;
    const own = isOwner() && host.session.status === "running";
    return `<div class="row spread">
      <div class="row"><h2 style="margin:0">${esc(net.name)}</h2>
        <span class="pill accent" style="font-size:.95rem">Week ${net.week}${net.status === "done" ? " · finished" : ""}</span>
        ${net.status === "playing" ? `<span class="small muted">${total - waiting.length} of ${total} teams in · this week <span data-since="${net.weekStartedAt}">${elapsed(Date.now() - net.weekStartedAt)}</span></span>` : ""}
      </div>
      ${own ? `<div class="row">
        ${net.status === "playing" ? `<button class="small" data-act="advance" data-net="${net.id}" ${waiting.length ? "" : "disabled"} title="Repeats last week's order for any team that hasn't submitted">Advance now</button>` : ""}
        <button class="small" data-act="undo" data-net="${net.id}" ${net.week > 1 || net.status === "done" ? "" : "disabled"}>Undo last week</button>
        <button class="small danger" data-act="restart" data-net="${net.id}">Restart</button></div>` : ""}
    </div>`;
  }

  function wireNetButtons(scope) {
    $$("[data-act]", scope).forEach(b => b.onclick = () => {
      const net = host.nets[b.dataset.net];
      const a = b.dataset.act;
      if (a === "advance") {
        const names = host.waitingTeams(net).map(id => net.teams[id].label).join(", ");
        if (confirm(`Advance ${net.name} now? These teams will repeat last week's order: ${names}`)) act(() => host.forceAdvance(net.id));
      } else if (a === "undo") {
        const w = net.status === "playing" ? net.week - 1 : net.week;
        if (confirm(`Undo week ${w} for ${net.name}? The game will pause so you can correct an order, then press Resume.`)) act(() => host.undoWeek(net.id));
      } else if (a === "restart") {
        if (confirm(`Restart ${net.name} from week 1? All orders will be erased.`)) act(() => host.restartNet(net.id));
      }
    });
  }

  function renderNetworkLive(body, net) {
    const B = Object.values(net.teams).find(t => t.tier === "brewery");
    const last = B.history[B.history.length - 1];
    const prev = B.history.filter(e => e.order != null).slice(-1)[0];
    const cfg = net.config;
    const owed = Object.values(B.backlog).reduce((a, b) => a + b, 0);
    const totalCost = Object.values(net.teams).reduce((s, t) => s + t.cost.total, 0);
    const bOrder = host.orderFor(B.id, net.week);
    const pending = (net.configChanges || []).find(c => c.week === net.week + 1);
    body.innerHTML = `<div class="stack">
      <div class="card">${netHeader(net)}<div id="svgwrap" style="margin-top:10px">${networkSVG(net)}</div>
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
    wireNetButtons(body);
    $$(".node", body).forEach(n => n.onclick = () => { ui.sel = n.dataset.id; renderDrawer(); markSel(); });
    markSel();
  }

  function networkSVG(net) {
    const W = 1000, rowY = { brewery: 16, distributor: 128, wholesaler: 240, retailer: 352 }, h = 82;
    const byTier = Object.fromEntries(TIERS.map(t => [t, E.teamOrder(net).filter(id => net.teams[id].tier === t).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))]));
    const pos = {};
    for (const t of TIERS) {
      const ids = byTier[t], col = W / ids.length;
      const w = Math.min(150, col - 10);
      ids.forEach((id, i) => pos[id] = { x: col * i + (col - w) / 2, y: rowY[t], w });
    }
    let edges = "", nodes = "";
    for (const id of Object.keys(net.teams)) {
      const t = net.teams[id];
      if (t.supplier) {
        const a = pos[t.supplier], b = pos[id];
        const x1 = a.x + a.w / 2, y1 = a.y + h, x2 = b.x + b.w / 2, y2 = b.y;
        const my = (y1 + y2) / 2;
        edges += `<path class="edge" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
      }
    }
    for (const id of Object.keys(net.teams)) {
      const t = net.teams[id], p = pos[id], team = host.teams[id] || {};
      const st = teamStatus(net, id);
      const owe = Object.values(t.backlog).reduce((a, b) => a + b, 0);
      const n = Object.keys(team.members || {}).length;
      const cap = team.bot ? "" : team.captainName ? `★ ${team.captainName}` : `No captain · ${n} member${n === 1 ? "" : "s"}`;
      nodes += `<g class="node ${st.cls}" data-id="${id}" transform="translate(${p.x},${p.y})">
        <rect class="box" width="${p.w}" height="${h}" rx="8"/>
        <rect width="5" height="${h}" rx="2" fill="${tierColor(t.tier)}"/>
        <text class="lbl" x="12" y="18">${esc(t.label)}</text>
        <text class="sub" x="12" y="35" ${st.cls ? `fill="var(--${st.cls === "late" ? "bad" : "warn"})" style="fill:var(--${st.cls === "late" ? "bad" : "warn"});font-weight:700"` : ""}>${esc(st.text)}${st.since ? ` <tspan data-since="${st.since}">${elapsed(Date.now() - st.since)}</tspan>` : ""}</text>
        <text class="sub" x="12" y="52">Inv ${int(t.inv)} · Owes ${int(owe)}</text>
        <text class="sub" x="12" y="69">${esc(cap.length > 22 ? cap.slice(0, 21) + "…" : cap)}</text>
      </g>`;
    }
    return `<svg class="netsvg" viewBox="0 0 ${W} 440" role="img" aria-label="Supply network status">${edges}${nodes}</svg>`;
  }

  function renderClassicLive(body, nets) {
    const own = isOwner() && host.session.status === "running";
    const order = ["brewery", "distributor", "wholesaler", "retailer"];
    body.innerHTML = `<div class="stack">
      <div class="card"><div class="row spread"><h2 style="margin:0">${nets.length} games</h2>
        <div class="legend"><span>Brewery → Distributor → Wholesaler → Retailer. Click a team for details.</span></div></div>
        <div class="games" style="margin-top:12px">${nets.map(net => {
          const waiting = net.status === "playing" ? host.waitingTeams(net).length : 0;
          return `<div class="gamerow">
            <div><b>${esc(net.name)}</b><div class="tiny">Week ${net.week}${net.status === "done" ? " · done" : ""}${net.sharing ? " · sharing" : ""}</div>
              <div class="tiny">${money0(Object.values(net.teams).reduce((s, t) => s + t.cost.total, 0))}</div>
              ${own ? `<div class="row" style="gap:4px;margin-top:4px">${net.status === "playing" ? `<button class="small ghost" style="padding:2px 6px" data-act="advance" data-net="${net.id}" ${waiting ? "" : "disabled"}>Advance</button>` : ""}
              <button class="small ghost" style="padding:2px 6px" data-act="undo" data-net="${net.id}">Undo</button></div>` : ""}</div>
            ${order.map(tier => {
              const id = Object.keys(net.teams).find(k => net.teams[k].tier === tier);
              const t = net.teams[id], team = host.teams[id] || {}, st = teamStatus(net, id);
              const owe = Object.values(t.backlog).reduce((a, b) => a + b, 0);
              return `<div class="tnode ${st.cls}" data-id="${id}" style="border-left:5px solid ${tierColor(tier)}">
                <b>${tierLabel(tier)}</b>
                <span class="${st.cls ? "" : "muted"}" style="${st.cls ? `color:var(--${st.cls === "late" ? "bad" : "warn"});font-weight:700` : ""}">${esc(st.text)} ${st.since ? `<span data-since="${st.since}">${elapsed(Date.now() - st.since)}</span>` : ""}</span>
                <div class="tiny">Inv ${int(t.inv)} · Owes ${int(owe)}</div>
                <div class="tiny">${team.bot ? "Computer" : team.captainName ? "★ " + esc(team.captainName) : "No captain"}</div>
              </div>`;
            }).join("")}</div>`;
        }).join("")}</div></div></div>`;
    wireNetButtons(body);
    $$(".tnode", body).forEach(n => n.onclick = () => { ui.sel = n.dataset.id; renderDrawer(); markSel(); });
    markSel();
  }

  function markSel() { $$("[data-id]").forEach(n => n.classList.toggle("sel", n.dataset.id === ui.sel)); }

  function updateTimers() {
    $$("[data-since]").forEach(el => el.textContent = elapsed(Date.now() - Number(el.dataset.since)));
  }

  // ---------------- team drawer ----------------
  let drawerKey = "";
  function renderDrawer() {
    const box = $("#drawer");
    if (!box) return;
    if (!ui.sel || !host.teams[ui.sel]) { box.innerHTML = ""; drawerKey = ""; watchChat(null); return; }
    const team = host.teams[ui.sel], net = host.nets[team.netId];
    if (!net) return;
    const t = net.teams[ui.sel];
    const o = host.orderFor(ui.sel, net.week);
    const key = JSON.stringify([ui.sel, net.week, net.status, team, o, t.history.length, ui.chatMsgs.length, host.session.paused]);
    if (key === drawerKey) return;
    drawerKey = key;
    const typed = $("#ovqty")?.value ?? "";
    const typedNote = $("#ovnote")?.value ?? "";
    watchChat(ui.sel);
    const own = isOwner() && host.session.status === "running";
    const L = net.status === "playing" ? E.limitsFor(net, ui.sel) : null;
    const members = Object.entries(team.members || {});
    box.innerHTML = `<div class="drawer stack">
      <div class="row spread"><div><h2 style="margin:0">${esc(t.label)}</h2><div class="tiny">${esc(net.name)}${t.supplier ? ` · buys from ${esc(net.teams[t.supplier].label)}` : ""}</div></div>
        <button class="ghost" id="close" aria-label="Close">✕</button></div>
      <div><h3>Members</h3><div class="chips">${members.length ? members.map(([id, n]) => `<span class="chip">${id === team.captain ? "★ " : ""}${esc(n)}</span>`).join("") : `<span class="muted small">No students</span>`}</div>
        ${own ? `<label class="row small" style="margin-top:8px;font-weight:600;gap:6px"><input type="checkbox" id="botck" style="width:auto" ${team.bot ? "checked" : ""}> Computer plays this team</label>` : ""}</div>
      <div><h3>Week ${net.week} ${t.tier === "brewery" ? "production" : "order"}</h3>
        ${net.status !== "playing" ? `<p class="muted">Game finished.</p>` : o
          ? `<div class="msg good">${int(o.qty)} cases · ${o.source === "instructor" ? "entered by you" : `submitted by ${esc(o.byName)}`}${o.previousQty != null ? ` (was ${int(o.previousQty)})` : ""}</div>`
          : `<div class="msg ${team.bot ? "info" : "warn"}">${team.bot ? "The computer will order when the week advances." : "Not submitted yet."}</div>`}
        ${own && net.status === "playing" ? `<form id="ovform" class="stack" style="margin-top:10px" autocomplete="off">
          <div class="row"><input id="ovqty" inputmode="numeric" placeholder="Cases" style="width:110px" value="${esc(typed)}">
          <input id="ovnote" placeholder="Reason (for the log)" style="flex:1;min-width:120px" value="${esc(typedNote)}">
          <button class="small" type="submit">${o ? "Correct order" : "Enter order"}</button></div>
          <div class="tiny">Limit ${int(L.max)} · confirmation above ${int(L.warnAt)}. To fix an order from an earlier week, use “Undo last week” first.</div>
        </form>` : ""}
      </div>
      <div><h3>Recent weeks</h3><div class="scrollx"><table><thead><tr><th>Wk</th><th>Recv</th><th>In</th><th>Ship</th><th>Inv</th><th>Owe</th><th>${t.tier === "brewery" ? "Brew" : "Order"}</th></tr></thead><tbody>
        ${t.history.slice(-8).reverse().map(e => `<tr><td>${e.week}</td><td>${int(e.received)}</td><td>${int(e.incoming)}</td><td>${int(e.shipped)}</td><td>${int(e.inv)}</td><td>${int(e.backlog)}</td><td>${e.order == null ? "—" : int(e.order)}</td></tr>`).join("")}</tbody></table></div>
        <p class="tiny">Total cost ${money(t.cost.total)}</p></div>
      <div><h3>Team chat</h3><div class="chat card flat" style="height:300px"><div class="log" id="dchat">${ui.chatMsgs.map(m => m.kind === "system"
        ? `<div class="sys">${esc(m.text)}</div>` : `<div class="bubble"><div class="who">${esc(m.name)}</div><div class="t">${esc(m.text)}</div></div>`).join("") || `<div class="sys">No messages yet.</div>`}</div></div></div>
    </div>`;
    const dc = $("#dchat"); dc.scrollTop = dc.scrollHeight;
    $("#close").onclick = () => { ui.sel = null; renderDrawer(); markSel(); };
    $("#botck") && ($("#botck").onchange = e => act(() => host.setBot(ui.sel, e.target.checked)));
    $("#ovform") && ($("#ovform").onsubmit = e => {
      e.preventDefault();
      const q = $("#ovqty").value, note = $("#ovnote").value;
      act(async () => { await host.overrideOrder(ui.sel, q, note); $("#ovqty").value = ""; $("#ovnote").value = ""; toast("Order saved."); });
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
      <p class="small muted">Changes take effect at the start of next week (week ${net.week + 1}) in every game still running, and are marked on the debrief charts. Lead times can't change mid-game.</p>
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
      if (Object.keys(changes).length) act(async () => { await host.changeSettings(changes); toast(`Saved. Takes effect in week ${net.week + 1}.`); });
    };
  }

  function exportModal(box) {
    box.innerHTML = `<div class="modal-bg"><div class="modal stack">
      <h2>Export</h2>
      <button id="ex-data">Game data (CSV): every team, every week</button>
      <button id="ex-chat">Team chats (CSV)</button>
      <button id="ex-log">Instructor log (CSV): corrections, undos, settings changes</button>
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
      for (const t of Object.values(host.teams).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
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

  // ---------------- debrief ----------------
  function renderDebrief(body, force) {
    const nets = netsList();
    if (!nets.length) return;
    const key = JSON.stringify([ui.dnet, ui.dtier, nets.map(n => [n.id, n.week, n.status, n.configChanges?.length])]);
    if (!force && key === bodyKey) return;
    bodyKey = key;
    C.destroyAll("d-");
    const multi = nets.length > 1;
    if (!ui.dnet) ui.dnet = multi ? "all" : nets[0].id;
    const picker = multi ? `<div class="row" style="margin-bottom:14px"><span class="small muted">Show</span>
      <select id="dpick" style="width:auto"><option value="all">All games side by side</option>${nets.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join("")}</select>
      <span class="tiny">Charts update live as the game runs.</span></div>` : `<p class="tiny">Charts update live as the game runs.</p>`;
    if (ui.dnet === "all") {
      body.innerHTML = picker + allGamesHTML(nets);
      drawAllGames(nets);
    } else {
      const net = host.nets[ui.dnet];
      const res = E.results(net);
      if (res.weeks < 2) { body.innerHTML = picker + `<div class="card"><p class="muted">The debrief fills in after a couple of weeks of play.</p></div>`; }
      else { body.innerHTML = picker + oneNetHTML(res); drawOneNet(res); }
    }
    if ($("#dpick")) { $("#dpick").value = ui.dnet; $("#dpick").onchange = e => { ui.dnet = e.target.value; renderDebrief(body, true); }; }
  }

  function oneNetHTML(res) {
    const bw = E.bullwhip(res);
    const teams = Object.values(res.teams);
    const total = teams.reduce((s, t) => s + t.cost.total, 0);
    const k = teams.reduce((s, t) => ({ h: s.h + t.cost.holding, b: s.b + t.cost.backorder, s: s.s + t.cost.surge }), { h: 0, b: 0, s: 0 });
    const tiersPresent = TIERS.filter(t => teams.some(x => x.tier === t));
    const multiTeam = res.mode === "network";
    return `<div class="stack">
      <div class="kpis">
        <div class="stat"><div class="k">Weeks played</div><div class="v">${res.weeks}</div></div>
        <div class="stat"><div class="k">Supply chain cost</div><div class="v">${money0(total)}</div></div>
        <div class="stat"><div class="k">Holding / backorder / surge</div><div class="v" style="font-size:1.05rem">${money0(k.h)} / ${money0(k.b)} / ${money0(k.s)}</div></div>
        <div class="stat"><div class="k">Brewery order swings vs demand</div><div class="v">${fmtRatio(bw.tierRatio.brewery)}×</div></div>
      </div>
      <div class="card"><h3>Customer demand vs. orders at each stage</h3>
        <p class="small muted">Totals across all teams in each tier. Customer demand changed once; every line above it is the bullwhip.</p>
        <div class="chartbox"><canvas id="d-bw"></canvas></div></div>
      ${multiTeam ? `<div class="card"><div class="row spread"><h3 style="margin:0">Orders by team</h3>
        <div class="seg" id="tierSeg">${tiersPresent.filter(t => t !== "brewery").map(t => `<button data-t="${t}" class="${ui.dtier === t ? "on" : ""}">${tierLabel(t)}s</button>`).join("")}</div></div>
        <div class="chartbox" style="margin-top:10px"><canvas id="d-teams"></canvas></div></div>` : ""}
      <div class="grid2">
        <div class="card"><h3>Inventory minus backorders, by tier</h3><p class="tiny">Below zero means customers are waiting.</p><div class="chartbox"><canvas id="d-inv"></canvas></div></div>
        <div class="card"><h3>Brewery production and capacity</h3><p class="tiny">${res.changes.length ? `Capacity changed in week ${res.changes.map(c => c.week).join(", ")}.` : "&nbsp;"}</p><div class="chartbox"><canvas id="d-brew"></canvas></div></div>
      </div>
      <div class="card"><h3>Costs by team</h3><div class="chartbox"><canvas id="d-cost"></canvas></div></div>
      <div class="card"><h3>Bullwhip measure</h3>
        <p class="small muted">Variance of orders divided by variance of the customer demand each team ultimately serves (scaled to its size). 1 = no amplification.</p>
        <div class="scrollx"><table><thead><tr><th>Team</th><th>Bullwhip ratio</th><th>Peak order</th><th>Peak backorders</th><th>Holding</th><th>Backorder</th><th>Surge</th><th>Total cost</th></tr></thead><tbody>
        ${tiersPresent.map(tier => {
          const ts = teams.filter(t => t.tier === tier);
          const rows = ts.map(t => `<tr><td>${esc(t.label)}</td><td>${fmtRatio(bw.teamRatio[t.id])}</td><td>${int(Math.max(...t.orders))}</td><td>${int(Math.max(...t.backlog))}</td><td>${money0(t.cost.holding)}</td><td>${money0(t.cost.backorder)}</td><td>${t.tier === "brewery" ? money0(t.cost.surge) : ""}</td><td>${money0(t.cost.total)}</td></tr>`).join("");
          const sumRow = ts.length > 1 ? `<tr style="font-weight:700;background:var(--surface-2)"><td><span class="dot" style="background:${tierColor(tier)}"></span> All ${tierLabel(tier).toLowerCase()}s</td><td>${fmtRatio(bw.tierRatio[tier])}</td><td></td><td></td><td></td><td></td><td></td><td>${money0(ts.reduce((s, t) => s + t.cost.total, 0))}</td></tr>` : "";
          return sumRow + rows;
        }).join("")}</tbody></table></div></div>
    </div>`;
  }

  function drawOneNet(res) {
    const bw = E.bullwhip(res);
    const labels = C.weeksLabels(res.weeks);
    C.bullwhipChart("d-bw", $("#d-bw"), res, bw);
    if ($("#d-teams")) {
      const ts = Object.values(res.teams).filter(t => t.tier === ui.dtier);
      const per = res.demand.map(d => d * ts[0].baseline / (res.demand[0] || 1));
      C.lines("d-teams", $("#d-teams"), {
        labels,
        series: [{ label: "Demand at this scale", data: per, color: cssVar("--ink"), dash: [6, 4] },
          ...ts.map((t, i) => ({ label: t.label, data: t.orders, color: cssVar(`--p${(i % 8) + 1}`) }))],
      });
      $$("#tierSeg button").forEach(b => b.onclick = () => { ui.dtier = b.dataset.t; renderDebrief($("#body"), true); });
    }
    const tiers = TIERS.filter(t => Object.values(res.teams).some(x => x.tier === t));
    C.lines("d-inv", $("#d-inv"), {
      labels, beginAtZero: false,
      series: tiers.map(tier => {
        const ts = Object.values(res.teams).filter(t => t.tier === tier);
        return { label: tierLabel(tier), color: tierColor(tier), data: labels.map((_, i) => ts.reduce((s, t) => s + t.inv[i] - t.backlog[i], 0)) };
      }),
    });
    const B = Object.values(res.teams).find(t => t.tier === "brewery");
    C.lines("d-brew", $("#d-brew"), {
      labels,
      series: [
        { label: "Production", data: B.orders, color: tierColor("brewery") },
        { label: "Orders from distributors", data: B.incoming, color: tierColor("distributor"), width: 1.5 },
        { label: "Normal capacity", data: res.capacity.map(c => c.normal), color: cssVar("--ink-3"), dash: [4, 4], width: 1.5, stepped: true },
        { label: "Surge maximum", data: res.capacity.map(c => c.surge), color: cssVar("--ink-3"), dash: [1, 3], width: 1.5, stepped: true },
        { label: "Backlog owed", data: B.backlog, color: cssVar("--ink"), width: 1.5, dash: [8, 3] },
      ],
    });
    const ordered = Object.values(res.teams);
    C.stackedBars("d-cost", $("#d-cost"), {
      labels: ordered.map(t => t.label),
      series: [
        { label: "Holding", data: ordered.map(t => Math.round(t.cost.holding)), color: cssVar("--c-holding") },
        { label: "Backorder", data: ordered.map(t => Math.round(t.cost.backorder)), color: cssVar("--c-backorder") },
        { label: "Surge", data: ordered.map(t => Math.round(t.cost.surge)), color: cssVar("--c-surge") },
      ],
    });
  }

  function allGamesHTML(nets) {
    const res = nets.map(n => E.results(n)).filter(r => r.weeks >= 2);
    if (!res.length) return `<div class="card"><p class="muted">The debrief fills in after a couple of weeks of play.</p></div>`;
    const rows = res.map(r => ({ r, bw: E.bullwhip(r), total: Object.values(r.teams).reduce((s, t) => s + t.cost.total, 0) }));
    const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const group = flag => rows.filter(x => x.r.sharing === flag);
    const anyShare = rows.some(x => x.r.sharing), anyNo = rows.some(x => !x.r.sharing);
    const avgRow = (label, list) => list.length ? `<tr style="font-weight:700;background:var(--surface-2)"><td>${label}</td>${TIERS.map(t => `<td>${fmtRatio(avg(list.map(x => x.bw.tierRatio[t]).filter(v => v != null)))}</td>`).join("")}<td>${money0(avg(list.map(x => x.total)))}</td></tr>` : "";
    return `<div class="stack">
      <div class="card"><h3>Every game, same pattern</h3><p class="small muted">Customer demand vs. orders at each stage, one chart per game.</p>
        <div class="legend" style="margin-bottom:10px"><span><span class="swatch" style="background:var(--ink);height:2px"></span>Customer demand (dashed)</span>${TIERS.map(t => `<span><span class="swatch" style="background:${tierColor(t)}"></span>${t === "brewery" ? "Brewery production" : tierLabel(t) + " orders"}</span>`).join("")}</div>
        <div class="multiples">${rows.map((x, i) => `<div><div class="small"><b>${esc(x.r.name)}</b>${x.r.sharing ? ` <span class="pill accent">sharing</span>` : ""}</div><div class="chartbox sm"><canvas id="d-g${i}"></canvas></div></div>`).join("")}</div></div>
      <div class="card"><h3>Bullwhip ratio by stage</h3><p class="small muted">Order variance ÷ customer demand variance. 1 = no amplification.</p>
        <div class="scrollx"><table><thead><tr><th>Game</th>${TIERS.map(t => `<th>${t === "brewery" ? "Brewery" : tierLabel(t)}</th>`).join("")}<th>Total cost</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td>${esc(x.r.name)}${x.r.sharing ? " (sharing)" : ""}</td>${TIERS.map(t => `<td>${fmtRatio(x.bw.tierRatio[t])}</td>`).join("")}<td>${money0(x.total)}</td></tr>`).join("")}
        ${anyShare && anyNo ? avgRow("Average, no sharing", group(false)) + avgRow("Average, with sharing", group(true)) : avgRow("Average", rows)}
        </tbody></table></div></div>
    </div>`;
  }
  function drawAllGames(nets) {
    nets.map(n => E.results(n)).filter(r => r.weeks >= 2).forEach((r, i) => {
      const ch = C.bullwhipChart(`d-g${i}`, $(`#d-g${i}`), r, E.bullwhip(r));
      if (ch) { ch.options.plugins.legend.display = false; ch.options.scales.y.title.display = false; ch.update(); }
    });
  }

  // ---------------- log ----------------
  function renderLog(body) {
    if (!auditUnsub) auditUnsub = store.watchCol(`${P}/audit`, a => { ui.audit = a.sort((x, y) => y.at - x.at); if (ui.tab === "log") renderLog($("#body")); });
    body.innerHTML = `<div class="card"><h3>Instructor log</h3><p class="small muted">Every correction, undo, restart, settings change and forced advance.</p>
      <div class="scrollx"><table><thead><tr><th>Time</th><th>Action</th><th style="text-align:left">Details</th></tr></thead><tbody>
      ${ui.audit.map(e => `<tr><td>${new Date(e.at).toLocaleTimeString()}</td><td style="text-align:left">${esc(e.action)}</td><td style="text-align:left;white-space:normal" class="small">${esc(prettyDetail(e.detail))}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }
  function prettyDetail(d) {
    try { const o = JSON.parse(d); return Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`).join(" · "); }
    catch { return d; }
  }

  return () => { host.stop(); clearInterval(timer); chatUnsub?.(); auditUnsub?.(); C.destroyAll("d-"); };
}
