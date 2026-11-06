// Simulation lab: play a whole game with computer players in this
// browser (no database), run every integrity check each week, show the
// debrief, and inspect the complete supply-chain state week by week.
import * as E from "./engine.js";
import { DEFAULTS, TIERS } from "./config.js";
import { esc, $, int, money, tierColor, topbar, toCSV, download } from "./ui.js";
import { renderDebrief } from "./debrief.js";

export function mount(root) {
  const ui = { deb: {}, week: 1, netIdx: 0 };
  let run = null;

  root.innerHTML = `${topbar(`<a class="btn small" href="#/host">Instructor</a>`)}
    <div class="wrap stack">
      <h1>Simulation lab</h1>
      <p class="muted">Runs a complete game in this browser with computer players, checks the simulation's books every week, and lets you inspect every team's state. Nothing is saved or shared.</p>
      <form class="card" id="labform">
        <div class="fields">
          <div class="field"><label for="mode">Structure</label><select id="mode"><option value="network">Class-wide network</option><option value="classic">Classic games</option></select></div>
          <div class="field"><label for="games">Classic games</label><input id="games" type="number" min="1" max="20" value="3"></div>
          <div class="field"><label for="weeks">Weeks</label><input id="weeks" type="number" min="5" max="100" value="${DEFAULTS.weeks}"></div>
          <div class="field"><label for="botStyle">Computer style</label><select id="botStyle">
            <option value="steady">Steady (baseline)</option><option value="mixed">Mixed</option><option value="conservative">Conservative</option>
            <option value="reactive">Reacts strongly</option><option value="forecast">Forecast-based</option></select></div>
          <div class="field"><label for="botSeed">Random seed</label><input id="botSeed" type="number" value="${DEFAULTS.botSeed}"></div>
          <div class="field"><label for="surgeCapacityFactor">Surge capacity (× peak demand)</label><input id="surgeCapacityFactor" type="number" step="0.25" value="${DEFAULTS.surgeCapacityFactor}"></div>
        </div>
        <div class="row"><button class="primary" type="submit">Run simulation</button><span id="runmsg" class="small muted"></span></div>
      </form>
      <div id="checks"></div>
      <div id="inspect"></div>
      <div id="deb"></div>
    </div>`;

  $("#labform").onsubmit = e => {
    e.preventDefault();
    const raw = { ...DEFAULTS };
    for (const id of ["mode", "weeks", "botStyle", "botSeed", "surgeCapacityFactor"]) raw[id] = $("#" + id).value;
    const c = E.normalizeConfig(raw);
    const cap = E.suggestedCapacity(c);
    Object.assign(c, { normalCapacity: cap.normal, surgeCapacity: cap.surge });
    const games = c.mode === "classic" ? Math.max(1, Number($("#games").value) || 1) : 1;
    const t0 = performance.now();
    const nets = [], weeksByNet = [], errors = [];
    E.buildSkeletons(c, games).forEach((s, i) => {
      let n = E.newNetwork(s, c, { index: i });
      const states = [n];
      try {
        while (n.status === "playing") {
          const orders = {}, sources = {};
          for (const id of Object.keys(n.teams)) { orders[id] = E.botOrder(n, id); sources[id] = "computer"; }
          n = E.advance(n, orders, Date.now(), sources);
          states.push(n);
        }
        E.checkIntegrity(n, "end");
      } catch (err) { errors.push(`${s.name}: ${err.message}`); }
      nets.push(n); weeksByNet.push(states);
    });
    run = { nets, weeksByNet, errors, c };
    ui.week = 1; ui.netIdx = 0; ui.deb = {};
    $("#runmsg").textContent = `Done in ${Math.round(performance.now() - t0)} ms.`;
    $("#checks").innerHTML = errors.length
      ? `<div class="msg error"><b>Integrity check failed.</b><br>${errors.map(esc).join("<br>")}</div>`
      : `<div class="msg good"><b>All integrity checks passed every week</b> in ${nets.length} ${nets.length > 1 ? "games" : "network"} (${E.completedWeeks(nets[0])} weeks): no negative inventory, shipments never exceeded stock, production within capacity, every order and shipment arrived after its exact delay, every link's orders = shipped + owed + in transit, and no cases created or lost.</div>`;
    renderInspector();
    renderDebrief($("#deb"), nets, ui.deb, { prefix: "lab-" });
  };

  function renderInspector() {
    if (!run) return;
    const states = run.weeksByNet[ui.netIdx];
    const maxW = states.length;
    ui.week = Math.min(Math.max(1, ui.week), maxW);
    const n = states[ui.week - 1];
    const ids = E.teamOrder(n);
    const sum = arr => arr.reduce((a, b) => a + b, 0);
    const cases = n.cases.delivered + Object.values(n.teams).reduce((s, t) => s + t.inv + sum(t.shipPipe), 0);
    $("#inspect").innerHTML = `<div class="card stack">
      <div class="row spread"><h2 style="margin:0">Week-by-week state</h2>
        <div class="row">
          ${run.nets.length > 1 ? `<select id="insnet" style="width:auto">${run.nets.map((x, i) => `<option value="${i}" ${i === ui.netIdx ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}
          <button class="small" id="wprev">◀</button>
          <input id="wslider" type="range" min="1" max="${maxW}" value="${ui.week}" style="width:220px">
          <button class="small" id="wnext">▶</button>
          <b>${n.status === "done" ? "Final state" : `Start of week ${n.week}`}</b>
          <button class="small" id="wjson">Download this state (JSON)</button>
        </div></div>
      <p class="small muted" style="margin:0">State after shipments arrive and orders are filled, before this week's decisions. “Decision” shows what was then chosen. Cases in system: ${int(cases)} = ${int(n.cases.start)} at start + ${int(n.cases.produced)} brewed (${int(n.cases.delivered)} already sold to customers).</p>
      <div class="scrollx"><table><thead><tr><th>Team</th><th>Style</th><th>Inventory</th><th>Owes</th><th>Owed to whom</th><th>Arrived</th><th>Orders in</th><th>Shipped</th><th>In transit to it</th><th>Its orders in transit</th><th>Decision</th><th>Cost to date</th></tr></thead><tbody>
      ${ids.map(id => {
        const t = n.teams[id];
        const e = t.history[t.history.length - 1] || {};
        const decided = states[ui.week]?.teams[id].history[t.history.length - 1]?.order;
        const owedTo = t.customers.length ? t.customers.map(cid => `${n.teams[cid].label}: ${t.backlog[cid]}`).join(", ") : `customers: ${t.backlog._customers ?? 0}`;
        const inTransitOrders = t.supplier ? n.teams[t.supplier].orderPipes[id] : null;
        return `<tr><td><span class="dot" style="background:${tierColor(t.tier)}"></span> ${esc(t.label)}</td><td class="small">${esc(E.BOT_STYLES[t.botStyle]?.label || "")}</td>
          <td>${int(t.inv)}</td><td>${int(Object.values(t.backlog).reduce((a, b) => a + b, 0))}</td><td class="small" style="text-align:left">${esc(owedTo)}</td>
          <td>${int(e.received)}</td><td>${int(e.incoming)}</td><td>${int(e.shipped)}</td>
          <td class="small">${t.shipPipe.map(int).join(" · ")}</td><td class="small">${inTransitOrders ? inTransitOrders.map(int).join(" · ") : "—"}</td>
          <td><b>${decided != null ? int(decided) : "—"}</b></td><td>${money(t.cost.total)}</td></tr>`;
      }).join("")}</tbody></table></div></div>`;
    $("#wslider").oninput = e => { ui.week = Number(e.target.value); renderInspector(); };
    $("#wprev").onclick = () => { ui.week--; renderInspector(); };
    $("#wnext").onclick = () => { ui.week++; renderInspector(); };
    $("#insnet") && ($("#insnet").onchange = e => { ui.netIdx = Number(e.target.value); renderInspector(); });
    $("#wjson").onclick = () => {
      const blob = JSON.stringify(n, null, 2);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([blob], { type: "application/json" }));
      a.download = `beergame-lab-week${n.week}.json`; a.click();
    };
  }

  return () => { };
}
