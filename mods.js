// Bloxstrap-style mods: replace files inside the Roblox version folder (cursor, font,
// emote wheel colours, death sound). Every original is backed up before the first
// overwrite and restored when the mod is turned off, so mods are fully reversible.
const { nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = '.orbit-originals';
const ABSENT = '.absent'; // marker: the file did not exist before Stellar created it

// Current cursors + the legacy ones some games' Mouse object still falls back to.
// (A game that sets its own Mouse.Icon / MouseIcon always overrides these.)
const CURSOR_FILES = [
  'textures/Cursors/KeyboardMouse/ArrowCursor.png',
  'textures/Cursors/KeyboardMouse/ArrowFarCursor.png',
  'textures/ArrowCursor.png',
  'textures/ArrowFarCursor.png',
];
const EMOTE_PARTS = ['CircleBackground', 'SegmentedCircle', 'SelectedGradient', 'SelectedLine'];
const EMOTE_FILES = ['Large', 'Small', 'TenFoot'].flatMap((size) =>
  EMOTE_PARTS.flatMap((part) => ['', '@2x', '@3x'].map((scale) => `textures/ui/Emotes/${size}/${part}${scale}.png`))
);
const DEATH_SOUND = 'sounds/ouch.ogg';
const CLASSIC_OOF = 'sounds/oof.ogg';
// Character sounds shipped in content/sounds (Roblox's audio engine detects the format from the data).
const CHAR_SOUNDS = {
  jump: 'sounds/action_jump.mp3',
  land: 'sounds/action_jump_land.mp3',
  steps: 'sounds/action_footsteps_plastic.mp3',
  falling: 'sounds/action_falling.ogg',
  getup: 'sounds/action_get_up.mp3',
  swim: 'sounds/action_swim.mp3',
  splash: 'sounds/impact_water.mp3',
  explosion: 'sounds/impact_explosion_03.mp3',
};
const charSoundFile = (modsDir, slot) => path.join(modsDir, 'sound-' + slot + '.bin');

/** 0.1 s of silence as a 16-bit mono WAV, used to mute a sound. */
function silentWav() {
  const rate = 22050, n = rate / 10, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
// Old Escape-menu key hint images. The current menu draws these keys as text, so the feature was
// removed; the section below only restores originals for anyone who had replaced them.
const MENU_ICONS = {
  leave: 'textures/ui/Settings/Help/LeaveIcon.png',
  reset: 'textures/ui/Settings/Help/ResetIcon.png',
  escape: 'textures/ui/Settings/Help/EscapeIcon.png',
};
const FONT_TARGETS = ['fonts/OrbitCustom.ttf', 'fonts/OrbitCustom.otf'];

const CURSOR_STYLES = ['default', 'dot', 'crosshair', 'circle', 'arrow', 'custom'];

// ---------- backup / restore ----------
const contentDir = (versionDir) => path.join(versionDir, 'content');
const backupPath = (versionDir, rel) => path.join(versionDir, BACKUP_DIR, rel);

/** Original bytes of a content file (from the backup if Stellar already replaced it), or null if absent. */
function readOriginal(versionDir, rel) {
  const b = backupPath(versionDir, rel);
  if (fs.existsSync(b)) return fs.readFileSync(b);
  if (fs.existsSync(b + ABSENT)) return null;
  const live = path.join(contentDir(versionDir), rel);
  return fs.existsSync(live) ? fs.readFileSync(live) : null;
}

function writeModded(versionDir, rel, data) {
  const live = path.join(contentDir(versionDir), rel);
  const b = backupPath(versionDir, rel);
  if (!fs.existsSync(b) && !fs.existsSync(b + ABSENT)) {
    fs.mkdirSync(path.dirname(b), { recursive: true });
    if (fs.existsSync(live)) fs.copyFileSync(live, b);
    else fs.writeFileSync(b + ABSENT, '');
  }
  fs.mkdirSync(path.dirname(live), { recursive: true });
  fs.writeFileSync(live, data);
}

function restore(versionDir, rel) {
  const live = path.join(contentDir(versionDir), rel);
  const b = backupPath(versionDir, rel);
  if (fs.existsSync(b)) {
    fs.copyFileSync(b, live);
    fs.unlinkSync(b);
  } else if (fs.existsSync(b + ABSENT)) {
    if (fs.existsSync(live)) fs.unlinkSync(live);
    fs.unlinkSync(b + ABSENT);
  }
}

// ---------- pixel helpers (Electron bitmaps are premultiplied BGRA) ----------
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Tints a white/grey UI image with a colour, keeping its shading and alpha. */
function recolor(pngBuffer, rgb) {
  const img = nativeImage.createFromBuffer(pngBuffer);
  const { width, height } = img.getSize();
  const px = Buffer.from(img.toBitmap());
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (!a) continue;
    // unpremultiply
    const b = (px[i] * 255) / a, g = (px[i + 1] * 255) / a, r = (px[i + 2] * 255) / a;
    const lum = Math.max(r, g, b) / 255;
    const out = rgb.map((c) => c * lum + 255 * Math.pow(lum, 8) * 0.25);
    px[i] = clamp((out[2] * a) / 255);
    px[i + 1] = clamp((out[1] * a) / 255);
    px[i + 2] = clamp((out[0] * a) / 255);
  }
  return nativeImage.createFromBitmap(px, { width, height }).toPNG();
}

// ---------- cursor generator (signed distance fields, 4x4 supersampling) ----------
const len = (x, y) => Math.hypot(x, y);
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return len(pax - bax * h, pay - bay * h);
}
function sdPolygon(px, py, v) {
  let d = (px - v[0][0]) ** 2 + (py - v[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    const wx = px - v[i][0], wy = py - v[i][1];
    const h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, (wx - ex * h) ** 2 + (wy - ey * h) ** 2);
    const c1 = py >= v[i][1], c2 = py < v[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// Roblox draws the cursor image centred on the mouse position (32,32).
const SHAPES = {
  dot: (x, y) => len(x - 32, y - 32) - 4.5,
  circle: (x, y) => Math.min(Math.abs(len(x - 32, y - 32) - 9) - 1.3, len(x - 32, y - 32) - 1.8),
  crosshair: (x, y) =>
    Math.min(
      sdSegment(x, y, 32, 21, 32, 28) - 1.3,
      sdSegment(x, y, 32, 36, 32, 43) - 1.3,
      sdSegment(x, y, 21, 32, 28, 32) - 1.3,
      sdSegment(x, y, 36, 32, 43, 32) - 1.3,
      len(x - 32, y - 32) - 1.6
    ),
  arrow: (x, y) => sdPolygon(x, y, [[32, 32], [32, 50], [36.5, 45.5], [40, 53], [43, 51.6], [39.6, 44.4], [45.5, 44.4]]),
};

function drawCursor(style, hex, outlineWidth = 1.6) {
  const sd = SHAPES[style];
  const [R, G, B] = hexToRgb(hex);
  const size = 64, ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let fill = 0, edge = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const d = sd(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
          if (d <= 0) fill++;
          else if (d <= outlineWidth) edge++;
        }
      }
      const n = ss * ss;
      const fa = fill / n, ea = (edge / n) * 0.85; // dark outline for visibility on any background
      const a = fa + ea * (1 - fa);
      if (!a) continue;
      const i = (y * size + x) * 4;
      // premultiplied BGRA: fill colour over black outline
      px[i] = clamp(B * fa);
      px[i + 1] = clamp(G * fa);
      px[i + 2] = clamp(R * fa);
      px[i + 3] = clamp(a * 255);
    }
  }
  return nativeImage.createFromBitmap(px, { width: size, height: size }).toPNG();
}

function cursorPng(cfg, modsDir) {
  if (cfg.cursorStyle === 'custom') {
    const f = path.join(modsDir, 'cursor.png');
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  }
  return SHAPES[cfg.cursorStyle] ? drawCursor(cfg.cursorStyle, cfg.cursorColor) : null;
}

/** Loads an image from a file path or PNG/JPG bytes, rejecting anything unreadable or huge. */
function loadImage(src) {
  const img = typeof src === 'string' ? nativeImage.createFromPath(src) : nativeImage.createFromBuffer(Buffer.from(src));
  if (img.isEmpty()) throw new Error('Image illisible (PNG ou JPG attendu)');
  const { width, height } = img.getSize();
  if (width > 4096 || height > 4096) throw new Error('Image trop grande (4096 px max)');
  return img;
}

/** Normalises an image (path or bytes) to a 64x64 PNG cursor. */
function importCursor(src, modsDir) {
  const img = loadImage(src);
  fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(path.join(modsDir, 'cursor.png'), img.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
}

const WHEEL_SIZE = 1200;

/** Centre-crops an image to a square, resizes it and cuts it to an anti-aliased circle. */
function importEmoteImage(src, modsDir) {
  let img = loadImage(src);
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  img = img.resize({ width: WHEEL_SIZE, height: WHEEL_SIZE, quality: 'best' });
  const px = Buffer.from(img.toBitmap());
  const c = WHEEL_SIZE / 2;
  for (let y = 0; y < WHEEL_SIZE; y++) {
    for (let x = 0; x < WHEEL_SIZE; x++) {
      const cover = Math.max(0, Math.min(1, c - Math.hypot(x + 0.5 - c, y + 0.5 - c)));
      if (cover >= 1) continue;
      const i = (y * WHEEL_SIZE + x) * 4; // premultiplied: scale every channel
      for (let k = 0; k < 4; k++) px[i + k] = Math.round(px[i + k] * cover);
    }
  }
  fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(path.join(modsDir, 'emote-wheel.png'), nativeImage.createFromBitmap(px, { width: WHEEL_SIZE, height: WHEEL_SIZE }).toPNG());
}

const sizeOf = (buf) => nativeImage.createFromBuffer(buf).getSize();

/**
 * Roblox's emote wheel draws its dark background with code (a Frame), not with
 * CircleBackground.png, so the only wheel-sized image it really displays is
 * SegmentedCircle.png (the separators, drawn above the background). A theme is
 * therefore composited into that image: theme at `opacity`, separators on top.
 */
// Layers, bottom to top: theme (at `opacity`, cut to the circle) -> separator lines -> stickers
// (full opacity, not cut to the circle, so they can also sit in the corners around the wheel).
function composeWheel(wheelImg, { width, height }, linesPng, opacity, stickersImg = null) {
  const out = wheelImg ? Buffer.from(wheelImg.resize({ width, height, quality: 'best' }).toBitmap()) : Buffer.alloc(width * height * 4);
  if (wheelImg) for (let i = 0; i < out.length; i++) out[i] = Math.round(out[i] * opacity); // premultiplied: scale all channels
  const over = (src) => {
    for (let i = 0; i < out.length; i += 4) {
      const a = src[i + 3] / 255;
      if (!a) continue;
      for (let k = 0; k < 4; k++) out[i + k] = clamp(src[i + k] + out[i + k] * (1 - a)); // source-over
    }
  };
  if (linesPng) over(nativeImage.createFromBuffer(linesPng).toBitmap());
  if (stickersImg) over(stickersImg.resize({ width, height, quality: 'best' }).toBitmap());
  return nativeImage.createFromBitmap(out, { width, height }).toPNG();
}

/** Saves the sticker layer (square PNG, transparent, not cut to a circle). */
function importStickerLayer(src, modsDir) {
  const img = loadImage(src).resize({ width: WHEEL_SIZE, height: WHEEL_SIZE, quality: 'best' });
  fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(path.join(modsDir, 'emote-stickers.png'), img.toPNG());
}

// ---------- apply ----------
/**
 * Brings one Roblox version folder in line with the mod config.
 * cfg: { cursorStyle, cursorColor, emoteColor, modFont: {ext}|null, deathSound: bool }
 */
// ---------- what is already applied (so unchanged mods are skipped) ----------
const statePath = (versionDir) => path.join(versionDir, BACKUP_DIR, 'state.json');
function readState(versionDir) {
  try {
    return JSON.parse(fs.readFileSync(statePath(versionDir), 'utf8'));
  } catch {
    return {};
  }
}
function writeState(versionDir, state) {
  fs.mkdirSync(path.dirname(statePath(versionDir)), { recursive: true });
  fs.writeFileSync(statePath(versionDir), JSON.stringify(state));
}
const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);

// Lets the main process handle other work (clicks, IPC) between heavy files.
const yieldToLoop = () => new Promise((r) => setImmediate(r));

/**
 * Brings one Roblox version folder in line with the mod config. Each section is skipped
 * when its inputs haven't changed since the last apply to this folder, and heavy work
 * yields between files so the launcher stays responsive.
 */
async function applyMods(versionDir, cfg, modsDir, { force = false } = {}) {
  const errors = [];
  const state = force ? {} : readState(versionDir);
  const section = async (label, key, fn) => {
    const k = JSON.stringify(key);
    if (state[label] === k) return;
    try {
      await fn();
      state[label] = k;
    } catch (e) {
      delete state[label];
      errors.push(`${label} : ${e.message}`);
    }
  };

  await section('Curseur', [cfg.cursorStyle, cfg.cursorColor, mtime(path.join(modsDir, 'cursor.png'))], () => {
    const png = cfg.cursorStyle !== 'default' ? cursorPng(cfg, modsDir) : null;
    for (const rel of CURSOR_FILES) png ? writeModded(versionDir, rel, png) : restore(versionDir, rel);
  });

  const wheelFile = path.join(modsDir, 'emote-wheel.png');
  const stickerFile = path.join(modsDir, 'emote-stickers.png');
  await section('Roue des emotes', [cfg.emoteTheme, cfg.emoteColor, cfg.emoteHideLines, cfg.emoteOpacity, cfg.emoteTheme ? mtime(wheelFile) : 0, cfg.emoteTheme ? mtime(stickerFile) : 0], async () => {
    const wheel = cfg.emoteTheme && fs.existsSync(wheelFile) ? nativeImage.createFromPath(wheelFile) : null;
    const stickers = cfg.emoteTheme && fs.existsSync(stickerFile) ? nativeImage.createFromPath(stickerFile) : null;
    const rgb = cfg.emoteColor ? hexToRgb(cfg.emoteColor) : null;
    for (const rel of EMOTE_FILES) {
      const original = readOriginal(versionDir, rel);
      if (!original) continue;
      let out = null;
      if (rel.includes('CircleBackground')) {
        out = null; // not displayed by current Roblox: keep the original
      } else if (rel.includes('SegmentedCircle')) {
        const lines = rgb ? recolor(original, rgb) : original;
        if (wheel || stickers) out = composeWheel(wheel, sizeOf(original), wheel && cfg.emoteHideLines ? null : lines, cfg.emoteOpacity, stickers);
        else if (rgb) out = lines;
      } else if (rgb) {
        out = recolor(original, rgb);
      }
      out ? writeModded(versionDir, rel, out) : restore(versionDir, rel);
      if (out) await yieldToLoop();
    }
  });

  const menuIcons = cfg.menuIcons || {};
  const menuFile = (k) => path.join(modsDir, `menu-${k}.png`);
  await section('Menu Échap', Object.keys(MENU_ICONS).map((k) => [menuIcons[k] || null, menuIcons[k] ? mtime(menuFile(k)) : 0]), () => {
    for (const [k, rel] of Object.entries(MENU_ICONS)) {
      menuIcons[k] && fs.existsSync(menuFile(k)) ? writeModded(versionDir, rel, fs.readFileSync(menuFile(k))) : restore(versionDir, rel);
    }
  });

  const deathFile = path.join(modsDir, 'death.ogg');
  await section('Son de mort', [cfg.deathSound, cfg.deathSound ? mtime(deathFile) : 0], () => {
    const oof = cfg.deathSound === 'oof' ? readOriginal(versionDir, CLASSIC_OOF) : null;
    if (oof) writeModded(versionDir, DEATH_SOUND, oof);
    else if (cfg.deathSound === true && fs.existsSync(deathFile)) writeModded(versionDir, DEATH_SOUND, fs.readFileSync(deathFile));
    else restore(versionDir, DEATH_SOUND);
  });

  const charSounds = cfg.charSounds || {};
  await section('Sons du personnage', Object.keys(CHAR_SOUNDS).map((k) => [charSounds[k] || null, charSounds[k] === 'custom' ? mtime(charSoundFile(modsDir, k)) : 0]), () => {
    for (const [k, rel] of Object.entries(CHAR_SOUNDS)) {
      const file = charSoundFile(modsDir, k);
      if (charSounds[k] === 'mute') writeModded(versionDir, rel, silentWav());
      else if (charSounds[k] === 'custom' && fs.existsSync(file)) writeModded(versionDir, rel, fs.readFileSync(file));
      else restore(versionDir, rel);
    }
  });

  const fontFile = cfg.modFont ? path.join(modsDir, `font.${cfg.modFont.ext}`) : null;
  await section('Police', [cfg.modFont, fontFile ? mtime(fontFile) : 0], async () => {
    const famDir = path.join(contentDir(versionDir), 'fonts', 'families');
    const families = fs.existsSync(famDir) ? fs.readdirSync(famDir).filter((n) => n.endsWith('.json')).map((n) => `fonts/families/${n}`) : [];
    if (fontFile && fs.existsSync(fontFile)) {
      const target = `fonts/OrbitCustom.${cfg.modFont.ext}`;
      for (const rel of FONT_TARGETS) if (rel !== target) restore(versionDir, rel);
      writeModded(versionDir, target, fs.readFileSync(fontFile));
      for (const rel of families) {
        const json = JSON.parse(readOriginal(versionDir, rel).toString('utf8'));
        for (const face of json.faces || []) face.assetId = `rbxasset://${target}`;
        writeModded(versionDir, rel, JSON.stringify(json, null, '\t'));
      }
    } else {
      for (const rel of [...FONT_TARGETS, ...families]) restore(versionDir, rel);
    }
    await yieldToLoop();
  });

  writeState(versionDir, state);
  return errors;
}

/** Previews for the UI (data URLs). */
function previews(cfg, modsDir, versionDir) {
  const toUrl = (buf) => (buf ? 'data:image/png;base64,' + buf.toString('base64') : null);
  const out = { cursors: {}, emote: null };
  for (const s of Object.keys(SHAPES)) out.cursors[s] = toUrl(drawCursor(s, cfg.cursorColor));
  const custom = path.join(modsDir, 'cursor.png');
  out.cursors.custom = fs.existsSync(custom) ? toUrl(fs.readFileSync(custom)) : null;
  if (versionDir) {
    const orig = readOriginal(versionDir, CURSOR_FILES[0]);
    out.cursors.default = orig ? toUrl(orig) : null;
    // Same composition as applyMods, at the Large/1x size Roblox uses on PC.
    const ring = readOriginal(versionDir, 'textures/ui/Emotes/Large/SegmentedCircle.png');
    if (ring) {
      const rgb = cfg.emoteColor ? hexToRgb(cfg.emoteColor) : null;
      const lines = rgb ? recolor(ring, rgb) : ring;
      const wheelFile = path.join(modsDir, 'emote-wheel.png');
      const stickerFile = path.join(modsDir, 'emote-stickers.png');
      const wheel = cfg.emoteTheme && fs.existsSync(wheelFile) ? nativeImage.createFromPath(wheelFile) : null;
      const stickers = cfg.emoteTheme && fs.existsSync(stickerFile) ? nativeImage.createFromPath(stickerFile) : null;
      out.emote = {
        ring: toUrl(wheel || stickers ? composeWheel(wheel, sizeOf(ring), wheel && cfg.emoteHideLines ? null : lines, cfg.emoteOpacity, stickers) : lines),
      };
    }
  }
  return out;
}

/** The wheel's separator lines as Roblox will draw them over a theme (for the sticker editor). */
function wheelLines(cfg, versionDir) {
  const ring = versionDir && readOriginal(versionDir, 'textures/ui/Emotes/Large/SegmentedCircle.png');
  if (!ring) return null;
  const lines = cfg.emoteColor ? recolor(ring, hexToRgb(cfg.emoteColor)) : ring;
  return 'data:image/png;base64,' + lines.toString('base64');
}

module.exports = { applyMods, previews, importCursor, importEmoteImage, importStickerLayer, wheelLines, MENU_KEYS: Object.keys(MENU_ICONS), CURSOR_STYLES, CHAR_SOUND_SLOTS: Object.keys(CHAR_SOUNDS), charSoundFile };
