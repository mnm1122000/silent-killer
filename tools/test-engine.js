// Rule tests for the engine: node tools/test-engine.js
import { Game, ROLE } from '../js/engine.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scenarios = JSON.parse(fs.readFileSync(new URL('../assets/scenarios.json', import.meta.url)));
const ctx = { scenarios, fmtTime: () => '5:18 PM' };
let now = 1_000_000;
let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };

function setup(n = 6, settings = {}) {
  const g = Game.create('TEST1', { id: 'p0', name: 'Host' }, settings);
  for (let i = 1; i < n; i++) g.addPlayer({ id: 'p' + i, name: 'P' + i });
  // force roles deterministically
  assert.equal(g.start(now).ok, true);
  return g;
}
function assign(g, map) { // map: {id: role}
  for (const pl of g.s.players) pl.role = map[pl.id] || ROLE.NETIZEN;
  g.s.killers = {};
  g.s.players.filter((x) => x.role === ROLE.KILLER).forEach((x) => { g.s.killers[x.id] = { failed: 0 }; });
  g.s.counts = { killers: Object.keys(g.s.killers).length, police: 1, netizens: g.s.players.length - 1 - Object.keys(g.s.killers).length };
}
const adv = (g, ms = 1e7) => { now += ms; return g.tick(now, ctx); };
function toAction(g) { g.handle(g.s.hostId, { type: 'skip' }, now); adv(g, 1); assert.equal(g.s.phase, 'action'); }
function reportAll(g, reports = {}) {
  for (const pl of g.alive()) {
    // Killers who locked a target confirm the wink by default
    const r = reports[pl.id] || (pl.role === ROLE.KILLER && g.cur.targets[pl.id] ? { confirm: true } : { winked: false });
    assert.equal(g.handle(pl.id, { type: 'report', ...r }, now).ok, true, 'report ' + pl.id);
  }
}
function finishRound(g, reports) {
  adv(g); assert.equal(g.s.phase, 'report');
  reportAll(g, reports);
  g.tick(now, ctx); assert.equal(g.s.phase, 'validate');
  adv(g); assert.equal(g.s.phase, 'announce');
  adv(g);
}

test('roles: exactly 1 police, correct killer count, host gets a role, host view hides roles', () => {
  const g = setup(10);
  const roles = g.s.players.map((p) => p.role);
  assert.equal(roles.filter((r) => r === ROLE.POLICE).length, 1);
  assert.equal(roles.filter((r) => r === ROLE.KILLER).length, 2);
  assert.ok(g.p('p0').role);
  const v = g.viewFor('p0', now);
  const visible = v.players.filter((p) => p.role && p.id !== 'p0');
  if (g.p('p0').role !== ROLE.KILLER) assert.equal(visible.length, 0);
  else assert.equal(visible.length, 1); // fellow killer only
});

test('no joining after start', () => {
  const g = setup(5);
  assert.equal(g.addPlayer({ id: 'late', name: 'Late' }).ok, false);
});

test('Scenario A: target dies even though they named the wrong suspect', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  assert.equal(g.handle('p1', { type: 'target', target: 'p3' }, now).ok, true);
  assert.equal(g.handle('p1', { type: 'target', target: 'p4' }, now).ok, false, 'cannot change after lock');
  finishRound(g, { p3: { winked: true, suspect: 'p5' } });
  assert.equal(g.p('p3').alive, false);
  assert.equal(g.p('p3').warnings, 0);
  const v = g.viewFor('p4', now);
  const item = v.announcement.items[0];
  assert.equal(item.pid, 'p3');
  assert.ok(!JSON.stringify(v).includes('"suspect"'), 'no suspect leak');
  assert.ok(!('targets' in item));
});

test('Scenario B: false YES gets a private warning, no elimination', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  g.handle('p1', { type: 'target', target: 'p3' }, now);
  finishRound(g, { p3: { winked: true, suspect: 'p1' }, p4: { winked: true, suspect: 'p5' } });
  assert.equal(g.p('p4').alive, true);
  assert.equal(g.p('p4').warnings, 1);
  assert.equal(g.viewFor('p4', now).me.warnedThisRound, true);
  assert.equal(g.viewFor('p5', now).me.warnedThisRound, false);
});

test('Scenario C: target reported NO but still dies (locked target is truth)', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  g.handle('p1', { type: 'target', target: 'p3' }, now);
  finishRound(g, {});
  assert.equal(g.p('p3').alive, false);
});

test('Scenario D: no target -> nobody dies, counter climbs, curse at 3 -> innocents win', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  finishRound(g, {}); assert.equal(g.s.phase, 'discussion'); assert.equal(g.s.killers.p1.failed, 1);
  adv(g); finishRound(g, {}); assert.equal(g.s.killers.p1.failed, 2);
  adv(g); finishRound(g, {});
  assert.equal(g.s.phase, 'over');
  assert.equal(g.s.result.winner, 'innocent');
  assert.equal(g.s.result.reason, 'curse');
});

test('killer says NO (could not wink): nobody dies, round counts as failed', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  g.handle('p1', { type: 'target', target: 'p3' }, now);
  finishRound(g, { p1: { confirm: false }, p3: { winked: true, suspect: 'p1' } });
  assert.equal(g.p('p3').alive, true);
  assert.equal(g.p('p3').warnings, 0, 'p3 really was the locked target -> no warning');
  assert.equal(g.s.killers.p1.failed, 1);
});

test('killer confirms YES but victim says NO: victim still dies', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  g.handle('p1', { type: 'target', target: 'p3' }, now);
  finishRound(g, { p1: { confirm: true }, p3: { winked: false } });
  assert.equal(g.p('p3').alive, false);
  assert.equal(g.s.killers.p1.failed, 0);
});

test('killer never confirms (report timed out): no kill', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  g.handle('p1', { type: 'target', target: 'p3' }, now);
  adv(g);
  for (const pl of g.alive()) if (pl.id !== 'p1') g.handle(pl.id, { type: 'report', winked: false }, now);
  adv(g); // report timeout
  assert.equal(g.p('p3').alive, true);
  assert.equal(g.s.killers.p1.failed, 1);
  assert.equal(g.viewFor('p1', now).me.target, undefined);
});

test('killer with no target: report is just "I did not wink", never a warning', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g); adv(g);
  assert.equal(g.handle('p1', { type: 'report', winked: true, suspect: 'p3' }, now).ok, true);
  assert.equal(g.cur.reports.p1.confirm, false);
  assert.equal(g.cur.reports.p1.winked, false);
  for (const pl of g.alive()) if (pl.id !== 'p1') g.handle(pl.id, { type: 'report', winked: false }, now);
  g.tick(now, ctx);
  assert.equal(g.p('p1').warnings, 0);
});

test('kill resets counter; targeting police fails silently and counts as failure', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g); finishRound(g, {}); assert.equal(g.s.killers.p1.failed, 1);
  adv(g); g.handle('p1', { type: 'target', target: 'p3' }, now); finishRound(g, {}); assert.equal(g.s.killers.p1.failed, 0);
  adv(g); g.handle('p1', { type: 'target', target: 'p2' }, now); finishRound(g, { p2: { winked: true, suspect: 'p1' } });
  assert.equal(g.p('p2').alive, true);
  assert.equal(g.p('p2').warnings, 0, 'police was truly targeted -> no warning');
  assert.equal(g.s.killers.p1.failed, 1);
});

test('killer cannot target self or fellow killer; can only act in Action Phase', () => {
  const g = setup(10); assign(g, { p1: ROLE.KILLER, p6: ROLE.KILLER, p2: ROLE.POLICE });
  assert.equal(g.handle('p1', { type: 'target', target: 'p3' }, now).ok, false, 'not in reveal');
  toAction(g);
  assert.equal(g.handle('p1', { type: 'target', target: 'p1' }, now).ok, false);
  assert.equal(g.handle('p1', { type: 'target', target: 'p6' }, now).ok, false);
  assert.equal(g.handle('p3', { type: 'target', target: 'p4' }, now).ok, false, 'netizen cannot target');
  const kv = g.viewFor('p1', now);
  assert.equal(kv.players.find((p) => p.id === 'p6').role, ROLE.KILLER, 'killers see partners');
  assert.equal(kv.players.find((p) => p.id === 'p2').role, null, 'killers do not see police');
});

test('two killers same victim: one death, both credited; separate counters', () => {
  const g = setup(10); assign(g, { p1: ROLE.KILLER, p6: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  g.handle('p1', { type: 'target', target: 'p3' }, now);
  g.handle('p6', { type: 'target', target: 'p3' }, now);
  finishRound(g, {});
  assert.equal(g.s.announcement.items.filter((i) => i.kind === 'death').length, 1);
  assert.equal(g.s.killers.p1.failed, 0); assert.equal(g.s.killers.p6.failed, 0);
  adv(g); g.handle('p1', { type: 'target', target: 'p4' }, now); finishRound(g, {});
  assert.equal(g.s.killers.p1.failed, 0); assert.equal(g.s.killers.p6.failed, 1);
});

test('one of two killers cursed: game continues, cursed killer publicly revealed', () => {
  const g = setup(10); assign(g, { p1: ROLE.KILLER, p6: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  for (let i = 0; i < 3; i++) {
    g.handle('p1', { type: 'target', target: g.alive(ROLE.NETIZEN)[0].id }, now);
    finishRound(g, {}); if (i < 2) adv(g);
  }
  assert.equal(g.p('p6').alive, false); assert.equal(g.p('p6').cause, 'curse');
  assert.notEqual(g.s.phase, 'over');
  assert.equal(g.viewFor('p3', now).players.find((p) => p.id === 'p6').role, ROLE.KILLER);
  assert.equal(g.viewFor('p3', now).killersAlive, 1);
});

test('massacre: last netizen dies -> killers win', () => {
  const g = setup(5); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  for (const victim of ['p0', 'p3', 'p4']) {
    g.handle('p1', { type: 'target', target: victim }, now);
    finishRound(g, {});
    if (g.s.phase !== 'over') adv(g);
  }
  assert.equal(g.s.phase, 'over'); assert.equal(g.s.result.winner, 'killer'); assert.equal(g.s.result.reason, 'massacre');
});

test('police accusation: right -> innocents; wrong -> killers; only once; any phase', () => {
  let g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  assert.equal(g.handle('p3', { type: 'accuse', targets: ['p1'] }, now).ok, false, 'netizen cannot accuse');
  assert.equal(g.handle('p2', { type: 'accuse', targets: ['p1'] }, now).ok, true);
  assert.equal(g.s.result.winner, 'innocent');
  g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g); adv(g); // report phase
  assert.equal(g.handle('p2', { type: 'accuse', targets: ['p4'] }, now).ok, true);
  assert.equal(g.s.result.winner, 'killer');
  assert.equal(g.handle('p2', { type: 'accuse', targets: ['p1'] }, now).ok, false);
});

test('accuse rule "all": must name every living killer', () => {
  const g = setup(10, { accuseRule: 'all' }); assign(g, { p1: ROLE.KILLER, p6: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  assert.equal(g.handle('p2', { type: 'accuse', targets: ['p1'] }, now).ok, false, 'needs 2 names');
  assert.equal(g.handle('p2', { type: 'accuse', targets: ['p1', 'p3'] }, now).ok, true);
  assert.equal(g.s.result.winner, 'killer');
});

test('reports: sealed once, dead cannot report, missed reports time out without blocking', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g); g.handle('p1', { type: 'target', target: 'p3' }, now); adv(g);
  assert.equal(g.handle('p4', { type: 'report', winked: false }, now).ok, true);
  assert.equal(g.handle('p4', { type: 'report', winked: true, suspect: 'p1' }, now).ok, false);
  assert.equal(g.handle('p4', { type: 'report', winked: true, suspect: 'p4' }, now).ok, false);
  const pv = g.viewFor('p5', now);
  assert.equal(pv.reportProgress.done, 1);
  assert.ok(!JSON.stringify(pv).includes('winked":false'), 'others reports hidden');
  assert.equal(g.handle('p1', { type: 'report', confirm: true }, now).ok, true);
  assert.ok(!JSON.stringify(g.viewFor('p5', now)).includes('confirm'), 'killer confirmation hidden');
  adv(g); // timeout
  assert.equal(g.s.phase, 'validate');
  assert.equal(g.p('p3').alive, false, 'kill stands even though victim never reported');
  assert.equal(g.p('p5').missed, 1);
  adv(g); adv(g); adv(g); // announce->discussion->action
  assert.equal(g.s.phase, 'action');
  g.tick(now, ctx); adv(g);
  assert.equal(g.handle('p3', { type: 'report', winked: false }, now).ok, false, 'dead cannot report');
});

test('host controls: pause freezes timer, cannot skip action, host has no secret access', () => {
  const g = setup(6); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g);
  assert.equal(g.handle('p0', { type: 'skip' }, now).ok, false);
  g.handle('p0', { type: 'pause' }, now);
  adv(g); assert.equal(g.s.phase, 'action', 'paused');
  g.handle('p0', { type: 'resume' }, now);
  const hv = g.viewFor('p0', now);
  assert.equal(hv.players.filter((p) => p.role && p.id !== 'p0').length, 0);
  assert.ok(!JSON.stringify(hv).includes('targets'));
});

test('skip quiet discussion setting goes straight to next action', () => {
  const g = setup(6, { skipQuietDiscussion: true }); assign(g, { p1: ROLE.KILLER, p2: ROLE.POLICE });
  toAction(g); finishRound(g, {});
  assert.equal(g.s.phase, 'action'); assert.equal(g.s.round, 2);
});

test('scenarios do not repeat until pool exhausted', () => {
  const g = setup(6);
  const ids = new Set();
  for (let i = 0; i < scenarios.length; i++) ids.add(g.pickScenario(scenarios, Math.random).id);
  assert.equal(ids.size, scenarios.length);
});

console.log(`\n${pass} tests passed`);
