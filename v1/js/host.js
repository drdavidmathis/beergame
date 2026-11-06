// Instructor-side game logic. The instructor's dashboard is the single
// "game master": students only write their own orders, captain claims
// and chat messages; the dashboard runs every week of the simulation,
// so there is exactly one writer of game state and nothing can collide.

import * as E from "./engine.js";
import { TIERS } from "./config.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const P = code => `sessions/${code}`;

export async function createSession(store, form) {
  const config = E.normalizeConfig(form);
  let code;
  for (let i = 0; i < 20; i++) {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    if (!(await store.getDoc(P(code)))) break;
  }
  const now = Date.now();
  await store.setDoc(P(code), {
    code, ownerUid: store.uid(), mode: config.mode, status: "lobby", paused: false,
    createdAt: now, networks: [],
  });
  await store.setDoc(`${P(code)}/private/_settings`, { config, createdAt: now });
  await audit(store, code, "Session created", { mode: config.mode });
  return code;
}

export async function audit(store, code, action, detail = {}) {
  await store.setDoc(`${P(code)}/audit/${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, {
    at: Date.now(), action, detail: JSON.stringify(detail),
  });
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Form role-teams, seat everyone, and start week 1.
export async function startSession(store, code) {
  const settings = await store.getDoc(`${P(code)}/private/_settings`);
  const config = settings.config;
  const players = (await store.getCol(`${P(code)}/players`)).filter(p => !p.replacedBy);
  if (!players.length) throw new Error("Nobody has joined yet.");
  const games = config.mode === "classic"
    ? Math.max(1, Math.round(players.length / (4 * config.classicTeamSize))) : 1;
  const skels = E.buildSkeletons(config, games);
  const now = Date.now();
  const nets = skels.map((s, i) => E.newNetwork(s, config, {
    now,
    sharing: config.sharing === "on" || (config.sharing === "split" && i % 2 === 1),
  }));

  // Seat upstream teams first so the brewery and distributors are never
  // left to the computer when the class is small.
  const all = [];
  for (const tier of [...TIERS].reverse()) {
    for (const n of nets) for (const id of E.teamOrder(n)) if (n.teams[id].tier === tier) all.push({ net: n, id });
  }
  const members = Object.fromEntries(all.map(x => [x.id, {}]));
  const ops = [];
  shuffle([...players]).forEach((p, i) => {
    const slot = all[i % all.length];
    members[slot.id][p.id] = p.name;
    ops.push({ op: "update", path: `${P(code)}/players/${p.id}`, data: { teamId: slot.id, netId: slot.net.id } });
  });
  for (const { net, id } of all) {
    const t = net.teams[id];
    const empty = !Object.keys(members[id]).length;
    ops.push({
      op: "set", path: `${P(code)}/teams/${id}`, data: {
        id, netId: net.id, netName: net.name, label: t.label, tier: t.tier, game: t.game,
        members: members[id], captain: null, captainName: null, bot: empty, sharing: net.sharing,
      },
    });
    ops.push({ op: "set", path: `${P(code)}/views/${id}`, data: E.teamView(net, id) });
  }
  for (const n of nets) {
    ops.push({ op: "set", path: `${P(code)}/private/${n.id}`, data: n });
    ops.push({ op: "set", path: `${P(code)}/snapshots/${n.id}_1`, data: n });
  }
  ops.push({
    op: "update", path: P(code), data: {
      status: "running", paused: false, startedAt: now,
      networks: nets.map(n => ({ id: n.id, name: n.name, sharing: n.sharing })),
    },
  });
  await store.batch(ops);
  await audit(store, code, "Game started", { players: players.length, networks: nets.length });
}

// ---------------------------------------------------------------------
// The live game master
// ---------------------------------------------------------------------
export class Host {
  constructor(store, code, onChange) {
    this.store = store;
    this.code = code;
    this.onChange = onChange;
    this.session = null;
    this.nets = {};
    this.teams = {};
    this.players = [];
    this.orders = {};
    this.unsubs = [];
    this.busy = false;
    this.dirty = false;
    this.error = null;
  }

  start() {
    const p = P(this.code);
    this.unsubs.push(
      this.store.watchDoc(p, s => { this.session = s; this.changed(); }),
      this.store.watchCol(`${p}/private`, docs => {
        this.nets = {};
        for (const d of docs) if (d.id === "_settings") this.settings = d; else this.nets[d.id] = d;
        this.changed();
      }),
      this.store.watchCol(`${p}/teams`, docs => { this.teams = Object.fromEntries(docs.map(d => [d.id, d])); this.changed(); }),
      this.store.watchCol(`${p}/players`, docs => { this.players = docs; this.changed(); }),
      this.store.watchCol(`${p}/orders`, docs => { this.orders = Object.fromEntries(docs.map(d => [d.id, d])); this.changed(); }),
    );
  }
  stop() { this.unsubs.forEach(u => u()); }

  changed() {
    this.onChange?.();
    this.tick();
  }

  orderFor(teamId, week) { return this.orders[`${teamId}_${week}`]; }

  // Run automatic work: seat late arrivals, advance any network whose
  // orders are all in. Serialized so it never runs twice at once.
  async tick() {
    if (this.busy) { this.dirty = true; return; }
    if (!this.session || this.session.status !== "running") return;
    if (this.session.ownerUid !== this.store.uid()) return;
    this.busy = true;
    try {
      await this.seatArrivals();
      if (!this.session.paused) {
        for (const net of Object.values(this.nets)) {
          if (net.status === "playing" && this.ready(net)) await this.advanceNet(net.id);
        }
      }
      this.error = null;
    } catch (e) {
      console.error(e);
      this.error = e.message;
      this.onChange?.();
    } finally {
      this.busy = false;
      if (this.dirty) { this.dirty = false; setTimeout(() => this.tick(), 0); }
    }
  }

  ready(net) {
    return Object.keys(net.teams).every(id => this.teams[id]?.bot || this.orderFor(id, net.week));
  }

  waitingTeams(net) {
    return Object.keys(net.teams).filter(id => !this.teams[id]?.bot && !this.orderFor(id, net.week));
  }

  // Advance one network a week. force = fill in missing orders by
  // repeating each team's last order (logged).
  async advanceNet(netId, { force = false } = {}) {
    const net = this.nets[netId];
    if (!net || net.status !== "playing") return;
    const w = net.week;
    const orders = {};
    const forced = [];
    for (const id of Object.keys(net.teams)) {
      const t = this.teams[id];
      const o = this.orderFor(id, w);
      if (o) orders[id] = o.qty;
      else if (t?.bot) orders[id] = E.botOrder(net, id);
      else if (force) {
        orders[id] = Math.min(net.teams[id].lastOrder, E.limitsFor(net, id).max);
        forced.push(id);
      } else return;
    }
    const next = E.advance(net, orders, Date.now());
    const committed = await this.store.transact(`${P(this.code)}/private/${netId}`, cur =>
      cur && cur.week === w && cur.status === "playing" ? next : undefined);
    if (!committed) return;
    this.nets[netId] = next; // don't wait for the echo
    const ops = [];
    for (const id of forced) {
      ops.push({
        op: "set", path: `${P(this.code)}/orders/${id}_${w}`, data: {
          teamId: id, netId, week: w, qty: orders[id], by: "instructor", byName: "Instructor",
          source: "instructor", at: Date.now(),
        },
      });
    }
    for (const id of Object.keys(next.teams)) {
      ops.push({ op: "set", path: `${P(this.code)}/views/${id}`, data: E.teamView(next, id) });
    }
    if (next.status === "playing") {
      ops.push({ op: "set", path: `${P(this.code)}/snapshots/${netId}_${next.week}`, data: next });
    } else {
      ops.push({ op: "set", path: `${P(this.code)}/results/${netId}`, data: E.results(next) });
    }
    await this.store.batch(ops);
    if (forced.length) {
      await audit(this.store, this.code, "Advanced without all orders",
        { network: next.name, week: w, repeatedLastOrder: forced.map(id => `${net.teams[id].label}: ${orders[id]}`) });
    }
    const allDone = Object.values(this.nets).every(n => n.status === "done");
    if (allDone) await this.store.updateDoc(P(this.code), { status: "ended", endedAt: Date.now() });
  }

  async seatArrivals() {
    const active = this.players.filter(p => !p.replacedBy);
    const unseated = active.filter(p => !p.teamId);
    if (!unseated.length || !Object.keys(this.teams).length) return;
    const norm = s => s.trim().toLowerCase();
    for (const p of unseated) {
      const same = active.filter(q => q.id !== p.id && q.teamId && norm(q.name) === norm(p.name));
      let team, replaced = null;
      if (same.length === 1) {
        replaced = same[0];
        team = this.teams[replaced.teamId];
      } else {
        // smallest team; computer-played teams first, then upstream first
        const list = Object.values(this.teams).filter(t => this.nets[t.netId]?.status === "playing");
        if (!list.length) return;
        list.sort((a, b) => Object.keys(a.members).length - Object.keys(b.members).length
          || (b.bot ? 1 : 0) - (a.bot ? 1 : 0)
          || TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier));
        team = list[0];
      }
      const members = { ...team.members, [p.id]: p.name };
      const patch = { members };
      if (replaced) {
        delete members[replaced.id];
        if (team.captain === replaced.id) { patch.captain = null; patch.captainName = null; }
      }
      if (team.bot && !replaced && !Object.keys(team.members).length) patch.bot = false;
      const ops = [
        { op: "update", path: `${P(this.code)}/teams/${team.id}`, data: patch },
        { op: "update", path: `${P(this.code)}/players/${p.id}`, data: { teamId: team.id, netId: team.netId } },
      ];
      if (replaced) ops.push({ op: "update", path: `${P(this.code)}/players/${replaced.id}`, data: { replacedBy: p.id } });
      await this.store.batch(ops);
      this.teams[team.id] = { ...team, ...patch };
      p.teamId = team.id;
      await audit(this.store, this.code, replaced ? "Student rejoined" : "Late arrival seated", { name: p.name, team: team.label });
    }
  }

  // ---- instructor controls ----
  async setPaused(paused) {
    await this.store.updateDoc(P(this.code), { paused });
    await audit(this.store, this.code, paused ? "Paused" : "Resumed");
  }

  async forceAdvance(netId) {
    await this.advanceNet(netId, { force: true });
  }

  // Change (or set) a team's order for the current week. Logged, and
  // the team sees a note in its chat.
  async overrideOrder(teamId, qty, note = "") {
    const team = this.teams[teamId];
    const net = this.nets[team.netId];
    const v = E.validateOrder(E.limitsFor(net, teamId), qty, team.tier === "brewery");
    if (!v.ok) throw new Error(v.error);
    const w = net.week;
    const prev = this.orderFor(teamId, w);
    await this.store.setDoc(`${P(this.code)}/orders/${teamId}_${w}`, {
      teamId, netId: net.id, week: w, qty: v.value, by: "instructor", byName: "Instructor",
      source: "instructor", at: Date.now(), previousQty: prev ? prev.qty : null,
    });
    await this.systemMessage(teamId, prev
      ? `Instructor changed this week's ${team.tier === "brewery" ? "production" : "order"} from ${prev.qty} to ${v.value}.`
      : `Instructor entered this week's ${team.tier === "brewery" ? "production" : "order"}: ${v.value}.`);
    await audit(this.store, this.code, "Order corrected",
      { team: team.label, week: w, from: prev ? prev.qty : null, to: v.value, note });
  }

  async systemMessage(teamId, text) {
    await this.store.setDoc(`${P(this.code)}/chats/${teamId}/msgs/${Date.now()}-${this.store.newId()}`, {
      uid: "system", name: "", text, at: Date.now(), kind: "system",
    });
  }

  async setBot(teamId, bot) {
    await this.store.updateDoc(`${P(this.code)}/teams/${teamId}`, { bot });
    await audit(this.store, this.code, bot ? "Computer took over team" : "Team returned to students",
      { team: this.teams[teamId].label });
  }

  // Undo the most recent completed week of a network. The game pauses so
  // you can correct an order before continuing.
  async undoWeek(netId) {
    const net = this.nets[netId];
    const lastDone = net.status === "playing" ? net.week - 1 : net.week;
    if (lastDone < 1) throw new Error("Nothing to undo yet.");
    await this.restoreTo(netId, lastDone, `Undid week ${lastDone}`);
  }

  async restartNet(netId) {
    await this.restoreTo(netId, 1, "Restarted from week 1", true);
  }

  async restoreTo(netId, week, label, clearAll = false) {
    const snap = await this.store.getDoc(`${P(this.code)}/snapshots/${netId}_${week}`);
    if (!snap) throw new Error(`No saved state for week ${week}.`);
    // Keep settings changes made after this point; they re-apply on schedule.
    const cur = this.nets[netId];
    snap.configChanges = [
      ...(snap.configChanges || []).filter(c => c.week <= snap.week),
      ...(cur?.configChanges || []).filter(c => c.week > snap.week),
    ];
    await this.store.updateDoc(P(this.code), { paused: true, status: "running" });
    const ops = [{ op: "set", path: `${P(this.code)}/private/${netId}`, data: snap }];
    for (const id of Object.keys(snap.teams)) {
      ops.push({ op: "set", path: `${P(this.code)}/views/${id}`, data: E.teamView(snap, id) });
    }
    for (const [key, o] of Object.entries(this.orders)) {
      if (o.netId === netId && (clearAll || o.week > week)) ops.push({ op: "delete", path: `${P(this.code)}/orders/${key}` });
    }
    ops.push({ op: "delete", path: `${P(this.code)}/results/${netId}` });
    await this.store.batch(ops);
    this.nets[netId] = snap;
    await audit(this.store, this.code, label, { network: snap.name });
  }

  // Settings changes take effect at the start of next week in every
  // network still playing. Lead times cannot change mid-game.
  async changeSettings(changes) {
    const keys = Object.keys(changes);
    if (!keys.length) return;
    for (const net of Object.values(this.nets)) {
      if (net.status !== "playing") continue;
      await this.store.transact(`${P(this.code)}/private/${net.id}`, cur => {
        if (!cur) return undefined;
        const wk = cur.week + 1;
        cur.configChanges = cur.configChanges || [];
        let ch = cur.configChanges.find(c => c.week === wk);
        if (!ch) { ch = { week: wk, changes: {}, previous: {}, at: Date.now() }; cur.configChanges.push(ch); }
        for (const k of keys) if (!(k in ch.previous)) ch.previous[k] = cur.config[k];
        Object.assign(ch.changes, changes);
        ch.at = Date.now();
        return cur;
      });
    }
    await audit(this.store, this.code, "Settings changed (from next week)", changes);
  }

  async endGame() {
    const ops = [];
    for (const net of Object.values(this.nets)) {
      if (net.status !== "playing") continue;
      const done = E.endNetwork(net);
      ops.push({ op: "set", path: `${P(this.code)}/private/${net.id}`, data: done });
      ops.push({ op: "set", path: `${P(this.code)}/results/${net.id}`, data: E.results(done) });
      for (const id of Object.keys(done.teams)) ops.push({ op: "set", path: `${P(this.code)}/views/${id}`, data: E.teamView(done, id) });
    }
    ops.push({ op: "update", path: P(this.code), data: { status: "ended", paused: false, endedAt: Date.now() } });
    await this.store.batch(ops);
    await audit(this.store, this.code, "Game ended by instructor");
  }
}
