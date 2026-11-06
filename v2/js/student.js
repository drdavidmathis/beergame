// Student screens: join, lobby, play (dashboard + captain + order + chat), debrief.
import * as E from "./engine.js";
import { TIERS } from "./config.js";
import { esc, $, int, money, tierLabel, tierColor, topbar, toast, cssVar } from "./ui.js";
import * as C from "./charts.js";

export async function mount(root, store, code, banner) {
  const me = store.uid();
  const S = { code, session: null, player: null, team: null, view: null, order: null, msgs: [], results: null };
  const subs = [];
  let teamSubs = [];
  let orderSub = null, orderWeek = null;
  let lastChatAt = 0;
  let pendingConfirm = null;
  let orderKey = "";
  let chatCount = -1;

  const P = () => `sessions/${S.code}`;
  const cleanup = () => { subs.forEach(u => u()); teamSubs.forEach(u => u()); orderSub?.(); C.destroyAll("s-"); };

  // ---------------- join ----------------
  async function showJoin(msg = "") {
    root.innerHTML = `${banner}${topbar()}
      <div class="wrap narrow" style="padding-top:40px">
        <div class="card stack">
          <h1>Join the game</h1>
          ${msg ? `<div class="msg error">${esc(msg)}</div>` : ""}
          <form id="join" class="stack" autocomplete="off">
            <div class="field"><label for="code">Session code</label>
              <input id="code" maxlength="6" value="${esc(code)}" style="text-transform:uppercase;font-size:1.3rem;letter-spacing:.15em" required></div>
            <div class="field"><label for="name">Your first name and last initial</label>
              <input id="name" maxlength="30" placeholder="e.g. Maria G." required></div>
            <button class="primary big" type="submit">Join</button>
            <p class="tiny">If you get disconnected, join again with exactly the same name to get your seat back.</p>
          </form>
        </div>
      </div>`;
    $("#join").onsubmit = async e => {
      e.preventDefault();
      const c = $("#code").value.trim().toUpperCase();
      const name = $("#name").value.trim().replace(/\s+/g, " ").slice(0, 30);
      if (!c || !name) return;
      const btn = e.submitter; if (btn) btn.disabled = true;
      const sess = await store.getDoc(`sessions/${c}`);
      if (!sess) { code = c; return showJoin("No session with that code. Check the code on the screen."); }
      if (sess.status === "ended") { code = c; return showJoin("That session has ended."); }
      await store.setDoc(`sessions/${c}/players/${me}`, { name, joinedAt: Date.now(), teamId: null, netId: null });
      if (location.hash === `#/play/${c}`) start(c); else location.hash = `#/play/${c}`;
    };
  }

  // ---------------- live ----------------
  async function start(c) {
    S.code = c;
    const p = await store.getDoc(`${P()}/players/${me}`);
    if (!p) return showJoin();
    subs.push(store.watchDoc(P(), s => { S.session = s; render(); }));
    subs.push(store.watchDoc(`${P()}/players/${me}`, pl => {
      const prevTeam = S.player?.teamId;
      S.player = pl;
      if (pl?.teamId && pl.teamId !== prevTeam && !pl.replacedBy) watchTeam(pl.teamId, pl.netId);
      render();
    }));
  }

  function watchTeam(teamId, netId) {
    teamSubs.forEach(u => u()); teamSubs = [];
    teamSubs.push(store.watchDoc(`${P()}/teams/${teamId}`, t => { S.team = t; render(); }));
    teamSubs.push(store.watchDoc(`${P()}/views/${teamId}`, v => {
      S.view = v;
      if (v && v.week !== orderWeek) watchOrder(teamId, v.week);
      render();
    }));
    teamSubs.push(store.watchCol(`${P()}/chats/${teamId}/msgs`, ms => {
      S.msgs = ms.sort((a, b) => a.at - b.at).slice(-200);
      renderChat();
    }));
    teamSubs.push(store.watchDoc(`${P()}/results/${netId}`, r => { S.results = r; render(); }));
  }

  function watchOrder(teamId, week) {
    orderSub?.();
    orderWeek = week;
    S.order = null;
    pendingConfirm = null;
    orderSub = store.watchDoc(`${P()}/orders/${teamId}_${week}`, o => { S.order = o; render(); });
  }

  // ---------------- render ----------------
  let shell = "";
  function render() {
    const s = S.session, pl = S.player;
    if (!s || !pl) return;
    if (pl.replacedBy) {
      root.innerHTML = `${banner}${topbar()}<div class="wrap narrow"><div class="card"><h2>You joined from another tab or device</h2><p>Your seat moved to your newer connection. You can close this tab.</p></div></div>`;
      shell = ""; return;
    }
    if (!pl.teamId || !S.view || !S.team) return renderLobby();
    if (S.view.status === "done" && S.results) return renderDebrief();
    renderPlay();
  }

  function renderLobby() {
    shell = "lobby";
    const s = S.session;
    root.innerHTML = `${banner}${topbar(`<span class="pill">${esc(S.player.name)}</span>`)}
      <div class="wrap narrow" style="padding-top:40px"><div class="card stack" style="text-align:center">
        <h1>You're in, ${esc(S.player.name.split(" ")[0])}.</h1>
        <p class="muted bigline">${s.status === "lobby"
          ? "Waiting for the instructor to form teams and start the game."
          : "Finding you a team…"}</p>
        <p class="small muted">Keep this tab open. Your team and role will appear here.</p>
      </div></div>`;
  }

  function renderPlay() {
    const v = S.view, team = S.team, s = S.session;
    if (shell !== "play") {
      shell = "play";
      orderKey = ""; chatCount = -1;
      root.innerHTML = `${banner}<div id="top"></div>
        <div class="wrap"><div id="pausebar"></div>
          <div class="play">
            <div class="stack">
              <div class="card" id="summary"></div>
              <div class="card orderbox" id="orderbox"></div>
              <div id="sharebox"></div>
              <div class="card" id="historybox"></div>
            </div>
            <div class="card chat" id="chat">
              <div class="head"><h3 style="margin:0">Team chat</h3><div class="tiny">Only your ${esc(v.label)} team can see this.</div></div>
              <div class="log" id="chatlog"></div>
              <form class="foot" id="chatform" autocomplete="off">
                <input id="chatin" maxlength="300" placeholder="Message your team">
                <button class="primary" type="submit">Send</button>
              </form>
            </div>
          </div>
        </div>`;
      $("#chatform").onsubmit = sendChat;
    }
    const where = v.mode === "classic" ? `${esc(v.netName)} · ` : "";
    $("#top").innerHTML = topbar(`<span class="small muted">${where}Your team</span>
      <span class="pill accent" style="font-size:.95rem">${esc(v.label)}</span>
      <span class="pill" style="font-size:.95rem">Week ${v.week}</span>
      <span class="small muted">${esc(S.player.name)}</span>`);
    $("#pausebar").innerHTML = s.paused ? `<div class="msg warn" style="margin-bottom:14px"><b>Paused.</b> The instructor has paused the game.</div>` : "";
    renderSummary();
    renderOrder();
    renderShare();
    renderHistory();
    renderChat();
  }

  function renderSummary() {
    const v = S.view, tw = v.thisWeek || {};
    const brewery = v.tier === "brewery";
    const up = brewery ? "brewing" : `from ${esc(v.supplier)}`;
    const chain = TIERS.slice().reverse().map(t => `<span class="${t === v.tier ? "me" : ""}">${tierLabel(t)}</span>`).join(" → ") + " → Customers";
    const by = tw.by ? `<div class="tiny" style="margin-top:4px">${tw.by.map(b => `${esc(b.label)}: ${int(b.incoming)} ordered, ${int(b.shipped)} shipped${b.owed ? `, ${int(b.owed)} still owed` : ""}`).join("<br>")}</div>` : "";
    const transitLbl = i => i === 0 ? "Next week" : `In ${i + 1} weeks`;
    $("#summary").innerHTML = `
      <div class="row spread" style="margin-bottom:10px">
        <div class="chain">${chain}</div>
        <div class="small muted">${brewery ? "You supply" : "You buy from"} <b>${brewery ? v.customers.map(esc).join(", ") : esc(v.supplier)}</b>${brewery ? "" : ` · you sell to <b>${v.customers.map(esc).join(", ")}</b>`}</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="k">Inventory</div><div class="v">${int(v.inv)}</div></div>
        <div class="stat ${v.backlog ? "bad" : ""}"><div class="k">Backorders (you owe)</div><div class="v">${int(v.backlog)}</div></div>
        <div class="stat"><div class="k">Cost this week</div><div class="v">${money(tw.weekCost)}</div></div>
        <div class="stat"><div class="k">Total cost</div><div class="v">${money(v.totalCost)}</div></div>
      </div>
      <h3 style="margin-top:16px">This week</h3>
      <div class="flow">
        <div class="stat"><div class="k">Beer received ${up}</div><div class="v">${int(tw.received)}</div></div>
        <div class="stat"><div class="k">New orders from ${v.tier === "retailer" ? "customers" : "your customers"}</div><div class="v">${int(tw.incoming)}</div>${by}</div>
        <div class="stat"><div class="k">Shipped out</div><div class="v">${int(tw.shipped)}</div></div>
      </div>
      <h3 style="margin-top:16px">${brewery ? "Beer being brewed" : `Beer on the way to you from ${esc(v.supplier)}`}</h3>
      <div class="transit">${v.inTransit.map((q, i) => `<div class="box"><span class="tiny">${transitLbl(i)}</span><b>${int(q)}</b></div>`).join("")}</div>
      <p class="tiny" style="margin:8px 0 0">Costs: ${money(v.rates.holding)} per case in inventory and ${money(v.rates.backorder)} per case backordered, each week.</p>`;
  }
  function renderOrder() {
    const v = S.view, team = S.team, s = S.session, o = S.order;
    const brewery = v.tier === "brewery";
    const isCaptain = team.captain === me;
    const key = [v.week, v.status, s.paused, isCaptain, team.captain, o ? o.qty + o.source : "", pendingConfirm ?? ""].join("|");
    if (key === orderKey) return;
    // keep a half-typed number when the panel redraws
    const typed = $("#qty")?.value ?? "";
    orderKey = key;
    const box = $("#orderbox");
    const noun = brewery ? "production" : "order";
    const captainLine = team.captain
      ? (isCaptain ? `<span class="pill accent">You are captain</span>` : `<span class="small muted">Captain: <b>${esc(team.captainName)}</b></span>`)
      : `<span class="pill warn">No captain yet</span>`;
    const claim = isCaptain ? "" : `<button class="small" id="claim">Become captain</button>`;
    let body;
    if (v.status !== "playing") {
      body = `<p class="bigline">The game is over. Results will appear in a moment.</p>`;
    } else if (o) {
      const by = o.source === "instructor" ? "the instructor" : esc(o.byName);
      body = `<div class="msg good bigline">This week's ${noun} is locked in: <b>${int(o.qty)} cases</b>, submitted by ${by}.</div>
        <p class="muted" style="margin-top:10px">Waiting for the rest of the supply chain. The next week starts when every team has submitted.</p>`;
    } else if (s.paused) {
      body = `<p class="bigline muted">The game is paused.</p>`;
    } else if (!isCaptain) {
      body = team.captain
        ? `<p class="bigline">${esc(team.captainName)} will submit this week's ${noun}. Talk it through in the team chat.</p>`
        : `<p class="bigline">Your team needs a captain to submit the ${noun}. Anyone can take the job.</p>`;
    } else if (pendingConfirm != null) {
      body = `<div class="msg warn bigline">You are about to ${brewery ? "brew" : "order"} <b>${int(pendingConfirm)} cases</b>. Is that right?</div>
        <div class="row" style="margin-top:12px">
          <button class="primary big" id="confirm">Yes, submit ${int(pendingConfirm)}</button>
          <button class="big" id="change">Change it</button>
        </div>`;
    } else {
      const L = v.limits;
      const prompt = brewery ? "How many cases will you brew this week?" : `How many cases will you order from ${esc(v.supplier)}?`;
      const capLine = brewery
        ? `<p class="small muted" style="margin:6px 0 0">Normal capacity: ${int(L.normalCapacity)} cases a week. You can surge up to ${int(L.surgeCapacity)}, at ${money(L.surgePremium)} extra for each case above ${int(L.normalCapacity)}. Beer takes ${v.brewWeeks} weeks to brew.</p>` : "";
      body = `<form id="orderform" class="stack" autocomplete="off" novalidate>
          <label for="qty" class="bigline" style="font-weight:700">${prompt}</label>
          <div class="row">
            <input id="qty" class="qty" inputmode="numeric" maxlength="9" value="${esc(typed)}" aria-describedby="qtymsg">
            <span class="muted">cases</span>
            <button class="primary big" type="submit" id="submit">Submit ${noun}</button>
          </div>
          <div id="qtymsg" aria-live="polite"></div>
          ${capLine}
          <p class="tiny" style="margin:0">Once submitted, the ${noun} is locked for this week.</p>
        </form>`;
    }
    box.innerHTML = `<div class="row spread" style="margin-bottom:10px"><h2 style="margin:0">This week's ${noun}</h2><div class="row">${captainLine}${claim}</div></div>${body}`;

    $("#claim") && ($("#claim").onclick = claimCaptain);
    if ($("#orderform")) {
      const q = $("#qty");
      q.oninput = () => liveHint();
      $("#orderform").onsubmit = e => { e.preventDefault(); trySubmit(q.value); };
      if (typed) liveHint();
      if (document.activeElement === document.body) q.focus();
    }
    $("#confirm") && ($("#confirm").onclick = () => submitOrder(pendingConfirm));
    $("#change") && ($("#change").onclick = () => { pendingConfirm = null; renderOrder(); });
  }

  function liveHint() {
    const v = S.view, m = $("#qtymsg");
    if (!m) return;
    const raw = $("#qty").value;
    if (!raw.trim()) { m.innerHTML = ""; return; }
    const r = E.validateOrder(v.limits, raw, v.tier === "brewery");
    if (!r.ok) { m.innerHTML = `<div class="msg error small">${esc(r.error)}</div>`; return; }
    if (v.tier === "brewery") {
      const L = v.limits, surge = Math.max(0, r.value - L.normalCapacity);
      m.innerHTML = `<div class="small muted">${int(r.value - surge)} normal${surge ? ` + ${int(surge)} surge (${money(surge * L.surgePremium)} extra)` : ""}</div>`;
    } else m.innerHTML = "";
  }

  function trySubmit(raw) {
    const v = S.view;
    const r = E.validateOrder(v.limits, raw, v.tier === "brewery");
    if (!r.ok) { liveHint(); $("#qty").focus(); return; }
    if (r.confirm) { pendingConfirm = r.value; renderOrder(); return; }
    submitOrder(r.value);
  }

  async function submitOrder(qty) {
    const v = S.view, team = S.team;
    $$btns(true);
    try {
      if (S.session.paused) throw new Error("The game is paused.");
      if (team.captain !== me) throw new Error("Only the captain can submit.");
      const r = E.validateOrder(v.limits, String(qty), v.tier === "brewery");
      if (!r.ok) throw new Error(r.error);
      const ok = await store.createOnce(`${P()}/orders/${v.teamId}_${v.week}`, {
        teamId: v.teamId, netId: v.netId, week: v.week, qty: r.value,
        by: me, byName: S.player.name, source: "captain", at: Date.now(),
      });
      pendingConfirm = null;
      if (ok) {
        await chatWrite({ kind: "system", text: `${S.player.name} submitted this week's ${v.tier === "brewery" ? "production" : "order"}: ${r.value} cases.` });
      } else toast("This week's order was already submitted.");
    } catch (e) {
      toast(e.message || "Could not submit. Try again.");
      pendingConfirm = null;
      orderKey = "";
      renderOrder();
    }
  }
  function $$btns(dis) { root.querySelectorAll("#orderbox button").forEach(b => b.disabled = dis); }

  async function claimCaptain() {
    const b = $("#claim"); if (b) b.disabled = true;
    await store.updateDoc(`${P()}/teams/${S.team.id}`, { captain: me, captainName: S.player.name });
    await chatWrite({ kind: "system", text: `${S.player.name} is now captain.` });
  }

  function renderShare() {
    const v = S.view, box = $("#sharebox");
    if (!v.sharing) { box.innerHTML = ""; return; }
    const sh = v.sharing;
    const d = sh.demand;
    const rows = TIERS.map(t => sh.tiers[t]).length ? TIERS.map(t => {
      const x = sh.tiers[t];
      return `<tr><td><span class="dot" style="background:${tierColor(t)}"></span> ${tierLabel(t)}${x.teams > 1 ? `s (${x.teams})` : ""}</td><td>${int(x.inv)}</td><td>${int(x.backlog)}</td></tr>`;
    }).join("") : "";
    box.innerHTML = `<div class="card"><h3>Shared information</h3>
      <p class="small">End-customer demand this week: <b>${int(d[d.length - 1])}</b> cases per store${sh.retailers > 1 ? ` (${int(d[d.length - 1] * sh.retailers)} across all ${sh.retailers} stores)` : ""}.
      Recent weeks: ${d.slice(-8).map(int).join(", ")}.</p>
      <table><thead><tr><th>Whole supply chain</th><th>Inventory</th><th>Backorders</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderHistory() {
    const v = S.view;
    const h = v.history;
    const brewery = v.tier === "brewery";
    $("#historybox").innerHTML = `<h3>Your history</h3>
      <div class="chartbox sm"><canvas id="s-hist"></canvas></div>
      <div class="scrollx scrolly" style="margin-top:10px"><table>
        <thead><tr><th>Week</th><th>Received</th><th>Orders in</th><th>Shipped</th><th>Inventory</th><th>Backorders</th><th>${brewery ? "Brewed" : "You ordered"}</th><th>Cost</th></tr></thead>
        <tbody>${h.slice().reverse().map(e => `<tr><td>${e.week}</td><td>${int(e.received)}</td><td>${int(e.incoming)}</td><td>${int(e.shipped)}</td><td>${int(e.inv)}</td><td>${int(e.backlog)}</td><td>${e.order == null ? "—" : int(e.order)}</td><td>${money(e.weekCost)}</td></tr>`).join("")}</tbody>
      </table></div>`;
    C.lines("s-hist", $("#s-hist"), {
      labels: h.map(e => e.week),
      series: [
        { label: "Orders you received", data: h.map(e => e.incoming), color: cssVar("--ink-3") },
        { label: brewery ? "Your production" : "Orders you placed", data: h.map(e => e.order), color: tierColor(v.tier) },
        { label: "Inventory minus backorders", data: h.map(e => e.inv - e.backlog), color: cssVar("--ink"), dash: [4, 3], width: 1.5 },
      ],
      beginAtZero: false,
    });
  }

  // ---------------- chat ----------------
  function renderChat() {
    const log = $("#chatlog");
    if (!log) return;
    if (S.msgs.length === chatCount) return;
    chatCount = S.msgs.length;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.innerHTML = S.msgs.length ? S.msgs.map(m => m.kind === "system"
      ? `<div class="sys">${esc(m.text)}</div>`
      : `<div class="bubble ${m.uid === me ? "mine" : ""}">${m.uid === me ? "" : `<div class="who">${esc(m.name)}</div>`}<div class="t">${esc(m.text)}</div></div>`).join("")
      : `<div class="sys">No messages yet. Use chat instead of talking out loud.</div>`;
    if (atBottom || chatCount <= 1) log.scrollTop = log.scrollHeight;
  }

  async function sendChat(e) {
    e.preventDefault();
    const inp = $("#chatin");
    const text = inp.value.trim().slice(0, 300);
    if (!text) return;
    if (Date.now() - lastChatAt < 1500) { toast("Slow down a little."); return; }
    lastChatAt = Date.now();
    inp.value = "";
    await chatWrite({ kind: "msg", text });
  }

  function chatWrite({ kind, text }) {
    return store.setDoc(`${P()}/chats/${S.team.id}/msgs/${Date.now()}-${store.newId()}`, {
      uid: me, name: S.player.name, text, at: Date.now(), kind,
    });
  }

  // ---------------- debrief ----------------
  function renderDebrief() {
    const v = S.view, r = S.results;
    if (shell === "debrief:" + r.weeks) return;
    shell = "debrief:" + r.weeks;
    const bw = E.bullwhip(r);
    const mine = r.teams[v.teamId];
    const tierTeams = Object.values(r.teams).filter(t => t.tier === v.tier);
    const avgTier = tierTeams.reduce((s, t) => s + t.cost.total, 0) / tierTeams.length;
    const total = Object.values(r.teams).reduce((s, t) => s + t.cost.total, 0);
    root.innerHTML = `${banner}${topbar(`<span class="pill accent">${esc(v.label)}</span><span class="small muted">${esc(S.player.name)}</span>`)}
      <div class="wrap mid stack">
        <h1>Game over</h1>
        <p class="bigline">Customers at every store ordered ${int(r.demand[0])} cases a week, then ${int(Math.max(...r.demand))} from week ${r.demand.findIndex(d => d !== r.demand[0]) + 1 || "–"} on. That was the only change in demand.</p>
        <div class="card"><h3>How orders grew as they moved up the supply chain</h3>
          <div class="chartbox"><canvas id="s-bw"></canvas></div></div>
        <div class="grid2">
          <div class="card"><h3>Your team: ${esc(v.label)}</h3>
            <div class="kpis">
              <div class="stat"><div class="k">Your total cost</div><div class="v">${money(mine.cost.total)}</div></div>
              <div class="stat"><div class="k">${tierTeams.length > 1 ? `Average ${tierLabel(v.tier).toLowerCase()}` : "Supply chain total"}</div><div class="v">${money(tierTeams.length > 1 ? avgTier : total)}</div></div>
            </div>
            <div class="chartbox sm" style="margin-top:10px"><canvas id="s-mine"></canvas></div>
          </div>
          <div class="card"><h3>Order swings at each stage</h3>
            <p class="small muted">Variability of orders compared with variability of customer demand. 1 means no amplification.</p>
            <table><tbody>${TIERS.map(t => `<tr><td><span class="dot" style="background:${tierColor(t)}"></span> ${t === "brewery" ? "Brewery production" : tierLabel(t)}</td><td><b>${fmtRatio(bw.tierRatio[t])}×</b></td></tr>`).join("")}</tbody></table>
          </div>
        </div>
      </div>`;
    C.bullwhipChart("s-bw", $("#s-bw"), r, bw);
    C.lines("s-mine", $("#s-mine"), {
      labels: C.weeksLabels(r.weeks),
      series: [
        { label: "Orders you received", data: mine.incoming, color: cssVar("--ink-3") },
        { label: v.tier === "brewery" ? "Your production" : "Orders you placed", data: mine.orders, color: tierColor(v.tier) },
      ],
    });
  }

  // ---------------- go ----------------
  if (!code) await showJoin(); else await start(code);
  return cleanup;
}

export const fmtRatio = x => x == null ? "–" : x >= 10 ? Math.round(x).toString() : x.toFixed(1);
