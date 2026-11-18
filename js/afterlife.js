// SILENT KILLER — The Afterlife: a little playground for eliminated players.
// Drag your ghost around; touching a living player's name "haunts" it.
// Purely cosmetic and only visible to the dead: it never reaches the living,
// so the dead still can't influence the game. Other ghosts (dead players) are
// shown too, synced through the relay.

const canvas = document.createElement('canvas');
canvas.className = 'afterlife-canvas';
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1, raf = 0, last = 0;
const bubbles = new Map(); // pid -> bubble
const remote = new Map();  // pid -> ghost
const ghost = { x: 0.5, y: 0.55, vx: 0, vy: 0, tx: null, ty: null, face: 1, boo: 0 };
let myName = '', haunts = 0, particles = [], lastSent = 0, lastSentPos = '';
let onMove = null, onHaunt = null;
const rand = (a, b) => a + Math.random() * (b - a);

function resize() {
  const r = canvas.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(200, r.width); H = Math.max(200, r.height);
  canvas.width = W * DPR; canvas.height = H * DPR;
}
addEventListener('resize', () => canvas.isConnected && resize());

// ---------- input ----------
function toLocal(e) {
  const r = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
}
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); const p = toLocal(e); ghost.tx = p.x; ghost.ty = p.y; });
canvas.addEventListener('pointermove', (e) => { if (ghost.tx == null) return; const p = toLocal(e); ghost.tx = p.x; ghost.ty = p.y; });
const release = () => { ghost.tx = null; ghost.ty = null; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// ---------- drawing ----------
function drawGhost(x, y, t, { alpha = 1, name = '', scale = 1, face = 1, boo = 0, mine = false }) {
  const s = 22 * scale * (1 + boo * 0.25);
  const bob = Math.sin(t * 2.6 + x * 10) * 4;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(face, 1);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = mine ? 'rgba(190,220,255,.9)' : 'rgba(255,200,200,.6)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = mine ? 'rgba(236,244,255,.95)' : 'rgba(255,235,235,.75)';
  ctx.beginPath();
  ctx.arc(0, -s * 0.2, s, Math.PI, 0);
  ctx.lineTo(s, s * 1.1);
  const waves = 4;
  for (let i = 0; i < waves; i++) {
    const x1 = s - ((i + 0.5) * 2 * s) / waves;
    const x2 = s - ((i + 1) * 2 * s) / waves;
    const wob = Math.sin(t * 6 + i * 1.7) * s * 0.12;
    ctx.quadraticCurveTo(x1, s * 1.1 + s * 0.32 + wob, x2, s * 1.1);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // face
  ctx.fillStyle = '#120507';
  ctx.beginPath(); ctx.ellipse(-s * 0.35, -s * 0.25, s * 0.16, s * 0.24 * (boo ? 1.3 : 1), 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(s * 0.35, -s * 0.25, s * 0.16, s * 0.24 * (boo ? 1.3 : 1), 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, s * 0.3, s * (0.12 + boo * 0.12), s * (0.16 + boo * 0.2), 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (name) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = mine ? '#dfe9ff' : '#f0d6d6';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillText(name, x, y + bob + s * 1.9);
    ctx.restore();
  }
}

function drawBubble(b, t) {
  const hz = b.haunt;
  const jx = hz ? rand(-3, 3) * hz : 0, jy = hz ? rand(-3, 3) * hz : 0;
  const sc = 1 + hz * 0.18;
  ctx.save();
  ctx.translate(b.x * W + jx, b.y * H + jy);
  ctx.scale(sc, sc);
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  const w = ctx.measureText(b.name).width + 26, h = 30;
  b.w = w * sc; b.h = h * sc;
  ctx.fillStyle = hz ? `rgba(120,160,255,${0.25 + hz * 0.4})` : 'rgba(40,14,18,.85)';
  ctx.strokeStyle = hz ? 'rgba(200,220,255,.9)' : 'rgba(255,80,90,.35)';
  ctx.lineWidth = 1.5;
  if (hz) { ctx.shadowColor = 'rgba(160,200,255,.9)'; ctx.shadowBlur = 20 * hz; }
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 15); else ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = hz ? '#fff' : '#ece4d8';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(b.name, 0, 1);
  ctx.restore();
}

// ---------- simulation ----------
function step(now) {
  raf = 0;
  if (!canvas.isConnected) return;
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  const t = now / 1000;
  // my ghost
  if (ghost.tx != null) {
    ghost.vx += (ghost.tx - ghost.x) * 9 * dt;
    ghost.vy += (ghost.ty - ghost.y) * 9 * dt;
  } else {
    ghost.vx += Math.sin(t * 0.7) * 0.02 * dt;
    ghost.vy += Math.cos(t * 0.9) * 0.02 * dt;
  }
  ghost.vx *= 0.9; ghost.vy *= 0.9;
  ghost.x = Math.max(0.06, Math.min(0.94, ghost.x + ghost.vx * dt * 6));
  ghost.y = Math.max(0.1, Math.min(0.86, ghost.y + ghost.vy * dt * 6));
  if (Math.abs(ghost.vx) > 0.002) ghost.face = ghost.vx < 0 ? -1 : 1;
  ghost.boo = Math.max(0, ghost.boo - dt * 2.5);

  // living names drift
  for (const b of bubbles.values()) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < 0.12 || b.x > 0.88) { b.vx *= -1; b.x = Math.max(0.12, Math.min(0.88, b.x)); }
    if (b.y < 0.08 || b.y > 0.92) { b.vy *= -1; b.y = Math.max(0.08, Math.min(0.92, b.y)); }
    b.vx *= 0.995; b.vy *= 0.995;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp < 0.02) { b.vx += rand(-0.01, 0.01); b.vy += rand(-0.01, 0.01); }
    b.haunt = Math.max(0, b.haunt - dt * 1.2);
    b.cool = Math.max(0, b.cool - dt);
    // touch test: ghost circle vs name pill
    const gx = ghost.x * W, gy = ghost.y * H, bx = b.x * W, by = b.y * H;
    const dx = Math.max(Math.abs(gx - bx) - (b.w || 60) / 2, 0), dy = Math.max(Math.abs(gy - by) - (b.h || 30) / 2, 0);
    if (Math.hypot(dx, dy) < 22 && b.cool <= 0) {
      b.haunt = 1; b.cool = 1.1;
      const ang = Math.atan2(by - gy, bx - gx);
      b.vx += Math.cos(ang) * 0.35; b.vy += Math.sin(ang) * 0.35;
      ghost.boo = 1;
      haunts++;
      const words = ['BOO!', 'boo…', '👻', 'WooOOo', '💀', '🕯️'];
      for (let i = 0; i < 5; i++) particles.push({ x: bx, y: by, vx: rand(-40, 40), vy: rand(-90, -30), life: 1, txt: i === 0 ? words[Math.floor(Math.random() * words.length)] : '·' });
      const el = document.getElementById('hauntCount');
      if (el) el.textContent = `Haunted ×${haunts}`;
      onHaunt && onHaunt(b.id);
    }
  }
  // remote ghosts glide toward their last known spot
  for (const g of remote.values()) {
    g.x += (g.tx - g.x) * Math.min(1, dt * 8);
    g.y += (g.ty - g.y) * Math.min(1, dt * 8);
    if (Math.abs(g.tx - g.x) > 0.001) g.face = g.tx < g.x ? -1 : 1;
  }
  // publish my position (throttled)
  const pos = `${ghost.x.toFixed(3)},${ghost.y.toFixed(3)}`;
  if (onMove && now - lastSent > 160 && pos !== lastSentPos) { lastSent = now; lastSentPos = pos; onMove(+ghost.x.toFixed(3), +ghost.y.toFixed(3)); }

  // ---- draw ----
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(60,70,110,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (const b of bubbles.values()) drawBubble(b, t);
  for (const r of remote.values()) drawGhost(r.x * W, r.y * H, t, { alpha: 0.55, name: r.name, scale: 0.85, face: r.face || 1 });
  drawGhost(ghost.x * W, ghost.y * H, t, { name: myName, face: ghost.face, boo: ghost.boo, mine: true });
  particles = particles.filter((p) => (p.life -= dt * 0.9) > 0);
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 30 * dt;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = '#dfe9ff';
    ctx.font = p.txt.length > 1 ? '20px Creepster, cursive' : '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.txt, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(step);
}

export const afterlife = {
  // Mount (or re-mount after a re-render) into a container element.
  attach(container) {
    if (canvas.parentElement !== container) container.appendChild(canvas);
    resize();
    const el = document.getElementById('hauntCount');
    if (el) el.textContent = haunts ? `Haunted ×${haunts}` : 'Touch a name to haunt it';
    if (!raf) { last = 0; raf = requestAnimationFrame(step); }
  },
  // living: [{id,name}], ghosts: [{id,name}] (other dead players)
  update({ name, living, dead }) {
    myName = name || '';
    const keep = new Set(living.map((p) => p.id));
    for (const id of [...bubbles.keys()]) if (!keep.has(id)) bubbles.delete(id);
    for (const p of living) {
      if (!bubbles.has(p.id)) bubbles.set(p.id, { id: p.id, name: p.name, x: rand(0.18, 0.82), y: rand(0.12, 0.88), vx: rand(-0.06, 0.06), vy: rand(-0.06, 0.06), haunt: 0, cool: 0 });
      else bubbles.get(p.id).name = p.name;
    }
    const ghosts = new Set(dead.map((p) => p.id));
    for (const id of [...remote.keys()]) if (!ghosts.has(id)) remote.delete(id);
    for (const p of dead) { const r = remote.get(p.id); if (r) r.name = p.name; }
    this._deadNames = Object.fromEntries(dead.map((p) => [p.id, p.name]));
  },
  remote(id, x, y) {
    const name = this._deadNames && this._deadNames[id];
    if (!name || typeof x !== 'number' || typeof y !== 'number') return;
    const r = remote.get(id);
    if (r) { r.tx = x; r.ty = y; } else remote.set(id, { name, x, y, tx: x, ty: y, face: 1 });
  },
  set onMove(fn) { onMove = fn; },
  set onHaunt(fn) { onHaunt = fn; },
  reset() { haunts = 0; bubbles.clear(); remote.clear(); particles = []; },
};
