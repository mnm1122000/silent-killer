// SILENT KILLER — sound engine (Web Audio). All sounds are files in assets/sfx.
// Fair-play rule: only PUBLIC moments make sound (phase changes, deaths, timers),
// so every phone in the room plays the same thing. Private actions (locking a
// target, receiving a warning) are silent so a sound never gives anyone away.

const NAMES = ['click', 'tick', 'tick_urgent', 'heartbeat', 'thunder', 'sting_action', 'wink', 'role_reveal', 'report', 'submit',
  'scan', 'death', 'no_death', 'discussion', 'warning', 'accuse', 'curse', 'win_innocent', 'win_killer', 'join', 'start_game',
  'ambience', 'lobby', 'tension', 'shh'];

class Sfx {
  constructor() {
    this.ctx = null; this.buffers = {}; this.master = null; this.musicBus = null;
    this.loops = {}; this.muted = false; this.musicVol = 0.55;
    try { this.muted = localStorage.getItem('sk_muted') === '1'; } catch (_) {}
  }

  // Must be called from inside a tap/click handler. Everything before the first
  // await runs synchronously inside the gesture, which iOS and Android require.
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve();
    // iPhone: the ring/silent switch mutes Web Audio unless the page is a "playback" app.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    if (!this.mediaEl) {
      // Classic iOS workaround: a looping silent <audio> element moves the page into the media
      // audio session, so sounds play even with the silent switch on.
      const a = document.createElement('audio');
      a.src = 'assets/sfx/silence.mp3';
      a.loop = true; a.preload = 'auto';
      a.setAttribute('playsinline', ''); a.setAttribute('webkit-playsinline', '');
      a.setAttribute('x-webkit-airplay', 'deny');
      document.body.appendChild(a);
      this.mediaEl = a;
    }
    if (this.mediaEl.paused) { const pr = this.mediaEl.play(); if (pr && pr.catch) pr.catch(() => {}); }
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVol;
      this.musicBus.connect(this.master);
      this.loadAll();
    }
    // Start a silent 1-sample buffer inside the gesture (old iOS unlock trick).
    try {
      const b = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = b; src.connect(this.ctx.destination); src.start(0);
    } catch (_) {}
    if (this.ctx.state !== 'running') {
      const pr = this.ctx.resume();
      return pr && pr.catch ? pr.catch(() => {}) : Promise.resolve();
    }
    return Promise.resolve();
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  loadAll() {
    this.pending = {};
    this.loading = Promise.all(NAMES.map((n) => (this.pending[n] = (async () => {
      try {
        const res = await fetch(`assets/sfx/${n}.mp3`);
        const arr = await res.arrayBuffer();
        this.buffers[n] = await new Promise((ok, bad) => this.ctx.decodeAudioData(arr, ok, bad));
      } catch (_) { /* missing sound is never fatal */ }
    })())));
    return this.loading;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('sk_muted', m ? '1' : '0'); } catch (_) {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  play(name, opts = {}) {
    if (!this.ctx) return;
    if (!this.buffers[name]) {
      // not decoded yet: play it as soon as it is, unless that is too late to make sense
      const asked = Date.now();
      if (this.pending && this.pending[name]) this.pending[name].then(() => { if (this.buffers[name] && Date.now() - asked < 2500) this.play(name, opts); });
      return;
    }
    const { vol = 1, rate = 1, delay = 0 } = opts;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
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
