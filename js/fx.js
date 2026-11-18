// SILENT KILLER — visual effects: drifting fog, lightning, blood flash, shake.
const canvas = document.getElementById('fog');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, tint = [120, 10, 20];
const blobs = Array.from({ length: 14 }, (_, i) => ({
  x: Math.random(), y: Math.random(), r: 0.25 + Math.random() * 0.35,
  vx: (Math.random() - 0.5) * 0.00006, vy: (Math.random() - 0.5) * 0.00003, a: 0.05 + Math.random() * 0.08, gray: i % 3 !== 0,
}));
function resize() {
  const s = 0.35; // low-res render, scaled up = soft
  W = canvas.width = Math.ceil(innerWidth * s);
  H = canvas.height = Math.ceil(innerHeight * s);
}
addEventListener('resize', resize);
resize();
let last = performance.now();
function frame(now) {
  const dt = Math.min(64, now - last); last = now;
  ctx.clearRect(0, 0, W, H);
  for (const b of blobs) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < -0.4) b.x = 1.4; if (b.x > 1.4) b.x = -0.4;
    if (b.y < -0.4) b.y = 1.4; if (b.y > 1.4) b.y = -0.4;
    const R = b.r * Math.max(W, H);
    const g = ctx.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, R);
    const c = b.gray ? '150,140,140' : tint.join(',');
    g.addColorStop(0, `rgba(${c},${b.a})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const flash = document.getElementById('flash');
function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

export const fx = {
  lightning() { flash.className = ''; replay(flash, 'lightning'); },
  blood() { flash.className = ''; replay(flash, 'blood'); },
  shake() { replay(document.getElementById('screen'), 'shake'); },
  setTint(rgb) { tint = rgb; },
};
