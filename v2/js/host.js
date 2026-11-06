// Instructor-side game logic. The instructor's dashboard is the single
// "game master": students only write their own orders, captain claims,
// and chat messages; the dashboard runs every
// week of the simulation, so there is exactly one writer of game state.

import * as E from "./engine.js";
import { TIERS } from "./config.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const P = code => `sessions/${code}`;
const SOURCE_OF = { captain: "team", instructor: "instructor", previous: "previous", computer: "computer" };

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
    createdAt: now, networks: [], assigned: false,
  });
  await store.setDoc(`${P(code)}/private/_settings`, { config, createdAt: now });
  await audit(store, code, "Session created", { mode: config.mode, weeks: config.weeks });
  return code;
}

export async function audit(store, code, action, detail = {}) {
  await store.setDoc(`${P(code)}/audit/${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, {
    at: Date.now(), action, detail: JSON.stringify(detail),
  });
}

const shuffle = a => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function teamDoc(skelTeam, net, members) {
  return {
    id: skelTeam.id, netId: net.id, netName: net.name, label: skelTeam.label, tier: skelTeam.tier, game: skelTeam.game,
    members, captain: null, captainName: null, bot: !Object.keys(members).length, sharing: false, nudgeAt: null,
  };
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
    this.settings = null;
    this.nets = {};
    this.teams = {};
    this.players = [];
    this.orders = {};
    this.unsubs = [];
    this.busy = false;
    this.dirty = false;
    this.error = null;
  }

  get p() { return P(this.code); }

  start() {
    const p = this.p;
    this.unsubs.push(
      this.store.watchDoc(p, s => { this.session = s; this.changed(); }),
      this.store.watchCol(`${p}/private`, docs => {
        this.nets = {};
        for (const d of docs) if (d.id === "_settings") this.settings = d; else this.nets[d.id] = d;
        this.changed();
      }),
      this.store.watchCol(`${p}/teams`, docs => { this.teams = Object.fromEntries(docs.map(d => [d.id, d])); this.changed(); }),
      this.store.watchCol(`${p}/players`, docs => { this.players = docs.filter(d => !d.removed); this.changed(); }),
      this.store.watchCol(`${p}/orders`, docs => { this.orders = Object.fromEntries(docs.map(d => [d.id, d])); this.changed(); }),
    );
  }
  stop() { this.unsubs.forEach(u => u()); }

  changed() { this.onChange?.(); this.tick(); }
  isOwner() { return this.session && this.session.ownerUid === this.store.uid(); }
  get config() { return this.settings?.config; }

  orderFor(teamId, week) { return this.orders[`${teamId}_${week}`]; }

  async tick() {
    if (this.busy) { this.dirty = true; return; }
    if (!this.session || this.session.status !== "running" || !this.isOwner()) return;
    this.busy = true;
    try {
      if (this.config?.autoPlaceLate !== false) await this.placeLateArrivals();
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

  // ---- lobby: team assignment ----

  // Randomly assign every student. Re-running reshuffles everyone.
  async autoAssign() {
    const c = this.config;
    const players = this.players;
    if (!players.length) throw new Error("Nobody has joined yet.");
    const games = c.mode === "classic" ? Math.max(1, Math.round(players.length / (4 * c.classicTeamSize))) : 1;
    const skels = E.buildSkeletons(c, games);
    const slots = shuffle(skels.flatMap(s => Object.values(s.teams).map(t => ({ skel: s, t }))));
    const members = Object.fromEntries(slots.map(x => [x.t.id, {}]));
    const ops = [];
    shuffle([...players]).forEach((pl, i) => {
      const slot = slots[i % slots.length];
      members[slot.t.id][pl.id] = pl.name;
      ops.push({ op: "update", path: `${this.p}/players/${pl.id}`, data: { teamId: slot.t.id, netId: slot.skel.id } });
    });
    for (const old of Object.keys(this.teams)) if (!members[old]) ops.push({ op: "delete", path: `${this.p}/teams/${old}` });
    for (const { skel, t } of slots) ops.push({ op: "set", path: `${this.p}/teams/${t.id}`, data: teamDoc(t, skel, members[t.id]) });
    ops.push({ op: "update", path: this.p, data: { assigned: true, games, networks: skels.map(s => ({ id: s.id, name: s.name })) } });
    await this.store.batch(ops);
    await audit(this.store, this.code, "Teams auto-assigned", { students: players.length, games });
  }

  // Move a student to another team (or to "unassigned" with teamId null).
  async moveStudent(pid, teamId) {
    const pl = this.players.find(x => x.id === pid);
    if (!pl) return;
    const ops = [];
    if (pl.teamId && this.teams[pl.teamId]) {
      const old = this.teams[pl.teamId];
      const m = { ...old.members }; delete m[pid];
      const patch = { members: m };
      if (old.captain === pid) Object.assign(patch, { captain: null, captainName: null });
      if (this.session.status === "lobby") patch.bot = !Object.keys(m).length;
      ops.push({ op: "update", path: `${this.p}/teams/${old.id}`, data: patch });
    }
    let netId = null;
    if (teamId) {
      const t = this.teams[teamId];
      const patch = { members: { ...t.members, [pid]: pl.name } };
      if (t.bot && !Object.keys(t.members).length) patch.bot = false;
      ops.push({ op: "update", path: `${this.p}/teams/${teamId}`, data: patch });
      netId = t.netId;
    }
    ops.push({ op: "update", path: `${this.p}/players/${pid}`, data: { teamId: teamId || null, netId } });
    await this.store.batch(ops);
    if (this.session.status !== "lobby") {
      await audit(this.store, this.code, "Student moved", { name: pl.name, from: pl.teamId ? this.teams[pl.teamId]?.label : "unassigned", to: teamId ? this.teams[teamId].label : "unassigned" });
      if (teamId) await this.systemMessage(teamId, `${pl.name} joined the team.`);
    }
  }

  // Remove a student entirely (e.g. a duplicate entry).
  async removeStudent(pid) {
    const pl = this.players.find(x => x.id === pid);
    if (!pl) return;
    if (pl.teamId) await this.moveStudent(pid, null);
    await this.store.updateDoc(`${this.p}/players/${pid}`, { removed: true, teamId: null, netId: null });
    await audit(this.store, this.code, "Student removed", { name: pl.name });
  }

  async setCaptain(teamId, pid) {
    const t = this.teams[teamId];
    const name = pid ? t.members[pid] : null;
    await this.store.updateDoc(`${this.p}/teams/${teamId}`, { captain: pid || null, captainName: name });
    if (this.session.status !== "lobby") await this.systemMessage(teamId, pid ? `The instructor made ${name} captain.` : "The instructor cleared the captain. Anyone can take the job.");
  }

  async startGame() {
    if (!this.session.assigned) { await this.autoAssign(); await this.reload(); }
    // seat anyone who joined after assignment
    for (const pl of this.players.filter(x => !x.teamId)) { await this.placeStudent(pl, true); }
    await this.reload();
    const c = this.config;
    const games = this.session.games || 1;
    const skels = E.buildSkeletons(c, games);
    const now = Date.now();
    const nets = skels.map((s, i) => E.newNetwork(s, c, {
      now, index: i,
      sharing: c.sharing === "on" || (c.sharing === "split" && i % 2 === 1),
    }));
    const ops = [];
    for (const n of nets) {
      for (const id of Object.keys(n.teams)) {
        const t = this.teams[id];
        const members = t?.members || {};
        ops.push({
          op: "set", path: `${this.p}/teams/${id}`, data: {
            ...teamDoc(n.teams[id], n, members),
            captain: t?.captain || null, captainName: t?.captainName || null, sharing: n.sharing,
          },
        });
        ops.push({ op: "set", path: `${this.p}/views/${id}`, data: E.teamView(n, id) });
      }
      ops.push({ op: "set", path: `${this.p}/private/${n.id}`, data: n });
      ops.push({ op: "set", path: `${this.p}/snapshots/${n.id}_1`, data: n });
    }
    ops.push({
      op: "update", path: this.p, data: {
        status: "running", paused: false, startedAt: now,
        networks: nets.map(n => ({ id: n.id, name: n.name, sharing: n.sharing })),
      },
    });
    await this.store.batch(ops);
    await audit(this.store, this.code, "Game started", { students: this.players.length, networks: nets.length, weeks: c.weeks });
  }

  async reload() {
    this.teams = Object.fromEntries((await this.store.getCol(`${this.p}/teams`)).map(d => [d.id, d]));
    this.players = (await this.store.getCol(`${this.p}/players`)).filter(d => !d.removed);
    this.session = await this.store.getDoc(this.p);
  }

  // Put one student on the smallest team, preferring computer-played
  // teams, choosing randomly among equals.
  async placeStudent(pl, quiet = false) {
    const list = Object.values(this.teams).filter(t => !this.nets[t.netId] || this.nets[t.netId].status === "playing");
    if (!list.length) return;
    const size = t => Object.keys(t.members || {}).length;
    const min = Math.min(...list.map(size));
    let pool = list.filter(t => size(t) === min);
    if (pool.some(t => t.bot)) pool = pool.filter(t => t.bot);
    const team = pool[Math.floor(Math.random() * pool.length)];
    await this.moveStudent(pl.id, team.id);
    this.teams[team.id] = { ...team, members: { ...team.members, [pl.id]: pl.name }, bot: false };
    pl.teamId = team.id;
    if (!quiet) await audit(this.store, this.code, "Late arrival seated", { name: pl.name, team: team.label });
  }

  async placeLateArrivals() {
    for (const pl of this.players.filter(x => !x.teamId)) await this.placeStudent(pl);
  }

  // ---- running the weeks ----

  async advanceNet(netId, { force = false } = {}) {
    const net = this.nets[netId];
    if (!net || net.status !== "playing") return;
    const w = net.week;
    const orders = {}, sources = {}, forced = [];
    for (const id of Object.keys(net.teams)) {
      const o = this.orderFor(id, w);
      if (o) { orders[id] = o.qty; sources[id] = SOURCE_OF[o.source] || "team"; }
      else if (this.teams[id]?.bot) { orders[id] = E.botOrder(net, id); sources[id] = "computer"; }
      else if (force) {
        orders[id] = Math.min(net.teams[id].lastOrder, E.limitsFor(net, id).max);
        sources[id] = "previous";
        forced.push(id);
      } else return;
    }
    const next = E.advance(net, orders, Date.now(), sources);
    const committed = await this.store.transact(`${this.p}/private/${netId}`, cur =>
      cur && cur.week === w && cur.status === "playing" ? next : undefined);
    if (!committed) return;
    this.nets[netId] = next;
    const ops = [];
    for (const id of forced) {
      ops.push({
        op: "set", path: `${this.p}/orders/${id}_${w}`, data: {
          teamId: id, netId, week: w, qty: orders[id], by: "instructor", byName: "Instructor",
          source: "previous", at: Date.now(),
        },
      });
    }
    ops.push(...this.viewOps(next));
    if (next.status === "playing") ops.push({ op: "set", path: `${this.p}/snapshots/${netId}_${next.week}`, data: next });
    else ops.push({ op: "set", path: `${this.p}/results/${netId}`, data: E.results(next) });
    await this.store.batch(ops);
    if (forced.length) {
      await audit(this.store, this.code, "Advanced with missing decisions (repeated last order)",
        { network: next.name, week: w, teams: forced.map(id => `${net.teams[id].label}: ${orders[id]}`) });
    }
    if (Object.values(this.nets).every(n => n.status === "done")) {
      await this.store.updateDoc(this.p, { status: "ended", endedAt: Date.now() });
    }
  }

  viewOps(net) {
    return Object.keys(net.teams).map(id => ({ op: "set", path: `${this.p}/views/${id}`, data: E.teamView(net, id) }));
  }

  async setPaused(paused) {
    await this.store.updateDoc(this.p, { paused });
    await audit(this.store, this.code, paused ? "Paused" : "Resumed");
  }

  async forceAdvance(netId) { await this.advanceNet(netId, { force: true }); }

  // ---- stalled teams ----

  async remind(teamId) {
    await this.store.updateDoc(`${this.p}/teams/${teamId}`, { nudgeAt: Date.now() });
    const t = this.teams[teamId];
    await this.systemMessage(teamId, `Reminder from the instructor: please submit this week's ${t.tier === "brewery" ? "production" : "order"}. The rest of the supply chain is waiting.`);
    await audit(this.store, this.code, "Reminder sent", { team: t.label });
  }

  // Decide this week for a team: "previous" repeats last week's order,
  // "computer" lets the computer player choose. Logged either way.
  async decideFor(teamId, kind) {
    const team = this.teams[teamId], net = this.nets[team.netId];
    const qty = kind === "previous"
      ? Math.min(net.teams[teamId].lastOrder, E.limitsFor(net, teamId).max)
      : E.botOrder(net, teamId);
    await this.writeOrder(team, net, qty, kind, kind === "previous" ? "repeated last week's" : "let the computer choose this week's");
  }

  async overrideOrder(teamId, qty, note = "") {
    const team = this.teams[teamId], net = this.nets[team.netId];
    const v = E.validateOrder(E.limitsFor(net, teamId), qty, team.tier === "brewery");
    if (!v.ok) throw new Error(v.error);
    await this.writeOrder(team, net, v.value, "instructor", "entered", note);
  }

  async writeOrder(team, net, qty, source, verb, note = "") {
    const w = net.week;
    const prev = this.orderFor(team.id, w);
    const noun = team.tier === "brewery" ? "production" : "order";
    await this.store.setDoc(`${this.p}/orders/${team.id}_${w}`, {
      teamId: team.id, netId: net.id, week: w, qty, by: "instructor", byName: "Instructor",
      source, at: Date.now(), previousQty: prev ? prev.qty : null,
    });
    await this.systemMessage(team.id, prev
      ? `The instructor changed this week's ${noun} from ${prev.qty} to ${qty}.`
      : `The instructor ${verb} ${noun}: ${qty} cases.`);
    await audit(this.store, this.code,
      source === "instructor" ? "Order entered by instructor" : source === "previous" ? "Repeated last order for team" : "Computer decided for team",
      { team: team.label, week: w, from: prev ? prev.qty : null, to: qty, ...(note ? { note } : {}) });
  }

  async systemMessage(teamId, text) {
    await this.store.setDoc(`${this.p}/chats/${teamId}/msgs/${Date.now()}-${this.store.newId()}`, {
      uid: "system", name: "", text, at: Date.now(), kind: "system",
    });
  }

  async setBot(teamId, bot) {
    await this.store.updateDoc(`${this.p}/teams/${teamId}`, { bot });
    await audit(this.store, this.code, bot ? "Computer took over team" : "Team returned to students", { team: this.teams[teamId].label });
  }

  // ---- corrections ----

  // Correct an order from any week. The current week is simply replaced.
  // A past week is fixed by re-running the game from that week's saved
  // state with the corrected order; every later week is recalculated from
  // the orders teams actually submitted, so inventories, shipments and
  // backorders stay consistent.
  async correctOrder(teamId, week, qty, note = "") {
    const team = this.teams[teamId], net = this.nets[team.netId];
    if (week === net.week && net.status === "playing") return this.overrideOrder(teamId, qty, note);
    if (week < 1 || week > E.completedWeeks(net)) throw new Error(`Week ${week} hasn't been played yet.`);
    const snap = await this.store.getDoc(`${this.p}/snapshots/${net.id}_${week}`);
    if (!snap) throw new Error(`The saved state for week ${week} is missing, so this can't be corrected safely. Use "Undo last week" to step back instead.`);
    const t = net.teams[teamId];
    const old = t.history[week - 1].order;
    const lim = E.limitsFor(snap, teamId);
    const v = E.validateOrder(lim, qty, t.tier === "brewery");
    if (!v.ok) throw new Error(v.error);
    const snaps = [];
    const fixed = E.replay(snap, net, { [teamId]: { [week]: v.value } }, Date.now(), n => snaps.push(structuredClone(n)));
    const committed = await this.store.transact(`${this.p}/private/${net.id}`, cur =>
      cur && cur.week === net.week && cur.status === net.status ? fixed : undefined);
    if (!committed) throw new Error("The game moved on while correcting. Please try again.");
    this.nets[net.id] = fixed;
    const ops = [...this.viewOps(fixed)];
    for (const s of snaps) ops.push({ op: "set", path: `${this.p}/snapshots/${net.id}_${s.week}`, data: s });
    ops.push({
      op: "set", path: `${this.p}/orders/${teamId}_${week}`, data: {
        teamId, netId: net.id, week, qty: v.value, by: "instructor", byName: "Instructor", source: "instructor",
        at: Date.now(), previousQty: old,
      },
    });
    if (fixed.status === "done") ops.push({ op: "set", path: `${this.p}/results/${net.id}`, data: E.results(fixed) });
    await this.store.batch(ops);
    await this.systemMessage(teamId, `The instructor corrected your week ${week} ${t.tier === "brewery" ? "production" : "order"} from ${old} to ${v.value}. Later weeks were recalculated.`);
    await audit(this.store, this.code, "Past order corrected (later weeks recalculated)",
      { team: t.label, week, from: old, to: v.value, recalculatedThrough: E.completedWeeks(fixed), ...(note ? { note } : {}) });
  }

  async undoWeek(netId) {
    const net = this.nets[netId];
    const lastDone = net.status === "playing" ? net.week - 1 : E.completedWeeks(net);
    if (lastDone < 1) throw new Error("Nothing to undo yet.");
    await this.restoreTo(netId, lastDone, `Undid week ${lastDone}`);
  }

  async restartNet(netId) { await this.restoreTo(netId, 1, "Restarted from week 1", true); }

  async restoreTo(netId, week, label, clearAll = false) {
    const snap = await this.store.getDoc(`${this.p}/snapshots/${netId}_${week}`);
    if (!snap) throw new Error(`No saved state for week ${week}.`);
    const cur = this.nets[netId];
    snap.configChanges = [
      ...(snap.configChanges || []).filter(c => c.week <= snap.week),
      ...(cur?.configChanges || []).filter(c => c.week > snap.week),
    ];
    snap.config.weeks = Math.max(snap.config.weeks, cur?.config.weeks || 0);
    await this.store.updateDoc(this.p, { paused: true, status: "running" });
    const ops = [{ op: "set", path: `${this.p}/private/${netId}`, data: snap }, ...this.viewOps(snap)];
    for (const [key, o] of Object.entries(this.orders)) {
      if (o.netId === netId && (clearAll || o.week > week)) ops.push({ op: "delete", path: `${this.p}/orders/${key}` });
    }
    ops.push({ op: "delete", path: `${this.p}/results/${netId}` });
    await this.store.batch(ops);
    this.nets[netId] = snap;
    await audit(this.store, this.code, label, { network: snap.name });
  }

  // ---- settings, length, ending ----

  async changeSettings(changes) {
    const keys = Object.keys(changes);
    if (!keys.length) return;
    for (const net of Object.values(this.nets)) {
      if (net.status !== "playing") continue;
      await this.store.transact(`${this.p}/private/${net.id}`, cur => {
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

  // Scheduled length is never shown to students.
  async extendGame(add = 5) {
    const ops = [];
    let resumed = false;
    for (const net of Object.values(this.nets)) {
      const n = E.extendNetwork(net, add);
      if (net.status === "done" && n.status === "playing") {
        resumed = true;
        ops.push({ op: "delete", path: `${this.p}/results/${n.id}` });
        ops.push({ op: "set", path: `${this.p}/snapshots/${n.id}_${n.week}`, data: n });
      }
      ops.push({ op: "set", path: `${this.p}/private/${n.id}`, data: n }, ...this.viewOps(n));
      this.nets[n.id] = n;
    }
    if (resumed) ops.push({ op: "update", path: this.p, data: { status: "running" } });
    await this.store.batch(ops);
    await audit(this.store, this.code, `Game extended by ${add} weeks`, { newLength: Object.values(this.nets)[0]?.config.weeks });
  }

  async endGame() {
    const ops = [];
    for (const net of Object.values(this.nets)) {
      if (net.status !== "playing") continue;
      const done = E.endNetwork(net);
      this.nets[net.id] = done;
      ops.push({ op: "set", path: `${this.p}/private/${net.id}`, data: done });
      ops.push({ op: "set", path: `${this.p}/results/${net.id}`, data: E.results(done) });
      ops.push(...this.viewOps(done));
    }
    ops.push({ op: "update", path: this.p, data: { status: "ended", paused: false, endedAt: Date.now() } });
    await this.store.batch(ops);
    await audit(this.store, this.code, "Game ended by instructor");
  }
}
