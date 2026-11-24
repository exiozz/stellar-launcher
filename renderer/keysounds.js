'use strict';
// Mechanical-keyboard sounds synthesised with Web Audio (no audio files):
// a short pitched "body" thump + filtered contact noise, with small random
// variation per stroke so it never sounds like a loop. Release (key up) is softer.

const KeySounds = (() => {
  const PROFILES = {
    // label, body pitch (Hz), body decay (s), noise low-pass (Hz), noise decay, noise gain, body gain
    creamy: { name: 'Creamy', pitch: 165, decay: 0.05, lp: 2000, nDecay: 0.03, nGain: 0.32, bGain: 0.95, pop: 780 },
    thocky: { name: 'Thocky', pitch: 105, decay: 0.075, lp: 1100, nDecay: 0.035, nGain: 0.22, bGain: 1.15, pop: 520 },
    clicky: { name: 'Clicky', pitch: 260, decay: 0.025, lp: 7500, hp: 2500, nDecay: 0.014, nGain: 0.65, bGain: 0.35, pop: 2400 },
    bubble: { name: 'Bulle', pitch: 420, decay: 0.06, lp: 1600, nDecay: 0.012, nGain: 0.12, bGain: 0.7, sweep: true },
    typewriter: { name: 'Machine à écrire', pitch: 320, decay: 0.03, lp: 9000, hp: 1800, nDecay: 0.025, nGain: 0.8, bGain: 0.45, pop: 3200 },
    soft: { name: 'Doux', pitch: 140, decay: 0.035, lp: 900, nDecay: 0.02, nGain: 0.12, bGain: 0.5 },
  };

  // A user-imported sound (one sample, played with a little pitch variation).
  let custom = { id: null, buffer: null };
  async function loadCustom(id, bytes) {
    if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    custom = { id, buffer: await ctx.decodeAudioData(data) };
  }

  let ctx = null;
  const noiseFor = new WeakMap();

  function noise(c) {
    if (!noiseFor.has(c)) {
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.15), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseFor.set(c, buf);
    }
    return noiseFor.get(c);
  }

  const env = (g, t, peak, decay) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  };

  /** Schedules one key sound on context `c` at time `t` (works with OfflineAudioContext for tests). */
  function schedule(c, t, { profile = 'creamy', volume = 0.6, kind = 'key', up = false }) {
    const p = PROFILES[profile] || PROFILES.creamy;
    const vary = 1 + (Math.random() - 0.5) * 0.14;
    let pitch = p.pitch * vary;
    let gain = volume;
    if (kind === 'space') { pitch *= 0.68; gain *= 1.2; }
    else if (kind === 'enter') { pitch *= 0.82; gain *= 1.1; }
    else if (kind === 'back') pitch *= 0.92;
    if (up) { pitch *= 1.35; gain *= 0.38; }

    const out = c.createGain();
    out.gain.value = gain;
    out.connect(c.destination);

    // body: the "thock" of the keycap bottoming out
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch * (p.sweep ? 0.6 : 1.8), t);
    osc.frequency.exponentialRampToValueAtTime(pitch * (p.sweep ? 1.6 : 1), t + (p.sweep ? 0.04 : 0.018));
    const og = c.createGain();
    env(og, t, p.bGain, p.decay);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + p.decay + 0.02);

    // contact: filtered noise burst, plus a soft resonant "pop" for the creamy character
    const n = c.createBufferSource();
    n.buffer = noise(c);
    n.playbackRate.value = vary;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.lp * vary;
    let tail = lp;
    n.connect(lp);
    if (p.hp) {
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = p.hp;
      lp.connect(hp);
      tail = hp;
    }
    const ng = c.createGain();
    env(ng, t, p.nGain, p.nDecay);
    tail.connect(ng).connect(out);
    if (p.pop) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = p.pop * vary;
      bp.Q.value = 6;
      const pg = c.createGain();
      env(pg, t, p.nGain * 1.4, p.nDecay * 1.6);
      lp.connect(bp).connect(pg).connect(out);
    }
    n.start(t);
    n.stop(t + 0.12);
  }

  function play(opts) {
    if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') ctx.resume();
    if (String(opts.profile).startsWith('user:')) {
      if (opts.up || custom.id !== opts.profile || !custom.buffer) return;
      const src = ctx.createBufferSource();
      src.buffer = custom.buffer;
      src.playbackRate.value = (0.94 + Math.random() * 0.12) * (opts.kind === 'space' ? 0.85 : 1);
      const g = ctx.createGain();
      g.gain.value = opts.volume;
      src.connect(g).connect(ctx.destination);
      src.start();
      return;
    }
    schedule(ctx, ctx.currentTime, opts);
  }

  /** A short typing demo for the "Tester" button. */
  function demo(profile, volume) {
    const seq = ['key', 'key', 'key', 'space', 'key', 'key', 'back', 'key', 'enter'];
    seq.forEach((kind, i) => {
      setTimeout(() => play({ profile, volume, kind }), i * 115);
      setTimeout(() => play({ profile, volume, kind, up: true }), i * 115 + 55);
    });
  }

  return { PROFILES, play, demo, schedule, loadCustom };
})();
