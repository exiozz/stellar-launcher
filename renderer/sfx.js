'use strict';
// Interface sounds, synthesised with WebAudio (no audio files): three packs to pick from.
const Sfx = (() => {
  let ctx = null;
  let out = null;
  let enabled = true;
  let pack = 'soft';
  const lastAt = {};

  function ac() {
    if (!ctx) {
      ctx = new AudioContext();
      // gentle master chain: low-pass + soft compressor so nothing ever sounds harsh
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6500;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      out = ctx.createGain();
      out.gain.value = 0.9;
      out.connect(lp).connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // A tone with a few harmonics (a mallet / glass feel), fast attack, exponential decay.
  function mallet(freq, at, dur, vol, harmonics = [1, 0.35, 0.12]) {
    const c = ac();
    const t = c.currentTime + at;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    harmonics.forEach((h, i) => {
      if (!h) return;
      const o = c.createOscillator();
      const hg = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq * (i + 1);
      hg.gain.value = h;
      o.connect(hg).connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  // A pitched sine that glides (bubbles, whooshes).
  function glide(f0, f1, at, dur, vol, type = 'sine') {
    const c = ac();
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Filtered noise: soft ticks and air.
  let noiseBuf = null;
  function noise(at, dur, vol, f0, f1 = f0, q = 1.2) {
    const c = ac();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = c.currentTime + at;
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  const PACKS = {
    // Doux: felt-like ticks and warm mallet notes
    soft: {
      hover: () => noise(0, 0.025, 0.05, 2600, 2200, 2.5),
      move: () => (noise(0, 0.03, 0.06, 1800, 1500, 2), mallet(1046, 0, 0.09, 0.025, [1, 0.2])),
      select: () => (mallet(784, 0, 0.22, 0.07), mallet(1175, 0.06, 0.3, 0.06)),
      back: () => (mallet(880, 0, 0.18, 0.06), mallet(587, 0.06, 0.26, 0.055)),
      page: () => noise(0, 0.22, 0.05, 500, 2400, 0.9),
    },
    // Console: crisp glassy clicks, a little "sparkle" on confirm
    console: {
      hover: () => mallet(2093, 0, 0.05, 0.02, [1, 0, 0.3]),
      move: () => mallet(1568, 0, 0.07, 0.04, [1, 0, 0.25]),
      select: () => (mallet(1318, 0, 0.16, 0.06, [1, 0, 0.3]), mallet(1976, 0.05, 0.25, 0.05, [1, 0, 0.2]), noise(0.05, 0.12, 0.02, 7000, 9000, 3)),
      back: () => (mallet(1568, 0, 0.12, 0.05, [1, 0, 0.25]), mallet(1046, 0.05, 0.2, 0.05, [1, 0, 0.2])),
      page: () => (noise(0, 0.18, 0.04, 1200, 4000, 1.5), mallet(2637, 0.08, 0.15, 0.02, [1])),
    },
    // Bulle: round, bouncy pops
    bubble: {
      hover: () => glide(900, 1400, 0, 0.05, 0.03),
      move: () => glide(600, 1100, 0, 0.07, 0.05),
      select: () => (glide(500, 1000, 0, 0.09, 0.06), glide(800, 1600, 0.07, 0.11, 0.05)),
      back: () => (glide(900, 600, 0, 0.09, 0.05), glide(700, 420, 0.06, 0.12, 0.05)),
      page: () => glide(300, 900, 0, 0.16, 0.05),
    },
  };
  const GAP = { hover: 45, move: 35, select: 90, back: 90, page: 90 };

  return {
    PACKS: Object.keys(PACKS),
    setEnabled(v) {
      enabled = !!v;
    },
    setPack(p) {
      if (PACKS[p]) pack = p;
    },
    play(kind, force = false) {
      if ((!enabled && !force) || !PACKS[pack][kind]) return;
      const now = performance.now();
      if (now - (lastAt[kind] || 0) < GAP[kind]) return;
      lastAt[kind] = now;
      try {
        PACKS[pack][kind]();
      } catch {
        /* audio unavailable */
      }
    },
  };
})();

// Mouse: a tick when the pointer reaches a new control, a chime on click.
(() => {
  const TARGETS = '.nav-item, .cx-tile, .cx-play, .cx-more, .cx-card-btn, .cx-tab, .game-card, .news-card, .item-card, .btn, .chip, .theme-card, .convo, .side-game, .av-item, .cat-tab';
  let hovered = null;
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest(TARGETS);
    if (t === hovered) return;
    hovered = t;
    if (t) Sfx.play('hover');
  });
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest('.nav-item')) Sfx.play('page');
      else if (e.target.closest(TARGETS)) Sfx.play('select');
    },
    true
  );
})();
