// SILENT KILLER — app: screens, host loop, client flow, sound & effects per phase.
import { Game, ROLE, MODES, MIN_PLAYERS, MAX_PLAYERS, roleCounts, maxKillers, CURSE_LIMIT } from './engine.js?v=6';
import * as net from './net.js?v=6';
import { sfx, vibrate } from './sfx.js?v=6';
import { fx } from './fx.js?v=6';
import { afterlife } from './afterlife.js?v=6';

// ======================================================================
// utils
// ======================================================================
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const SLOT = params.get('slot') ? '_' + params.get('slot') : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_ALPHA[b % CODE_ALPHA.length]).join('');
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('sk_' + k + SLOT); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('sk_' + k + SLOT, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem('sk_' + k + SLOT); } catch (_) {} },
};
const fmtTime = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtSec = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);
const durLabel = (s) => (s % 60 === 0 ? `${s / 60} min` : s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function netBanner(msg) {
  const n = $('#net');
  if (!msg) n.classList.add('hidden'); else { n.textContent = msg; n.classList.remove('hidden'); }
}

// ======================================================================
// icons & copy
// ======================================================================
const ICON = {
  killer: `<svg class="r-ic" width="96" height="96" viewBox="0 0 100 100"><path d="M20 52 Q50 22 80 52 Q50 70 20 52Z" fill="#f3d7d0"/><circle cx="50" cy="50" r="13" fill="#b30d17"/><circle cx="50" cy="50" r="6" fill="#000"/><path d="M16 52 Q50 14 84 52 Q50 36 16 52Z" fill="#2a0205"/><path d="M18 52 Q50 36 82 52" stroke="#000" stroke-width="3" fill="none"/><path d="M57 66 C57 66 52 75 52 79 a5 5 0 0 0 10 0 C62 75 57 66 57 66Z" fill="#ff2b3a"/></svg>`,
  police: `<svg class="r-ic" width="96" height="96" viewBox="0 0 100 100"><path d="M50 8 L84 20 V48 C84 70 68 86 50 92 C32 86 16 70 16 48 V20Z" fill="#1c3a6e" stroke="#9cc0ff" stroke-width="3"/><path d="M50 28 l6.5 13.2 14.5 2.1 -10.5 10.2 2.5 14.5 -13 -6.8 -13 6.8 2.5 -14.5 -10.5 -10.2 14.5 -2.1Z" fill="#e8f0ff"/></svg>`,
  netizen: `<svg class="r-ic" width="96" height="96" viewBox="0 0 100 100"><rect x="30" y="10" width="40" height="80" rx="8" fill="#2b2421" stroke="#d9cfbf" stroke-width="3"/><rect x="35" y="19" width="30" height="56" rx="2" fill="#544843"/><circle cx="50" cy="82" r="3" fill="#d9cfbf"/><circle cx="50" cy="40" r="8" fill="#d9cfbf"/><path d="M38 62 Q50 46 62 62Z" fill="#d9cfbf"/></svg>`,
};
const ROLE_INFO = {
  killer: { name: 'Killer', goal: 'Lock ONE target on your phone every Action Phase, then wink at them without being caught.' },
  police: { name: 'Police', goal: 'Find the Killer. You cannot be killed. You get ONE accusation — use it any time. Guess wrong and the Killers win.' },
  netizen: { name: 'Netizen', goal: 'Survive. Watch for winks. Report honestly and help the Police expose the Killer.' },
};
const PHASE = {
  lobby: ['Lobby', 'Gathering victims'],
  reveal: ['Your Role', 'Keep it secret'],
  action: ['Action', 'Watch every eye'],
  report: ['Report', 'Were you winked at?'],
  validate: ['Validation', 'Checking the records'],
  announce: ['Crime Scene', 'Crime Scene Report'],
  discussion: ['Discussion', 'The dead stay silent'],
  over: ['The End', 'Final verdict'],
};
const PRESETS = ['💀', '👻', '🎭', '👁️', '🦇', '🕷️', '🕯️', '🔪', '🩸', '🐈‍⬛', '🧛', '🤡'];

// ======================================================================
// state
// ======================================================================
const App = {
  screen: 'splash', mode: null, code: null, bus: null, me: null,
  view: null, viewKey: '', deadline: null, phaseKey: '',
  profile: store.get('profile', { name: '', avatar: null }),
  avatars: {},
  ui: { sel: null, reportYes: false, suspect: null, accuse: [], notes: {}, shown: 0, peeked: false, busy: false, pendingJoin: null },
  scenarios: [],
  // host
  game: null, hostKeys: null, pubs: {}, keyP: {}, lastSent: {}, seen: {}, botPlan: {},
  // client
  hostKey: null, ident: null, lastViewAt: 0,
};
window.SK = App; // debugging only (never contains secrets on client devices)

fetch('assets/scenarios.json').then((r) => r.json()).then((d) => { App.scenarios = d; }).catch(() => {});

const engineCtx = () => ({ scenarios: App.scenarios, fmtTime });

// ======================================================================
// avatars
// ======================================================================
function avatarStyle(id) {
  const img = App.avatars[id];
  return img ? `style="background-image:url('${img}')"` : '';
}
function av(id, name, cls = '') {
  const img = App.avatars[id];
  const ini = img ? '' : esc((name || '?').trim().charAt(0).toUpperCase());
  return `<div class="av ${cls}" data-av="${esc(id)}" ${avatarStyle(id)}>${ini}</div>`;
}
function paintAvatars() {
  document.querySelectorAll('[data-av]').forEach((el) => {
    const img = App.avatars[el.dataset.av];
    if (img) { el.style.backgroundImage = `url('${img}')`; if (el.firstChild && el.firstChild.nodeType === 3) el.textContent = ''; }
  });
}
function emojiAvatar(emoji) {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(80, 60, 10, 80, 80, 100);
  g.addColorStop(0, '#5a0a12'); g.addColorStop(1, '#120406');
  x.fillStyle = g; x.fillRect(0, 0, 160, 160);
  x.font = '92px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(emoji, 80, 88);
  return c.toDataURL('image/jpeg', 0.8);
}
function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const x = c.getContext('2d');
      x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
function publishAvatar(id, img) {
  App.avatars[id] = img;
  if (App.bus && img) App.bus.publish('av/' + id, { img }, { retain: true });
}
function onAvatar(data, id) {
  if (data && typeof data.img === 'string' && data.img.startsWith('data:image/') && data.img.length < 60000) {
    App.avatars[id] = data.img;
    paintAvatars();
  }
}

// ======================================================================
// wake lock (keep phones awake during the game)
// ======================================================================
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (_) {}
}
// Phones only allow audio after a real tap. Re-unlock on every tap until it is running
// (iOS also suspends audio when the screen locks or the app goes to the background).
for (const ev of ['touchend', 'click', 'keydown']) {
  document.addEventListener(ev, () => { if (!sfx.ready || (sfx.mediaEl && sfx.mediaEl.paused)) sfx.unlock(); }, true);
}
function testSound() {
  sfx.unlock();
  if (sfx.muted) sfx.setMuted(false);
  setTimeout(() => sfx.play('discussion', { vol: 1 }), 80);
  setTimeout(() => {
    const st = sfx.status();
    const ok = st.ctx === 'running';
    toast(`${ok ? '🔊 Sound is ON' : '⚠️ Sound blocked — tap again'} · audio ${st.ctx} · ${st.loaded}/${st.total} sounds loaded. `
      + 'Hear nothing? Turn Silent mode OFF, raise the media volume, close other apps using audio, disconnect Bluetooth.', 7000);
  }, 900);
  render();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake();
    sfx.unlock();
    if (App.mode === 'client' && App.bus) sendHost({ type: 'sync' });
  }
});

// ======================================================================
// HOST
// ======================================================================
async function hostCreate() {
  App.mode = 'host';
  App.code = genCode();
  App.me = 'h_' + rid(8);
  App.hostKeys = await net.genKeys();
  App.game = Game.create(App.code, { id: App.me, name: App.profile.name }, { minPlayers: DEV ? 3 : MIN_PLAYERS });
  App.bus = new net.Bus(App.code);
  await App.bus.connectAny(0);
  await hostWire();
}

async function hostResume(saved) {
  App.mode = 'host';
  App.code = saved.code; App.me = saved.me; App.hostKeys = saved.hostKeys; App.pubs = saved.pubs || {};
  App.game = new Game(saved.state);
  App.bus = new net.Bus(App.code);
  try { await App.bus.connectTo(saved.broker ?? 0); } catch (_) { await App.bus.connectAny(0); }
  await hostWire();
}

async function hostWire() {
  const bus = App.bus;
  bus.onStatus = (s) => netBanner(s === 'online' ? null : 'Connection lost — reconnecting…');
  await bus.subscribe('up', onHostUp);
  await bus.subscribe('av/+', onAvatar);
  publishMeta();
  if (App.profile.avatar) publishAvatar(App.me, App.profile.avatar);
  for (const pl of App.game.s.players) if (pl.bot && App.avatars[pl.id]) publishAvatar(pl.id, App.avatars[pl.id]);
  App.screen = 'game';
  store.set('last', { code: App.code, host: true, at: Date.now() });
  clearInterval(App.loop); clearInterval(App.beat);
  App.loop = setInterval(hostTick, 250);
  App.beat = setInterval(() => broadcast(true), 4000);
  afterChange();
}

function publishMeta() {
  const open = App.game.s.phase === 'lobby';
  if (App._metaOpen === open && App._metaAt && Date.now() - App._metaAt < 60000) return;
  App._metaOpen = open; App._metaAt = Date.now();
  App.bus.publish('meta', { v: 1, pub: App.hostKeys.pub, open, at: Date.now() }, { retain: true });
}

function keyFor(pid) {
  if (!App.keyP[pid] && App.pubs[pid]) App.keyP[pid] = net.deriveKey(App.hostKeys.priv, App.pubs[pid]);
  return App.keyP[pid] || null;
}

async function onHostUp(data) {
  if (!data || typeof data.pid !== 'string' || data.pid.length > 40) return;
  const pid = data.pid;
  const g = App.game;
  if (data.t === 'hello') {
    if (!data.pub || !data.pub.x) return;
    const known = App.pubs[pid];
    if (known && (known.x !== data.pub.x || known.y !== data.pub.y)) { App.bus.publish('dn/' + pid, { t: 'reject', reason: 'This identity is already in use.' }); return; }
    if (!g.p(pid) && g.s.phase !== 'lobby') { App.bus.publish('dn/' + pid, { t: 'reject', reason: 'The game has already started. Wait for the next round of games.' }); return; }
    if (!g.p(pid) && g.s.players.length >= MAX_PLAYERS) { App.bus.publish('dn/' + pid, { t: 'reject', reason: 'The lobby is full.' }); return; }
    if (!known) { App.pubs[pid] = data.pub; saveHost(); }
    keyFor(pid);
    return;
  }
  if (data.t !== 'm') return;
  const kp = keyFor(pid);
  if (!kp) { App.bus.publish('dn/' + pid, { t: 'who' }); return; }
  let msg;
  try { msg = await net.unseal(await kp, data); } catch (_) { return; }
  App.seen[pid] = Date.now();
  const now = Date.now();
  switch (msg.type) {
    case 'join': {
      const res = g.addPlayer({ id: pid, name: msg.name });
      if (!res.ok) { sendTo(pid, { type: 'error', error: res.error, fatal: true }); return; }
      if (!res.rejoin) sfx.play('join', { vol: 0.6 });
      afterChange(); sendView(pid, true);
      break;
    }
    case 'sync': sendView(pid, true); break;
    case 'haunt': hostHaunt(pid, msg.target); break;
    case 'ping': if (!App.lastSent[pid]) sendView(pid, true); break;
    case 'act': {
      if (!g.p(pid)) return;
      const res = g.handle(pid, msg.a || {}, now, engineCtx());
      if (!res.ok && res.error) sendTo(pid, { type: 'error', error: res.error });
      afterChange();
      break;
    }
  }
}

// A dead player's ghost touched a living player's name: flash the ghost's face on that
// player's screen and vibrate their phone. Rate-limited so ghosts can't spam.
App.hauntAt = {};
function hostHaunt(from, target) {
  const g = App.game, now = Date.now();
  if (!g || g.s.settings.ghostHaunt === false || !g.inGame()) return;
  const f = g.p(from), t = g.p(target);
  if (!f || f.alive || !t || !t.alive || t.bot) return;
  if (now - (App.hauntAt[from] || 0) < 1500 || now - (App.hauntAt['t:' + target] || 0) < 1000) return;
  App.hauntAt[from] = now; App.hauntAt['t:' + target] = now;
  if (target === App.me) showHaunt(from);
  else sendTo(target, { type: 'haunt', from });
}

async function sendTo(pid, obj) {
  const kp = keyFor(pid);
  if (!kp) return;
  const sealed = await net.seal(await kp, obj);
  App.bus.publish('dn/' + pid, { t: 'm', ...sealed });
}

function decorate(v) {
  const now = Date.now();
  v.players.forEach((p) => { p.online = p.id === App.game.s.hostId || !!p.bot || (App.seen[p.id] && now - App.seen[p.id] < 16000); });
  return v;
}

function sendView(pid, force = false) {
  const g = App.game;
  const v = g.viewFor(pid, Date.now());
  if (!v) return;
  decorate(v);
  const { remaining, ...rest } = v;
  const key = JSON.stringify(rest);
  if (!force && App.lastSent[pid] === key) return;
  App.lastSent[pid] = key;
  sendTo(pid, { type: 'view', v });
}

function broadcast(force = false) {
  if (!App.game) return;
  for (const p of App.game.s.players) if (!p.bot && p.id !== App.me) sendView(p.id, force);
  if (force) publishMeta();
}

let saveTimer = null;
function saveHost() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!App.game) return;
    const bots = {};
    App.game.s.players.filter((p) => p.bot).forEach((p) => { bots[p.id] = App.avatars[p.id]; });
    store.set('host', { code: App.code, me: App.me, hostKeys: App.hostKeys, pubs: App.pubs, state: App.game.s, broker: App.bus ? App.bus.brokerIdx : 0, savedAt: Date.now(), bots });
  }, 200);
}

// Private events from the engine (lures) go only to the one phone they are for.
function deliverEvents() {
  const g = App.game;
  if (!g) return;
  for (const ev of g.drainEvents()) {
    if (ev.type !== 'lure') continue;
    const to = g.p(ev.to);
    if (!to || to.bot) continue;
    if (ev.to === App.me) showLure(ev.look);
    else sendTo(ev.to, { type: 'lure', look: ev.look });
  }
}

function afterChange() {
  deliverEvents();
  saveHost();
  publishMeta();
  broadcast();
  const v = App.game.viewFor(App.me, Date.now());
  applyView(decorate(v));
}

function hostTick() {
  const g = App.game;
  if (!g) return;
  const now = Date.now();
  if (DEV) runBots(now);
  if (g.tick(now, engineCtx())) afterChange();
  else deliverEvents(); // phantom lures fire mid-phase without changing the state
}

// ---- dev bots (host-side test players; ?dev=1 only) ----
function addBot() {
  const names = ['Ali', 'Badrul', 'Chloe', 'Dina', 'Eiman', 'Farah', 'Ganesh', 'Hana', 'Irfan', 'Jia Wei', 'Kamal', 'Lina', 'Mei', 'Nabil', 'Omar', 'Priya', 'Qis', 'Rina', 'Siti'];
  const used = new Set(App.game.s.players.map((p) => p.name));
  const name = names.find((n) => !used.has(n)) || 'Bot ' + rid(3);
  const id = 'b_' + rid(6);
  App.game.addPlayer({ id, name, bot: true });
  publishAvatar(id, emojiAvatar(PRESETS[Math.floor(Math.random() * PRESETS.length)]));
  afterChange();
}
function runBots(now) {
  const g = App.game, s = g.s;
  const bots = s.players.filter((p) => p.bot && p.alive);
  if (!bots.length || s.paused) return;
  const key = s.phase + s.round;
  for (const b of bots) {
    const pk = key + b.id;
    if (App.botPlan[pk] == null) App.botPlan[pk] = now + 1500 + Math.random() * 5000;
    if (now < App.botPlan[pk]) continue;
    if (s.phase === 'action' && b.role === ROLE.KILLER && !g.cur.targets[b.id]) {
      const opts = g.alive().filter((p) => p.id !== b.id && p.role !== ROLE.KILLER);
      if (opts.length) g.handle(b.id, { type: 'target', target: opts[Math.floor(Math.random() * opts.length)].id }, now);
      if (Math.random() < 0.6) g.handle(b.id, { type: 'lure', look: Math.random() < 0.5 ? b.id : g.alive().filter((p) => p.id !== g.cur.targets[b.id])[0].id }, now);
      afterChange();
    }
    if (s.phase === 'report' && !g.cur.reports[b.id]) {
      const targeted = Object.values(g.cur.targets).includes(b.id);
      const others = g.alive().filter((p) => p.id !== b.id);
      const liar = Math.random() < 0.12;
      const yes = targeted || liar;
      const killer = Object.keys(g.cur.targets).find((k) => g.cur.targets[k] === b.id);
      g.handle(b.id, { type: 'report', winked: yes, suspect: yes ? (killer && Math.random() < 0.6 ? killer : others[Math.floor(Math.random() * others.length)].id) : null }, now);
      afterChange();
    }
  }
}

async function closeLobby() {
  if (App.mode !== 'host') return;
  for (const p of App.game.s.players) if (!p.bot && p.id !== App.me) await sendTo(p.id, { type: 'error', error: 'The host closed the lobby.', fatal: true });
  App.bus.publish('meta', null, { retain: true });
  for (const p of App.game.s.players) App.bus.publish('av/' + p.id, null, { retain: true });
  store.del('host'); store.del('last');
  await sleep(900); // let the goodbye messages flush before disconnecting
  teardown();
}

// ======================================================================
// CLIENT
// ======================================================================
async function clientJoin(code, preferredBroker = null) {
  App.mode = 'client';
  App.code = code;
  setScreen('connecting', { msg: `Searching the shadows for lobby ${code}…` });
  const found = await net.findLobby(code, preferredBroker);
  if (!found) { setScreen('home'); toast('Lobby not found. Check the code.'); return; }
  App.bus = found.bus;
  let ident = store.get('id_' + code);
  if (!ident) { ident = { pid: 'p_' + rid(10), keys: await net.genKeys() }; store.set('id_' + code, ident); }
  App.ident = ident; App.me = ident.pid;
  App.hostPub = found.meta.pub;
  App.hostKey = await net.deriveKey(ident.keys.priv, found.meta.pub);
  const bus = App.bus;
  bus.onStatus = (s) => { if (s === 'online') { netBanner(null); clientHello(); } else netBanner('Connection lost — reconnecting…'); };
  await bus.subscribe('dn/' + App.me, onClientDn);
  await bus.subscribe('av/+', onAvatar);
  await bus.subscribe('meta', async (m) => {
    if (!m) { if (App.view && App.mode === 'client') { toast('The host closed the lobby.', 3500); store.del('last'); teardown(); } return; }
    if (m.pub && (m.pub.x !== App.hostPub.x)) { App.hostPub = m.pub; App.hostKey = await net.deriveKey(ident.keys.priv, m.pub); clientHello(); }
  });
  if (App.profile.avatar) publishAvatar(App.me, App.profile.avatar);
  store.set('last', { code, broker: bus.brokerIdx, at: Date.now() });
  App.broker = bus.brokerIdx;
  await clientHello();
  setScreen('connecting', { msg: 'Knocking on the door…' });
  clearInterval(App.beat);
  App.beat = setInterval(() => {
    sendHost({ type: 'ping' });
    if (App.view && Date.now() - App.lastViewAt > 13000) { netBanner('Waiting for the host…'); sendHost({ type: 'sync' }); }
  }, 5000);
  setTimeout(() => { if (!App.view && App.mode === 'client') { netBanner('Host is not answering…'); clientHello(); } }, 6000);
}

async function clientHello() {
  if (!App.bus || !App.ident) return;
  App.bus.publish('up', { t: 'hello', pid: App.me, pub: App.ident.keys.pub });
  await sleep(250);
  await sendHost({ type: 'join', name: App.profile.name });
}

async function sendHost(obj) {
  if (!App.hostKey || !App.bus) return;
  const sealed = await net.seal(App.hostKey, obj);
  App.bus.publish('up', { t: 'm', pid: App.me, ...sealed });
}

async function onClientDn(data) {
  if (!data) return;
  if (data.t === 'reject') { toast(data.reason, 4000); store.del('last'); teardown(); return; }
  if (data.t === 'who') { clientHello(); return; }
  if (data.t !== 'm') return;
  let msg;
  try { msg = await net.unseal(App.hostKey, data); } catch (_) { return; }
  if (msg.type === 'haunt') { showHaunt(msg.from); return; }
  if (msg.type === 'lure') { showLure(msg.look); return; }
  if (msg.type === 'view') { App.lastViewAt = Date.now(); netBanner(null); App.screen = 'game'; applyView(msg.v); }
  else if (msg.type === 'error') {
    toast(msg.error, 3500);
    App.ui.busy = false;
    if (msg.fatal) { store.del('last'); teardown(); }
    else render();
  }
}

// "LOOK AT <name>": a Killer's lure, or one of the game's random phantom lures — the phone
// can't tell you which. Silent (no sound), just vibration, so the room hears nothing.
function showLure(look) {
  const v = App.view;
  if (!v || !v.me.alive || v.phase !== 'action') return;
  const p = v.players.find((x) => x.id === look);
  if (!p) return;
  const el = document.getElementById('lure');
  if (!el) return;
  const you = look === v.me.id;
  el.innerHTML = `<div class="lure-box">
      <div class="lure-eye">👁</div>
      <div class="lure-t">LOOK AT</div>
      ${av(p.id, p.name, 'xl')}
      <div class="lure-name">${you ? 'YOURSELF?!' : esc(p.name)}</div>
      <div class="lure-sub">The spirits demand it… look ${you ? 'around you' : `at ${esc(p.name)}`} now.</div>
      <div class="lure-bar"><i></i></div>
      <div class="small">Tap to close</div>
    </div>`;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(showLure._t);
  showLure._t = setTimeout(() => el.classList.remove('on'), 4500);
  vibrate([220, 90, 220, 90, 420]);
  fx.shake();
}
document.addEventListener('pointerdown', (e) => {
  const el = document.getElementById('lure');
  if (el && el.classList.contains('on') && el.contains(e.target)) el.classList.remove('on');
}, true);

function showHaunt(from) {
  const v = App.view;
  if (!v || !v.me.alive) return;
  const img = App.avatars[from];
  const el = document.getElementById('haunt');
  if (!el) return;
  const p = v.players.find((x) => x.id === from);
  el.style.backgroundImage = img ? `url('${img}')` : 'none';
  el.dataset.name = img ? '' : (p ? p.name : '');
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  fx.shake(); // iPhones can't vibrate from a website, so the screen shivers too
  vibrate([60, 50, 60, 50, 120]);
}

function teardown() {
  clearInterval(App.loop); clearInterval(App.beat);
  if (App.bus) App.bus.close();
  App.ghostSub = false;
  Object.assign(App, { mode: null, bus: null, game: null, view: null, viewKey: '', code: null, me: null, hostKey: null, phaseKey: '', lastSent: {}, keyP: {}, pubs: {}, seen: {} });
  sfx.stopAll();
  sfx.loop('lobby');
  netBanner(null);
  setScreen('home');
}

// ======================================================================
// ACTIONS (both modes)
// ======================================================================
function act(a) {
  if (App.mode === 'host') {
    const res = App.game.handle(App.me, a, Date.now(), engineCtx());
    if (!res.ok && res.error) toast(res.error);
    afterChange();
  } else {
    sendHost({ type: 'act', a });
  }
}

// ======================================================================
// VIEW APPLY + PHASE SOUNDS
// ======================================================================
function applyView(v) {
  if (!v) return;
  const prev = App.view;
  App.view = v;
  App.deadline = v.remaining != null && !v.paused ? Date.now() + v.remaining : null;
  App.pausedRemaining = v.paused ? v.remaining : null;
  const pk = `${v.gameNo}:${v.phase}:${v.round}`;
  if (pk !== App.phaseKey) {
    const before = App.phaseKey;
    App.phaseKey = pk;
    onPhase(v, prev, !before);
  }
  const { remaining, ...rest } = v;
  const key = JSON.stringify(rest);
  if (key !== App.viewKey) {
    App.viewKey = key;
    if (prev && prev.phase === 'lobby' && v.phase === 'lobby' && v.players.length > prev.players.length && App.mode === 'client') sfx.play('join', { vol: 0.6 });
    App.ui.busy = false;
    render();
  }
}

function onPhase(v, prev, first) {
  const ui = App.ui;
  ui.sel = null; ui.reportYes = false; ui.suspect = null; ui.shown = 0;
  if (v.phase !== 'reveal') ui.peeked = false;
  if (v.phase === 'lobby') { ui.notes = {}; afterlife.reset(); }
  if (v.gameNo && store.get('notes_game') !== `${v.code}:${v.gameNo}`) { store.set('notes_game', `${v.code}:${v.gameNo}`); ui.notes = {}; store.set('notes', {}); }
  else ui.notes = store.get('notes', {});
  sfx.stop('hb', 0.5);
  App.lastTickSec = null;
  switch (v.phase) {
    case 'lobby':
      fx.setTint([120, 10, 20]);
      sfx.loop('lobby');
      break;
    case 'reveal':
      fx.lightning(); sfx.play('start_game'); sfx.play('thunder', { vol: 0.6, delay: 0.3 });
      sfx.loop('ambience');
      break;
    case 'action':
      fx.lightning(); fx.setTint([150, 8, 18]);
      sfx.play('sting_action');
      sfx.play('shh', { delay: 1.6, vol: 0.9 });
      sfx.loop('tension', { vol: 0.9 });
      break;
    case 'report':
      fx.setTint([90, 30, 60]);
      sfx.play('tick_urgent'); sfx.play('report', { delay: 0.2 });
      sfx.loop('ambience');
      break;
    case 'validate':
      sfx.play('scan');
      break;
    case 'announce':
      if (!(v.announcement && v.announcement.items.length)) sfx.play('no_death');
      break;
    case 'discussion':
      fx.setTint([110, 20, 30]);
      sfx.play('discussion');
      sfx.loop('ambience');
      break;
    case 'over': {
      sfx.stop('music', 1.5);
      const r = v.result || {};
      const winS = r.winner === 'innocent' ? 'win_innocent' : r.winner === 'killer' ? 'win_killer' : 'no_death';
      if (r.reason && r.reason.startsWith('accuse')) { sfx.play('accuse'); sfx.play(winS, { delay: 2.7 }); setTimeout(() => { fx.lightning(); fx.shake(); }, 2700); }
      else { sfx.play(winS); fx.lightning(); }
      fx.setTint(r.winner === 'innocent' ? [40, 70, 140] : [160, 5, 15]);
      break;
    }
  }
}

// per-frame: timers, ticks, heartbeat, staged crime reports
function frame() {
  const v = App.view;
  if (v && App.screen === 'game') {
    const rem = App.deadline ? Math.max(0, App.deadline - Date.now()) : App.pausedRemaining;
    const sec = rem == null ? null : Math.ceil(rem / 1000);
    document.querySelectorAll('.timer').forEach((el) => {
      const total = Number(el.dataset.total) || 1;
      const fg = el.querySelector('.t-fg');
      const num = el.querySelector('.t-num');
      if (sec == null) { num.textContent = '—'; fg.style.strokeDashoffset = 0; return; }
      num.textContent = fmtSec(sec);
      fg.style.strokeDashoffset = String(201 * (1 - Math.min(1, rem / (total * 1000))));
      el.classList.toggle('urgent', sec <= 10 && ['action', 'discussion', 'report'].includes(v.phase));
    });
    if (sec != null && !v.paused && sec !== App.lastTickSec) {
      App.lastTickSec = sec;
      if (['action', 'discussion'].includes(v.phase) && sec <= 10 && sec > 0) sfx.play(sec <= 5 ? 'tick_urgent' : 'tick', { vol: 0.8 });
      if (v.phase === 'action' && sec <= 15 && sec > 0) sfx.loop('heartbeat', { slot: 'hb', vol: 0.9, fade: 0.3, rate: 1 + (15 - sec) / 12 });
    }
    if (v.phase === 'announce' && v.announcement) {
      const items = v.announcement.items.length;
      const total = 4000 + 9000 * items;
      const elapsed = total - (rem ?? 0);
      const shown = Math.min(items, elapsed < 1200 ? 0 : 1 + Math.floor((elapsed - 1200) / 9000));
      if (shown !== App.ui.shown) {
        App.ui.shown = shown;
        const it = v.announcement.items[shown - 1];
        if (it) {
          if (it.kind === 'death') { sfx.play('death'); fx.blood(); fx.shake(); vibrate([80, 60, 200]); }
          else if (it.kind === 'escape') { sfx.play('wink', { vol: 1 }); sfx.play('heartbeat', { delay: 0.6 }); sfx.play('heartbeat', { delay: 1.5 }); fx.lightning(); }
          else { sfx.play('curse'); fx.lightning(); fx.shake(); }
        }
        render();
      }
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ======================================================================
// RENDER
// ======================================================================
function setScreen(name, data = {}) { App.screen = name; App.screenData = data; render(); }

function render() {
  const el = $('#screen');
  const fn = { splash: rSplash, home: rHome, join: rJoin, profile: rProfile, connecting: rConnecting, game: rGame }[App.screen] || rHome;
  el.innerHTML = fn();
  paintAvatars();
  if (App.screen === 'game' && App.view && App.view.phase === 'lobby') drawQR();
  mountAfterlife();
}

function rSplash() {
  return `<div class="splash fade-in">
    <img class="eye-logo" src="assets/img/logo.svg" alt="">
    <div class="logo"><span class="flick">SILENT</span><span>KILLER</span></div>
    <div class="tagline">One wink. One death. One detective.<br>Who can you trust?</div>
    <button class="btn primary big block" data-act="enter">Enter… if you dare</button>
    <div class="small">Turn your sound on (and Silent mode off). Best played in a room full of liars.</div>
  </div>`;
}

function rHome() {
  const host = store.get('host');
  const last = store.get('last');
  const fresh = (x) => x && Date.now() - (x.savedAt || x.at || 0) < 8 * 3600e3;
  return `<div class="col fade-in" style="gap:18px;padding-top:30px">
    <img class="eye-logo" src="assets/img/logo.svg" alt="" style="width:96px;height:96px;margin:0 auto;display:block;filter:drop-shadow(0 0 20px rgba(255,20,40,.5))">
    <div class="logo"><span class="flick">SILENT</span><span>KILLER</span></div>
    <div class="tagline">One wink. One death. One detective. Who can you trust?</div>
    <div class="col" style="margin-top:10px">
      ${fresh(host) ? `<button class="btn primary big block" data-act="resumeHost">Resume hosting ${esc(host.code)}</button>` : ''}
      ${!fresh(host) && fresh(last) && !last.host ? `<button class="btn primary big block" data-act="rejoin">Rejoin ${esc(last.code)}</button>` : ''}
      <button class="btn ${fresh(host) || (fresh(last) && !last.host) ? '' : 'primary'} big block" data-act="create">🕯️ Create a lobby</button>
      <button class="btn big block" data-act="goJoin">🚪 Join a lobby</button>
      <button class="btn ghost block" data-act="rules">📜 How to play</button>
      <button class="btn ghost block" data-act="testSound">🔊 Test sound</button>
    </div>
    <div class="foot">5–20 players · everyone in the same room · one phone each</div>
  </div>`;
}

function rJoin() {
  return `<div class="col fade-in" style="gap:16px;padding-top:30px">
    <div class="title">Join a lobby</div>
    <div class="sub">Enter the 5-letter code shown on the host's phone.</div>
    <input id="codeIn" class="input code-input" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="•••••" value="${esc(App.screenData.code || '')}">
    <button class="btn primary big block" data-act="joinCode">Continue</button>
    <button class="btn ghost block" data-act="home">Back</button>
  </div>`;
}

function rProfile() {
  const d = App.screenData;
  const p = App.profile;
  return `<div class="col fade-in" style="gap:16px;padding-top:20px">
    <div class="title">${d.create ? 'Create a lobby' : 'Who are you?'}</div>
    <div class="sub">${d.create ? 'You will host the game — and still get a secret role.' : `Joining lobby <b class="type" style="color:var(--bone)">${esc(d.code)}</b>`}</div>
    <div class="card avatar-pick">
      <div class="av-wrap"><div class="av lg" id="myAv" data-act="pickGallery" ${p.avatar ? `style="background-image:url('${p.avatar}')"` : ''}>${p.avatar ? '' : '📷'}</div></div>
      <div class="row" style="width:100%">
        <button class="btn grow sm" data-act="pickCamera">📸 Take photo</button>
        <button class="btn grow sm" data-act="pickGallery">🖼️ Gallery</button>
      </div>
      <div class="small">…or pick a mask</div>
      <div class="presets">${PRESETS.map((e) => `<button class="preset" data-act="preset" data-e="${e}">${e}</button>`).join('')}</div>
    </div>
    <div>
      <div class="label">Your name</div>
      <input id="nameIn" class="input" maxlength="18" placeholder="Enter your name" value="${esc(p.name)}" autocomplete="nickname">
    </div>
    <button class="btn primary big block" data-act="${d.create ? 'doCreate' : 'doJoin'}">${d.create ? 'Open the lobby' : 'Enter the lobby'}</button>
    <button class="btn ghost block" data-act="home">Back</button>
  </div>`;
}

function rConnecting() {
  return `<div class="splash fade-in">
    <img class="eye-logo" src="assets/img/logo.svg" alt="">
    <div class="type" style="font-size:18px">${esc(App.screenData.msg || 'Connecting…')}</div>
    <button class="btn ghost" data-act="cancelConnect">Cancel</button>
  </div>`;
}

// ---------------------------------------------------------------- game
const P = (id) => App.view.players.find((p) => p.id === id);
const isHost = () => App.view && App.view.me.isHost;

function timerHTML(total) {
  return `<div class="timer" data-total="${total}"><svg viewBox="0 0 74 74"><circle class="t-bg" cx="37" cy="37" r="32" fill="none" stroke-width="5"/><circle class="t-fg" cx="37" cy="37" r="32" fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray="201" stroke-dashoffset="0"/></svg><div class="t-num">—</div></div>`;
}
function phaseTotal(v) {
  const s = v.settings;
  return { reveal: s.revealSec, action: s.actionSec, report: s.reportSec, validate: 4.5, announce: v.announcement ? (v.announcement.items.length ? 4 + 9 * v.announcement.items.length : 5.5) : 5.5, discussion: s.discussionSec }[v.phase] || 1;
}

function hud(v) {
  const [t1] = PHASE[v.phase];
  const alive = v.players.filter((p) => p.alive).length;
  const sub = v.phase === 'over' ? `Game over · ${v.round} round${v.round === 1 ? '' : 's'}` : v.phase === 'lobby' ? `${v.players.length}/${MAX_PLAYERS} players` : `Round ${v.round || 1} · ${alive} alive · ${v.killersAlive} killer${v.killersAlive === 1 ? '' : 's'} left`;
  return `<div class="row">
      <button class="icon-btn" data-act="role" title="My role" aria-label="My secret role">👁️</button>
      <button class="icon-btn" data-act="archive" title="Crime Archive" aria-label="Crime archive">📁</button>
      <div class="spacer"></div>
      <button class="icon-btn" data-act="mute" aria-label="Sound">${sfx.muted ? '🔇' : '🔊'}</button>
      <button class="icon-btn" data-act="menu" aria-label="Menu">☰</button>
    </div>
    <div class="hud">
      <div class="phase"><div class="p1 glitch">${t1}</div><div class="p2">${sub}</div></div>
      ${v.phase === 'over' ? '' : timerHTML(phaseTotal(v))}
    </div>
    ${v.paused ? '<div class="paused-banner">⏸ Game paused by host</div>' : ''}`;
}

function rGame() {
  const v = App.view;
  if (!v) return rConnecting();
  if (v.phase === 'lobby') return rLobby(v);
  const body = { reveal: rReveal, action: rAction, report: rReport, validate: rValidate, announce: rAnnounce, discussion: rDiscussion, over: rOver }[v.phase];
  return `${v.phase !== 'over' ? '<div class="drip"></div>' : ''}${hud(v)}${body(v)}`;
}

function rLobby(v) {
  const host = isHost();
  const n = v.players.length;
  const c = roleCounts(Math.max(n, 1), v.settings);
  const min = v.settings.minPlayers;
  const link = inviteLink();
  return `<div class="drip"></div>
  <div class="row"><button class="btn sm ghost" data-act="testSound">🔊 Test sound</button><div class="spacer"></div><button class="icon-btn" data-act="mute">${sfx.muted ? '🔇' : '🔊'}</button><button class="icon-btn" data-act="rules">📜</button></div>
  <div class="logo" style="font-size:34px"><span class="flick">SILENT KILLER</span></div>
  <div class="card blood code-box">
    <div class="label">Lobby code</div>
    <div class="code-big">${esc(v.code)}</div>
    <div class="qr" id="qr"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn grow sm" data-act="share">📤 Share invite</button>
      <button class="btn grow sm" data-act="copy">🔗 Copy link</button>
    </div>
    <div class="small" style="margin-top:8px;word-break:break-all">${esc(link)}</div>
  </div>
  <div class="card">
    <h3>Victims gathered (${n}/${MAX_PLAYERS})</h3>
    <div class="plist">${v.players.map((p) => `<div class="prow">
        ${av(p.id, p.name)}
        <div class="name">${esc(p.name)}</div>
        ${p.id === v.me.id ? '<span class="tag you">You</span>' : ''}
        ${p.id === v.hostId ? '<span class="tag host">Host</span>' : ''}
        <span class="dot ${p.online ? '' : 'off'}" title="${p.online ? 'online' : 'offline'}"></span>
        ${host && p.id !== v.me.id ? `<button class="icon-btn" style="width:34px;height:34px" data-act="kick" data-id="${esc(p.id)}" aria-label="Remove">✕</button>` : ''}
      </div>`).join('')}</div>
    ${!host ? `<div class="row" style="margin-top:12px"><button class="btn grow sm" data-act="editProfile">✏️ Edit profile</button><button class="btn grow sm danger" data-act="leave">Leave</button></div>` : `<div class="row" style="margin-top:12px"><button class="btn grow sm" data-act="editProfile">✏️ Edit my profile</button>${DEV ? '<button class="btn grow sm" data-act="addBot">🤖 Add bot</button>' : ''}</div>`}
  </div>
  <div class="card">
    <h3>Role distribution</h3>
    <div class="stats3">
      <div class="stat"><b style="color:var(--blood-hi)">${c.killers}</b><span>Killer${c.killers > 1 ? 's' : ''}</span></div>
      <div class="stat"><b style="color:var(--police)">1</b><span>Police</span></div>
      <div class="stat"><b>${Math.max(0, n - c.killers - 1)}</b><span>Netizens</span></div>
    </div>
    <div class="small" style="margin-top:8px">Roles are dealt randomly. The host gets a secret role too and cannot see anyone else's.</div>
  </div>
  ${rSettings(v, host)}
  ${host ? `<button class="btn primary big block" data-act="start" ${n < min ? 'disabled' : ''}>${n < min ? `Need ${min - n} more player${min - n > 1 ? 's' : ''}` : '🩸 Start the game'}</button>
            <button class="btn ghost block danger" data-act="closeLobby">Close lobby</button>`
    : `<div class="card center type">Waiting for the host to begin the ritual…</div>`}
  `;
}

function rSettings(v, host) {
  const s = v.settings;
  const n = v.players.length;
  const chip = (on, act, val, label, dis = false) => `<button class="chip ${on ? 'on' : ''}" ${host && !dis ? `data-act="${act}" data-v="${val}"` : 'disabled'}>${label}</button>`;
  const killerOpts = ['auto', 1, 2, 3];
  const mk = maxKillers(Math.max(n, 5));
  return `<div class="card">
    <h3>Game settings ${host ? '' : '<span class="small">(set by host)</span>'}</h3>
    <div class="label">Game mode</div>
    <div class="chips">${Object.entries(MODES).map(([k, m]) => chip(s.mode === k, 'mode', k, m.label)).join('')}</div>
    <div class="label" style="margin-top:14px">Action phase</div>
    <div class="chips">${[30, 60, 90, 120].map((x) => chip(s.actionSec === x, 'actionSec', x, durLabel(x))).join('')}${chip(![30, 60, 90, 120].includes(s.actionSec), 'customAction', 0, ![30, 60, 90, 120].includes(s.actionSec) ? durLabel(s.actionSec) : 'Custom')}</div>
    <div class="label" style="margin-top:14px">Discussion phase</div>
    <div class="chips">${[60, 90, 120, 180].map((x) => chip(s.discussionSec === x, 'discussionSec', x, durLabel(x))).join('')}${chip(![60, 90, 120, 180].includes(s.discussionSec), 'customDiscussion', 0, ![60, 90, 120, 180].includes(s.discussionSec) ? durLabel(s.discussionSec) : 'Custom')}</div>
    <div class="label" style="margin-top:14px">Report time limit</div>
    <div class="chips">${[30, 45, 60, 90].map((x) => chip(s.reportSec === x, 'reportSec', x, durLabel(x))).join('')}</div>
    <div class="label" style="margin-top:14px">Killers</div>
    <div class="chips">${killerOpts.map((k) => chip(String(s.killers) === String(k), 'killers', k, k === 'auto' ? 'Auto' : String(k), k !== 'auto' && k > mk)).join('')}</div>
    <div class="label" style="margin-top:14px">Police wins by naming</div>
    <div class="chips">${chip(s.accuseRule === 'any', 'accuseRule', 'any', 'Any one Killer')}${chip(s.accuseRule === 'all', 'accuseRule', 'all', 'Every living Killer')}</div>
    <div class="switch" style="margin-top:12px"><div><div style="font-weight:600">Skip discussion after a quiet round</div><div class="small">No body → straight to the next Action Phase</div></div><div class="toggle ${s.skipQuietDiscussion ? 'on' : ''} ${host ? '' : 'disabled'}" ${host ? 'data-act="toggleQuiet"' : ''}></div></div>
    <div class="switch"><div><div style="font-weight:600">Killer lures</div><div class="small">A Killer can make their target's phone say "LOOK AT…" (with random fake lures for cover)</div></div><div class="toggle ${s.lures !== false ? 'on' : ''} ${host ? '' : 'disabled'}" ${host ? 'data-act="toggleLures"' : ''}></div></div>
    <div class="switch"><div><div style="font-weight:600">Ghosts can haunt the living</div><div class="small">A dead player's ghost makes your screen flash their face + vibrate</div></div><div class="toggle ${s.ghostHaunt !== false ? 'on' : ''} ${host ? '' : 'disabled'}" ${host ? 'data-act="toggleHaunt"' : ''}></div></div>
    <div class="switch"><div><div style="font-weight:600">Special roles</div><div class="small">Doctor, Informant, Jester… coming soon</div></div><div class="toggle disabled"></div></div>
  </div>`;
}

function drawQR() {
  const el = $('#qr');
  if (!el || !window.qrcode) return;
  try {
    const q = window.qrcode(0, 'M');
    q.addData(inviteLink());
    q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (_) { el.remove(); }
}
function inviteLink() {
  const b = App.bus ? App.bus.brokerIdx : 0;
  return `${location.origin}${location.pathname}?join=${App.code}${b ? '&b=' + b : ''}`;
}

function roleCard(v) {
  const r = v.me.role;
  if (!r) return '';
  const info = ROLE_INFO[r];
  let extra = '';
  if (r === ROLE.KILLER) {
    const mates = v.players.filter((p) => p.role === ROLE.KILLER && p.id !== v.me.id);
    extra = mates.length ? `Your fellow Killer${mates.length > 1 ? 's' : ''}: <b>${mates.map((m) => esc(m.name)).join(', ')}</b><br>` : 'You hunt alone.<br>';
    extra += `Kill at least once every ${CURSE_LIMIT} rounds or the curse takes you. Police can't be killed.`;
  }
  if (r === ROLE.POLICE) extra = v.settings.accuseRule === 'all' ? `You must name <b>every living Killer</b> at once.` : `Name any one Killer to win.`;
  if (r === ROLE.NETIZEN) extra = 'If you are killed, you must stay completely silent.';
  return `<div class="role-card ${r}">${ICON[r]}<div class="small" style="letter-spacing:.2em;text-transform:uppercase">You are the</div><div class="r-name">${info.name}</div><div class="r-goal">${info.goal}</div><div class="r-extra">${extra}</div></div>`;
}

function holdCard(v) {
  return `<div class="hold" data-hold="role"><div class="hold-hint"><span class="eye">👁️</span><b>Press &amp; hold to see your role</b><br><span class="small">Shield your screen. Release to hide.</span></div></div>`;
}

function rReveal(v) {
  const rp = v.readyProgress || { done: 0, total: 0 };
  return `<div class="title">Your secret role</div>
    ${holdCard(v)}
    ${v.me.ready ? `<div class="card center type">Waiting for the others… (${rp.done}/${rp.total} ready)</div>`
      : `<button class="btn primary big block" data-act="ready">I know my role — I'm ready</button>`}
    ${isHost() ? `<button class="btn ghost block" data-act="skip">Start Round 1 now</button>` : ''}
    <div class="small center">You can peek at your role again any time with the 👁️ button.</div>`;
}

function afterlifeCard() {
  return `<div class="card afterlife"><div class="row"><h3 style="margin:0">👻 The Afterlife</h3><div class="spacer"></div><span class="small" id="hauntCount"></span></div>
    <div id="afterlife" class="afterlife-box"></div>
    <div class="small">Drag your ghost and touch a living player's name to haunt them${App.view && App.view.settings.ghostHaunt !== false ? ' — their screen flickers with your face and their phone shivers' : ''}. Only the dead see this playground. Still no talking!</div></div>`;
}

function mountAfterlife() {
  const box = document.getElementById('afterlife');
  const v = App.view;
  if (!box || !v) return;
  afterlife.update({
    name: v.me.name,
    living: v.players.filter((p) => p.alive),
    dead: v.players.filter((p) => !p.alive && p.id !== v.me.id),
  });
  afterlife.onMove = (x, y) => App.bus && App.bus.publish('gh/' + App.me, { x, y }, { qos: 0 });
  afterlife.onHaunt = (targetId) => {
    vibrate(12);
    if (App.view.settings.ghostHaunt === false) return;
    if (App.mode === 'host') hostHaunt(App.me, targetId);
    else sendHost({ type: 'haunt', target: targetId });
  };
  if (!App.ghostSub && App.bus) {
    App.ghostSub = true;
    App.bus.subscribe('gh/+', (d, id) => { if (d && id !== App.me && App.view && !App.view.me.alive) afterlife.remote(id, d.x, d.y); });
  }
  afterlife.attach(box);
}

function deadBox(v) {
  return `<div class="dead-box"><div class="d-t">You are dead</div>
    <div class="type">${v.me.cause === 'curse' ? 'The curse consumed you.' : 'Someone winked. You fell.'}</div>
    <p class="small">Stay completely silent. No hints, no looks, no reactions. You may watch until the end.</p></div>`;
}

function grid(list, { selected = [], disabled = () => false, marks = true, act = 'cell' } = {}) {
  const notes = App.ui.notes || {};
  return `<div class="pgrid">${list.map((p) => {
    const sel = selected.includes(p.id);
    const dis = disabled(p);
    const m = notes[p.id];
    const mark = p.role === ROLE.KILLER && p.id !== App.view.me.id ? '<span class="mark mk">🔪</span>' : marks && m === 1 ? '<span class="mark m1">?</span>' : marks && m === 2 ? '<span class="mark m2">✓</span>' : '';
    return `<div class="pcell ${sel ? 'sel' : ''} ${dis ? 'disabled' : ''} ${!p.alive ? 'deadc' : ''}" data-act="${act}" data-id="${esc(p.id)}">${mark}${av(p.id, p.name, p.alive ? '' : 'dead')}<div class="nm">${p.marked && p.alive ? '👁 ' : ''}${esc(p.name)}</div></div>`;
  }).join('')}</div>`;
}

function rAction(v) {
  const me = v.me;
  if (!me.alive) return deadBox(v) + afterlifeCard() + rRoster(v);
  const others = v.players.filter((p) => p.id !== me.id && p.alive);
  if (me.role === ROLE.KILLER) {
    if (me.target) {
      // Deliberately looks like everyone else's screen so nobody can spot the Killer's phone from afar.
      const t = P(me.target);
      return `${silenceBanner()}<div class="card"><h3>Mark your suspects</h3><div class="small" style="margin-bottom:10px">🔒 Locked: <b>${esc(t.name)}</b> — now wink at them. Failed rounds: ${me.failed}/${me.curseLimit}</div>
        ${grid(others, { marks: true })}</div>
        ${v.settings.lures !== false ? (me.lure
          ? `<div class="small center">🧲 Lure used: ${esc(t.name)} was told to look at <b>${me.lure === me.id ? 'you' : esc(P(me.lure)?.name)}</b>.</div>`
          : `<button class="btn block" data-act="lureOpen">🧲 Lure ${esc(t.name)} — make them look at someone</button>`) : ''}
        ${roleTip('killer', t.name)}`;
    }
    return `${silenceBanner()}<div class="card"><h3>Choose your target</h3><div class="small" style="margin-bottom:10px">Tap a face, then lock it. One target per round — you can't change it.</div>
      ${grid(others, { selected: [App.ui.sel], disabled: (p) => p.role === ROLE.KILLER, marks: true })}</div>
      ${roleTip('killer')}
      <button class="btn primary big block" data-act="lock" ${App.ui.sel ? '' : 'disabled'}>${App.ui.sel ? `Lock ${esc(P(App.ui.sel)?.name || '')}` : 'Select a target'}</button>
      <div class="small center">Failed rounds in a row: ${me.failed}/${me.curseLimit}${me.failed >= me.curseLimit - 1 ? ' — <b style="color:var(--blood-hi)">the curse is near</b>' : ''}</div>`;
  }
  return `${silenceBanner()}<div class="card"><h3>Mark your suspects</h3><div class="small" style="margin-bottom:10px">Tap faces to note them: ? suspicious · ✓ trusted. Private to you.</div>
    ${grid(others, { marks: true })}</div>
    ${roleTip(me.role)}`;
}

// What to do this Action Phase, depending on your secret role.
function roleTip(role, targetName) {
  const tips = {
    killer: targetName
      ? `🔪 <b>Your move.</b> Use 🧲 <b>Lure</b> to make ${esc(targetName)} look at you (or at a decoy). Mingle silently and <b>wink at ${esc(targetName)}</b> to kill them. Make it quick — if anyone, especially the Police, catches your wink, you're exposed.<br><span class="small">After the timer you confirm: "YES, I winked at ${esc(targetName)}".</span>`
      : `🔪 <b>Pick your victim</b>, lock them, then mingle silently and <b>wink at them</b> to kill. Don't let anyone catch you winking.`,
    police: `🔎 <b>You are the detective.</b> Mingle silently and <b>watch everyone's eyes</b>. Catch the person who winks at others. You can't be killed. When you're sure, open 👁️ → <b>Accuse</b> — you only get one chance.`,
    netizen: `👀 <b>Survive.</b> Mingle silently and watch the eyes. If your phone says "LOOK AT…", look — it might be a Killer's lure, or just the spirits playing tricks. If someone winks at you: <b>stay calm, don't react, don't say anything</b>. Remember who it was and report it when the timer ends.`,
  };
  return `<div class="card type center tip" style="font-size:14px">${tips[role] || tips.netizen}</div>`;
}

function silenceBanner() {
  return `<div class="silence"><span class="sh">🤫</span><div><b>SILENCE.</b> Mingle and make eye contact — <b>no talking</b> until the Discussion Phase.</div></div>`;
}

function rReport(v) {
  const me = v.me;
  const rp = v.reportProgress || { done: 0, total: 0, pending: [] };
  const progress = `<div class="card"><div class="label">Reports sealed: ${rp.done}/${rp.total}</div>
    <div style="height:8px;border-radius:4px;background:rgba(255,255,255,.07);overflow:hidden"><div style="height:100%;width:${rp.total ? (rp.done / rp.total) * 100 : 0}%;background:var(--blood-hi)"></div></div>
    ${rp.pending.length ? `<div class="pending-names" style="margin-top:8px">Waiting for: ${rp.pending.map((id) => esc(P(id)?.name)).join(', ')}</div>` : ''}</div>`;
  if (!me.alive) return deadBox(v) + afterlifeCard() + progress;
  const confirming = me.role === ROLE.KILLER;
  if (confirming && !me.target) {
    if (me.myReport) return `<div class="card center"><div class="horror" style="font-size:28px">Report sealed</div><p class="type">You didn't lock a target, so you didn't wink at anyone this round.</p><div class="small">Failed rounds in a row: ${me.failed + 1}/${me.curseLimit}</div></div>${progress}`;
    return `<div class="bigq">Did you wink at<br>anyone?</div>
      <div class="yesno">
        <button class="btn" disabled><span class="ic">😉</span>YES,<br>I winked at…</button>
        <button class="btn" data-act="confirmNo" ${App.ui.busy ? 'disabled' : ''}><span class="ic">😐</span>NO,<br>I didn't wink</button>
      </div>
      <div class="small center">You didn't lock a target this round, so there is no kill. This counts as a failed round.</div>${progress}`;
  }
  if (me.myReport && confirming) {
    return `<div class="card center"><div class="horror" style="font-size:28px">Report sealed</div>
      <p class="type">${me.myReport.confirm ? `You confirmed you winked at <b>${esc(P(me.target)?.name)}</b>.` : 'You said you did not manage to wink this round.'}</p>
      <div class="small">Reports are private and cannot be changed.</div></div>${progress}`;
  }
  if (confirming) {
    const nm = esc(P(me.target)?.name);
    return `<div class="bigq">Did you wink at<br>${nm}?</div>
      <div class="yesno">
        <button class="btn" data-act="confirmYes" ${App.ui.busy ? 'disabled' : ''}><span class="ic">😉</span>YES,<br>I winked at ${nm}</button>
        <button class="btn" data-act="confirmNo" ${App.ui.busy ? 'disabled' : ''}><span class="ic">😐</span>NO,<br>I didn't wink</button>
      </div>
      <div class="small center">Only YES kills. A NO counts as a failed round (${me.failed}/${me.curseLimit}).</div>${progress}`;
  }
  if (me.myReport) {
    return `<div class="card center"><div class="horror" style="font-size:28px">Report sealed</div>
      <p class="type">${me.myReport.winked ? `You reported a wink from <b>${esc(P(me.myReport.suspect)?.name)}</b>.` : 'You reported that nobody winked at you.'}</p>
      <div class="small">Reports are private and cannot be changed.</div></div>${progress}`;
  }
  if (App.ui.reportYes) {
    const others = v.players.filter((p) => p.id !== me.id && p.alive);
    return `<div class="bigq">Who winked at you?</div>
      ${grid(others, { selected: [App.ui.suspect], act: 'suspect', marks: true })}
      <button class="btn primary big block" data-act="sealYes" ${App.ui.suspect && !App.ui.busy ? '' : 'disabled'}>${App.ui.suspect ? `Seal report: ${esc(P(App.ui.suspect)?.name)} winked at me` : 'Choose who winked'}</button>
      <button class="btn ghost block" data-act="reportBack">Back</button>${progress}`;
  }
  return `<div class="bigq">Were you winked at<br>this round?</div>
    <div class="yesno">
      <button class="btn" data-act="reportYes"><span class="ic">😉</span>YES,<br>I was winked at</button>
      <button class="btn" data-act="sealNo" ${App.ui.busy ? 'disabled' : ''}><span class="ic">😐</span>NO,<br>nobody winked</button>
    </div>
    <div class="small center">Be honest. False reports are recorded as warnings.</div>
    ${me.role === ROLE.POLICE ? '<div class="small center">🔎 Saw someone wink at another player? Keep it in mind for the Discussion — or accuse via 👁️.</div>' : ''}${progress}`;
}

function rValidate() {
  return `<div class="scan"><div class="scan-txt">Cross-checking every report<br>against the secret crime records…</div></div>
    <div class="small center type">The truth does not depend on what you claim.</div>`;
}

function crimeCard(it, v) {
  const p = P(it.pid) || { id: it.pid, name: '?' };
  if (it.kind === 'escape') {
    return `<div class="crime escape"><div class="c-head"><span>INCIDENT REPORT</span><span>ROUND ${it.round || (v.announcement && v.announcement.round)}</span></div>
      <div class="c-victim">👁 Someone winked at ${esc(p.name)}</div>
      <div class="c-title">A Narrow Escape</div>
      <div class="c-body"><div class="c-photo">${av(p.id, p.name)}</div>
      <div class="c-text">At ${esc(it.time || '')}, a Killer winked at <b>${esc(p.name)}</b>… but ${esc(p.name)} didn't notice. The wink missed its mark — this time. <b>${esc(p.name)} is now marked: the next wink will be fatal.</b></div></div>
      <div class="stamp">MARKED</div></div>`;
  }
  if (it.kind === 'curse') {
    return `<div class="crime curse"><div class="c-head"><span>CRIME ARCHIVE</span><span>ROUND ${v.announcement ? v.announcement.round : it.round}</span></div>
      <div class="c-title">Consumed by the Curse</div>
      <div class="c-body"><div class="c-photo">${av(p.id, p.name)}</div>
      <div class="c-text"><b>${esc(p.name)}</b> was a <b style="color:#ff3b48">KILLER</b>. They failed to claim a victim for ${CURSE_LIMIT} rounds in a row, and the darkness took them back.</div></div>
      <div class="stamp">EXPOSED</div></div>`;
  }
  return `<div class="crime"><div class="c-head"><span>CRIME SCENE REPORT</span><span>ROUND ${it.round || (v.announcement && v.announcement.round)} · ${esc(it.sid)}</span></div>
    <div class="c-victim">☠ ${esc(p.name)} has been found dead</div>
    <div class="c-title">${esc(it.title)}</div>
    <div class="c-body"><div class="c-photo">${av(p.id, p.name)}</div><div class="c-text">${esc(it.text)}</div></div>
    <div class="c-meta"><b>Victim</b><span>${esc(p.name)}</span><b>Location</b><span>${esc(it.location)}</span><b>Time</b><span>${esc(it.time)}</span></div>
    <div class="stamp">DECEASED</div></div>`;
}

function rAnnounce(v) {
  const a = v.announcement || { items: [] };
  const warn = v.me.warnedThisRound ? `<div class="warning-box">⚠️ <b>Private notice:</b> your report did not match the crime records. A warning has been logged (${v.me.warnings} total).</div>` : '';
  if (!a.items.length) {
    return `${!v.me.alive ? afterlifeCard() : ''}<div class="quiet card"><div class="q-ic">🕯️</div><div class="horror" style="font-size:32px">No bodies found</div><p class="type">The night passes quietly… this time.</p></div>${warn}`;
  }
  const shown = a.items.slice(0, App.ui.shown);
  const iDied = a.items.some((it) => it.pid === v.me.id);
  return `${shown.length ? '' : '<div class="scan" style="height:120px"><div class="scan-txt">A body has been found…</div></div>'}
    ${shown.slice().reverse().map((it) => crimeCard({ ...it, round: a.round }, v)).join('')}
    ${iDied && shown.some((it) => it.pid === v.me.id) ? deadBox(v) : ''}${!v.me.alive && !iDied ? afterlifeCard() : ''}${warn}`;
}

function rDiscussion(v) {
  const deaths = (v.announcement && v.announcement.items) || [];
  return `${!v.me.alive ? deadBox(v) + afterlifeCard() : `<div class="card center type">🗣️ <b>Now you may talk.</b> Share what you saw and who you suspect.<br><b>The dead may not speak.</b></div>`}
    ${v.me.warnedThisRound ? `<div class="warning-box">⚠️ Your last report was flagged. Warnings: ${v.me.warnings}</div>` : ''}
    ${deaths.length ? `<div class="card"><h3>This round</h3>${deaths.map((it) => `<div class="prow">${av(it.pid, P(it.pid)?.name, it.kind === 'escape' ? '' : 'dead')}<div class="stack"><span class="name">${esc(P(it.pid)?.name)}</span><span class="small">${it.kind === 'curse' ? 'Cursed Killer' : it.kind === 'escape' ? '👁 Winked at, did not notice — marked' : esc(it.title)}</span></div></div>`).join('')}</div>` : ''}
    ${rRoster(v)}
    ${isHost() ? `<button class="btn block" data-act="skip">⏭ End discussion now</button>` : ''}`;
}

function rRoster(v) {
  const alive = v.players.filter((p) => p.alive && p.id !== v.me.id);
  const dead = v.players.filter((p) => !p.alive);
  return `<div class="card"><h3>The living (${v.players.filter((p) => p.alive).length})</h3>${grid(alive, { marks: true })}
    ${dead.length ? `<div class="label" style="margin-top:14px">The dead</div>${grid(dead, { marks: false })}` : ''}</div>`;
}

function reasonText(r, v) {
  const acc = r.accusation;
  const names = acc ? acc.targets.map((id) => esc(P(id)?.name)).join(' & ') : '';
  const by = acc ? esc(P(acc.by)?.name) : '';
  return {
    accuse_right: `Police officer <b>${by}</b> accused <b>${names}</b> — and was right.`,
    accuse_wrong: `Police officer <b>${by}</b> accused <b>${names}</b>… an innocent. The Killers walk free.`,
    curse: 'Every Killer failed to kill for three rounds and was consumed by the curse.',
    massacre: 'Not a single Netizen survived.',
    aborted: 'The host ended the game early.',
  }[r.reason] || '';
}

function rOver(v) {
  const r = v.result || {};
  const cls = r.winner || '';
  const title = r.winner === 'innocent' ? 'Innocents win' : r.winner === 'killer' ? 'Killers win' : 'Game ended';
  const mineWon = r.winner && ((r.winner === 'killer') === (v.me.role === ROLE.KILLER));
  const stats = Object.fromEntries((r.stats || []).map((s) => [s.id, s]));
  const order = { killer: 0, police: 1, netizen: 2 };
  const ppl = v.players.slice().sort((a, b) => order[a.role] - order[b.role]);
  const hist = (r.history || []).map((h) => {
    const lines = Object.entries(h.killerResults || {}).map(([k, kr]) => {
      const kn = esc(P(k)?.name);
      if (!kr.target) return `🔪 ${kn} chose no target`;
      const tp = P(kr.target);
      const how = !kr.confirmed ? '→ never confirmed a wink (no kill)' : kr.escaped ? `→ winked, but ${esc(tp?.name)} didn't notice (escaped once)` : h.deaths.includes(kr.target) ? '→ winked → <b style="color:var(--blood-hi)">killed</b>' : tp && tp.role === ROLE.POLICE ? '→ winked, but the Police is immune' : '→ survived';
      return `🔪 ${kn} targeted ${esc(tp?.name)} ${how}`;
    });
    Object.entries(h.lures || {}).forEach(([k, look]) => lines.push(`🧲 ${esc(P(k)?.name)} lured ${esc(P(h.targets[k])?.name)} to look at ${k === look ? 'the Killer themself' : esc(P(look)?.name)}`));
    h.curses.forEach((c) => lines.push(`☠️ ${esc(P(c)?.name)} was consumed by the curse`));
    if (h.warnings.length) lines.push(`⚠️ False reports: ${h.warnings.map((w) => esc(P(w)?.name)).join(', ')}`);
    return `<div class="tl-round"><b>Round ${h.n}</b><br>${lines.join('<br>') || 'Nothing happened.'}</div>`;
  }).join('');
  return `<div class="winner ${cls}"><div class="w-t">${title}</div>
      ${r.winner ? `<div class="type" style="margin-top:8px;font-size:18px">${mineWon ? 'You won.' : 'You lost.'}</div>` : ''}
      <p class="type">${reasonText(r, v)}</p></div>
    <div class="card"><h3>The truth</h3><div class="plist">${ppl.map((p) => `<div class="prow">${av(p.id, p.name, p.alive ? '' : 'dead')}<div class="name">${esc(p.name)}${p.id === v.me.id ? ' (you)' : ''}</div>
      ${stats[p.id] && stats[p.id].warnings ? `<span class="tag" title="False reports">⚠ ${stats[p.id].warnings}</span>` : ''}
      <span class="tag ${p.role}">${ROLE_INFO[p.role]?.name || '?'}</span></div>`).join('')}</div></div>
    ${hist ? `<div class="card"><h3>What really happened</h3><div class="timeline">${hist}</div></div>` : ''}
    ${isHost() ? `<button class="btn primary big block" data-act="toLobby">🔁 Play again (same players)</button><button class="btn ghost block danger" data-act="closeLobby">Close lobby</button>`
      : `<div class="card center type">Waiting for the host to start another game…</div><button class="btn ghost block" data-act="leave">Leave</button>`}`;
}

// ======================================================================
// MODALS
// ======================================================================
function openModal(html, { onClose } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="backdrop" data-act="closeModal"></div><div class="sheet"><div class="grab"></div>${html}</div>`;
  m.classList.add('open');
  App.modalClose = onClose;
}
function closeModal() {
  const m = $('#modal');
  m.classList.remove('open'); m.innerHTML = '';
  if (App.modalClose) { const f = App.modalClose; App.modalClose = null; f(); }
}

function rulesHTML() {
  return `<div class="title">How to play</div><div class="rules">
  <h4>The idea</h4><p>Everyone is in the same room with their own phone. One (or more) of you is a <b>Killer</b> who kills by <b>winking</b>. One of you is the <b>Police</b>. Everyone else is a <b>Netizen</b>.</p>
  <h4>Each round</h4><ul>
    <li><b>Action — in silence:</b> mingle and make eye contact, but <b>no talking</b>. The Killer secretly locks ONE target on their phone, then winks at that person. If you get winked at, stay silent and don't react — remember who it was.</li>
    <li><b>Report:</b> everyone answers "Were you winked at?" — and if yes, names who did it. A Killer who locked a target instead confirms: "Did you wink at them?"</li>
    <li><b>Validation:</b> the game checks reports against the Killers' locked targets.</li>
    <li><b>Crime Scene:</b> victims are announced with a fictional incident. The Killer is never revealed.</li>
    <li><b>Discussion:</b> argue, accuse, survive. The dead stay silent.</li></ul>
  <h4>Lures 🧲</h4><p>After locking a target, a Killer may <b>lure</b> them once per round: the target's phone vibrates and shows <b>"LOOK AT …"</b> with someone's face — the Killer himself (to get eye contact for the wink) or anyone else as a decoy. The game also sends <b>random fake lures</b> to random players every round, so a "LOOK AT" prompt never proves who the Killer is. When you get one: look, but stay silent.</p>
  <h4>Didn't notice the wink?</h4><p>If the Killer confirms the wink but the victim answered "nobody winked at me", the victim <b>escapes once</b>. Everyone is told that someone winked at them and they didn't notice, and they are marked 👁. The next confirmed wink on a marked player kills them for sure. A victim who answers YES dies right away.</p>
  <h4>How a kill works</h4><p>A kill needs two things from the Killer's phone: the target <b>locked</b> during the Action Phase, and the Killer <b>confirming "YES, I winked at them"</b> in the Report Phase. Then the victim dies — even if they missed the wink, said nobody winked at them, or named the wrong person. If the Killer answers NO (couldn't wink in time), nobody dies and it counts as a failed round. Winking at anyone you didn't lock is only a bluff.</p>
  <h4>Immune</h4><p>The Police and other Killers cannot be killed. A Killer who locks the Police wastes the round.</p>
  <h4>The curse</h4><p>Every Killer must kill at least once every ${CURSE_LIMIT} rounds. Three failed rounds in a row and that Killer is consumed — and revealed. A round with no locked target counts as a failure.</p>
  <h4>False reports</h4><p>Saying YES when no Killer targeted you gets a private warning. Warnings only depend on whether you were targeted — never on who you named — so reports can't be used to test people.</p>
  <h4>The accusation</h4><p>The Police has ONE accusation, usable any time (open 👁️ → Accuse). Right: innocents win. Wrong: Killers win. With several Killers the host picks the rule: name <i>any one</i> Killer, or <i>every living</i> Killer at once.</p>
  <h4>Winning</h4><ul><li><b>Innocents:</b> Police names a Killer correctly, or every Killer is consumed by the curse.</li><li><b>Killers:</b> every Netizen is dead, or the Police accuses wrongly.</li></ul>
  <h4>The dead</h4><p>Eliminated players must stay silent. Their phone opens <b>The Afterlife</b>: drag your ghost and touch living players' names to haunt them — the haunted player's screen flickers with the ghost's face and their phone vibrates (the host can turn this off).</p>
  <h4>Fair play</h4><ul><li>Phones only make sounds that everyone hears at the same moment — locking a target and warnings are silent.</li><li>Hold the 👁️ card to peek at your role; shield your screen.</li><li>If someone's report times out, the game moves on — kills still follow the locked targets.</li><li>No one can join after the game starts. Lost connection? Reopen the link — you'll rejoin as yourself.</li></ul>
  </div><button class="btn block" data-act="closeModal">Close</button>`;
}

function roleSheet() {
  const v = App.view;
  const police = v.me.role === ROLE.POLICE;
  const canAccuse = police && v.me.alive && !v.me.accused && !['lobby', 'over', 'reveal'].includes(v.phase);
  openModal(`${holdCard(v)}
    ${v.me.role === ROLE.KILLER ? `<div class="small center">Failed rounds in a row: ${v.me.failed}/${v.me.curseLimit}</div>` : ''}
    ${v.me.warnings ? `<div class="small center">Your warnings: ${v.me.warnings}</div>` : ''}
    ${canAccuse ? `<button class="btn primary block" data-act="accuseOpen">⚖️ Make my accusation</button>` : ''}
    <button class="btn block" data-act="closeModal">Close</button>`);
}

function lureSheet() {
  const v = App.view;
  const t = P(v.me.target);
  if (!t) return;
  const opts = v.players.filter((p) => p.alive && p.id !== t.id);
  openModal(`<div class="title">Lure ${esc(t.name)}</div>
    <div class="sub">${esc(t.name)}'s phone will vibrate and flash <b>"LOOK AT …"</b> with the face you pick. Pick <b>yourself</b> to get eye contact for your wink — or someone else as a decoy. One lure per round.</div>
    <div class="small center">The game also sends random fake "LOOK AT" prompts to everyone, so a lure never gives you away.</div>
    ${grid(opts.map((p) => (p.id === v.me.id ? { ...p, name: p.name + ' (you)' } : p)), { selected: [App.ui.lureSel], act: 'lurePick', marks: false })}
    <button class="btn primary big block" data-act="lureGo" ${App.ui.lureSel ? '' : 'disabled'}>${App.ui.lureSel ? `🧲 Make ${esc(t.name)} look at ${App.ui.lureSel === v.me.id ? 'me' : esc(P(App.ui.lureSel)?.name)}` : 'Pick who they should look at'}</button>
    <button class="btn ghost block" data-act="closeModal">Cancel</button>`, { onClose: () => { App.ui.lureSel = null; } });
}

function accuseSheet() {
  const v = App.view;
  const need = v.settings.accuseRule === 'all' ? v.killersAlive : 1;
  const opts = v.players.filter((p) => p.alive && p.id !== v.me.id);
  const sel = App.ui.accuse;
  openModal(`<div class="title">Accusation</div>
    <div class="sub">${need > 1 ? `Name all <b>${need}</b> living Killers.` : 'Name the Killer.'} You only get one chance. Wrong = Killers win.</div>
    ${grid(opts, { selected: sel, act: 'accusePick', marks: true })}
    <button class="btn primary big block" data-act="accuseGo" ${sel.length === need ? '' : 'disabled'}>${sel.length === need ? `Accuse ${sel.map((id) => esc(P(id)?.name)).join(' & ')}` : `Choose ${need - sel.length} more`}</button>
    <button class="btn ghost block" data-act="closeModal">Cancel</button>`, { onClose: () => { App.ui.accuse = []; } });
}

function archiveSheet() {
  const v = App.view;
  const a = (v && v.archive) || [];
  openModal(`<div class="title">Crime Archive</div>
    ${a.length ? a.slice().reverse().map((it) => crimeCard(it, { announcement: { round: it.round } })).join('') : '<div class="card center type">No bodies… yet.</div>'}
    <button class="btn block" data-act="closeModal">Close</button>`);
  paintAvatars();
}

function menuSheet() {
  const v = App.view;
  const host = isHost();
  const inGame = v && !['lobby', 'over'].includes(v.phase);
  const canSkip = v && ['reveal', 'report', 'announce', 'discussion'].includes(v.phase);
  openModal(`<div class="title">Menu</div>
    <button class="btn block" data-act="rules">📜 How to play</button>
    <button class="btn block" data-act="archive">📁 Crime Archive</button>
    <button class="btn block" data-act="testSound">🔊 Test sound</button>
    ${host && inGame ? `<div class="label" style="margin-top:6px">Host controls</div>
      ${v.paused ? '<button class="btn block" data-act="resume">▶️ Resume game</button>' : '<button class="btn block" data-act="pause">⏸ Pause game</button>'}
      ${canSkip ? '<button class="btn block" data-act="skip">⏭ Skip this phase</button>' : ''}
      <button class="btn block danger" data-act="endGame">⛔ End game & reveal roles</button>
      <div class="small">You manage the flow, but you can't see anyone's role. The Action Phase can't be skipped.</div>` : ''}
    <div class="label" style="margin-top:6px">Lobby ${esc(App.code || '')}</div>
    <button class="btn block" data-act="share">📤 Share invite link</button>
    ${host ? '' : '<button class="btn block danger" data-act="leave">🚪 Leave</button>'}
    <button class="btn ghost block" data-act="closeModal">Close</button>`);
}

function profileSheet() {
  const p = App.profile;
  openModal(`<div class="title">Your profile</div>
    <div class="avatar-pick">
      <div class="av lg" id="myAv" data-act="pickGallery" ${p.avatar ? `style="background-image:url('${p.avatar}')"` : ''}>${p.avatar ? '' : '📷'}</div>
      <div class="row" style="width:100%"><button class="btn grow sm" data-act="pickCamera">📸 Take photo</button><button class="btn grow sm" data-act="pickGallery">🖼️ Gallery</button></div>
      <div class="presets">${PRESETS.map((e) => `<button class="preset" data-act="preset" data-e="${e}">${e}</button>`).join('')}</div>
    </div>
    <div class="label">Name</div><input id="nameIn" class="input" maxlength="18" value="${esc(p.name)}">
    <button class="btn primary block" data-act="saveProfile">Save</button>
    <button class="btn ghost block" data-act="closeModal">Cancel</button>`);
}

function customDurSheet(field) {
  const v = App.view;
  const cur = v.settings[field];
  openModal(`<div class="title">${field === 'actionSec' ? 'Action' : 'Discussion'} duration</div>
    <div class="label">Seconds</div><input id="durIn" class="input" type="number" inputmode="numeric" min="${field === 'actionSec' ? 15 : 20}" max="${field === 'actionSec' ? 600 : 900}" value="${cur}">
    <button class="btn primary block" data-act="saveDur" data-f="${field}">Set</button>
    <button class="btn ghost block" data-act="closeModal">Cancel</button>`);
}

// ======================================================================
// EVENTS
// ======================================================================
let pickTarget = 'profile';
async function handlePicked(file) {
  if (!file) return;
  try {
    const img = await fileToAvatar(file);
    setAvatarDraft(img);
  } catch (e) { toast(e.message); }
}
function setAvatarDraft(img) {
  App.profileDraft = img;
  const el = $('#myAv');
  if (el) { el.style.backgroundImage = `url('${img}')`; el.textContent = ''; }
  if (App.screen === 'profile') { App.profile.avatar = img; store.set('profile', App.profile); }
}
$('#filePick').addEventListener('change', (e) => { handlePicked(e.target.files[0]); e.target.value = ''; });
$('#camPick').addEventListener('change', (e) => { handlePicked(e.target.files[0]); e.target.value = ''; });

function readName() {
  const n = ($('#nameIn')?.value || '').trim().slice(0, 18);
  return n;
}

const QUIET_PHASES = ['action']; // no UI click sounds when a tap could betray a Killer

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const a = t.dataset.act;
  const v = App.view;
  if (!(v && QUIET_PHASES.includes(v.phase) && App.screen === 'game') && !['cell', 'closeModal'].includes(a)) sfx.play('click', { vol: 0.5 });
  switch (a) {
    case 'enter':
      sfx.unlock(); keepAwake();
      sfx.play('thunder'); fx.lightning();
      sfx.loop('lobby');
      route();
      break;
    case 'home': if (App.mode) teardown(); else setScreen('home'); break;
    case 'create': setScreen('profile', { create: true }); break;
    case 'goJoin': setScreen('join', {}); setTimeout(() => $('#codeIn')?.focus(), 50); break;
    case 'joinCode': {
      const code = ($('#codeIn').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 5) { toast('Codes have 5 characters.'); return; }
      setScreen('profile', { code });
      break;
    }
    case 'pickCamera': pickTarget = App.screen; $('#camPick').click(); break;
    case 'pickGallery': pickTarget = App.screen; $('#filePick').click(); break;
    case 'preset': setAvatarDraft(emojiAvatar(t.dataset.e)); break;
    case 'doCreate':
    case 'doJoin': {
      const name = readName();
      if (!name) { toast('Enter your name first.'); $('#nameIn')?.focus(); return; }
      App.profile.name = name;
      if (!App.profile.avatar) App.profile.avatar = emojiAvatar(PRESETS[Math.floor(Math.random() * PRESETS.length)]);
      store.set('profile', App.profile);
      try {
        if (a === 'doCreate') { setScreen('connecting', { msg: 'Opening the lobby…' }); await hostCreate(); }
        else await clientJoin(App.screenData.code, params.get('b') != null ? Number(params.get('b')) : null);
      } catch (err) { console.error(err); toast('Could not connect. Check your internet and try again.'); teardown(); }
      break;
    }
    case 'cancelConnect': teardown(); break;
    case 'resumeHost': {
      const saved = store.get('host');
      setScreen('connecting', { msg: 'Reopening your lobby…' });
      try {
        if (saved.bots) Object.assign(App.avatars, saved.bots);
        await hostResume(saved);
      } catch (err) { console.error(err); toast('Could not reconnect.'); teardown(); }
      break;
    }
    case 'rejoin': {
      const last = store.get('last');
      try { await clientJoin(last.code, last.broker ?? null); } catch (err) { toast('Could not connect.'); teardown(); }
      break;
    }
    case 'rules': closeModal(); openModal(rulesHTML()); break;
    case 'closeModal': closeModal(); break;
    case 'mute': sfx.setMuted(!sfx.muted); if (!sfx.muted) sfx.play('click'); render(); break;
    case 'testSound': testSound(); break;
    case 'menu': menuSheet(); break;
    case 'role': roleSheet(); break;
    case 'archive': closeModal(); archiveSheet(); break;
    case 'share': {
      const link = inviteLink();
      if (navigator.share) { try { await navigator.share({ title: 'SILENT KILLER', text: `Join my Silent Killer lobby — code ${App.code}`, url: link }); } catch (_) {} }
      else { navigator.clipboard?.writeText(link); toast('Invite link copied.'); }
      break;
    }
    case 'copy': navigator.clipboard?.writeText(inviteLink()).then(() => toast('Invite link copied.'), () => toast(inviteLink())); break;
    case 'editProfile': profileSheet(); break;
    case 'saveProfile': {
      const name = readName();
      if (!name) { toast('Enter a name.'); return; }
      App.profile.name = name;
      if (App.profileDraft) App.profile.avatar = App.profileDraft;
      App.profileDraft = null;
      store.set('profile', App.profile);
      publishAvatar(App.me, App.profile.avatar);
      paintAvatars();
      act({ type: 'profile', name });
      closeModal();
      break;
    }
    case 'leave':
      closeModal();
      if (v && v.phase === 'lobby') act({ type: 'leave' });
      if (App.bus && App.me) App.bus.publish('av/' + App.me, null, { retain: true });
      store.del('last');
      setTimeout(teardown, 300);
      break;
    case 'kick': act({ type: 'kick', target: t.dataset.id }); break;
    case 'addBot': addBot(); break;
    case 'closeLobby': if (confirm('Close this lobby for everyone?')) closeLobby(); break;
    // settings
    case 'mode': act({ type: 'settings', patch: { mode: t.dataset.v } }); break;
    case 'actionSec': act({ type: 'settings', patch: { actionSec: Number(t.dataset.v) } }); break;
    case 'discussionSec': act({ type: 'settings', patch: { discussionSec: Number(t.dataset.v) } }); break;
    case 'reportSec': act({ type: 'settings', patch: { reportSec: Number(t.dataset.v) } }); break;
    case 'killers': act({ type: 'settings', patch: { killers: t.dataset.v === 'auto' ? 'auto' : Number(t.dataset.v) } }); break;
    case 'accuseRule': act({ type: 'settings', patch: { accuseRule: t.dataset.v } }); break;
    case 'toggleLures': act({ type: 'settings', patch: { lures: !(v.settings.lures !== false) } }); break;
    case 'toggleHaunt': act({ type: 'settings', patch: { ghostHaunt: !(v.settings.ghostHaunt !== false) } }); break;
    case 'toggleQuiet': act({ type: 'settings', patch: { skipQuietDiscussion: !v.settings.skipQuietDiscussion } }); break;
    case 'customAction': customDurSheet('actionSec'); break;
    case 'customDiscussion': customDurSheet('discussionSec'); break;
    case 'saveDur': act({ type: 'settings', patch: { [t.dataset.f]: Number($('#durIn').value) } }); closeModal(); break;
    // game
    case 'start': act({ type: 'start' }); break;
    case 'ready': act({ type: 'ready' }); break;
    case 'skip': closeModal(); act({ type: 'skip' }); break;
    case 'pause': closeModal(); act({ type: 'pause' }); break;
    case 'resume': closeModal(); act({ type: 'resume' }); break;
    case 'endGame': if (confirm('End the game now and reveal every role?')) { closeModal(); act({ type: 'end' }); } break;
    case 'toLobby': act({ type: 'lobby' }); break;
    case 'cell': {
      const id = t.dataset.id;
      if (v.phase === 'action' && v.me.role === ROLE.KILLER && v.me.alive && !v.me.target) {
        App.ui.sel = App.ui.sel === id ? null : id; render();
      } else {
        const notes = App.ui.notes; notes[id] = ((notes[id] || 0) + 1) % 3; store.set('notes', notes); render();
      }
      break;
    }
    case 'lock': {
      const target = App.ui.sel;
      if (!target) return;
      const nm = P(target)?.name;
      openModal(`<div class="title">Lock ${esc(nm)}?</div><div class="sub">This is final for this round. If ${esc(nm)} can die, they will die when the Action Phase ends.</div>
        <button class="btn primary big block" data-act="lockGo" data-id="${esc(target)}">🔪 Lock target</button><button class="btn ghost block" data-act="closeModal">Cancel</button>`);
      break;
    }
    case 'lockGo': closeModal(); act({ type: 'target', target: t.dataset.id }); break;
    case 'reportYes': App.ui.reportYes = true; render(); break;
    case 'reportBack': App.ui.reportYes = false; App.ui.suspect = null; render(); break;
    case 'suspect': App.ui.suspect = t.dataset.id; render(); break;
    case 'sealYes': App.ui.busy = true; render(); sfx.play('submit'); act({ type: 'report', winked: true, suspect: App.ui.suspect }); break;
    case 'confirmYes': App.ui.busy = true; render(); sfx.play('submit'); act({ type: 'report', confirm: true }); break;
    case 'confirmNo': App.ui.busy = true; render(); sfx.play('submit'); act({ type: 'report', confirm: false }); break;
    case 'sealNo': App.ui.busy = true; render(); sfx.play('submit'); act({ type: 'report', winked: false }); break;
    case 'lureOpen': App.ui.lureSel = null; lureSheet(); break;
    case 'lurePick': { const keep = t.dataset.id; App.modalClose = null; closeModal(); App.ui.lureSel = keep; lureSheet(); break; }
    case 'lureGo': { const look = App.ui.lureSel; App.modalClose = null; closeModal(); App.ui.lureSel = null; if (look) act({ type: 'lure', look }); break; }
    case 'accuseOpen': App.ui.accuse = []; closeModal(); accuseSheet(); break;
    case 'accusePick': {
      const need = v.settings.accuseRule === 'all' ? v.killersAlive : 1;
      const id = t.dataset.id;
      let s = App.ui.accuse;
      if (s.includes(id)) s = s.filter((x) => x !== id);
      else s = need === 1 ? [id] : s.length < need ? [...s, id] : s;
      App.ui.accuse = s;
      const keep = App.ui.accuse;
      App.modalClose = null; closeModal(); App.ui.accuse = keep; accuseSheet();
      break;
    }
    case 'accuseGo': {
      const targets = App.ui.accuse.slice();
      App.modalClose = null; closeModal();
      openModal(`<div class="title">Final answer?</div><div class="sub">You are about to accuse <b>${targets.map((id) => esc(P(id)?.name)).join(' & ')}</b>. This ends the game.</div>
        <button class="btn primary big block" data-act="accuseFinal" data-ids="${esc(targets.join(','))}">⚖️ Yes — accuse</button><button class="btn ghost block" data-act="closeModal">Cancel</button>`);
      break;
    }
    case 'accuseFinal': closeModal(); act({ type: 'accuse', targets: t.dataset.ids.split(',') }); break;
  }
});

// press-and-hold to reveal role
function showRole(holdEl, on) {
  const v = App.view;
  if (!v || !v.me.role) return;
  if (on) {
    holdEl.insertAdjacentHTML('beforeend', roleCard(v));
    if (!App.ui.peeked && v.phase === 'reveal') { App.ui.peeked = true; sfx.play('role_reveal', { vol: 0.8 }); }
  } else {
    holdEl.querySelectorAll('.role-card').forEach((n) => n.remove());
  }
}
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('[data-hold]');
  if (!h) return;
  e.preventDefault();
  showRole(h, true);
  const up = () => { showRole(h, false); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
});
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-hold]')) e.preventDefault(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && App.screen === 'join') $('[data-act="joinCode"]')?.click();
  if (e.key === 'Escape') closeModal();
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'codeIn') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
});

// ======================================================================
// ROUTING
// ======================================================================
function route() {
  const join = (params.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (join.length === 5) {
    const last = store.get('last');
    if (last && last.code === join && !last.host && store.get('id_' + join) && App.profile.name) {
      clientJoin(join, params.get('b') != null ? Number(params.get('b')) : last.broker ?? null).catch(() => teardown());
      return;
    }
    setScreen('profile', { code: join });
    return;
  }
  setScreen('home');
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
  // A new version took over: reload right away if we're not in the middle of a game.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    if (!App.mode || (App.view && ['lobby', 'over'].includes(App.view.phase))) { reloaded = true; location.reload(); }
    else toast('An update is ready — it will load after this game.', 4000);
  });
}
render();
