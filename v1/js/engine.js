// Beer Game simulation engine. Pure functions: no network, no DOM.
//
// Everything is a "network": a tree of role-teams in which each team has
// one supplier (except the brewery) and one or more customers (retailers
// sell to end customers). A classic game is simply a 1-1-1-1 network.
//
// Every supplier-customer link keeps its own order pipeline, shipment
// pipeline and backorder balance, and a ledger check runs every week so
// orders, shipments and backorders can never be double counted.

import { TIERS, TIER_LABELS } from "./config.js";

const CUST = "_customers"; // retailers' end customers

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------
const INT_KEYS = ["networkDistributors", "networkWholesalers", "networkRetailers", "classicTeamSize",
  "weeks", "demandBase", "demandStepWeek", "demandStepTo", "orderDelay", "shipDelay",
  "productionDelay", "normalCapacity", "surgeCapacity"];
const NUM_KEYS = ["startingInventoryWeeks", "holdingCost", "backorderCost", "surgePremium",
  "warnMultiple", "hardMaxRetailer", "hardMaxWholesaler", "hardMaxDistributor",
  "normalCapacityFactor", "surgeCapacityFactor"];

export function normalizeConfig(raw) {
  const c = { ...raw };
  for (const k of NUM_KEYS) if (k in c) c[k] = Math.max(0, Number(c[k]) || 0);
  for (const k of INT_KEYS) if (k in c) c[k] = Math.max(0, Math.round(Number(c[k]) || 0));
  c.mode = c.mode === "classic" ? "classic" : "network";
  c.weeks = Math.max(2, c.weeks);
  for (const k of ["orderDelay", "shipDelay", "productionDelay", "networkDistributors",
    "networkWholesalers", "networkRetailers", "classicTeamSize"]) c[k] = Math.max(1, c[k]);
  c.networkWholesalers = Math.max(c.networkWholesalers, c.networkDistributors);
  c.networkRetailers = Math.max(c.networkRetailers, c.networkWholesalers);
  c.demandType = c.demandType === "custom" ? "custom" : "step";
  c.demandCustom = String(c.demandCustom || "");
  c.sharing = ["off", "on", "split"].includes(c.sharing) ? c.sharing : "off";
  if (c.mode === "network" && c.sharing === "split") c.sharing = "off";
  c.warnMultiple = c.warnMultiple || 3;
  return c;
}

export function demandFor(c, week) {
  if (c.demandType === "custom") {
    const list = customList(c);
    if (list.length) return list[Math.min(week - 1, list.length - 1)];
  }
  return week < c.demandStepWeek ? c.demandBase : c.demandStepTo;
}
function customList(c) {
  return c.demandCustom.split(/[\s,]+/).filter(Boolean).map(Number)
    .filter(n => Number.isFinite(n) && n >= 0).map(Math.round);
}
export function peakDemand(c) {
  if (c.demandType === "custom" && customList(c).length) return Math.max(...customList(c));
  return Math.max(c.demandBase, c.demandStepTo);
}

export function retailersPerNetwork(c) {
  return c.mode === "classic" ? 1 : c.networkRetailers;
}

// Brewery capacity in cases/week, from the factors (used to prefill forms).
export function suggestedCapacity(c) {
  const peak = peakDemand(c) * retailersPerNetwork(c);
  return {
    normal: Math.round(c.normalCapacityFactor * peak),
    surge: Math.round(c.surgeCapacityFactor * peak),
    peakDemand: peak,
  };
}

// ---------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------
// Returns [{id, name, teams: {id: {id, tier, label, supplier, customers}}}]
export function buildSkeletons(c, games = 1) {
  if (c.mode === "classic") {
    const nets = [];
    for (let g = 1; g <= games; g++) {
      const p = `G${g}-`;
      const ids = { retailer: p + "R", wholesaler: p + "W", distributor: p + "D", brewery: p + "B" };
      const teams = {};
      TIERS.forEach((tier, i) => {
        teams[ids[tier]] = {
          id: ids[tier], tier, label: TIER_LABELS[tier], game: `Game ${g}`,
          supplier: i < 3 ? ids[TIERS[i + 1]] : null,
          customers: i > 0 ? [ids[TIERS[i - 1]]] : [],
        };
      });
      nets.push({ id: `G${g}`, name: `Game ${g}`, teams });
    }
    return nets;
  }
  const counts = { brewery: 1, distributor: c.networkDistributors, wholesaler: c.networkWholesalers, retailer: c.networkRetailers };
  const letter = { brewery: "B", distributor: "D", wholesaler: "W", retailer: "R" };
  const idOf = (tier, i) => tier === "brewery" ? "B" : `${letter[tier]}${i + 1}`;
  const teams = {};
  for (const tier of TIERS) {
    for (let i = 0; i < counts[tier]; i++) {
      const id = idOf(tier, i);
      teams[id] = {
        id, tier, label: tier === "brewery" ? "Brewery" : `${TIER_LABELS[tier]} ${i + 1}`,
        game: "Network", supplier: null, customers: [],
      };
    }
  }
  for (let t = 0; t < 3; t++) {
    const tier = TIERS[t], up = TIERS[t + 1];
    for (let i = 0; i < counts[tier]; i++) {
      const s = idOf(up, Math.floor(i * counts[up] / counts[tier]));
      teams[idOf(tier, i)].supplier = s;
      teams[s].customers.push(idOf(tier, i));
    }
  }
  return [{ id: "N", name: "Supply Network", teams }];
}

// Upstream-first order is irrelevant to the math (phases are separate),
// but a stable order keeps tables and CSVs tidy.
export function teamOrder(net) {
  return Object.values(net.teams)
    .sort((a, b) => TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier) || a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map(t => t.id);
}

// ---------------------------------------------------------------------
// Network state
// ---------------------------------------------------------------------
export function newNetwork(skel, config, { sharing = false, now = Date.now() } = {}) {
  const c = structuredClone(config);
  const net = {
    id: skel.id, name: skel.name, mode: c.mode, sharing: !!sharing,
    config: c, configChanges: [],
    week: 0, status: "playing", demand: [],
    weekStartedAt: now, startedAt: now, endedAt: null,
    teams: {}, ledger: {},
  };
  // baselines bottom-up
  const d1 = demandFor(c, 1);
  const base = {};
  const calc = id => {
    const t = skel.teams[id];
    if (base[id] != null) return base[id];
    base[id] = t.tier === "retailer" ? d1 : t.customers.reduce((s, cid) => s + calc(cid), 0);
    return base[id];
  };
  Object.keys(skel.teams).forEach(calc);

  for (const s of Object.values(skel.teams)) {
    const b = base[s.id];
    const brewery = s.tier === "brewery";
    const lead = brewery ? c.productionDelay : c.shipDelay;
    const custKeys = s.tier === "retailer" ? [CUST] : s.customers;
    net.teams[s.id] = {
      id: s.id, tier: s.tier, label: s.label, game: s.game,
      supplier: s.supplier, customers: s.customers, baseline: b,
      inv: Math.round(c.startingInventoryWeeks * b),
      backlog: Object.fromEntries(custKeys.map(k => [k, 0])),
      orderPipes: Object.fromEntries(s.customers.map(cid => [cid, Array(c.orderDelay).fill(base[cid])])),
      shipPipe: Array(lead).fill(b),
      onOrder: b * (brewery ? c.productionDelay : c.shipDelay + c.orderDelay),
      expDemand: b,
      lastOrder: b,
      cost: { holding: 0, backorder: 0, surge: 0, total: 0 },
      history: [],
    };
    // ledger: one entry per link, keyed by the customer team
    if (s.supplier) {
      net.ledger[s.id] = { ordered: c.orderDelay * b, arrived: 0, shipped: 0, seedShip: lead * b, received: 0 };
    } else {
      net.ledger[s.id] = { brewed: 0, seed: lead * b, received: 0 };
    }
  }
  net.ledger[CUST] = {};
  startWeek(net, 1, now);
  return net;
}

// Split scarce inventory in proportion to what each customer is owed.
// Whole cases; leftover cases go to the largest remainders (ties rotate weekly).
export function allocate(inv, owed, week = 0) {
  const keys = Object.keys(owed);
  const total = keys.reduce((s, k) => s + owed[k], 0);
  if (inv >= total) return { ...owed };
  const out = {}, rema = [];
  let used = 0;
  keys.forEach((k, i) => {
    const raw = total > 0 ? inv * owed[k] / total : 0;
    out[k] = Math.floor(raw);
    used += out[k];
    rema.push({ k, r: raw - out[k], tie: (i + week) % keys.length });
  });
  rema.sort((a, b) => b.r - a.r || a.tie - b.tie);
  for (let i = 0; used < inv && i < rema.length; i++) {
    if (out[rema[i].k] < owed[rema[i].k]) { out[rema[i].k]++; used++; }
  }
  return out;
}

const sum = o => Object.values(o).reduce((s, v) => s + v, 0);

function startWeek(net, w, now) {
  for (const ch of net.configChanges) if (ch.week === w) Object.assign(net.config, ch.changes);
  const c = net.config;
  net.week = w;
  net.weekStartedAt = now;
  const d = demandFor(c, w);
  net.demand.push(d);
  const teams = Object.values(net.teams);

  // 1. receive
  const received = {};
  for (const t of teams) {
    const r = t.shipPipe.shift() ?? 0;
    received[t.id] = r;
    t.inv += r;
    t.onOrder -= r;
    net.ledger[t.id].received += r;
  }
  // 2. orders arrive, 3. ship
  for (const t of teams) {
    const incoming = {};
    if (t.tier === "retailer") incoming[CUST] = d;
    else for (const cid of t.customers) {
      incoming[cid] = t.orderPipes[cid].shift() ?? 0;
      net.ledger[cid].arrived += incoming[cid];
    }
    const owed = {};
    for (const k in incoming) owed[k] = t.backlog[k] + incoming[k];
    const shipped = allocate(t.inv, owed, w);
    for (const k in owed) t.backlog[k] = owed[k] - shipped[k];
    t.inv -= sum(shipped);
    for (const cid of t.customers) {
      net.teams[cid].shipPipe.push(shipped[cid]);
      net.ledger[cid].shipped += shipped[cid];
    }
    const inc = sum(incoming);
    t.expDemand += 0.3 * (inc - t.expDemand);
    const backlog = sum(t.backlog);
    const holding = c.holdingCost * t.inv;
    const backorder = c.backorderCost * backlog;
    t.cost.holding += holding;
    t.cost.backorder += backorder;
    t.cost.total += holding + backorder;
    const many = t.customers.length > 1;
    t.history.push({
      week: w, received: received[t.id], incoming: inc, shipped: sum(shipped),
      inv: t.inv, backlog,
      ...(many ? { incomingBy: incoming, shippedBy: shipped, backlogBy: { ...t.backlog } } : {}),
      order: null, normal: null, surge: null,
      holdingCost: holding, backorderCost: backorder, surgeCost: 0,
      weekCost: holding + backorder, cumCost: t.cost.total,
    });
  }
  checkLedger(net);
}

// Apply this week's decisions and move on. orders = {teamId: qty}
export function advance(net, orders, now = Date.now()) {
  const n = structuredClone(net);
  if (n.status !== "playing") return n;
  const c = n.config;
  for (const t of Object.values(n.teams)) {
    const q = orders[t.id];
    if (!Number.isInteger(q) || q < 0) throw new Error(`Missing order for ${t.label}`);
    const e = t.history[t.history.length - 1];
    e.order = q;
    if (t.tier === "brewery") {
      const normal = Math.min(q, c.normalCapacity);
      const surge = q - normal;
      const sc = surge * c.surgePremium;
      Object.assign(e, { normal, surge, surgeCost: sc, weekCost: e.weekCost + sc });
      t.cost.surge += sc;
      t.cost.total += sc;
      e.cumCost = t.cost.total;
      t.shipPipe.push(q);
      n.ledger[t.id].brewed += q;
    } else {
      n.teams[t.supplier].orderPipes[t.id].push(q);
      n.ledger[t.id].ordered += q;
    }
    t.onOrder += q;
    t.lastOrder = q;
  }
  if (n.week >= c.weeks) {
    n.status = "done";
    n.endedAt = now;
  } else {
    startWeek(n, n.week + 1, now);
  }
  return n;
}

// End early (instructor). The current, undecided week is dropped from stats.
export function endNetwork(net, now = Date.now()) {
  const n = structuredClone(net);
  if (n.status === "playing") { n.status = "done"; n.endedAt = now; }
  return n;
}

// Orders, shipments and backorders must always balance on every link.
export function checkLedger(net) {
  for (const t of Object.values(net.teams)) {
    const L = net.ledger[t.id];
    const inPipe = t.shipPipe.reduce((a, b) => a + b, 0);
    if (t.supplier) {
      const s = net.teams[t.supplier];
      const ordersInTransit = s.orderPipes[t.id].reduce((a, b) => a + b, 0);
      const ok = L.ordered === L.arrived + ordersInTransit
        && L.arrived === L.shipped + s.backlog[t.id]
        && L.shipped + L.seedShip === L.received + inPipe;
      if (!ok) throw new Error(`Ledger mismatch on link ${t.supplier} -> ${t.id} (week ${net.week})`);
    } else if (L.brewed + L.seed !== L.received + inPipe) {
      throw new Error(`Ledger mismatch in brewery production (week ${net.week})`);
    }
  }
}

// ---------------------------------------------------------------------
// Limits, validation, computer players
// ---------------------------------------------------------------------
export function recentIncoming(t, n = 4) {
  const h = t.history.slice(-n);
  return h.length ? h.reduce((s, e) => s + e.incoming, 0) / h.length : t.baseline;
}

export function limitsFor(net, teamId) {
  const c = net.config;
  const t = net.teams[teamId];
  const mult = { retailer: c.hardMaxRetailer, wholesaler: c.hardMaxWholesaler, distributor: c.hardMaxDistributor };
  const max = t.tier === "brewery" ? c.surgeCapacity : Math.max(1, Math.round(mult[t.tier] * t.baseline));
  const warnAt = Math.max(1, Math.round(c.warnMultiple * Math.max(recentIncoming(t), t.baseline)));
  return t.tier === "brewery"
    ? { max, warnAt, normalCapacity: c.normalCapacity, surgeCapacity: c.surgeCapacity, surgePremium: c.surgePremium }
    : { max, warnAt };
}

// Returns {ok, value, error, confirm}. Never trims an order: it either
// accepts it, asks to confirm it, or rejects it with a reason.
export function validateOrder(limits, raw, isBrewery = false) {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (s === "") return { ok: false, error: isBrewery ? "Enter how many cases to brew." : "Enter how many cases to order." };
  if (!/^\d+$/.test(s)) return { ok: false, error: "Please enter a whole number of cases (0 or more)." };
  if (s.length > 9 || Number(s) > limits.max) {
    return {
      ok: false,
      error: isBrewery
        ? `The brewery can make at most ${limits.max} cases a week (${limits.normalCapacity} normal + ${limits.max - limits.normalCapacity} surge). Please enter a different amount.`
        : `That is more than the ${limits.max}-case limit for one week. Please enter a different amount.`,
    };
  }
  const v = Number(s);
  return { ok: true, value: v, confirm: v > limits.warnAt };
}

// Computer player for empty teams: orders to cover expected demand and
// close gaps in inventory and in what is already on the way.
export function botOrder(net, teamId) {
  const c = net.config;
  const t = net.teams[teamId];
  const lead = t.tier === "brewery" ? c.productionDelay : c.orderDelay + c.shipDelay;
  const E = t.expDemand;
  const target = c.startingInventoryWeeks * t.baseline;
  const gapInv = target - (t.inv - sum(t.backlog));
  const gapLine = E * (lead - 1) - t.onOrder;
  const q = Math.round(E + 0.25 * (gapInv + gapLine));
  return Math.max(0, Math.min(limitsFor(net, teamId).max, q));
}

// ---------------------------------------------------------------------
// What a team is allowed to see
// ---------------------------------------------------------------------
export function teamView(net, teamId) {
  const t = net.teams[teamId];
  const labelOf = id => net.teams[id]?.label ?? "";
  const last = t.history[t.history.length - 1];
  const view = {
    teamId, tier: t.tier, label: t.label, game: t.game, netId: net.id, netName: net.name,
    mode: net.mode, week: net.week, status: net.status,
    supplier: t.supplier ? labelOf(t.supplier) : null,
    customers: t.tier === "retailer" ? ["Customers"] : t.customers.map(labelOf),
    inv: t.inv, backlog: sum(t.backlog),
    thisWeek: last ? {
      received: last.received, incoming: last.incoming, shipped: last.shipped,
      by: last.incomingBy ? t.customers.map(cid => ({
        label: labelOf(cid), incoming: last.incomingBy[cid], shipped: last.shippedBy[cid], owed: last.backlogBy[cid],
      })) : null,
      holdingCost: last.holdingCost, backorderCost: last.backorderCost, weekCost: last.weekCost,
    } : null,
    totalCost: t.cost.total,
    rates: { holding: net.config.holdingCost, backorder: net.config.backorderCost },
    inTransit: [...t.shipPipe],
    brewWeeks: net.config.productionDelay,
    limits: net.status === "playing" ? limitsFor(net, teamId) : null,
    history: t.history.map(e => ({
      week: e.week, received: e.received, incoming: e.incoming, shipped: e.shipped,
      inv: e.inv, backlog: e.backlog, order: e.order, weekCost: e.weekCost,
      ...(t.tier === "brewery" ? { surge: e.surge } : {}),
    })),
    sharing: null,
  };
  if (net.sharing) {
    const tiers = {};
    for (const tier of TIERS) {
      const ts = Object.values(net.teams).filter(x => x.tier === tier);
      tiers[tier] = { inv: ts.reduce((s, x) => s + x.inv, 0), backlog: ts.reduce((s, x) => s + sum(x.backlog), 0), teams: ts.length };
    }
    view.sharing = { demand: [...net.demand], retailers: Object.values(net.teams).filter(x => x.tier === "retailer").length, tiers };
  }
  return view;
}

// ---------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------
export function completedWeeks(net) {
  const t = Object.values(net.teams)[0];
  return t.history.filter(e => e.order != null).length;
}

// Compact, shareable results for the debrief (no live pipeline state).
export function results(net) {
  const W = completedWeeks(net);
  const teams = {};
  for (const id of teamOrder(net)) {
    const t = net.teams[id];
    const h = t.history.slice(0, W);
    teams[id] = {
      id, tier: t.tier, label: t.label, baseline: t.baseline, supplier: t.supplier,
      orders: h.map(e => e.order), incoming: h.map(e => e.incoming), received: h.map(e => e.received),
      shipped: h.map(e => e.shipped), inv: h.map(e => e.inv), backlog: h.map(e => e.backlog),
      holding: h.map(e => e.holdingCost), backorder: h.map(e => e.backorderCost), surgeCost: h.map(e => e.surgeCost),
      normal: t.tier === "brewery" ? h.map(e => e.normal) : null,
      surge: t.tier === "brewery" ? h.map(e => e.surge) : null,
      cost: {
        holding: h.reduce((s, e) => s + e.holdingCost, 0),
        backorder: h.reduce((s, e) => s + e.backorderCost, 0),
        surge: h.reduce((s, e) => s + e.surgeCost, 0),
      },
    };
    const k = teams[id].cost;
    k.total = k.holding + k.backorder + k.surge;
  }
  // capacity by week (reflects mid-game changes)
  const cap = [];
  const cfg = { ...net.configChanges.length ? initialConfig(net) : net.config };
  for (let w = 1; w <= W; w++) {
    for (const ch of net.configChanges) if (ch.week === w) Object.assign(cfg, ch.changes);
    cap.push({ normal: cfg.normalCapacity, surge: cfg.surgeCapacity });
  }
  return {
    netId: net.id, name: net.name, mode: net.mode, sharing: net.sharing, weeks: W,
    retailers: Object.values(net.teams).filter(t => t.tier === "retailer").length,
    demand: net.demand.slice(0, W), capacity: cap,
    changes: net.configChanges.filter(ch => ch.week <= W),
    teams,
  };
}
function initialConfig(net) {
  // Undo every recorded change, newest first, to recover week-1 settings.
  const cfg = { ...net.config };
  for (const ch of [...net.configChanges].reverse()) Object.assign(cfg, ch.previous || {});
  return cfg;
}

function variance(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

// Bullwhip ratio = variance of orders / variance of the customer demand
// the team (or tier) ultimately serves, scaled to its size.
export function bullwhip(res) {
  const demandRetail = res.demand;
  const vd = variance(demandRetail);
  const teamRatio = {};
  for (const t of Object.values(res.teams)) {
    const scale = t.baseline / (demandRetail[0] || 1);
    teamRatio[t.id] = vd > 0 ? variance(t.orders) / (vd * scale * scale) : null;
  }
  const tierRatio = {}, tierOrders = {};
  const vTotal = vd * res.retailers * res.retailers;
  for (const tier of TIERS) {
    const ts = Object.values(res.teams).filter(t => t.tier === tier);
    const tot = res.demand.map((_, i) => ts.reduce((s, t) => s + t.orders[i], 0));
    tierOrders[tier] = tot;
    tierRatio[tier] = vTotal > 0 ? variance(tot) / vTotal : null;
  }
  return { teamRatio, tierRatio, tierOrders, demandTotal: res.demand.map(d => d * res.retailers) };
}

// Flat rows for CSV export.
export function csvRows(res, extra = {}) {
  const rows = [];
  for (const t of Object.values(res.teams)) {
    for (let i = 0; i < res.weeks; i++) {
      rows.push({
        ...extra, network: res.name, sharing: res.sharing ? "on" : "off",
        team: t.label, team_id: t.id, tier: t.tier, supplier: t.supplier ? res.teams[t.supplier].label : "",
        week: i + 1, customer_demand_per_retailer: res.demand[i],
        received: t.received[i], incoming_orders: t.incoming[i], shipped: t.shipped[i],
        inventory: t.inv[i], backorders: t.backlog[i], order_or_production: t.orders[i],
        surge_units: t.surge ? t.surge[i] : "", normal_capacity: t.tier === "brewery" ? res.capacity[i].normal : "",
        holding_cost: t.holding[i], backorder_cost: t.backorder[i], surge_cost: t.surgeCost[i],
        week_cost: t.holding[i] + t.backorder[i] + t.surgeCost[i],
      });
    }
  }
  return rows;
}
