// Debrief dashboard, shared by the instructor dashboard and the
// simulation lab. Takes full network states and draws from E.results().
import * as E from "./engine.js";
import { TIERS } from "./config.js";
import { esc, $, $$, int, money0, tierLabel, tierColor, cssVar } from "./ui.js";
import * as C from "./charts.js";
import { fmtRatio } from "./student.js";

// ui: persistent view state {dnet, focus, invMode, costMode}
export function renderDebrief(body, nets, ui, { prefix = "d-" } = {}) {
  C.destroyAll(prefix);
  if (!nets.length) { body.innerHTML = ""; return; }
  const multi = nets.length > 1;
  if (!ui.dnet || (ui.dnet !== "all" && !nets.find(n => n.id === ui.dnet))) ui.dnet = multi ? "all" : nets[0].id;
  const picker = multi ? `<div class="row" style="margin-bottom:14px"><span class="small muted">Show</span>
    <select id="${prefix}pick" style="width:auto"><option value="all">All games side by side</option>${nets.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join("")}</select></div>` : "";
  const rerender = () => renderDebrief(body, nets, ui, { prefix });
  if (ui.dnet === "all") {
    const res = nets.map(n => E.results(n)).filter(r => r.weeks >= 2);
    body.innerHTML = picker + (res.length ? allGamesHTML(res, prefix) : notYet());
    drawAllGames(res, prefix);
  } else {
    const res = E.results(nets.find(n => n.id === ui.dnet));
    body.innerHTML = picker + (res.weeks >= 2 ? oneNetHTML(res, ui, prefix) : notYet());
    if (res.weeks >= 2) drawOneNet(res, ui, prefix, rerender);
  }
  const pk = $(`#${prefix}pick`, body);
  if (pk) { pk.value = ui.dnet; pk.onchange = e => { ui.dnet = e.target.value; ui.focus = "all"; rerender(); }; }
}

const notYet = () => `<div class="card"><p class="muted">The debrief fills in after a couple of weeks of play.</p></div>`;

function cumulative(xs) { let s = 0; return xs.map(x => (s += x)); }
function sumArrays(arrs, W) { return Array.from({ length: W }, (_, i) => arrs.reduce((s, a) => s + (a[i] || 0), 0)); }

// Teams in a branch: a distributor (or wholesaler) and everyone below it,
// plus the path up to the brewery.
function branchOf(res, rootId) {
  const ids = new Set([rootId]);
  const down = id => (res.teams[id].customers || []).forEach(c => { ids.add(c); down(c); });
  down(rootId);
  let up = res.teams[rootId].supplier;
  while (up) { ids.add(up); up = res.teams[up].supplier; }
  return ids;
}

function focusOptions(res) {
  const teams = Object.values(res.teams);
  const opts = [`<option value="all">Whole network</option>`];
  const branches = teams.filter(t => t.tier === "distributor" && teams.filter(x => x.tier === "distributor").length > 1);
  if (branches.length) opts.push(`<optgroup label="Branches">${branches.map(t => `<option value="b:${t.id}">${esc(t.label)} branch</option>`).join("")}</optgroup>`);
  opts.push(`<optgroup label="One team">${teams.map(t => `<option value="t:${t.id}">${esc(t.label)}</option>`).join("")}</optgroup>`);
  return opts.join("");
}
function focusSet(res, focus) {
  if (!focus || focus === "all") return null;
  if (focus.startsWith("b:")) return branchOf(res, focus.slice(2));
  if (focus.startsWith("t:")) return new Set([focus.slice(2)]);
  return null;
}

function oneNetHTML(res, ui, p) {
  const bw = E.bullwhip(res);
  const teams = Object.values(res.teams);
  const total = teams.reduce((s, t) => s + t.cost.total, 0);
  const k = teams.reduce((s, t) => ({ h: s.h + t.cost.holding, b: s.b + t.cost.backorder, s: s.s + t.cost.surge }), { h: 0, b: 0, s: 0 });
  const tiersPresent = TIERS.filter(t => teams.some(x => x.tier === t));
  const network = res.retailers > 1;
  const B = teams.find(t => t.tier === "brewery");
  const ratioCell = x => bw.ok ? fmtRatio(x) : "–";
  ui.invMode = ui.invMode || "net";
  return `<div class="stack">
    <div class="kpis">
      <div class="stat"><div class="k">Weeks played</div><div class="v">${res.weeks}</div></div>
      <div class="stat"><div class="k">Supply chain cost</div><div class="v">${money0(total)}</div></div>
      <div class="stat"><div class="k">Holding / backorder / surge</div><div class="v" style="font-size:1.05rem">${money0(k.h)} / ${money0(k.b)} / ${money0(k.s)}</div></div>
      <div class="stat"><div class="k">Distributor order swings vs demand</div><div class="v">${bw.ok ? fmtRatio(bw.tierRatio.distributor) + "×" : "–"}</div></div>
    </div>
    <div class="card"><h3>Customer demand vs. orders at each stage</h3>
      <p class="small muted">${network ? "Totals across all teams in each tier. " : ""}Customer demand changed once; the swings above it are the bullwhip. Brewery production is shown separately below.</p>
      <div class="chartbox"><canvas id="${p}bw"></canvas></div></div>
    <div class="grid2">
      <div class="card"><h3>Brewery: orders received vs. production</h3>
        <p class="tiny">${res.changes.length ? `Capacity settings changed in week ${res.changes.map(c => c.week).join(", ")}.` : "Dotted lines show normal and maximum capacity."}</p>
        <div class="chartbox"><canvas id="${p}brew"></canvas></div></div>
      <div class="card"><div class="row spread"><h3 style="margin:0">Cumulative cost</h3>
        <span class="tiny">Whole ${network ? "network" : "game"}</span></div>
        <div class="chartbox" style="margin-top:8px"><canvas id="${p}cum"></canvas></div></div>
    </div>
    <div class="card"><div class="row spread"><h3 style="margin:0">Compare teams</h3>
        <div class="row"><span class="small muted">Highlight</span><select id="${p}focus" style="width:auto">${focusOptions(res)}</select></div></div>
      <p class="small muted">Orders shown relative to each team's normal weekly flow, so every tier fits on one scale (1 = normal; customer demand doubles to 2).</p>
      <div class="chartbox"><canvas id="${p}idx"></canvas></div>
      <div class="chartbox" style="margin-top:12px"><canvas id="${p}tinv"></canvas></div></div>
    <div class="card"><div class="row spread"><h3 style="margin:0">Inventory and backorders by tier</h3>
      <div class="seg" id="${p}invseg">${[["net", "Inventory − backorders"], ["inv", "Inventory"], ["back", "Backorders"]].map(([v, l]) => `<button data-v="${v}" class="${ui.invMode === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="chartbox" style="margin-top:10px"><canvas id="${p}inv"></canvas></div></div>
    <div class="card"><h3>Costs by team</h3><div class="chartbox"><canvas id="${p}cost"></canvas></div></div>
    <div class="card"><h3>Bullwhip measure</h3>
      ${bw.ok ? `<p class="small muted">Variance of orders ÷ variance of the customer demand each team ultimately serves, scaled to its size. 1 = no amplification. For the brewery, “orders received” measures how wildly distributors ordered; “production” measures the brewery's own decisions.</p>`
        : `<div class="msg info">Customer demand barely varied in this game (or too few weeks were played), so ratios aren't meaningful and are left out.</div>`}
      <div class="scrollx"><table><thead><tr><th>Team</th><th>Bullwhip ratio</th><th>Peak order</th><th>Peak backorders</th><th>Holding</th><th>Backorder</th><th>Surge</th><th>Total cost</th></tr></thead><tbody>
      ${tiersPresent.map(tier => {
        const ts = teams.filter(t => t.tier === tier);
        if (tier === "brewery") {
          return `<tr style="font-weight:700;background:var(--surface-2)"><td><span class="dot" style="background:${tierColor(tier)}"></span> Brewery</td><td></td><td></td><td></td><td>${money0(B.cost.holding)}</td><td>${money0(B.cost.backorder)}</td><td>${money0(B.cost.surge)}</td><td>${money0(B.cost.total)}</td></tr>
            <tr><td>Orders received from distributors</td><td>${ratioCell(bw.breweryOrdersRatio)}</td><td>${int(Math.max(...B.incoming))}</td><td>${int(Math.max(...B.backlog))}</td><td colspan="4"></td></tr>
            <tr><td>Production decisions</td><td>${ratioCell(bw.breweryProductionRatio)}</td><td>${int(Math.max(...B.orders))}</td><td></td><td colspan="4"></td></tr>`;
        }
        const rows = ts.map(t => `<tr><td>${ts.length > 1 ? "" : `<span class="dot" style="background:${tierColor(tier)}"></span> `}${esc(t.label)}</td><td>${ratioCell(bw.teamRatio[t.id])}</td><td>${int(Math.max(...t.orders))}</td><td>${int(Math.max(...t.backlog))}</td><td>${money0(t.cost.holding)}</td><td>${money0(t.cost.backorder)}</td><td></td><td>${money0(t.cost.total)}</td></tr>`).join("");
        const head = `<tr style="font-weight:700;background:var(--surface-2)"><td><span class="dot" style="background:${tierColor(tier)}"></span> ${ts.length > 1 ? `All ${tierLabel(tier).toLowerCase()}s` : tierLabel(tier)}</td><td>${ratioCell(bw.tierRatio[tier])}</td><td></td><td></td><td></td><td></td><td></td><td>${money0(ts.reduce((s, t) => s + t.cost.total, 0))}</td></tr>`;
        return ts.length > 1 ? head + rows : rows;
      }).join("")}</tbody></table></div></div>
  </div>`;
}

function drawOneNet(res, ui, p, rerender) {
  const bw = E.bullwhip(res);
  const W = res.weeks, labels = C.weeksLabels(W);
  const teams = Object.values(res.teams);
  C.bullwhipChart(p + "bw", $(`#${p}bw`), res, bw);
  C.breweryChart(p + "brew", $(`#${p}brew`), res);

  // cumulative costs
  const hold = cumulative(sumArrays(teams.map(t => t.holding), W));
  const back = cumulative(sumArrays(teams.map(t => t.backorder), W));
  const surge = cumulative(sumArrays(teams.map(t => t.surgeCost), W));
  C.lines(p + "cum", $(`#${p}cum`), {
    labels, yTitle: "Dollars, cumulative",
    series: [
      { label: "Total", data: hold.map((h, i) => h + back[i] + surge[i]), color: cssVar("--ink"), width: 2.5 },
      { label: "Holding", data: hold, color: cssVar("--c-holding") },
      { label: "Backorder", data: back, color: cssVar("--c-backorder") },
      { label: "Surge", data: surge, color: cssVar("--c-surge") },
    ],
  });

  // focus charts
  const sel = focusSet(res, ui.focus);
  const fade = cssVar("--grid");
  const d0 = res.demand[0] || 1;
  const ordered = [...teams].sort((a, b) => (sel?.has(a.id) ? 1 : 0) - (sel?.has(b.id) ? 1 : 0)); // highlighted drawn last
  const style = t => {
    const on = !sel || sel.has(t.id);
    return { color: on ? tierColor(t.tier) : fade, width: on ? (sel ? 2.5 : 1.5) : 1 };
  };
  C.lines(p + "idx", $(`#${p}idx`), {
    labels, yTitle: "Orders ÷ normal flow",
    series: [{ label: "Customer demand", data: res.demand.map(d => d / d0), color: cssVar("--ink"), dash: [6, 4] },
      ...ordered.map(t => ({ label: t.label, data: t.orders.map(o => o / t.baseline), ...style(t) }))],
  });
  C.lines(p + "tinv", $(`#${p}tinv`), {
    labels, yTitle: "Inventory − backorders (cases)", beginAtZero: false,
    series: ordered.map(t => ({ label: t.label, data: t.inv.map((v, i) => v - t.backlog[i]), ...style(t) })),
  });
  for (const id of [p + "idx", p + "tinv"]) {
    const ch = C.get(id);
    if (ch) {
      ch.options.plugins.legend.display = !!sel && sel.size <= 8;
      ch.options.plugins.legend.labels.filter = item => !sel || item.text === "Customer demand" || [...sel].some(x => res.teams[x].label === item.text);
      ch.options.plugins.tooltip.filter = item => !sel || item.dataset.label === "Customer demand" || [...sel].some(x => res.teams[x].label === item.dataset.label);
      ch.update();
    }
  }
  const fs = $(`#${p}focus`);
  fs.value = ui.focus || "all";
  fs.onchange = e => { ui.focus = e.target.value; rerender(); };

  // inventory by tier
  const tiers = TIERS.filter(t => teams.some(x => x.tier === t));
  const pick = { net: (t, i) => t.inv[i] - t.backlog[i], inv: (t, i) => t.inv[i], back: (t, i) => t.backlog[i] }[ui.invMode];
  C.lines(p + "inv", $(`#${p}inv`), {
    labels, beginAtZero: ui.invMode !== "net", yTitle: "Cases",
    series: tiers.map(tier => {
      const ts = teams.filter(t => t.tier === tier);
      return { label: tierLabel(tier), color: tierColor(tier), data: labels.map((_, i) => ts.reduce((s, t) => s + pick(t, i), 0)) };
    }),
  });
  $$(`#${p}invseg button`).forEach(b => b.onclick = () => { ui.invMode = b.dataset.v; rerender(); });

  C.stackedBars(p + "cost", $(`#${p}cost`), {
    labels: teams.map(t => t.label),
    series: [
      { label: "Holding", data: teams.map(t => Math.round(t.cost.holding)), color: cssVar("--c-holding") },
      { label: "Backorder", data: teams.map(t => Math.round(t.cost.backorder)), color: cssVar("--c-backorder") },
      { label: "Surge", data: teams.map(t => Math.round(t.cost.surge)), color: cssVar("--c-surge") },
    ],
  });
}

function allGamesHTML(res, p) {
  const rows = res.map(r => ({ r, bw: E.bullwhip(r), total: Object.values(r.teams).reduce((s, t) => s + t.cost.total, 0) }));
  const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const cols = [["retailer", "Retailer"], ["wholesaler", "Wholesaler"], ["distributor", "Distributor"]];
  const val = (x, k) => k === "prod" ? x.bw.breweryProductionRatio : x.bw.tierRatio[k];
  const avgRow = (label, list) => list.length ? `<tr style="font-weight:700;background:var(--surface-2)"><td>${label}</td>${[...cols.map(c => c[0]), "prod"].map(k => `<td>${fmtRatio(avg(list.map(x => val(x, k)).filter(v => v != null)))}</td>`).join("")}<td>${money0(avg(list.map(x => x.total)))}</td></tr>` : "";
  const sh = rows.filter(x => x.r.sharing), no = rows.filter(x => !x.r.sharing);
  return `<div class="stack">
    <div class="card"><h3>Every game, same pattern</h3>
      <div class="legend" style="margin-bottom:10px"><span><span class="swatch" style="background:var(--ink);height:2px"></span>Customer demand (dashed)</span>${cols.map(([t, l]) => `<span><span class="swatch" style="background:${tierColor(t)}"></span>${l} orders</span>`).join("")}</div>
      <div class="multiples">${rows.map((x, i) => `<div><div class="small"><b>${esc(x.r.name)}</b>${x.r.sharing ? ` <span class="pill accent">sharing</span>` : ""}</div><div class="chartbox sm"><canvas id="${p}g${i}"></canvas></div></div>`).join("")}</div></div>
    <div class="card"><h3>Bullwhip ratio by stage</h3><p class="small muted">Order variance ÷ customer demand variance. 1 = no amplification.</p>
      <div class="scrollx"><table><thead><tr><th>Game</th>${cols.map(c => `<th>${c[1]}</th>`).join("")}<th>Brewery production</th><th>Total cost</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${esc(x.r.name)}${x.r.sharing ? " (sharing)" : ""}</td>${[...cols.map(c => c[0]), "prod"].map(k => `<td>${fmtRatio(val(x, k))}</td>`).join("")}<td>${money0(x.total)}</td></tr>`).join("")}
      ${sh.length && no.length ? avgRow("Average, no sharing", no) + avgRow("Average, with sharing", sh) : avgRow("Average", rows)}
      </tbody></table></div></div>
  </div>`;
}
function drawAllGames(res, p) {
  res.forEach((r, i) => {
    const ch = C.bullwhipChart(`${p}g${i}`, $(`#${p}g${i}`), r, E.bullwhip(r));
    if (ch) { ch.options.plugins.legend.display = false; ch.options.scales.y.title.display = false; ch.update(); }
  });
}
