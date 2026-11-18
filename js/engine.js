// SILENT KILLER — authoritative game engine.
// Runs ONLY on the host device. Pure logic: no DOM, no network. Every client
// receives a personalised, sanitised view from viewFor(), never the raw state.

export const ROLE = { KILLER: 'killer', POLICE: 'police', NETIZEN: 'netizen' };
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 20;
export const CURSE_LIMIT = 3; // consecutive failed rounds before a Killer is consumed

export const MODES = {
  classic: { label: 'Classic', actionSec: 60, discussionSec: 120 },
  quick: { label: 'Quick', actionSec: 30, discussionSec: 60 },
  slowburn: { label: 'Slow Burn', actionSec: 90, discussionSec: 180 },
  custom: { label: 'Custom' },
};

export const DEFAULTS = {
  mode: 'classic',
  actionSec: 60,
  discussionSec: 120,
  reportSec: 45,
  revealSec: 30,
  killers: 'auto', // 'auto' | 1 | 2 | 3
  accuseRule: 'any', // 'any' = naming one Killer wins | 'all' = must name every living Killer
  skipQuietDiscussion: false, // no death -> straight back to Action
  specialRoles: false, // reserved for future roles
  minPlayers: MIN_PLAYERS,
};

const T = { VALIDATE: 4500, QUIET: 5500, ANNOUNCE_BASE: 4000, ANNOUNCE_PER: 9000 };

export const autoKillers = (n) => (n >= 15 ? 3 : n >= 9 ? 2 : 1);
export const maxKillers = (n) => Math.max(1, Math.min(3, Math.floor((n - 1) / 3)));
export const clampSec = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

export function roleCounts(n, settings) {
  let k = settings.killers === 'auto' ? autoKillers(n) : Number(settings.killers) || 1;
  k = Math.max(1, Math.min(k, maxKillers(n)));
  return { killers: k, police: 1, netizens: Math.max(0, n - k - 1) };
}

function defaultRng() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 4294967296;
  }
  return Math.random();
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);

export class Game {
  constructor(state) {
    this.s = state;
  }

  static create(code, host, settings = {}) {
    const g = new Game({
      v: 1, code, phase: 'lobby', round: 0, paused: false, remaining: null, deadline: null,
      settings: { ...DEFAULTS, ...settings }, hostId: host.id, players: [], rounds: [],
      killers: {}, usedScenarios: [], announcement: null, accusation: null, result: null,
      pendingResult: null, gameNo: 0, rev: 0,
    });
    g.addPlayer(host);
    return g;
  }

  // ---------- helpers ----------
  p(id) { return this.s.players.find((x) => x.id === id); }
  get cur() { return this.s.rounds[this.s.rounds.length - 1]; }
  alive(role) { return this.s.players.filter((x) => x.alive && (!role || x.role === role)); }
  inGame() { return !['lobby', 'over'].includes(this.s.phase); }
  bump() { this.s.rev++; return true; }

  setPhase(phase, ms, now) {
    this.s.phase = phase;
    this.s.paused = false;
    this.s.remaining = null;
    this.s.deadline = ms == null ? null : now + ms;
    this.s.phaseStartedAt = now;
    this.bump();
  }

  // ---------- lobby ----------
  addPlayer({ id, name, bot = false }) {
    const s = this.s;
    if (this.p(id)) return { ok: true, rejoin: true };
    if (s.phase !== 'lobby') return { ok: false, error: 'The game has already started. Wait for the next game.' };
    if (s.players.length >= MAX_PLAYERS) return { ok: false, error: `Lobby is full (${MAX_PLAYERS} players).` };
    let nm = cleanName(name) || 'Stranger';
    const taken = new Set(s.players.map((x) => x.name.toLowerCase()));
    if (taken.has(nm.toLowerCase())) { let i = 2; while (taken.has(`${nm} ${i}`.toLowerCase())) i++; nm = `${nm} ${i}`; }
    s.players.push({ id, name: nm, bot, role: null, alive: true, cause: null, deathRound: null, warnings: 0, missed: 0, ready: false, seen: 0, joinedAt: Date.now() });
    this.bump();
    return { ok: true };
  }

  rename(id, name) {
    const pl = this.p(id);
    const nm = cleanName(name);
    if (!pl || !nm || this.s.phase !== 'lobby') return { ok: false };
    if (this.s.players.some((x) => x.id !== id && x.name.toLowerCase() === nm.toLowerCase())) return { ok: false, error: 'That name is taken.' };
    pl.name = nm;
    return { ok: this.bump() };
  }

  removePlayer(id) {
    if (this.s.phase !== 'lobby' || id === this.s.hostId) return { ok: false };
    const before = this.s.players.length;
    this.s.players = this.s.players.filter((x) => x.id !== id);
    return { ok: before !== this.s.players.length && this.bump() };
  }

  setSettings(patch) {
    if (this.s.phase !== 'lobby') return { ok: false };
    const st = { ...this.s.settings };
    if (patch.mode && MODES[patch.mode]) {
      st.mode = patch.mode;
      if (MODES[patch.mode].actionSec) { st.actionSec = MODES[patch.mode].actionSec; st.discussionSec = MODES[patch.mode].discussionSec; }
    }
    if (patch.actionSec != null) { st.actionSec = clampSec(patch.actionSec, 15, 600); st.mode = 'custom'; }
    if (patch.discussionSec != null) { st.discussionSec = clampSec(patch.discussionSec, 20, 900); st.mode = 'custom'; }
    if (patch.reportSec != null) st.reportSec = clampSec(patch.reportSec, 15, 180);
    if (patch.killers != null) st.killers = patch.killers === 'auto' ? 'auto' : clampSec(patch.killers, 1, 3);
    if (patch.accuseRule && ['any', 'all'].includes(patch.accuseRule)) st.accuseRule = patch.accuseRule;
    if (patch.skipQuietDiscussion != null) st.skipQuietDiscussion = !!patch.skipQuietDiscussion;
    this.s.settings = st;
    return { ok: this.bump() };
  }

  // ---------- start ----------
  start(now, rng = defaultRng) {
    const s = this.s;
    if (s.phase !== 'lobby') return { ok: false, error: 'Already started.' };
    const n = s.players.length;
    if (n < s.settings.minPlayers) return { ok: false, error: `Need at least ${s.settings.minPlayers} players.` };
    const c = roleCounts(n, s.settings);
    const roles = [...Array(c.killers).fill(ROLE.KILLER), ROLE.POLICE, ...Array(c.netizens).fill(ROLE.NETIZEN)];
    shuffle(roles, rng);
    const order = shuffle(s.players.map((_, i) => i), rng);
    order.forEach((pi, k) => { s.players[pi].role = roles[k]; });
    s.players.forEach((pl) => Object.assign(pl, { alive: true, cause: null, deathRound: null, warnings: 0, missed: 0, ready: !!pl.bot }));
    s.killers = {};
    s.players.filter((x) => x.role === ROLE.KILLER).forEach((x) => { s.killers[x.id] = { failed: 0 }; });
    s.counts = c;
    s.rounds = [];
    s.round = 0;
    s.announcement = null; s.accusation = null; s.result = null; s.pendingResult = null;
    s.gameNo++;
    this.setPhase('reveal', s.settings.revealSec * 1000, now);
    return { ok: true };
  }

  backToLobby() {
    const s = this.s;
    s.players.forEach((pl) => Object.assign(pl, { role: null, alive: true, cause: null, deathRound: null, warnings: 0, missed: 0, ready: false }));
    s.rounds = []; s.round = 0; s.killers = {}; s.announcement = null; s.accusation = null; s.result = null; s.pendingResult = null;
    this.setPhase('lobby', null, 0);
    return { ok: true };
  }

  startRound(now) {
    const s = this.s;
    s.round++;
    s.rounds.push({ n: s.round, targets: {}, lockedAt: {}, reports: {}, items: [], warnings: [], killerResults: {}, aliveAtStart: this.alive().map((x) => x.id) });
    s.announcement = null;
    this.setPhase('action', s.settings.actionSec * 1000, now);
  }

  // ---------- the core: validation against secret target records ----------
  resolveRound(now, ctx) {
    const s = this.s, r = this.cur;
    // 1. Missing reports are recorded as "no report" (never blocks the game, never changes a kill).
    for (const pl of this.alive()) {
      if (!r.reports[pl.id]) { r.reports[pl.id] = { winked: false, suspect: null, missed: true }; pl.missed++; }
    }
    // 2. Kills: the Killer's locked target is the source of truth. Police and Killers are immune.
    const aliveKillers = this.alive(ROLE.KILLER);
    const deaths = [];
    for (const k of aliveKillers) {
      const t = r.targets[k.id];
      const victim = t && this.p(t);
      if (victim && victim.alive && victim.role === ROLE.NETIZEN && !deaths.includes(t)) deaths.push(t);
    }
    const timeText = ctx.fmtTime ? ctx.fmtTime(now) : new Date(now).toLocaleTimeString();
    for (const id of deaths) {
      const v = this.p(id);
      v.alive = false; v.cause = 'kill'; v.deathRound = r.n;
      const sc = this.pickScenario(ctx.scenarios || [], ctx.rng || defaultRng);
      r.items.push({
        kind: 'death', pid: id, sid: sc.id, title: sc.title, location: sc.location, time: timeText,
        text: sc.text.replace(/\{PLAYER\}/g, v.name).replace(/\{TIME\}/g, timeText),
      });
    }
    // 3. Inactivity curse: each Killer has their own counter. A kill only counts if their own locked target died.
    for (const k of aliveKillers) {
      const ks = s.killers[k.id];
      const t = r.targets[k.id] || null;
      const credited = !!t && deaths.includes(t);
      ks.failed = credited ? 0 : ks.failed + 1;
      r.killerResults[k.id] = { target: t, credited, failed: ks.failed };
      if (ks.failed >= CURSE_LIMIT) {
        k.alive = false; k.cause = 'curse'; k.deathRound = r.n;
        r.items.push({ kind: 'curse', pid: k.id });
      }
    }
    // 4. False reports: a "YES" from someone no Killer targeted. Depends ONLY on whether the reporter was
    //    targeted — never on who they named — so reports can't be used to probe identities.
    const targeted = new Set(Object.values(r.targets).filter(Boolean));
    for (const [pid, rep] of Object.entries(r.reports)) {
      if (rep.winked && !targeted.has(pid)) { this.p(pid).warnings++; r.warnings.push(pid); }
    }
    s.pendingResult = this.checkWin();
    s.announcement = { round: r.n, items: r.items, warned: r.warnings };
  }

  pickScenario(list, rng) {
    if (!list.length) return { id: 'X', title: 'The Unexplained Incident', location: 'Somewhere nearby', text: '{PLAYER} was found at {TIME}. Nobody saw anything.' };
    let pool = list.filter((x) => !this.s.usedScenarios.includes(x.id));
    if (!pool.length) { this.s.usedScenarios = []; pool = list; }
    const sc = pool[Math.floor(rng() * pool.length)];
    this.s.usedScenarios.push(sc.id);
    return sc;
  }

  checkWin() {
    if (this.alive(ROLE.KILLER).length === 0) return { winner: 'innocent', reason: 'curse' };
    if (this.alive(ROLE.NETIZEN).length === 0) return { winner: 'killer', reason: 'massacre' };
    return null;
  }

  finish(result, now) {
    this.s.result = { ...result, endedRound: this.s.round, at: now };
    this.s.pendingResult = null;
    this.setPhase('over', null, now);
  }

  // ---------- clock ----------
  tick(now, ctx = {}) {
    const s = this.s;
    if (!this.inGame() || s.paused) return false;
    const due = s.deadline != null && now >= s.deadline;
    switch (s.phase) {
      case 'reveal':
        if (due || this.alive().every((x) => x.ready)) { this.startRound(now); return true; }
        return false;
      case 'action':
        if (due) { this.setPhase('report', s.settings.reportSec * 1000, now); return true; }
        return false;
      case 'report':
        if (due || this.alive().every((x) => this.cur.reports[x.id])) {
          this.resolveRound(now, ctx);
          this.setPhase('validate', T.VALIDATE, now);
          return true;
        }
        return false;
      case 'validate':
        if (due) {
          const items = s.announcement.items.length;
          this.setPhase('announce', items ? T.ANNOUNCE_BASE + T.ANNOUNCE_PER * items : T.QUIET, now);
          return true;
        }
        return false;
      case 'announce':
        if (due) {
          if (s.pendingResult) { this.finish(s.pendingResult, now); return true; }
          if (!s.announcement.items.length && s.settings.skipQuietDiscussion) this.startRound(now);
          else this.setPhase('discussion', s.settings.discussionSec * 1000, now);
          return true;
        }
        return false;
      case 'discussion':
        if (due) { this.startRound(now); return true; }
        return false;
    }
    return false;
  }

  // ---------- actions ----------
  handle(pid, a, now, ctx = {}) {
    const s = this.s, me = this.p(pid);
    if (!me || !a || typeof a !== 'object') return { ok: false, error: 'Unknown player.' };
    const isHost = pid === s.hostId;
    const r = this.cur;
    switch (a.type) {
      case 'profile': return this.rename(pid, a.name);
      case 'leave': return s.phase === 'lobby' && !isHost ? this.removePlayer(pid) : { ok: false };
      case 'ready':
        if (s.phase !== 'reveal' || me.ready) return { ok: false };
        me.ready = true; return { ok: this.bump() };

      case 'target': {
        if (s.phase !== 'action') return { ok: false, error: 'You can only choose during the Action Phase.' };
        if (me.role !== ROLE.KILLER || !me.alive) return { ok: false, error: 'Not allowed.' };
        if (r.targets[pid]) return { ok: false, error: 'Your target is already locked.' };
        const t = this.p(a.target);
        if (!t || !t.alive || t.id === pid || t.role === ROLE.KILLER) return { ok: false, error: 'Invalid target.' };
        r.targets[pid] = t.id; r.lockedAt[pid] = now;
        return { ok: this.bump() };
      }

      case 'report': {
        if (s.phase !== 'report') return { ok: false, error: 'Reports are closed.' };
        if (!me.alive) return { ok: false, error: 'The dead do not report.' };
        if (r.reports[pid]) return { ok: false, error: 'Your report is already sealed.' };
        const winked = !!a.winked;
        let suspect = null;
        if (winked) {
          const sp = this.p(a.suspect);
          if (!sp || sp.id === pid || !r.aliveAtStart.includes(sp.id)) return { ok: false, error: 'Choose who winked at you.' };
          suspect = sp.id;
        }
        r.reports[pid] = { winked, suspect, at: now };
        return { ok: this.bump() };
      }

      case 'accuse': {
        if (!this.inGame() || s.phase === 'reveal') return { ok: false, error: 'You cannot accuse right now.' };
        if (me.role !== ROLE.POLICE) return { ok: false, error: 'Only the Police can accuse.' };
        if (s.accusation) return { ok: false, error: 'You already used your accusation.' };
        const need = s.settings.accuseRule === 'all' ? this.alive(ROLE.KILLER).length : 1;
        const ids = [...new Set(Array.isArray(a.targets) ? a.targets : [])];
        if (ids.length !== need || ids.some((id) => { const x = this.p(id); return !x || !x.alive || x.id === pid; }))
          return { ok: false, error: need > 1 ? `Name exactly ${need} living suspects.` : 'Choose one living suspect.' };
        const killerIds = this.alive(ROLE.KILLER).map((x) => x.id);
        const correct = s.settings.accuseRule === 'all'
          ? ids.every((id) => killerIds.includes(id))
          : killerIds.includes(ids[0]);
        s.accusation = { by: pid, targets: ids, correct, round: s.round, phase: s.phase };
        this.finish({ winner: correct ? 'innocent' : 'killer', reason: correct ? 'accuse_right' : 'accuse_wrong' }, now);
        return { ok: true };
      }

      // ---- host controls (the host manages flow, never sees secrets) ----
      case 'settings': return isHost ? this.setSettings(a.patch || {}) : { ok: false };
      case 'start': return isHost ? this.start(now, ctx.rng) : { ok: false };
      case 'kick': return isHost ? this.removePlayer(a.target) : { ok: false };
      case 'pause':
        if (!isHost || !this.inGame() || s.paused || s.deadline == null) return { ok: false };
        s.paused = true; s.remaining = Math.max(0, s.deadline - now); s.deadline = null;
        return { ok: this.bump() };
      case 'resume':
        if (!isHost || !s.paused) return { ok: false };
        s.paused = false; s.deadline = now + (s.remaining || 0); s.remaining = null;
        return { ok: this.bump() };
      case 'skip':
        // Host may cut waiting phases short. Never the Action Phase (that would cut a Killer's time).
        if (!isHost || !['reveal', 'report', 'announce', 'discussion'].includes(s.phase)) return { ok: false };
        if (s.phase === 'reveal') s.players.forEach((x) => { x.ready = true; });
        s.paused = false; s.remaining = null; s.deadline = now;
        return { ok: this.bump() };
      case 'end':
        if (!isHost || !this.inGame()) return { ok: false };
        this.finish({ winner: null, reason: 'aborted' }, now);
        return { ok: true };
      case 'lobby':
        if (!isHost || s.phase !== 'over') return { ok: false };
        return this.backToLobby();
    }
    return { ok: false, error: 'Unknown action.' };
  }

  // ---------- personalised, sanitised view ----------
  viewFor(pid, now) {
    const s = this.s, me = this.p(pid);
    if (!me) return null;
    const over = s.phase === 'over';
    const r = this.cur;
    const amKiller = me.role === ROLE.KILLER;
    const v = {
      code: s.code, phase: s.phase, round: s.round, paused: s.paused, gameNo: s.gameNo,
      remaining: s.paused ? s.remaining : s.deadline != null ? Math.max(0, s.deadline - now) : null,
      settings: s.settings, hostId: s.hostId,
      counts: s.counts || roleCounts(s.players.length, s.settings),
      players: s.players.map((x) => ({
        id: x.id, name: x.name, bot: x.bot || undefined,
        alive: x.alive, cause: x.alive ? null : x.cause, deathRound: x.deathRound,
        // A role is only visible if: it's you, you're both Killers, the curse exposed them, or the game is over.
        role: over || x.id === pid || x.cause === 'curse' || (amKiller && x.role === ROLE.KILLER) ? x.role : null,
      })),
      me: { id: pid, role: me.role, alive: me.alive, cause: me.cause, warnings: me.warnings, ready: me.ready, isHost: pid === s.hostId },
      killersAlive: s.phase === 'lobby' ? null : (s.counts ? s.counts.killers : 0) - s.players.filter((x) => x.role === ROLE.KILLER && x.cause === 'curse').length,
    };
    v.me.name = me.name;
    if (s.phase === 'reveal') {
      const al = this.alive();
      v.readyProgress = { done: al.filter((x) => x.ready).length, total: al.length };
    }
    if (amKiller && s.killers[pid]) {
      v.me.failed = s.killers[pid].failed;
      v.me.curseLimit = CURSE_LIMIT;
      if (r && s.phase === 'action') v.me.target = r.targets[pid] || null;
    }
    if (me.role === ROLE.POLICE) v.me.accused = !!s.accusation;
    if (r && s.phase === 'report') {
      const aliveIds = this.alive().map((x) => x.id);
      v.me.myReport = r.reports[pid] ? { winked: r.reports[pid].winked, suspect: r.reports[pid].suspect } : null;
      v.reportProgress = { done: aliveIds.filter((id) => r.reports[id]).length, total: aliveIds.length, pending: aliveIds.filter((id) => !r.reports[id]) };
    }
    if (s.announcement && ['announce', 'discussion', 'over'].includes(s.phase)) {
      v.announcement = { round: s.announcement.round, items: s.announcement.items };
      v.me.warnedThisRound = s.announcement.warned.includes(pid); // private
    }
    // Crime Archive: public record of every body. Never contains killer / report info.
    const showCur = ['announce', 'discussion', 'over'].includes(s.phase);
    v.archive = s.rounds.filter((rd) => rd.n < s.round || showCur).flatMap((rd) => rd.items.map((it) => ({ ...it, round: rd.n })));
    if (over) {
      v.result = {
        ...s.result,
        accusation: s.accusation,
        history: s.rounds.map((rd) => ({
          n: rd.n, targets: rd.targets, killerResults: rd.killerResults, warnings: rd.warnings,
          deaths: rd.items.filter((i) => i.kind === 'death').map((i) => i.pid),
          curses: rd.items.filter((i) => i.kind === 'curse').map((i) => i.pid),
          reports: rd.reports,
        })),
        stats: s.players.map((x) => ({ id: x.id, role: x.role, warnings: x.warnings, missed: x.missed })),
      };
    }
    return v;
  }
}
