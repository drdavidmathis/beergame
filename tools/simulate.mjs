// Calibration: plays the game with simulated "typical human" teams
// (Sterman 1989 ordering behavior) to check that limits and brewery
// capacity leave room for the bullwhip without locking up the network.
// Run:  node tools/simulate.mjs [network|classic] [typical|aggressive]
import { DEFAULTS, TIERS } from "../js/config.js";
import * as E from "../js/engine.js";

const mode = process.argv[2] || "network";
const style = process.argv[3] || "typical";
const P = style === "aggressive"
  ? { theta: 0.5, alpha: 0.45, beta: 0.15 }
  : { theta: 0.36, alpha: 0.26, beta: 0.34 };

const c0 = E.normalizeConfig({ ...DEFAULTS, mode, ...(process.env.SURGE ? { surgeCapacityFactor: +process.env.SURGE } : {}) });
const cap = E.suggestedCapacity(c0);
const c = { ...c0, normalCapacity: cap.normal, surgeCapacity: cap.surge };
let net = E.newNetwork(E.buildSkeletons(c, 1)[0], c);
const exp = {};
let rnd = 7; const noise = () => ((rnd = (rnd * 48271) % 2147483647) / 2147483647 - 0.5);
const clipped = {};
while (net.status === "playing") {
  const orders = {};
  for (const t of Object.values(net.teams)) {
    const last = t.history[t.history.length - 1];
    exp[t.id] = exp[t.id] ?? t.baseline;
    exp[t.id] += P.theta * (last.incoming - exp[t.id]);
    const Sp = 17 / 4 * t.baseline;
    const want = Math.max(0, Math.round(exp[t.id] + P.alpha * (Sp - (t.inv - Object.values(t.backlog).reduce((a,b)=>a+b,0)) - P.beta * t.onOrder) + noise() * 2 * (t.baseline / 4)));
    const lim = E.limitsFor(net, t.id).max;
    if (want > lim) clipped[t.tier] = (clipped[t.tier] || 0) + 1;
    orders[t.id] = Math.min(want, lim);
  }
  net = E.advance(net, orders);
}
const res = E.results(net);
const bw = E.bullwhip(res);
console.log(`\n${mode} / ${style}  brewery normal ${c.normalCapacity}, surge max ${c.surgeCapacity}`);
for (const tier of TIERS) {
  const ts = Object.values(res.teams).filter(t => t.tier === tier);
  const peak = Math.max(...ts.flatMap(t => t.orders));
  const lim = tier === "brewery" ? c.surgeCapacity : E.limitsFor(net, ts[0].id).max;
  const peakBack = Math.max(...ts.flatMap(t => t.backlog));
  const cost = ts.reduce((s, t) => s + t.cost.total, 0);
  console.log(`${tier.padEnd(12)} peak order/team ${String(peak).padStart(4)} (limit ${lim}, hit limit ${clipped[tier] || 0}x)  peak backlog ${String(peakBack).padStart(4)}  bullwhip ${bw.tierRatio[tier]?.toFixed(1)}  cost ${cost.toFixed(0)}`);
}
const B = res.teams.B || res.teams["G1-B"];
const surgeWeeks = B.surge.filter(s => s > 0).length;
const lastBack = B.backlog.map((b, i) => [b, i + 1]).filter(([b]) => b > 0).pop();
console.log(`brewery: surge used ${surgeWeeks} weeks, backlog last positive in week ${lastBack ? lastBack[1] : "-"}`);
console.log("brewery production:", B.orders.join(","));
console.log("brewery backlog:   ", B.backlog.join(","));
