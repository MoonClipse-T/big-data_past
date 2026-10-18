/* =========================================================
   소리: 배경음악(BGM) + 효과음(SFX)
   - assets/audio/bgm_<이름>.mp3, sfx_<이름>.mp3 파일이 있으면 그 파일을 쓰고,
     없으면 웹오디오로 만든 소리로 대신해요. (파일만 넣으면 자동으로 바뀜)
   - iPad는 음량(volume) 조절이 막혀 있어서 모든 소리를 GainNode로 조절해요.
   ========================================================= */
const BGM_FILES = { lab: 'bgm_lab', cambrian: 'bgm_cambrian', devonian: 'bgm_devonian', permian: 'bgm_permian', chase: 'bgm_chase', analysis: 'bgm_analysis', ending: 'bgm_ending' };
// 파일이 없을 때 대신 쓸 곡
const BGM_FALLBACK = { lab: 'devonian', analysis: 'cambrian', ending: 'cambrian', chase: null };
const SFX_FILES = ['bite', 'eat', 'probe', 'molt', 'alarm', 'warp', 'eruption', 'roar', 'alert', 'correct', 'wrong', 'dash', 'shield', 'heartbeat', 'click', 'sting'];

export class Sound {
  constructor(base = 'assets/audio/') {
    this.base = base; this.ctx = null; this.muted = false;
    this.tracks = {}; this.current = null; this.chaseOn = false; this.sfx = {};
    this.available = {};
  }
  // 반드시 사용자 터치/클릭 안에서 호출 (iPad 소리 잠금 해제)
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.55; this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.loadSfx();
    }
    this.ctx.resume?.();
  }
  // 어떤 BGM 파일이 실제로 있는지 미리 확인 (없는 곡은 대체곡으로)
  // assets/audio/manifest.json 에 적힌 파일만 사용 (새 파일을 넣으면 목록에도 추가)
  async probe() {
    try { this.manifest = await (await fetch(this.base + 'manifest.json')).json(); } catch (e) { this.manifest = { bgm: [], sfx: [] }; }
    for (const k of Object.keys(BGM_FILES)) this.available[k] = this.manifest.bgm.includes(k);
  }
  async loadSfx() {
    await Promise.all(SFX_FILES.filter(n => this.manifest?.sfx.includes(n)).map(async n => {
      try {
        const r = await fetch(this.base + 'sfx_' + n + '.mp3'); if (!r.ok) return;
        this.sfx[n] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) { /* 합성음으로 대체 */ }
    }));
  }
  track(name) {
    if (this.tracks[name] !== undefined) return this.tracks[name];
    const el = new Audio(); el.src = this.base + BGM_FILES[name] + '.mp3'; el.loop = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
    const t = { el, gain: null, ok: true };
    el.addEventListener('error', () => { t.ok = false; });
    if (this.ctx) { const src = this.ctx.createMediaElementSource(el); t.gain = this.ctx.createGain(); t.gain.gain.value = 0; src.connect(t.gain).connect(this.musicBus); }
    this.tracks[name] = t; return t;
  }
  fade(t, to, sec) {
    if (!t || !t.gain) return;
    const g = t.gain.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(to, now + sec);
    if (to > 0 && t.el.paused) t.el.play().catch(() => { });
    if (to === 0) setTimeout(() => { if (t.gain.gain.value < 0.01) t.el.pause(); }, sec * 1000 + 50);
  }
  music(name, sec = 2) {
    if (!this.ctx) return;
    if (this.available[name] === false) { name = BGM_FALLBACK[name]; if (!name) return; }
    if (this.current === name) return;
    const t = this.track(name);
    if (this.current) this.fade(this.tracks[this.current], 0, sec);
    this.current = name; this.fade(t, this.chaseOn ? 0.25 : 1, sec);
  }
  chase(on) {
    if (!this.ctx || on === this.chaseOn) return; this.chaseOn = on;
    const cur = this.tracks[this.current];
    if (this.available.chase) { const c = this.track('chase'); this.fade(c, on ? 1 : 0, on ? 0.6 : 2.5); this.fade(cur, on ? 0.25 : 1, on ? 0.6 : 2.5); }
    else { this.fade(cur, on ? 0.45 : 1, 0.8); if (on) this.play('alert'); }
  }
  stopMusic(sec = 1.5) { if (this.current) this.fade(this.tracks[this.current], 0, sec); this.current = null; this.chase(false); }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 1; return this.muted; }

  /* ---- 효과음 ---- */
  play(name, vol = 1, rate = 1) {
    if (!this.ctx || this.muted) return;
    const buf = this.sfx[name];
    if (buf) {
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
      s.buffer = buf; s.playbackRate.value = rate; g.gain.value = vol; s.connect(g).connect(this.sfxBus); s.start(); return;
    }
    (SYNTH[name] || SYNTH.click)(this, vol);
  }
  // 합성음 재료
  osc(type, f0, f1, dur, vol, delay = 0, filter) {
    const c = this.ctx, t0 = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let n = o; if (filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); n = f; }
    n.connect(g).connect(this.sfxBus); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise(dur, vol, f0, f1, type = 'lowpass', delay = 0, q = 1) {
    const c = this.ctx, t0 = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.05, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.sfxBus); s.start(t0); s.stop(t0 + dur + 0.05);
  }
}

// 파일이 없을 때 쓰는 합성 효과음 (물속 느낌이 나도록 낮은 음역 + 필터)
const SYNTH = {
  bite: (s, v) => { s.noise(0.35, 0.7 * v, 1800, 200, 'lowpass'); s.osc('sawtooth', 110, 45, 0.3, 0.35 * v, 0.02, 600); s.osc('square', 70, 40, 0.2, 0.3 * v, 0.12, 300); },
  eat: (s, v) => { s.osc('sine', 300 + Math.random() * 120, 900, 0.12, 0.25 * v); s.noise(0.08, 0.12 * v, 2500, 800, 'bandpass', 0.02, 3); },
  probe: (s, v) => { [660, 990, 1320, 1760].forEach((f, i) => s.osc('triangle', f, 0, 0.35, 0.12 * v, i * 0.07)); s.noise(0.5, 0.06 * v, 6000, 2000, 'highpass'); },
  molt: (s, v) => { s.noise(0.25, 0.3 * v, 3000, 900, 'bandpass', 0, 2); [523, 659, 784, 1046, 1318].forEach((f, i) => s.osc('triangle', f, 0, 0.4, 0.1 * v, 0.1 + i * 0.07)); },
  alarm: (s, v) => { s.osc('square', 880, 0, 0.22, 0.08 * v, 0, 2400); s.osc('square', 660, 0, 0.22, 0.08 * v, 0.25, 2400); },
  warp: (s, v) => { s.noise(2.6, 0.25 * v, 200, 6000, 'bandpass', 0, 4); s.osc('sawtooth', 60, 900, 2.6, 0.08 * v, 0, 1500); s.osc('sine', 40, 30, 2.8, 0.3 * v); },
  eruption: (s, v) => { s.noise(2.4, 0.8 * v, 400, 90, 'lowpass'); s.osc('sine', 55, 30, 2, 0.5 * v); s.noise(1.8, 0.25 * v, 3000, 600, 'bandpass', 0.3, 1); },
  roar: (s, v) => { s.osc('sawtooth', 90, 55, 0.9, 0.25 * v, 0, 400); s.noise(0.9, 0.3 * v, 500, 150, 'lowpass'); },
  alert: (s, v) => { s.osc('square', 1200, 0, 0.08, 0.08 * v, 0, 3000); s.osc('square', 1600, 0, 0.12, 0.08 * v, 0.1, 3000); s.osc('sawtooth', 80, 60, 0.5, 0.25 * v, 0, 300); },
  correct: (s, v) => { s.osc('triangle', 784, 0, 0.18, 0.12 * v); s.osc('triangle', 1175, 0, 0.35, 0.12 * v, 0.12); },
  wrong: (s, v) => s.osc('square', 220, 160, 0.28, 0.07 * v, 0, 900),
  dash: (s, v) => s.noise(0.35, 0.25 * v, 600, 2400, 'bandpass', 0, 2),
  shield: (s, v) => { s.osc('square', 340, 700, 0.12, 0.12 * v, 0, 1800); s.noise(0.15, 0.2 * v, 4000, 1500, 'bandpass', 0, 3); },
  heartbeat: (s, v) => { s.osc('sine', 60, 40, 0.18, 0.5 * v); s.osc('sine', 55, 38, 0.18, 0.4 * v, 0.22); },
  click: (s, v) => s.osc('square', 1200, 0, 0.04, 0.03 * v, 0, 4000),
  sting: (s, v) => { s.osc('sawtooth', 1400, 600, 0.15, 0.08 * v, 0, 3000); s.noise(0.2, 0.15 * v, 5000, 2000, 'highpass'); },
};
