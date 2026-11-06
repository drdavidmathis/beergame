// Integrity test suite for the simulation engine.
// Run:  node tools/test.mjs
import { DEFAULTS, TIERS } from "../js/config.js";
import * as E from "../js/engine.js";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};
const eq = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const yes = (v, msg) => { if (!v) throw new Error(msg); };

function cfg(over = {}) {
  const c = E.normalizeConfig({ ...DEFAULTS, ...over });
  const cap = E.suggestedCapacity(c);
  return { ...c, normalCapacity: over.normalCapacity ?? cap.normal, surgeCapacity: over.surgeCapacity ?? cap.surge };
}
// Play a whole game with computer players; keep a snapshot of every week start.
function playAll(c, games = 1, decide = null) {
  const nets = E.buildSkeletons(c, games).map((s, i) => E.newNetwork(s, c, { index: i }));
  return nets.map(net => {
    const snaps = { 1: net };
    let n = net;
    while (n.status === "playing") {
      const orders = {}, sources = {};
      for (const id of Object.keys(n.teams)) {
        const d = decide?.(n, id);
        if (d != null) { orders[id] = d; sources[id] = "team"; } else { orders[id] = E.botOrder(n, id); sources[id] = "computer"; }
      }
      n = E.advance(n, orders, 0, sources);
      if (n.status === "playing") snaps[n.week] = n;
    }
    return { final: n, snaps };
  });
}
// Wild but legal "student" ordering, deterministic
const wild = (seed = 3) => {
  const r = E.mulberry32(seed);
  return (n, id) => {
    const lim = E.limitsFor(n, id).max;
    const t = n.teams[id];
    const want = Math.round(t.history.at(-1).incoming * (0.5 + 2 * r()) + (r() < 0.1 ? t.baseline * 4 : 0));
    return Math.min(lim, want);
  };
};

console.log("\nBeer Game integrity tests\n");

for (const mode of ["network", "classic"]) {
  for (const style of ["steady", "mixed"]) {
    t(`${mode}/${style}: 36-week computer game passes every weekly check`, () => {
      const [{ final }] = playAll(cfg({ mode, botStyle: style }));
      eq(final.status, "done"); eq(E.completedWeeks(final), 36);
    });
  }
  t(`${mode}: 36 weeks of erratic human-like orders pass every weekly check`, () => {
    const [{ final }] = playAll(cfg({ mode }), 1, wild());
    eq(E.completedWeeks(final), 36);
  });
}

t("inventory never negative; unmet demand becomes backorders", () => {
  const [{ final }] = playAll(cfg(), 1, wild(9));
  for (const tm of Object.values(final.teams)) for (const e of tm.history) yes(e.inv >= 0 && e.backlog >= 0, `${tm.label} wk ${e.week}`);
  yes(Object.values(final.teams).some(tm => tm.history.some(e => e.backlog > 0)), "expected some backorders in an erratic game");
});

t("shipments never exceed what was available", () => {
  const [{ final }] = playAll(cfg(), 1, wild(5));
  for (const tm of Object.values(final.teams)) tm.history.forEach((e, i) => {
    const before = (i ? tm.history[i - 1].inv : null);
    if (before != null) yes(e.shipped <= before + e.received, `${tm.label} wk ${e.week}`);
  });
});

t("production above maximum capacity is refused", () => {
  const c = cfg();
  const n = E.newNetwork(E.buildSkeletons(c)[0], c);
  const orders = Object.fromEntries(Object.keys(n.teams).map(id => [id, n.teams[id].baseline]));
  orders.B = c.surgeCapacity + 1;
  let threw = false; try { E.advance(n, orders); } catch { threw = true; }
  yes(threw, "should refuse");
});

t("orders and shipments arrive after exactly the configured delays", () => {
  for (const [od, sd, pd] of [[2, 2, 3], [1, 3, 2], [3, 1, 4]]) {
    const c = cfg({ orderDelay: od, shipDelay: sd, productionDelay: pd });
    let n = E.newNetwork(E.buildSkeletons(c)[0], c);
    const base = id => n.teams[id].baseline;
    const plan = { 3: { R1: 37 }, 4: { B: 77 } };
    while (n.week < 15) {
      const w = n.week;
      const orders = Object.fromEntries(Object.keys(n.teams).map(id => [id, plan[w]?.[id] ?? base(id)]));
      n = E.advance(n, orders);
    }
    const W1 = n.teams.W1.history, B = n.teams.B.history;
    eq(W1[3 + od - 1].incomingBy.R1, 37, `R1's week-3 order should reach W1 in week ${3 + od}:`);
    eq(B[4 + pd - 1].received, 77, `week-4 production should finish in week ${4 + pd}:`);
    // a shipment from W1 to R1 arrives shipDelay weeks later
    const sent = W1[6].shippedBy.R1;
    eq(n.teams.R1.history[6 + sd].received, sent, "W1->R1 shipment:");
  }
});

t("proportional allocation splits scarce stock fairly, in whole cases", () => {
  eq(E.allocate(10, { a: 6, b: 12 }), { a: 3, b: 7 });
  eq(E.allocate(5, { a: 4, b: 4 }, 0).a + E.allocate(5, { a: 4, b: 4 }, 0).b, 5);
  eq(E.allocate(30, { a: 6, b: 12 }), { a: 6, b: 12 }, "enough stock:");
  eq(E.allocate(0, { a: 6, b: 12 }), { a: 0, b: 0 });
  const x = E.allocate(7, { a: 3, b: 3, c: 3 }, 1);
  eq(x.a + x.b + x.c, 7); yes(Object.values(x).every(v => v >= 2 && v <= 3), "spread");
});

t("cases are never created or lost (whole-network conservation)", () => {
  const [{ final }] = playAll(cfg(), 1, wild(11));
  let cases = final.cases.delivered;
  for (const tm of Object.values(final.teams)) cases += tm.inv + tm.shipPipe.reduce((a, b) => a + b, 0);
  eq(cases, final.cases.start + final.cases.produced);
});

t("all teams move through the same weeks together", () => {
  const [{ final }] = playAll(cfg(), 1, wild(2));
  const lens = Object.values(final.teams).map(tm => tm.history.length);
  yes(lens.every(l => l === lens[0]), "history lengths differ");
});

t("replaying with no corrections reproduces the game exactly", () => {
  const [{ final, snaps }] = playAll(cfg({ botStyle: "mixed" }), 1, (n, id) => id.startsWith("W") ? wild(4)(n, id) : null);
  const again = E.replay(snaps[10], final, {});
  eq(again.teams, final.teams);
});

t("correcting a past order recalculates later weeks consistently", () => {
  const [{ final, snaps }] = playAll(cfg(), 1, wild(6));
  const fixed = E.replay(snaps[12], final, { D1: { 12: 0 } });
  eq(fixed.teams.D1.history[11].order, 0);
  eq(fixed.teams.D1.history[11].source, "instructor");
  yes(JSON.stringify(fixed.teams.B.history[13]) !== JSON.stringify(final.teams.B.history[13]), "brewery should see a different week 14");
  eq(fixed.teams.R1.history.slice(0, 11), final.teams.R1.history.slice(0, 11), "earlier weeks unchanged:");
  E.checkIntegrity(fixed, "end");
});

t("extending a finished game continues from where it stopped", () => {
  const [{ final }] = playAll(cfg({ weeks: 20 }));
  let n = E.extendNetwork(final, 5);
  eq(n.status, "playing"); eq(n.week, 21);
  while (n.status === "playing") n = E.advance(n, Object.fromEntries(Object.keys(n.teams).map(id => [id, E.botOrder(n, id)])));
  eq(E.completedWeeks(n), 25);
});

t("order validation: rejects bad input, asks to confirm big orders, never trims", () => {
  const L = { max: 40, warnAt: 24 };
  for (const bad of ["", "abc", "-3", "3.5", "1e9", "Infinity", "72000000000", "41"]) yes(!E.validateOrder(L, bad).ok, bad);
  eq(E.validateOrder(L, "12"), { ok: true, value: 12, confirm: false });
  eq(E.validateOrder(L, "30").confirm, true);
  eq(E.validateOrder(L, "40").value, 40);
});

t("bullwhip ratios are withheld when demand barely varies", () => {
  const [{ final }] = playAll(cfg({ demandType: "custom", demandCustom: "4" }));
  const bw = E.bullwhip(E.results(final));
  eq(bw.ok, false); eq(bw.tierRatio.retailer, null);
});

t("the same seed gives the same mixed computer players", () => {
  const c = cfg({ botStyle: "mixed", botSeed: 42 });
  const a = E.newNetwork(E.buildSkeletons(c)[0], c), b = E.newNetwork(E.buildSkeletons(c)[0], c);
  eq(Object.values(a.teams).map(x => x.botStyle), Object.values(b.teams).map(x => x.botStyle));
  const d = E.newNetwork(E.buildSkeletons({ ...c, botSeed: 7 })[0], { ...c, botSeed: 7 });
  yes(new Set(Object.values(a.teams).map(x => x.botStyle)).size > 1, "mixed should vary");
});

t("36-week exported records reconcile row by row (inventory, backorders, costs)", () => {
  for (const mode of ["network", "classic"]) {
    const c = cfg({ mode });
    const [{ final }] = playAll(c, 1, wild(8));
    const res = E.results(final);
    for (const tm of Object.values(res.teams)) {
      let inv = c.startingInventoryWeeks * tm.baseline, back = 0;
      for (let i = 0; i < res.weeks; i++) {
        inv = inv + tm.received[i] - tm.shipped[i];
        back = back + tm.incoming[i] - tm.shipped[i];
        eq(tm.inv[i], inv, `${mode} ${tm.label} wk ${i + 1} inventory:`);
        eq(tm.backlog[i], back, `${mode} ${tm.label} wk ${i + 1} backorders:`);
        eq(tm.holding[i], c.holdingCost * inv, "holding cost:");
        eq(tm.backorder[i], c.backorderCost * back, "backorder cost:");
        if (tm.tier === "brewery") eq(tm.surgeCost[i], Math.max(0, tm.orders[i] - c.normalCapacity) * c.surgePremium, "surge cost:");
      }
      const rows = E.csvRows(res).filter(r => r.team_id === tm.id);
      eq(rows.length, res.weeks);
    }
    eq(res.weeks, 36);
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
