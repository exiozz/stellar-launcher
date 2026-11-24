'use strict';
// Procedural art for mods: emote-wheel themes (square, drawn inside a circle) and
// effect cursors (64x64, hotspot at the centre — Roblox centres the cursor image on the mouse).
// Everything is drawn here, so it costs nothing in game: Roblox just shows a PNG.

const OrbitArt = (() => {
  const TAU = Math.PI * 2;
  const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

  // ---------- helpers ----------
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); };
  function radial(ctx, S, stops, cx = 0.5, cy = 0.5, r = 0.5) {
    const g = ctx.createRadialGradient(S * cx, S * cy, 0, S * cx, S * cy, S * r);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  }
  function vertical(ctx, S, top, bottom) {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    return g;
  }
  function fillDisc(ctx, S, fill, frac = 0.5) {
    circle(ctx, S / 2, S / 2, S * frac);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function emoji(ctx, ch, x, y, size, rot = 0, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, size * 0.04);
    ctx.restore();
  }
  function ringOf(ctx, S, chars, count, rFrac, sizeFrac, offset = 0) {
    for (let i = 0; i < count; i++) {
      const a = offset + (i * TAU) / count - Math.PI / 2;
      emoji(ctx, chars[i % chars.length], S / 2 + Math.cos(a) * S * rFrac, S / 2 + Math.sin(a) * S * rFrac, S * sizeFrac);
    }
  }
  function scatter(ctx, S, chars, n, seed, minSize, maxSize, alpha = 1, rMax = 0.46) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * S * rMax;
      emoji(ctx, chars[i % chars.length], S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (minSize + r() * (maxSize - minSize)), (r() - 0.5) * 1.2, alpha);
    }
  }
  function stars(ctx, S, n, seed, color = '#fff', maxR = 2.6) {
    const r = rng(seed);
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * S * 0.49;
      ctx.globalAlpha = 0.35 + r() * 0.65;
      circle(ctx, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, (0.6 + r() * maxR) * (S / 600));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  /** Scalloped (lace) border: a ring of bumps plus the disc they sit on. */
  function scallop(ctx, S, rFrac, bumps, bumpFrac, fill) {
    ctx.fillStyle = fill;
    for (let i = 0; i < bumps; i++) {
      const a = (i * TAU) / bumps;
      circle(ctx, S / 2 + Math.cos(a) * S * rFrac, S / 2 + Math.sin(a) * S * rFrac, S * bumpFrac);
      ctx.fill();
    }
    fillDisc(ctx, S, fill, rFrac);
  }
  function starPath(ctx, x, y, outer, inner, points, rot = -Math.PI / 2) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? inner : outer, a = rot + (i * Math.PI) / points;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.35);
    ctx.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.45, y - s * 0.95, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.45, y - s * 0.95, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
    ctx.closePath();
  }
  /** Centre disc where Roblox writes the emote name: kept darker so white text stays readable. */
  function centre(ctx, S, fill, stroke) {
    fillDisc(ctx, S, fill, 0.2);
    if (stroke) {
      ctx.lineWidth = S * 0.008;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }
  function clip(ctx, S, frac = 0.5) {
    circle(ctx, S / 2, S / 2, S * frac);
    ctx.clip();
  }

  // ---------- emote wheel themes ----------
  const themes = [
    { id: 'kawaii-rose', name: 'Rose kawaii', draw(ctx, S) {
      scallop(ctx, S, 0.47, 30, 0.032, '#ffffff');
      ctx.save(); clip(ctx, S, 0.455);
      ctx.fillStyle = radial(ctx, S, [[0, '#ffeef6'], [1, '#ffb3d1']]); ctx.fillRect(0, 0, S, S);
      stars(ctx, S, 70, 7, '#ffffff', 3);
      ctx.restore();
      ringOf(ctx, S, ['💖', '🎀'], 12, 0.36, 0.07);
      centre(ctx, S, 'rgba(214, 72, 135, .65)', '#ffffff');
    } },
    { id: 'pattes', name: 'Pattes de chat', draw(ctx, S) {
      scallop(ctx, S, 0.47, 34, 0.03, '#262626');
      fillDisc(ctx, S, '#ffffff', 0.445);
      ctx.save(); clip(ctx, S, 0.43);
      ctx.fillStyle = radial(ctx, S, [[0, '#ffffff'], [1, '#e7e2dc']]); ctx.fillRect(0, 0, S, S);
      scatter(ctx, S, ['🐾'], 26, 3, 0.05, 0.085, 0.55, 0.42);
      ctx.restore();
      ringOf(ctx, S, ['🐱', '🐾'], 8, 0.36, 0.065, Math.PI / 8);
      centre(ctx, S, 'rgba(40, 40, 40, .7)', '#ffffff');
    } },
    { id: 'nuit', name: 'Nuit étoilée', draw(ctx, S) {
      fillDisc(ctx, S, vertical(ctx, S, '#121844', '#4a2b7c'));
      ctx.save(); clip(ctx, S); stars(ctx, S, 220, 11); ctx.restore();
      scatter(ctx, S, ['✨'], 7, 5, 0.04, 0.06, 0.95, 0.42);
      emoji(ctx, '🌙', S / 2, S * 0.13, S * 0.1);
      circle(ctx, S / 2, S / 2, S * 0.49); ctx.lineWidth = S * 0.01; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();
      centre(ctx, S, 'rgba(0, 0, 0, .4)', 'rgba(255,255,255,.5)');
    } },
    { id: 'sakura', name: 'Sakura', draw(ctx, S) {
      fillDisc(ctx, S, radial(ctx, S, [[0, '#fff7fb'], [1, '#ffc4da']]));
      ctx.save(); clip(ctx, S); scatter(ctx, S, ['🌸'], 22, 9, 0.03, 0.05, 0.45); ctx.restore();
      ringOf(ctx, S, ['🌸'], 10, 0.39, 0.08);
      circle(ctx, S / 2, S / 2, S * 0.49); ctx.lineWidth = S * 0.012; ctx.strokeStyle = '#ff9cc2'; ctx.stroke();
      centre(ctx, S, 'rgba(200, 70, 120, .6)', '#ffffff');
    } },
    { id: 'gothique', name: 'Gothique', draw(ctx, S) {
      scallop(ctx, S, 0.47, 36, 0.03, '#ffffff');
      fillDisc(ctx, S, '#0c0c0c', 0.455);
      scallop(ctx, S, 0.43, 40, 0.012, '#ffffff');
      fillDisc(ctx, S, radial(ctx, S, [[0, '#2a2a2a'], [1, '#050505']]), 0.425);
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8 + Math.PI / 8 - Math.PI / 2;
        starPath(ctx, S / 2 + Math.cos(a) * S * 0.34, S / 2 + Math.sin(a) * S * 0.34, S * 0.035, S * 0.008, 4, 0);
        ctx.fillStyle = '#ffffff'; ctx.fill();
      }
      ringOf(ctx, S, ['🖤', '🕸️'], 8, 0.36, 0.05);
      centre(ctx, S, '#141414', '#ffffff');
    } },
    { id: 'galaxie', name: 'Galaxie', draw(ctx, S) {
      fillDisc(ctx, S, '#0a0820');
      ctx.save(); clip(ctx, S);
      for (const [x, y, c] of [[0.35, 0.35, 'rgba(139,92,246,.6)'], [0.68, 0.62, 'rgba(34,211,238,.5)'], [0.62, 0.28, 'rgba(236,72,153,.4)'], [0.3, 0.72, 'rgba(99,102,241,.45)']]) {
        ctx.fillStyle = radial(ctx, S, [[0, c], [1, 'rgba(0,0,0,0)']], x, y, 0.38); ctx.fillRect(0, 0, S, S);
      }
      stars(ctx, S, 240, 21);
      ctx.restore();
      emoji(ctx, '🪐', S * 0.76, S * 0.26, S * 0.09);
      scatter(ctx, S, ['✨', '⭐'], 6, 13, 0.035, 0.05, 0.9, 0.42);
      centre(ctx, S, 'rgba(0, 0, 0, .45)', 'rgba(255,255,255,.45)');
    } },
    { id: 'bonbon', name: 'Bonbon', draw(ctx, S) {
      const bands = ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'];
      bands.forEach((c, i) => fillDisc(ctx, S, c, 0.5 - i * 0.0375));
      ringOf(ctx, S, ['🍭', '🍬'], 10, 0.39, 0.07);
      centre(ctx, S, 'rgba(150, 100, 220, .75)', '#ffffff');
    } },
    { id: 'nuages', name: 'Nuages', draw(ctx, S) {
      fillDisc(ctx, S, vertical(ctx, S, '#86cfff', '#e6f6ff'));
      ctx.save(); clip(ctx, S); scatter(ctx, S, ['☁️'], 12, 4, 0.09, 0.14, 0.95); ctx.restore();
      emoji(ctx, '🌈', S / 2, S * 0.14, S * 0.13);
      centre(ctx, S, 'rgba(40, 120, 200, .6)', '#ffffff');
    } },
    { id: 'ourson', name: 'Ourson', draw(ctx, S) {
      scallop(ctx, S, 0.47, 30, 0.032, '#c89a62');
      fillDisc(ctx, S, radial(ctx, S, [[0, '#fff8e8'], [1, '#f3d7a4']]), 0.45);
      ringOf(ctx, S, ['🧸', '🍯', '🐝'], 9, 0.36, 0.07);
      centre(ctx, S, 'rgba(140, 95, 50, .7)', '#fff3dc');
    } },
    { id: 'pique-nique', name: 'Pique-nique', draw(ctx, S) {
      fillDisc(ctx, S, '#ffffff');
      ctx.save(); clip(ctx, S);
      const step = S / 16;
      ctx.fillStyle = 'rgba(255, 105, 140, .35)';
      for (let i = 0; i < 16; i += 2) { ctx.fillRect(i * step, 0, step, S); ctx.fillRect(0, i * step, S, step); }
      ctx.restore();
      circle(ctx, S / 2, S / 2, S * 0.49); ctx.lineWidth = S * 0.014; ctx.strokeStyle = '#ff6f91'; ctx.stroke();
      ringOf(ctx, S, ['🍓', '🍒'], 10, 0.38, 0.07);
      centre(ctx, S, 'rgba(224, 66, 94, .7)', '#ffffff');
    } },
  ];

  // ---------- effect cursors (64x64, hotspot at 32,32) ----------
  const ARROW = [[0, 0], [0, 20], [5, 15.5], [9, 24], [12.5, 22.5], [8.8, 14.6], [15.5, 14.6]];
  function path(ctx, pts, ox, oy) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x, oy + y) : ctx.moveTo(ox + x, oy + y)));
    ctx.closePath();
  }
  const glow = (ctx, c, blur = 8) => { ctx.shadowColor = c; ctx.shadowBlur = blur; };
  const noGlow = (ctx) => { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; };
  // Light halo + soft drop shadow: readable on both dark and bright game backgrounds.
  const emojiCursor = (ch) => (ctx) => {
    ctx.shadowColor = 'rgba(255,255,255,.95)'; ctx.shadowBlur = 5;
    emoji(ctx, ch, 32, 32, 30);
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    emoji(ctx, ch, 32, 32, 30);
  };

  const cursors = [
    { id: 'neon', name: 'Néon', color: '#4fd1ff', draw(ctx, c) {
      path(ctx, ARROW, 32, 32);
      glow(ctx, c, 9); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = c; ctx.lineJoin = 'round'; ctx.stroke();
    } },
    { id: 'neon-cross', name: 'Viseur néon', color: '#3ddc97', draw(ctx, c) {
      ctx.lineCap = 'round';
      for (const [a, b, d, e] of [[32, 19, 32, 27], [32, 37, 32, 45], [19, 32, 27, 32], [37, 32, 45, 32]]) {
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(d, e);
        glow(ctx, c, 8); ctx.lineWidth = 3.4; ctx.strokeStyle = c; ctx.stroke();
        noGlow(ctx); ctx.lineWidth = 1.2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      }
      glow(ctx, c, 6); circle(ctx, 32, 32, 1.8); ctx.fillStyle = '#ffffff'; ctx.fill();
    } },
    { id: 'glow-dot', name: 'Point lumineux', color: '#ff5cc8', draw(ctx, c) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 13);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, c); g.addColorStop(1, 'rgba(0,0,0,0)');
      circle(ctx, 32, 32, 13); ctx.fillStyle = g; ctx.fill();
      circle(ctx, 32, 32, 3); ctx.fillStyle = '#ffffff'; ctx.fill();
    } },
    { id: 'heart', name: 'Cœur', color: '#ff5c9a', draw(ctx, c) {
      heartPath(ctx, 32, 34, 15);
      const g = ctx.createLinearGradient(20, 20, 44, 46);
      g.addColorStop(0, '#ffd1e4'); g.addColorStop(1, c);
      glow(ctx, c, 8); ctx.fillStyle = g; ctx.fill();
      noGlow(ctx); ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    } },
    { id: 'star', name: 'Étoile', color: '#ffc94d', draw(ctx, c) {
      starPath(ctx, 32, 33, 14, 6, 5);
      const g = ctx.createLinearGradient(20, 18, 44, 46);
      g.addColorStop(0, '#fff7c2'); g.addColorStop(1, c);
      glow(ctx, c, 9); ctx.fillStyle = g; ctx.fill();
      noGlow(ctx); ctx.lineWidth = 1.6; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round'; ctx.stroke();
    } },
    { id: 'sparkle', name: 'Étincelle', color: '#b28bff', draw(ctx, c) {
      starPath(ctx, 32, 32, 16, 3.6, 4);
      glow(ctx, c, 10); ctx.fillStyle = '#ffffff'; ctx.fill();
      glow(ctx, c, 4); starPath(ctx, 32, 32, 9, 2.2, 4, -Math.PI / 4); ctx.fillStyle = c; ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1;
    } },
    { id: 'rainbow', name: 'Arc-en-ciel', color: '#ffffff', draw(ctx) {
      const g = ctx.createConicGradient(0, 32, 32);
      ['#ff5c5c', '#ffc94d', '#3ddc97', '#4fd1ff', '#8b7bff', '#ff5cc8', '#ff5c5c'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
      circle(ctx, 32, 32, 10); ctx.lineWidth = 4.5; ctx.strokeStyle = g; glow(ctx, 'rgba(255,255,255,.6)', 5); ctx.stroke();
      noGlow(ctx); circle(ctx, 32, 32, 2.6); ctx.fillStyle = '#ffffff'; ctx.fill();
    } },
    { id: 'paw', name: 'Patte', draw: emojiCursor('🐾') },
    { id: 'sakura', name: 'Sakura', draw: emojiCursor('🌸') },
    { id: 'ribbon', name: 'Ruban', draw: emojiCursor('🎀') },
    { id: 'love', name: 'Cœur brillant', draw: emojiCursor('💖') },
    { id: 'ghost', name: 'Fantôme', draw: emojiCursor('👻') },
    { id: 'strawberry', name: 'Fraise', draw: emojiCursor('🍓') },
    { id: 'kitty', name: 'Chat', draw: emojiCursor('🐱') },
  ];

  // ---------- rendering ----------
  function canvasFor(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }
  async function toPngBytes(canvas) {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }
  const cursorColor = (preset, userColor) => (userColor && userColor.toLowerCase() !== '#ffffff' ? userColor : preset.color || '#ffffff');

  function drawCursor(preset, userColor, canvas = canvasFor(64)) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.save();
    preset.draw(ctx, cursorColor(preset, userColor));
    ctx.restore();
    return canvas;
  }
  function drawTheme(theme, size) {
    const canvas = canvasFor(size);
    theme.draw(canvas.getContext('2d'), size);
    return canvas;
  }
  /** Decodes any image the browser can read (PNG/JPG/WebP/GIF) and re-encodes it as PNG. */
  async function reencode(bytes) {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    return toPngBytes(canvas);
  }

  return { themes, cursors, drawCursor, drawTheme, toPngBytes, reencode };
})();
