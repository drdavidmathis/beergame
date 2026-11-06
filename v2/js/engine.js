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
  c.botStyle = ["steady", "mixed", "conservative", "reactive", "forecast"].includes(c.botStyle) ? c.botStyle : "steady";
  c.botSeed = Math.round(Number(c.botSeed) || 1);
  c.autoPlaceLate = c.autoPlaceLate !== false && c.autoPlaceLate !== "false";
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
export function newNetwork(skel, config, { sharing = false, now = Date.now(), index = 0 } = {}) {
  const c = structuredClone(config);
  const net = {
    id: skel.id, name: skel.name, mode: c.mode, sharing: !!sharing,
    config: c, configChanges: [],
    week: 0, status: "playing", endedBy: null, demand: [],
    weekStartedAt: now, startedAt: now, endedAt: null,
    teams: {}, ledger: {}, cases: { start: 0, produced: 0, delivered: 0 },
  };
  const rng = mulberry32(hashSeed(c.botSeed ?? 1, skel.id, index));
  const styles = Object.keys(BOT_STYLES);
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
      botStyle: c.botStyle === "mixed" ? styles[Math.floor(rng() * styles.length)]
        : (BOT_STYLES[c.botStyle] ? c.botStyle : "steady"),
      history: [],
    };
    // ledger: one entry per link, keyed by the customer team
    if (s.supplier) {
      net.ledger[s.id] = { ordered: c.orderDelay * b, arrived: 0, shipped: 0, seedShip: lead * b, received: 0 };
    } else {
      net.ledger[s.id] = { brewed: 0, seed: lead * b, received: 0 };
    }
  }
  for (const t of Object.values(net.teams)) net.cases.start += t.inv + t.shipPipe.reduce((a, b) => a + b, 0);
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
    if (sum(shipped) > t.inv) throw new Error(`Integrity: ${t.label} shipped more than it had (week ${w})`);
    for (const k in owed) {
      if (shipped[k] > owed[k] || shipped[k] < 0) throw new Error(`Integrity: allocation error at ${t.label} (week ${w})`);
      t.backlog[k] = owed[k] - shipped[k];
    }
    t.inv -= sum(shipped);
    if (t.tier === "retailer") net.cases.delivered += shipped[CUST];
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
      order: null, source: null, normal: null, surge: null,
      holdingCost: holding, backorderCost: backorder, surgeCost: 0,
      weekCost: holding + backorder, cumCost: t.cost.total,
    });
  }
  checkIntegrity(net, "start");
}

// Apply this week's decisions and move on. orders = {teamId: qty}
// sources = {teamId: "team" | "instructor" | "previous" | "computer"}
export function advance(net, orders, now = Date.now(), sources = {}) {
  const n = structuredClone(net);
  if (n.status !== "playing") return n;
  const c = n.config;
  for (const t of Object.values(n.teams)) {
    const q = orders[t.id];
    if (!Number.isInteger(q) || q < 0) throw new Error(`Missing order for ${t.label}`);
    const lim = limitsFor(n, t.id).max;
    if (q > lim) throw new Error(t.tier === "brewery"
      ? `Integrity: production of ${q} exceeds the brewery's maximum of ${lim}`
      : `Integrity: order of ${q} from ${t.label} exceeds its limit of ${lim}`);
    const e = t.history[t.history.length - 1];
    e.order = q;
    e.source = sources[t.id] || "team";
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
      n.cases.produced += q;
    } else {
      n.teams[t.supplier].orderPipes[t.id].push(q);
      n.ledger[t.id].ordered += q;
    }
    t.onOrder += q;
    t.lastOrder = q;
  }
  if (n.week >= c.weeks) {
    n.status = "done";
    n.endedBy = "schedule";
    n.endedAt = now;
    checkIntegrity(n, "end");
  } else {
    startWeek(n, n.week + 1, now);
  }
  return n;
}

// Add weeks to a game. A game that already reached its scheduled end
// (or was ended early) picks up where it stopped.
export function extendNetwork(net, add, now = Date.now()) {
  const n = structuredClone(net);
  n.config.weeks += add;
  if (n.status === "done") {
    n.status = "playing";
    n.endedAt = null;
    if (n.endedBy === "schedule") startWeek(n, n.week + 1, now);
    else n.weekStartedAt = now;
    n.endedBy = null;
  }
  return n;
}

// Re-run the game from a saved start-of-week state, using the decisions
// recorded in priorNet, with some of them corrected. Computer decisions
// are recalculated, because the computer reacts to the corrected state.
// corrections = {teamId: {week: qty}}
export function replay(snapshot, priorNet, corrections, now = Date.now(), onWeekStart = null) {
  let n = structuredClone(snapshot);
  n.configChanges = structuredClone(priorNet.configChanges || []);
  const doneWeeks = completedWeeks(priorNet);
  while (n.status === "playing" && n.week <= doneWeeks) {
    const w = n.week;
    const orders = {}, sources = {};
    for (const id of Object.keys(n.teams)) {
      const e = priorNet.teams[id].history[w - 1];
      const fix = corrections[id]?.[w];
      if (fix != null) { orders[id] = fix; sources[id] = "instructor"; }
      else if (e.source === "computer") { orders[id] = botOrder(n, id); sources[id] = "computer"; }
      else { orders[id] = e.order; sources[id] = e.source; }
    }
 n = advance(n, orders, now, sources);
    if (n.status === "playing") onWeekStart?.(n);
  }
  if (priorNet.status === "done" && priorNet.endedBy === "instructor" && n.status === "playing") {
    n = endNetwork(n, now);
  }
  n.weekStartedAt = priorNet.weekStartedAt;
  return n;
}

// End early (instructor). The current, undecided week is dropped from stats.
export function endNetwork(net, now = Date.now()) {
  const n = structuredClone(net);
  if (n.status === "playing") { n.status = "done"; n.endedBy = "instructor"; n.endedAt = now; }
  return n;
}

// Run after every state change. Throws on any inconsistency.
export function checkIntegrity(net, phase = "start") {
  checkLedger(net);
  const c = net.config;
  let cases = net.cases.delivered;
  for (const t of Object.values(net.teams)) {
    if (t.inv < 0) throw new Error(`Integrity: negative inventory at ${t.label} (week ${net.week})`);
    if (Object.values(t.backlog).some(b => b < 0)) throw new Error(`Integrity: negative backorders at ${t.label}`);
    cases += t.inv + t.shipPipe.reduce((a, b) => a + b, 0);
    // pipeline lengths prove every shipment and order takes exactly its lead time
    if (phase === "start") {
      const want = t.tier === "brewery" ? c.productionDelay - 1 : c.shipDelay;
      if (t.shipPipe.length !== want) throw new Error(`Integrity: wrong transit length at ${t.label}`);
      for (const cid of t.customers) {
        if (t.orderPipes[cid].length !== c.orderDelay - 1) throw new Error(`Integrity: wrong order-delay length at ${t.label}`);
      }
    }
  }
  if (cases !== net.cases.start + net.cases.produced) {
    throw new Error(`Integrity: cases created or lost (have ${cases}, expected ${net.cases.start + net.cases.produced}, week ${net.week})`);
  }
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

// Computer players. Each style is a plain decision rule: forecast
// demand, then close part of the gap in inventory and in what is
// already on the way. Styles differ in how they forecast and react;
// none of them is built to create a bullwhip on purpose.
export const BOT_STYLES = {
  steady: { label: "Steady (baseline)", theta: 0.3, adjust: 0.25, lineWeight: 1, invWeeks: null },
  conservative: { label: "Conservative", theta: 0.2, adjust: 0.15, lineWeight: 1, invWeeks: 2 },
  reactive: { label: "Reacts strongly", theta: 0.6, adjust: 0.5, lineWeight: 0.4, invWeeks: null },
  forecast: { label: "Forecast-based", theta: null, adjust: 0.3, lineWeight: 1, invWeeks: null },
};

function forecastFor(t, style) {
  const inc = t.history.map(e => e.incoming);
  if (style.theta == null) {
    // 4-week moving average plus half the recent trend
    const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : t.baseline;
    const now = avg(inc.slice(-4)), before = avg(inc.slice(-8, -4).length ? inc.slice(-8, -4) : inc.slice(0, 1));
    return Math.max(0, now + 0.5 * (now - before));
  }
  let E = t.baseline;
  for (const x of inc) E += style.theta * (x - E);
  return E;
}

export function botOrder(net, teamId) {
  const c = net.config;
  const t = net.teams[teamId];
  const style = BOT_STYLES[t.botStyle] || BOT_STYLES.steady;
  const lead = t.tier === "brewery" ? c.productionDelay : c.orderDelay + c.shipDelay;
  const E = forecastFor(t, style);
  const target = (style.invWeeks ?? c.startingInventoryWeeks) * t.baseline;
  const gapInv = target - (t.inv - sum(t.backlog));
  const gapLine = E * (lead - 1) - t.onOrder;
  const q = Math.round(E + style.adjust * (gapInv + style.lineWeight * gapLine));
  return Math.max(0, Math.min(limitsFor(net, teamId).max, q));
}

// Small seeded random number generator, so "mixed" computer players are
// assigned the same way every time for a given seed.
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join("|")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
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
    costs: { holding: t.cost.holding, backorder: t.cost.backorder, surge: t.cost.surge },
    owedBy: t.customers.length > 1 ? t.customers.map(cid => ({ label: labelOf(cid), owed: t.backlog[cid] })) : null,
    lastDecision: (() => {
      const e = [...t.history].reverse().find(x => x.order != null);
      return e ? { week: e.week, qty: e.order } : null;
    })(),
    rates: { holding: net.config.holdingCost, backorder: net.config.backorderCost },
    inTransit: [...t.shipPipe],
    brewWeeks: net.config.productionDelay,
    limits: net.status === "playing" ? limitsFor(net, teamId) : null,
    history: t.history.map(e => ({
      week: e.week, received: e.received, incoming: e.incoming, shipped: e.shipped,
      inv: e.inv, backlog: e.backlog, order: e.order, weekCost: e.weekCost,
      ...(t.tier === "brewery" ? { surge: e.surge, surgeCost: e.surgeCost } : {}),
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
      id, tier: t.tier, label: t.label, baseline: t.baseline, supplier: t.supplier, customers: t.customers,
      botStyle: t.botStyle, sources: h.map(e => e.source),
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
// the team (or tier) ultimately serves, scaled to its size. When customer
// demand barely varied, ratios are meaningless, so they are left out.
export const MIN_DEMAND_VARIANCE = 0.05;
export function bullwhip(res) {
  const demandRetail = res.demand;
  const vd = variance(demandRetail);
  const ok = vd >= MIN_DEMAND_VARIANCE && res.weeks >= 4;
  const teamRatio = {};
  for (const t of Object.values(res.teams)) {
    const scale = t.baseline / (demandRetail[0] || 1);
    teamRatio[t.id] = ok ? variance(t.orders) / (vd * scale * scale) : null;
  }
  const tierRatio = {}, tierOrders = {};
  const vTotal = vd * res.retailers * res.retailers;
  for (const tier of TIERS) {
    const ts = Object.values(res.teams).filter(t => t.tier === tier);
    const tot = res.demand.map((_, i) => ts.reduce((s, t) => s + t.orders[i], 0));
    tierOrders[tier] = tot;
    tierRatio[tier] = ok ? variance(tot) / vTotal : null;
  }
  const B = Object.values(res.teams).find(t => t.tier === "brewery");
  return {
    ok, demandVariance: vd,
    teamRatio, tierRatio, tierOrders,
    // brewery: what it was asked for vs. what it chose to brew
    breweryOrdersRatio: ok ? variance(B.incoming) / vTotal : null,
    breweryProductionRatio: tierRatio.brewery,
    demandTotal: res.demand.map(d => d * res.retailers),
  };
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
        decision_source: t.sources ? t.sources[i] : "",
        surge_units: t.surge ? t.surge[i] : "", normal_capacity: t.tier === "brewery" ? res.capacity[i].normal : "",
        holding_cost: t.holding[i], backorder_cost: t.backorder[i], surge_cost: t.surgeCost[i],
        week_cost: t.holding[i] + t.backorder[i] + t.surgeCost[i],
      });
    }
  }
  return rows;
}
