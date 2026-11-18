// SILENT KILLER — sound engine (Web Audio). All sounds are files in assets/sfx.
// Fair-play rule: only PUBLIC moments make sound (phase changes, deaths, timers),
// so every phone in the room plays the same thing. Private actions (locking a
// target, receiving a warning) are silent so a sound never gives anyone away.

const NAMES = ['click', 'tick', 'tick_urgent', 'heartbeat', 'thunder', 'sting_action', 'wink', 'role_reveal', 'report', 'submit',
  'scan', 'death', 'no_death', 'discussion', 'warning', 'accuse', 'curse', 'win_innocent', 'win_killer', 'join', 'start_game',
  'ambience', 'lobby', 'tension'];

class Sfx {
  constructor() {
    this.ctx = null; this.buffers = {}; this.master = null; this.musicBus = null;
    this.loops = {}; this.muted = false; this.musicVol = 0.55;
    try { this.muted = localStorage.getItem('sk_muted') === '1'; } catch (_) {}
  }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVol;
      this.musicBus.connect(this.master);
      this.loadAll();
    }
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (_) {} }
  }

  loadAll() {
    this.loading = Promise.all(NAMES.map(async (n) => {
      try {
        const res = await fetch(`assets/sfx/${n}.mp3`);
        const arr = await res.arrayBuffer();
        this.buffers[n] = await new Promise((ok, bad) => this.ctx.decodeAudioData(arr, ok, bad));
      } catch (_) { /* missing sound is never fatal */ }
    }));
    return this.loading;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('sk_muted', m ? '1' : '0'); } catch (_) {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  play(name, { vol = 1, rate = 1, delay = 0 } = {}) {
    if (!this.ctx || !this.buffers[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start(this.ctx.currentTime + delay);
  }

  // looping music bed with crossfade; only one per "slot"
  loop(name, { slot = 'music', vol = 1, fade = 1.5, rate = 1 } = {}) {
    if (!this.ctx) return;
    const cur = this.loops[slot];
    if (cur && cur.name === name) { cur.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.3); return; }
    this.stop(slot, fade);
    const buf = this.buffers[name];
    if (!buf) { // not loaded yet — retry shortly
      this.loading && this.loading.then(() => { if (!this.loops[slot] && this.wanted && this.wanted[slot] === name) this.loop(name, { slot, vol, fade, rate }); });
      this.wanted = { ...(this.wanted || {}), [slot]: name };
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.loopStart = 0.06; src.loopEnd = buf.duration - 0.06; // skip mp3 encoder padding
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(vol, this.ctx.currentTime, fade / 3);
    src.connect(g).connect(slot === 'music' ? this.musicBus : this.master);
    src.start(0, 0.06);
    this.loops[slot] = { name, src, g };
  }

  stop(slot = 'music', fade = 1) {
    const cur = this.loops[slot];
    if (!cur || !this.ctx) return;
    cur.g.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    try { cur.src.stop(this.ctx.currentTime + fade * 2); } catch (_) {}
    delete this.loops[slot];
    if (this.wanted) delete this.wanted[slot];
  }

  stopAll() { Object.keys(this.loops).forEach((s) => this.stop(s, 0.5)); }
}

export const sfx = new Sfx();

export function vibrate(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch (_) {}
}
