'use strict';
// Stellar's own sounds, composed and synthesised here (WebAudio, no audio files):
//  - signature(): the Stellar jingle (startup, launching a game, screensaver)
//  - ambience(on): a slow, quiet pad for the menu, like a console home screen
const StellarSound = (() => {
  let ctx = null;
  let master = null;
  let reverb = null;
  let amb = null; // { gain, stop }

  function ac() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      master.connect(comp).connect(ctx.destination);
      // generated reverb tail: decaying stereo noise
      reverb = ctx.createConvolver();
      const len = ctx.sampleRate * 3.2;
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
      reverb.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      reverb.connect(wet).connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // A bell: sine partials with inharmonic overtones, sent dry + to the reverb.
  function bell(midi, at, dur, vol) {
    const c = ac();
    const t = c.currentTime + at;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    g.connect(reverb);
    [
      [1, 1],
      [2.01, 0.35],
      [3.98, 0.12],
      [5.4, 0.05],
    ].forEach(([mult, amp]) => {
      const o = c.createOscillator();
      const og = c.createGain();
      o.frequency.value = hz(midi) * mult;
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  // A soft swelling chord (detuned saws through a low-pass).
  function pad(midis, at, dur, vol, cutoff = 1400) {
    const c = ac();
    const t = c.currentTime + at;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff * 0.4, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    g.connect(master);
    g.connect(reverb);
    for (const m of midis)
      for (const det of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
  }

  // Airy sparkle: filtered noise sweeping up.
  function shimmer(at, dur, vol) {
    const c = ac();
    const t = c.currentTime + at;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(2500, t);
    bp.frequency.exponentialRampToValueAtTime(11000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g);
    g.connect(master);
    g.connect(reverb);
    s.start(t);
  }

  // Sub "whoom" under everything.
  function sub(at, dur, vol) {
    const c = ac();
    const t = c.currentTime + at;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(48, t);
    o.frequency.exponentialRampToValueAtTime(70, t + dur * 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  let lastSig = 0;
  function signature() {
    if (config?.stellarSound === false) return;
    if (performance.now() - lastSig < 2500) return;
    lastSig = performance.now();
    try {
      // "Stel-lar": a rising fifth + octave on bells, a sparkle, then a wide Ab(add9) chord
      sub(0, 1.6, 0.22);
      shimmer(0.05, 0.9, 0.05);
      bell(68, 0.12, 1.6, 0.1); // Ab4
      bell(75, 0.32, 1.6, 0.1); // Eb5
      bell(80, 0.52, 2.2, 0.11); // Ab5
      bell(82, 0.78, 2.6, 0.09); // Bb5 (the add9 that makes it "Stellar")
      pad([56, 63, 68, 70, 75], 0.5, 3.4, 0.03, 1800);
    } catch {
      /* no audio device */
    }
  }

  // Slow chord cycle for the menu / screensaver (very quiet).
  const AMB_CHORDS = [
    [44, 56, 63, 67, 70],
    [41, 53, 60, 65, 68],
    [37, 49, 56, 60, 63],
    [39, 51, 58, 63, 67],
  ];
  function ambience(on) {
    if (!on) {
      if (amb) {
        const a = amb;
        amb = null;
        a.stop();
      }
      return;
    }
    if (amb) return;
    try {
      const c = ac();
      let i = 0;
      const play = () => {
        pad(AMB_CHORDS[i % AMB_CHORDS.length], 0, 10, 0.018, 900);
        if (i % 2 === 0) bell(AMB_CHORDS[i % AMB_CHORDS.length][3] + 12, 2 + Math.random() * 3, 3, 0.025);
        i++;
      };
      play();
      const timer = setInterval(play, 8000);
      amb = { stop: () => clearInterval(timer) };
      void c;
    } catch {
      /* no audio device */
    }
  }

  return { signature, ambience };
})();
