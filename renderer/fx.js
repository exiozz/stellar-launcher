'use strict';
// Lightweight particle trail used by the cursor-effects overlay and its preview.
// Sprites are pre-rendered once to small canvases; the loop only runs while
// particles are alive, so an idle mouse costs nothing.

const OrbitFx = (() => {
  const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

  // gravity px/s², initial speed spread, sway amplitude, life (s), spin, sprite list
  const EFFECTS = {
    sakura: { name: 'Sakura', gravity: 55, spread: 40, sway: 28, life: 2.6, spin: 2.2, sprites: ['petal', 'petal', 'petal', '🌸'] },
    stars: { name: 'Étoiles', gravity: 25, spread: 60, sway: 6, life: 1.4, spin: 3, sprites: ['✨', '⭐', 'spark'] },
    hearts: { name: 'Cœurs', gravity: -45, spread: 35, sway: 18, life: 1.8, spin: 0.6, sprites: ['💖', '💕', '💗'] },
    snow: { name: 'Neige', gravity: 40, spread: 30, sway: 22, life: 2.8, spin: 1, sprites: ['❄️', 'flake', 'flake'] },
    bubbles: { name: 'Bulles', gravity: -60, spread: 30, sway: 14, life: 2, spin: 0, sprites: ['bubble'] },
    rainbow: { name: 'Arc-en-ciel', gravity: 30, spread: 70, sway: 4, life: 1.1, spin: 0, sprites: ['dot'] },
    butterflies: { name: 'Papillons', gravity: -20, spread: 50, sway: 30, life: 2.2, spin: 0.4, sprites: ['🦋'] },
  };

  const spriteCache = new Map();
  function sprite(kind, size, hue) {
    const key = `${kind}|${size}|${hue ?? ''}`;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const c = document.createElement('canvas');
    const s = Math.ceil(size * 1.6);
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.translate(s / 2, s / 2);
    if (kind === 'petal') {
      const g = x.createLinearGradient(0, -size / 2, 0, size / 2);
      g.addColorStop(0, '#ffe4ef'); g.addColorStop(1, '#ff9cc4');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(0, -size * 0.45);
      x.bezierCurveTo(size * 0.42, -size * 0.3, size * 0.32, size * 0.32, 0, size * 0.45);
      x.bezierCurveTo(-size * 0.32, size * 0.32, -size * 0.42, -size * 0.3, 0, -size * 0.45);
      x.fill();
      x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, -size * 0.3); x.lineTo(0, size * 0.3); x.stroke();
    } else if (kind === 'flake' || kind === 'spark' || kind === 'dot') {
      const color = kind === 'dot' ? `hsl(${hue},95%,65%)` : '#ffffff';
      const g = x.createRadialGradient(0, 0, 0, 0, 0, size / 2);
      g.addColorStop(0, color); g.addColorStop(0.4, color); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(0, 0, size / 2, 0, Math.PI * 2); x.fill();
    } else if (kind === 'bubble') {
      x.strokeStyle = 'rgba(190,235,255,.9)'; x.lineWidth = Math.max(1.2, size / 14);
      x.beginPath(); x.arc(0, 0, size * 0.42, 0, Math.PI * 2); x.stroke();
      x.fillStyle = 'rgba(200,240,255,.18)'; x.fill();
      x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(-size * 0.15, -size * 0.15, size * 0.08, 0, Math.PI * 2); x.fill();
    } else {
      x.font = `${size}px ${EMOJI_FONT}`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(kind, 0, size * 0.05);
    }
    spriteCache.set(key, c);
    return c;
  }

  /** Creates a trail renderer on a canvas. Call move(x, y) with pointer positions (CSS px). */
  function create(canvas, getOptions) {
    const ctx = canvas.getContext('2d');
    const parts = [];
    let last = null, raf = 0, prevT = 0, hue = 0, carry = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(x, y) {
      const o = getOptions();
      const fx = EFFECTS[o.effect];
      if (!fx) return;
      const kind = fx.sprites[Math.floor(Math.random() * fx.sprites.length)];
      const size = (kind.length > 2 ? 12 : 18) * o.size * (0.7 + Math.random() * 0.6);
      hue = (hue + 17) % 360;
      parts.push({
        x, y, kind, size, hue,
        vx: (Math.random() - 0.5) * fx.spread,
        vy: (Math.random() - 0.5) * fx.spread * 0.6,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * fx.spin,
        phase: Math.random() * Math.PI * 2,
        age: 0,
        life: fx.life * (0.7 + Math.random() * 0.6),
        fx,
      });
      if (parts.length > 260) parts.shift(); // hard cap: never heavy
    }

    function move(x, y) {
      if (last) {
        const d = Math.hypot(x - last.x, y - last.y);
        carry += d * 0.06 * getOptions().density; // particles per px moved
        const n = Math.floor(carry);
        carry -= n;
        for (let i = 0; i < n; i++) {
          const t = (i + 1) / (n + 1);
          spawn(last.x + (x - last.x) * t, last.y + (y - last.y) * t);
        }
      }
      last = { x, y };
      if (!raf && parts.length) { prevT = performance.now(); raf = requestAnimationFrame(frame); }
    }

    function frame(t) {
      const dt = Math.min(0.05, (t - prevT) / 1000);
      prevT = t;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        p.vy += p.fx.gravity * dt;
        p.vx *= 0.985;
        p.x += (p.vx + Math.sin(p.age * 3 + p.phase) * p.fx.sway) * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        const k = p.age / p.life;
        const img = sprite(p.kind, Math.round(p.size), p.kind === 'dot' ? p.hue : undefined);
        ctx.save();
        ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.pow((k - 0.15) / 0.85, 2);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();
      }
      raf = parts.length ? requestAnimationFrame(frame) : 0;
      if (!raf) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    resize();
    window.addEventListener('resize', resize);
    return { move, reset: () => { last = null; }, resize };
  }

  return { EFFECTS, create };
})();
