// Student screens: join, lobby, play, debrief.
// The play screen puts three jobs first: see the team's situation, talk
// it over in team chat, and (captain only) submit the decision.
import * as E from "./engine.js";
import { TIERS, BACKEND } from "./config.js";
import { esc, $, $$, int, money, tierLabel, tierColor, topbar, toast, cssVar } from "./ui.js";
import { perTabIdentity } from "./store.js";
import * as C from "./charts.js";

export const fmtRatio = x => x == null ? "–" : x >= 10 ? Math.round(x).toString() : x.toFixed(1);

export async function mount(root, store, code, banner) {
  const me = store.uid();
  const S = { code, session: null, player: null, team: null, view: null, order: null, msgs: [], results: null };
  const subs = [];
  let teamSubs = [];
  let orderSub = null, orderWeek = null, watchedTeam = null;
  let lastChatAt = 0, pendingConfirm = null, orderKey = "", chatCount = -1;
  let mobileTab = "team", seenMsgs = 0, historyOpen = false;

  const P = () => `sessions/${S.code}`;
  const cleanup = () => {
    subs.forEach(u => u()); teamSubs.forEach(u => u()); orderSub?.();
    C.destroyAll("s-");
  };

  // ---------------- join ----------------
  async function showJoin(msg = "") {
    const fb = BACKEND === "firebase";
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
            <p class="tiny">This browser will remember you. If you refresh or lose your connection, just come back to this page.</p>
          </form>
          ${fb ? `<p class="tiny"><a href="#" id="tabid">Testing with several tabs?</a> Click here to make this tab a separate student.</p>` : ""}
        </div>
      </div>`;
    $("#tabid") && ($("#tabid").onclick = e => { e.preventDefault(); perTabIdentity(true); location.reload(); });
    $("#join").onsubmit = async e => {
      e.preventDefault();
      const c = $("#code").value.trim().toUpperCase();
      const name = $("#name").value.trim().replace(/\s+/g, " ").slice(0, 30);
      if (!c || !name) return;
      const btn = e.submitter; if (btn) btn.disabled = true;
      const sess = await store.getDoc(`sessions/${c}`);
      if (!sess) { code = c; return showJoin("No session with that code. Check the code on the screen."); }
      if (sess.status === "ended") { code = c; return showJoin("That session has ended."); }
      const existing = await store.getDoc(`sessions/${c}/players/${me}`);
      if (!existing) await store.setDoc(`sessions/${c}/players/${me}`, { name, joinedAt: Date.now(), teamId: null, netId: null });
      if (location.hash === `#/play/${c}`) start(c); else location.hash = `#/play/${c}`;
    };
  }

  // ---------------- live data ----------------
  async function start(c) {
    S.code = c;
    const p = await store.getDoc(`${P()}/players/${me}`);
    if (!p) return showJoin();
    subs.push(store.watchDoc(P(), s => { S.session = s; render(); }));
    subs.push(store.watchDoc(`${P()}/players/${me}`, pl => {
      S.player = pl;
      if (pl?.teamId && pl.teamId !== watchedTeam && !pl.removed) watchTeam(pl.teamId, pl.netId);
      render();
    }));
  }

  function watchTeam(teamId, netId) {
    teamSubs.forEach(u => u()); teamSubs = [];
    watchedTeam = teamId;
    orderWeek = null; S.view = null; S.team = null; S.msgs = []; S.results = null;
    shell = ""; chatCount = -1; seenMsgs = 0;
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
    if (pl.removed) {
      shell = "";
      root.innerHTML = `${banner}${topbar()}<div class="wrap narrow"><div class="card"><h2>You've been removed from this session</h2><p>Ask your instructor if this is a mistake.</p></div></div>`;
      return;
    }
    if (!pl.teamId || !S.view || !S.team) return renderLobby();
    if (S.view.status === "done" && S.results) return renderDebrief();
    renderPlay();
  }

  function renderLobby() {
    shell = "lobby";
    const s = S.session, team = S.team;
    root.innerHTML = `${banner}${topbar(`<span class="pill">${esc(S.player.name)}</span>`)}
      <div class="wrap narrow" style="padding-top:40px"><div class="card stack" style="text-align:center">
        <h1>You're in, ${esc(S.player.name.split(" ")[0])}.</h1>
        ${team ? `<p class="bigline">Your team: <span class="pill accent" style="font-size:1rem">${esc(team.label)}</span>${team.game && team.game !== "Network" ? ` <span class="muted">(${esc(team.game)})</span>` : ""}</p>` : ""}
        <p class="muted bigline">${s.status === "lobby" ? "Waiting for the instructor to start the game." : "Getting your team ready…"}</p>
        <p class="small muted">Keep this page open.</p>
      </div></div>`;
  }

  function statusChip() {
    const v = S.view, o = S.order;
    if (v.status !== "playing") return `<span class="pill">Game over</span>`;
    if (S.session.paused) return `<span class="pill warn">Paused</span>`;
    if (o) return `<span class="pill good">✓ Submitted</span>`;
    return `<span class="pill warn">Not submitted</span>`;
  }

  function renderPlay() {
    const v = S.view, team = S.team;
    if (shell !== "play") {
      shell = "play";
      orderKey = ""; chatCount = -1;
      root.innerHTML = `${banner}<div id="top"></div>
        <div class="wrap play-wrap" data-tab="${mobileTab}">
          <div id="alerts"></div>
          <div class="play">
            <div class="stack main-col">
              <div class="card orderbox" id="orderbox"></div>
              <div id="cards"></div>
              <div id="sharebox"></div>
              <details class="card" id="historybox" ${historyOpen ? "open" : ""}><summary><h3 style="display:inline">History and charts</h3></summary><div id="historybody"></div></details>
            </div>
            <div class="card chat" id="chat">
              <div class="head"><h3 style="margin:0">Team chat</h3><div class="tiny">Only your ${esc(v.label)} team can see this. Use it instead of talking out loud.</div></div>
              <div class="log" id="chatlog"></div>
              <form class="foot" id="chatform" autocomplete="off">
                <input id="chatin" maxlength="300" placeholder="Message your team">
                <button class="primary" type="submit">Send</button>
              </form>
            </div>
          </div>
        </div>
        <nav class="mobtabs" id="mobtabs"><button data-t="team">Team</button><button data-t="chat">Chat <span id="unread" class="pill bad hidden"></span></button></nav>`;
      $("#chatform").onsubmit = sendChat;
      $("#historybox").addEventListener("toggle", e => { historyOpen = e.target.open; if (historyOpen) renderHistory(); });
      $$("#mobtabs button").forEach(b => b.onclick = () => {
        mobileTab = b.dataset.t;
        $(".play-wrap").dataset.tab = mobileTab;
        if (mobileTab === "chat") { seenMsgs = S.msgs.length; const log = $("#chatlog"); log.scrollTop = log.scrollHeight; }
        markTabs();
      });
      markTabs();
    }
    const cap = team.captain === me ? `<span class="pill accent">You are captain</span>`
      : team.captain ? `<span class="small">Captain: <b>${esc(team.captainName)}</b></span>` : `<span class="pill warn">No captain</span>`;
    $("#top").innerHTML = topbar(`
      <span class="pill" style="font-size:.95rem">Week ${v.week}</span>
      <span class="pill accent" style="font-size:.95rem">${esc(v.label)}${v.mode === "classic" ? ` · ${esc(v.netName)}` : ""}</span>
      ${cap}${statusChip()}`);
    const alerts = [];
    if (S.session.paused) alerts.push(`<div class="msg warn"><b>Paused.</b> The instructor has paused the game.</div>`);
    if (team.nudgeAt && Date.now() - team.nudgeAt < 5 * 60000 && !S.order && v.status === "playing") {
      alerts.push(`<div class="msg error"><b>The rest of the supply chain is waiting for your team.</b> ${team.captain ? "Captain, please submit this week's decision." : "Someone please become captain and submit."}</div>`);
    }
    $("#alerts").innerHTML = alerts.length ? `<div class="stack" style="margin-bottom:14px">${alerts.join("")}</div>` : "";
    renderOrder();
    renderCards();
    renderShare();
    if (historyOpen) renderHistory();
    renderChat();
  }

  function markTabs() {
    $$("#mobtabs button").forEach(b => b.classList.toggle("on", b.dataset.t === mobileTab));
    const u = $("#unread");
    if (!u) return;
    const n = S.msgs.length - seenMsgs;
    if (mobileTab === "chat") seenMsgs = S.msgs.length;
    u.textContent = n;
    u.classList.toggle("hidden", mobileTab === "chat" || n <= 0);
  }

  // ---------------- decision panel ----------------
  function renderOrder() {
    const v = S.view, team = S.team, s = S.session, o = S.order;
    const brewery = v.tier === "brewery";
    const isCaptain = team.captain === me;
    const key = [v.week, v.status, s.paused, isCaptain, team.captain, o ? o.qty + o.source : "", pendingConfirm ?? ""].join("|");
    if (key === orderKey) return;
    const typed = $("#qty")?.value ?? "";
    orderKey = key;
    const noun = brewery ? "production" : "order";
    const verb = brewery ? "brew" : "order";
    const last = v.lastDecision ? `<span class="small muted">Last week your team ${brewery ? "brewed" : "ordered"} <b>${int(v.lastDecision.qty)}</b>.</span>` : "";
    const claim = isCaptain ? "" : `<button class="small" id="claim">Become captain</button>`;
    let body;
    if (v.status !== "playing") {
      body = `<p class="bigline">The game is over. Results will appear in a moment.</p>`;
    } else if (o) {
      const by = o.source === "captain" ? esc(o.byName) : o.source === "instructor" ? "the instructor" : o.source === "previous" ? "the instructor (repeated last week's)" : "the computer, at the instructor's request";
      body = `<div class="submitted"><div class="big">✓ Submitted: ${int(o.qty)} cases</div><div class="small">Locked in by ${by}. The next week starts when every team has submitted.</div></div>`;
    } else if (s.paused) {
      body = `<p class="bigline muted">The game is paused.</p>`;
    } else if (!isCaptain) {
      body = team.captain
        ? `<p class="bigline">${esc(team.captainName)} will submit this week's ${noun}. Talk it through in team chat.</p>`
        : `<p class="bigline">Your team needs a captain to submit the ${noun}. Anyone can take the job.</p>`;
    } else if (pendingConfirm != null) {
      body = `<div class="msg warn bigline">That's a large ${noun}: <b>${int(pendingConfirm)} cases</b>. Is that right?</div>
        ${brewery ? surgeLine(pendingConfirm) : ""}
        <div class="row" style="margin-top:12px">
          <button class="primary big" id="confirm">Yes, submit ${int(pendingConfirm)}</button>
          <button class="big" id="change">Change it</button>
        </div>`;
    } else {
      const prompt = brewery ? "How many cases will you brew this week?" : `How many cases will you order from ${esc(v.supplier)}?`;
      body = `<form id="orderform" class="stack" autocomplete="off" novalidate>
          <label for="qty" class="bigline" style="font-weight:700">${prompt}</label>
          <div class="row">
            <input id="qty" class="qty" inputmode="numeric" maxlength="9" value="${esc(typed)}" aria-describedby="qtymsg">
            <span class="muted">cases</span>
            <button class="primary big" type="submit" id="submit">Submit ${noun}</button>
          </div>
          <div id="qtymsg" aria-live="polite"></div>
          <p class="tiny" style="margin:0">Not submitted until you press Submit. Once submitted, it's locked for this week.</p>
        </form>`;
    }
    $("#orderbox").innerHTML = `<div class="row spread" style="margin-bottom:10px">
        <h2 style="margin:0">This week's ${noun}</h2><div class="row">${last}${claim}</div></div>${body}`;
    $("#claim") && ($("#claim").onclick = claimCaptain);
    if ($("#orderform")) {
      const q = $("#qty");
      q.oninput = liveHint;
      $("#orderform").onsubmit = e => { e.preventDefault(); trySubmit(q.value); };
      liveHint();
    }
    $("#confirm") && ($("#confirm").onclick = () => submitOrder(pendingConfirm));
    $("#change") && ($("#change").onclick = () => { pendingConfirm = null; renderOrder(); });
  }

  function surgeLine(q) {
    const L = S.view.limits;
    const surge = Math.max(0, q - L.normalCapacity);
    return `<div class="small" style="margin-top:6px">${int(q - surge)} at normal capacity${surge
      ? ` + <b>${int(surge)} surge</b> · additional surge cost <b>${money(surge * L.surgePremium)}</b>`
      : " · no surge cost"}</div>`;
  }

  function liveHint() {
    const v = S.view, m = $("#qtymsg");
    if (!m) return;
    const raw = $("#qty").value;
    if (!raw.trim()) { m.innerHTML = `<span class="pill">Nothing entered</span>`; return; }
    const r = E.validateOrder(v.limits, raw, v.tier === "brewery");
    if (!r.ok) { m.innerHTML = `<div class="msg error small">${esc(r.error)}</div>`; return; }
    m.innerHTML = `<span class="pill warn">Entered: ${int(r.value)}, not submitted yet</span>${v.tier === "brewery" ? surgeLine(r.value) : ""}`;
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
    root.querySelectorAll("#orderbox button").forEach(b => b.disabled = true);
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
      if (ok) await chatWrite({ kind: "system", text: `${S.player.name} submitted this week's ${v.tier === "brewery" ? "production" : "order"}: ${r.value} cases.` });
      else toast("This week's decision was already submitted.");
    } catch (e) {
      toast(e.message || "Could not submit. Try again.");
      pendingConfirm = null; orderKey = ""; renderOrder();
    }
  }

  async function claimCaptain() {
    const b = $("#claim"); if (b) b.disabled = true;
    await store.updateDoc(`${P()}/teams/${S.team.id}`, { captain: me, captainName: S.player.name });
    await chatWrite({ kind: "system", text: `${S.player.name} is now captain.` });
  }

  // ---------------- situation cards ----------------
  function renderCards() {
    const v = S.view, tw = v.thisWeek || {};
    const brewery = v.tier === "brewery";
    const when = i => i === 0 ? "Next week" : `In ${i + 1} weeks`;
    const transit = `<div class="transit">${v.inTransit.map((q, i) => `<div class="box"><span class="tiny">${when(i)}</span><b>${int(q)}</b></div>`).join("")}</div>`;
    const byCust = tw.by ? `<div class="tiny" style="margin-top:4px">${tw.by.map(b => `${esc(b.label)}: ${int(b.incoming)}`).join(" · ")}</div>` : "";
    const owedBy = v.owedBy ? `<div class="tiny" style="margin-top:4px">${v.owedBy.map(b => `${esc(b.label)}: ${int(b.owed)}`).join(" · ")}</div>` : "";
    const chain = TIERS.slice().reverse().map(t => `<span class="${t === v.tier ? "me" : ""}">${tierLabel(t)}</span>`).join(" → ") + " → Customers";
    const rel = brewery ? `You supply <b>${v.customers.map(esc).join(", ")}</b>`
      : `You buy from <b>${esc(v.supplier)}</b> · you sell to <b>${v.customers.map(esc).join(", ")}</b>`;

    if (brewery) {
      const L = v.limits;
      $("#cards").innerHTML = `<div class="card stack">
        <div class="row spread"><div class="chain">${chain}</div><div class="small muted">${rel}</div></div>
        <div class="stats">
          <div class="stat"><div class="k">Inventory</div><div class="v">${int(v.inv)}</div></div>
          <div class="stat ${v.backlog ? "bad" : ""}"><div class="k">Owed to distributors</div><div class="v">${int(v.backlog)}</div>${owedBy}</div>
          <div class="stat"><div class="k">Orders from distributors this week</div><div class="v">${int(tw.incoming)}</div>${byCust}</div>
          <div class="stat"><div class="k">Shipped out this week</div><div class="v">${int(tw.shipped)}</div></div>
        </div>
        <div class="grid2">
          <div><h3>Production schedule</h3>${transit}<p class="tiny" style="margin:6px 0 0">Beer takes ${v.brewWeeks} weeks to brew. This week's batch will be ready in ${v.brewWeeks} weeks. Finished this week: ${int(tw.received)}.</p></div>
          <div><h3>Capacity</h3>${L ? `<table class="captable"><tbody>
            <tr><td>Normal capacity</td><td><b>${int(L.normalCapacity)}</b> cases/week</td></tr>
            <tr><td>Maximum with surge</td><td><b>${int(L.surgeCapacity)}</b> cases/week</td></tr>
            <tr><td>Surge cost</td><td><b>${money(L.surgePremium)}</b> per case above normal</td></tr></tbody></table>` : ""}</div>
        </div>
        <div class="stats">
          <div class="stat"><div class="k">Cost this week</div><div class="v">${money(tw.weekCost)}</div></div>
          <div class="stat"><div class="k">Total cost</div><div class="v">${money(v.totalCost)}</div></div>
          <div class="stat"><div class="k">of which surge</div><div class="v">${money(v.costs?.surge)}</div></div>
          <div class="stat"><div class="k">of which holding / backorder</div><div class="v" style="font-size:1.1rem">${money(v.costs?.holding)} / ${money(v.costs?.backorder)}</div></div>
        </div>
        <p class="tiny" style="margin:0">Costs: ${money(v.rates.holding)} per case in inventory and ${money(v.rates.backorder)} per case owed, each week, plus surge.</p>
      </div>`;
      return;
    }
    $("#cards").innerHTML = `<div class="card stack">
      <div class="row spread"><div class="chain">${chain}</div><div class="small muted">${rel}</div></div>
      <div class="stats">
        <div class="stat"><div class="k">Inventory</div><div class="v">${int(v.inv)}</div></div>
        <div class="stat ${v.backlog ? "bad" : ""}"><div class="k">Backorders (you owe)</div><div class="v">${int(v.backlog)}</div>${owedBy}</div>
        <div class="stat"><div class="k">New orders received</div><div class="v">${int(tw.incoming)}</div>${byCust}</div>
        <div class="stat"><div class="k">Shipment that arrived</div><div class="v">${int(tw.received)}</div></div>
      </div>
      <div class="grid2">
        <div><h3>Beer on the way to you</h3>${transit}<p class="tiny" style="margin:6px 0 0">Shipped out this week: ${int(tw.shipped)}.</p></div>
        <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="stat"><div class="k">Cost this week</div><div class="v">${money(tw.weekCost)}</div></div>
          <div class="stat"><div class="k">Total cost</div><div class="v">${money(v.totalCost)}</div></div>
        </div>
      </div>
      <p class="tiny" style="margin:0">Costs: ${money(v.rates.holding)} per case in inventory and ${money(v.rates.backorder)} per case backordered, each week.</p>
    </div>`;
  }

  function renderShare() {
    const v = S.view, box = $("#sharebox");
    if (!v.sharing) { box.innerHTML = ""; return; }
    const sh = v.sharing, d = sh.demand;
    box.innerHTML = `<div class="card"><h3>Shared information</h3>
      <p class="small">End-customer demand this week: <b>${int(d[d.length - 1])}</b> cases per store${sh.retailers > 1 ? ` (${int(d[d.length - 1] * sh.retailers)} across all ${sh.retailers} stores)` : ""}.
      Recent weeks: ${d.slice(-8).map(int).join(", ")}.</p>
      <table><thead><tr><th>Whole supply chain</th><th>Inventory</th><th>Backorders</th></tr></thead><tbody>${TIERS.map(t => {
        const x = sh.tiers[t];
        return `<tr><td><span class="dot" style="background:${tierColor(t)}"></span> ${tierLabel(t)}${x.teams > 1 ? `s (${x.teams})` : ""}</td><td>${int(x.inv)}</td><td>${int(x.backlog)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function renderHistory() {
    const v = S.view, h = v.history, brewery = v.tier === "brewery";
    const box = $("#historybody");
    if (!box) return;
    box.innerHTML = `<div class="chartbox sm" style="margin-top:10px"><canvas id="s-hist"></canvas></div>
      <div class="scrollx scrolly" style="margin-top:10px"><table>
        <thead><tr><th>Week</th><th>Arrived</th><th>Orders in</th><th>Shipped</th><th>Inventory</th><th>Backorders</th><th>${brewery ? "Brewed" : "You ordered"}</th>${brewery ? "<th>Surge</th>" : ""}<th>Cost</th></tr></thead>
        <tbody>${h.slice().reverse().map(e => `<tr><td>${e.week}</td><td>${int(e.received)}</td><td>${int(e.incoming)}</td><td>${int(e.shipped)}</td><td>${int(e.inv)}</td><td>${int(e.backlog)}</td><td>${e.order == null ? "—" : int(e.order)}</td>${brewery ? `<td>${e.surge ? int(e.surge) : ""}</td>` : ""}<td>${money(e.weekCost)}</td></tr>`).join("")}</tbody>
      </table></div>`;
    C.lines("s-hist", $("#s-hist"), {
      labels: h.map(e => e.week),
      series: [
        { label: brewery ? "Orders from distributors" : "Orders you received", data: h.map(e => e.incoming), color: cssVar("--ink-3") },
        { label: brewery ? "Your production" : "Orders you placed", data: h.map(e => e.order), color: tierColor(v.tier) },
      ],
    });
  }

  // ---------------- chat ----------------
  function renderChat() {
    const log = $("#chatlog");
    if (!log) return;
    markTabs();
    if (S.msgs.length === chatCount) return;
    chatCount = S.msgs.length;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.innerHTML = S.msgs.length ? S.msgs.map(m => m.kind === "system"
      ? `<div class="sys">${esc(m.text)}</div>`
      : `<div class="bubble ${m.uid === me ? "mine" : ""}">${m.uid === me ? "" : `<div class="who">${esc(m.name)}</div>`}<div class="t">${esc(m.text)}</div></div>`).join("")
      : `<div class="sys">No messages yet.</div>`;
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
    const stepWeek = r.demand.findIndex(d => d !== r.demand[0]) + 1;
    const ratioRows = [["retailer", "Retailer orders"], ["wholesaler", "Wholesaler orders"], ["distributor", "Distributor orders"]];
    root.innerHTML = `${banner}${topbar(`<span class="pill accent">${esc(v.label)}</span><span class="small muted">${esc(S.player.name)}</span>`)}
      <div class="wrap mid stack">
        <h1>Game over</h1>
        <p class="bigline">${stepWeek > 0
          ? `Customers at every store ordered ${int(r.demand[0])} cases a week, then ${int(r.demand[stepWeek - 1])} from week ${stepWeek} on. That was the only change in demand.`
          : `Customer demand was ${int(r.demand[0])} cases a week per store.`}</p>
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
            ${bw.ok ? `<p class="small muted">How much more orders varied than customer demand. 1 means no amplification.</p>
            <table><tbody>${ratioRows.map(([t, l]) => `<tr><td><span class="dot" style="background:${tierColor(t)}"></span> ${l}</td><td><b>${fmtRatio(bw.tierRatio[t])}×</b></td></tr>`).join("")}
            <tr><td><span class="dot" style="background:${tierColor("brewery")}"></span> Brewery production</td><td><b>${fmtRatio(bw.breweryProductionRatio)}×</b></td></tr></tbody></table>`
            : `<p class="small muted">Customer demand barely changed in this game, so there's no meaningful ratio to show.</p>`}
          </div>
        </div>
      </div>`;
    C.bullwhipChart("s-bw", $("#s-bw"), r, bw);
    C.lines("s-mine", $("#s-mine"), {
      labels: C.weeksLabels(r.weeks),
      series: [
        { label: v.tier === "brewery" ? "Orders from distributors" : "Orders you received", data: mine.incoming, color: cssVar("--ink-3") },
        { label: v.tier === "brewery" ? "Your production" : "Orders you placed", data: mine.orders, color: tierColor(v.tier) },
      ],
    });
  }

  if (!code) await showJoin(); else await start(code);
  return cleanup;
}
