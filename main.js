const { app, BrowserWindow, ipcMain, shell, dialog, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const accounts = require('./accounts');
const mods = require('./mods');
const { watchForeground } = require('./focus');
const playtime = require('./playtime');
const media = require('./media');

const isWin = process.platform === 'win32';

// ---------- Rename: "Orbit" became "Stellar" ----------
// Electron keeps data in %APPDATA%\<app name>. Move the old Orbit folder (config, logged-in
// accounts, mods, fonts, playtime…) on first start. If Orbit is still running and the folder is
// locked, keep using it for now; the move is retried on the next start.
(function migrateFromOrbit() {
  const appData = app.getPath('appData');
  const oldDir = path.join(appData, 'Orbit');
  const newDir = path.join(appData, 'Stellar');
  if (app.getPath('userData') !== newDir) return; // custom data folder (tests, portable): leave it alone
  if (fs.existsSync(newDir) || !fs.existsSync(oldDir)) return;
  try {
    fs.renameSync(oldDir, newDir);
  } catch {
    app.setPath('userData', oldDir);
  }
})();

// ---------- Config (persisted in userData) ----------
const DEFAULT_CONFIG = {
  fps: 144,
  uncapped: false,
  msaa: 0,
  renderer: 'auto',
  textureQuality: -1,
  minimizeOnLaunch: false,
  closeOnLeave: false,
  launchFx: true,
  padCursorButton: 8,
  padCursorSpeed: 1,
  stellarSound: true,
  menuMusic: false,
  idleEnabled: true,
  idleMinutes: 5,
  idleSource: 'recent',
  idleSound: true,
  navHidden: [],
  barPosition: 'left',
  uiSounds: true,
  uiSoundPack: 'soft',
  multiInstance: false,
  favorites: [],
  recent: [],
  favoriteFriends: [],
  friendSort: 'status',
  theme: 'dark',
  designVersion: 36,
  accent: 'auto',
  notifyFavorites: true,
  friendNicknames: {},
  // music
  musicHotkeys: { launcher: 'Ctrl+Shift+S', toggle: '', next: '', prev: '', show: '', player: '', volup: '', voldown: '' },
  launcherPadButton: null,
  musicPadButton: null,
  musicPlayerPos: null,
  musicPopup: true,
  accounts: [],
  activeAccountId: null,
  // graphics
  graphicsProfile: 'roblox',
  noShadows: false,
  noPostFx: false,
  noGrass: false,
  customFlags: {},
  // mods
  cursorStyle: 'default',
  cursorColor: '#ffffff',
  emoteColor: null,
  emoteTheme: null,
  emoteHideLines: false,
  emoteOpacity: 0.9,
  cursorPreset: null,
  menuIcons: { leave: null, reset: null, escape: null },
  modFont: null,
  deathSound: false,
  charSounds: {},
  ownedFlags: [],
  // keyboard sounds
  keySounds: false,
  keySoundProfile: 'creamy',
  keySoundVolume: 0.6,
  keySoundsRobloxOnly: true,
  keyIgnoreGame: true,
  // cursor effects overlay
  cursorFx: null,
  cursorFxDensity: 0.6,
  cursorFxSize: 1,
  // GPU
  forceDedicatedGpu: false,
  ownedGpuPrefs: [],
};

const isBool = (v) => typeof v === 'boolean';
const isStr = (v, max = 100) => typeof v === 'string' && v.length <= max;
const isGameRef = (g) => g && Number.isSafeInteger(g.universeId) && Number.isSafeInteger(g.placeId) && isStr(g.name, 200);
const isAccount = (a) =>
  a && Number.isSafeInteger(a.id) && isStr(a.name) && isStr(a.displayName) && accounts.PARTITION_RE.test(a.partition);
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const MUSIC_ACTIONS = ['launcher', 'toggle', 'next', 'prev', 'show', 'player', 'volup', 'voldown'];
const FX_EFFECTS = ['sakura', 'stars', 'hearts', 'snow', 'bubbles', 'rainbow', 'butterflies'];
const USER_SOUND_RE = /^user:[\w\- ]{1,60}\.(wav|mp3|ogg)$/;
const isPresetId = (v) => v === null || (typeof v === 'string' && /^[a-z0-9-]{1,30}$/.test(v));
const isImageBytes = (b) => b instanceof Uint8Array && b.length > 0 && b.length <= 12 * 1024 * 1024;
const FLAG_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const isFlagValue = (v) => typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || isStr(v, 200);
const isFlagMap = (v) =>
  v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 300 &&
  Object.entries(v).every(([k, x]) => FLAG_KEY_RE.test(k) && isFlagValue(x));

// Graphics profiles. Roblox only honours FastFlags on its allowlist and ignores the rest.
const PROFILES = {
  roblox: {},
  performance: {
    DFIntDebugFRMQualityLevelOverride: 1,
    FIntDebugForceMSAASamples: 1,
    DFFlagTextureQualityOverrideEnabled: true,
    DFIntTextureQualityOverride: 0,
    FIntRenderShadowIntensity: 0,
    FFlagDisablePostFx: true,
    FIntFRMMinGrassDistance: 0,
    FIntFRMMaxGrassDistance: 0,
  },
  balanced: { DFIntDebugFRMQualityLevelOverride: 10, FIntDebugForceMSAASamples: 2 },
  quality: {
    DFIntDebugFRMQualityLevelOverride: 17,
    FIntDebugForceMSAASamples: 4,
    DFFlagTextureQualityOverrideEnabled: true,
    DFIntTextureQualityOverride: 3,
  },
  // MSAA 8x makes ViewportFrames (item icons in many games' hotbars) render empty: stay at 4x.
  ultra: {
    DFIntDebugFRMQualityLevelOverride: 21,
    FIntDebugForceMSAASamples: 4,
    DFFlagTextureQualityOverrideEnabled: true,
    DFIntTextureQualityOverride: 3,
  },
};

const VALIDATORS = {
  fps: (v) => Number.isInteger(v) && v >= 30 && v <= 360,
  uncapped: isBool,
  msaa: (v) => [0, 1, 2, 4, 8].includes(v),
  renderer: (v) => ['auto', 'd3d11', 'vulkan'].includes(v),
  textureQuality: (v) => [-1, 0, 1, 2, 3].includes(v),
  minimizeOnLaunch: isBool,
  closeOnLeave: isBool,
  launchFx: isBool,
  musicPadButton: (v) => v === null || (Number.isInteger(v) && v >= 0 && v < 64),
  launcherPadButton: (v) => v === null || (Number.isInteger(v) && v >= 0 && v < 64),
  musicPlayerPos: (v) => v === null || (v && Number.isInteger(v.x) && Number.isInteger(v.y)),
  padCursorButton: (v) => [8, 10, 11, 16, 17].includes(v),
  padCursorSpeed: (v) => typeof v === 'number' && v >= 0.4 && v <= 2.5,
  stellarSound: isBool,
  menuMusic: isBool,
  idleEnabled: isBool,
  idleMinutes: (v) => Number.isInteger(v) && v >= 1 && v <= 30,
  idleSource: (v) => ['recent', 'favorites', 'trending'].includes(v),
  idleSound: isBool,
  navHidden: (v) => Array.isArray(v) && v.length <= 20 && v.every((x) => ["discover","news","catalog","trading","community","friends","messages","players","mods","filters","instances","accounts"].includes(x)),
  barPosition: (v) => ['left', 'right', 'top', 'bottom'].includes(v),
  uiSounds: isBool,
  uiSoundPack: (v) => ['soft', 'console', 'bubble'].includes(v),
  multiInstance: isBool,
  favorites: (v) => Array.isArray(v) && v.length <= 200 && v.every(isGameRef),
  recent: (v) => Array.isArray(v) && v.length <= 20 && v.every(isGameRef),
  favoriteFriends: (v) => Array.isArray(v) && v.length <= 1000 && v.every(Number.isSafeInteger),
  friendSort: (v) => ['status', 'az', 'za', 'recent', 'favorites'].includes(v),
  theme: (v) => ['dark', 'light', 'system', 'neon', 'sakura', 'galaxy'].includes(v),
  designVersion: (v) => Number.isInteger(v),
  accent: (v) => ['auto', 'violet', 'cyan', 'rose', 'vert', 'orange', 'rouge'].includes(v),
  notifyFavorites: isBool,
  musicHotkeys: (v) =>
    v && typeof v === 'object' && Object.keys(v).every((k) => MUSIC_ACTIONS.includes(k)) &&
    Object.values(v).every((a) => a === '' || (isStr(a, 60) && /^[A-Za-z0-9+]+$/.test(a))),
  musicPopup: isBool,
  friendNicknames: (v) =>
    v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 1000 &&
    Object.entries(v).every(([k, n]) => /^\d{1,20}$/.test(k) && typeof n === 'string' && n.length >= 1 && n.length <= 40),
  accounts: (v) => Array.isArray(v) && v.length <= 20 && v.every(isAccount),
  activeAccountId: (v) => v === null || Number.isSafeInteger(v),
  graphicsProfile: (v) => Object.hasOwn(PROFILES, v),
  noShadows: isBool,
  noPostFx: isBool,
  noGrass: isBool,
  customFlags: isFlagMap,
  cursorStyle: (v) => mods.CURSOR_STYLES.includes(v),
  cursorColor: isHex,
  emoteColor: (v) => v === null || isHex(v),
  emoteTheme: isPresetId,
  emoteHideLines: isBool,
  emoteOpacity: (v) => typeof v === 'number' && v >= 0.2 && v <= 1,
  cursorPreset: isPresetId,
  menuIcons: (v) =>
    v && typeof v === 'object' && Object.keys(v).every((k) => mods.MENU_KEYS.includes(k)) &&
    Object.values(v).every((x) => x === null || isStr(x, 40)),
  modFont: (v) => v === null || (v && isStr(v.name, 200) && ['ttf', 'otf'].includes(v.ext) && (v.id === undefined || isStr(v.id, 120))),
  deathSound: (v) => typeof v === 'boolean' || v === 'oof',
  charSounds: (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([k, x]) => mods.CHAR_SOUND_SLOTS.includes(k) && ['custom', 'mute'].includes(x)),
  keySounds: isBool,
  keySoundProfile: (v) => ['creamy', 'thocky', 'clicky', 'bubble', 'typewriter', 'soft'].includes(v) || (typeof v === 'string' && USER_SOUND_RE.test(v)),
  keySoundVolume: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  keySoundsRobloxOnly: isBool,
  keyIgnoreGame: isBool,
  cursorFx: (v) => v === null || FX_EFFECTS.includes(v),
  cursorFxDensity: (v) => typeof v === 'number' && v >= 0.1 && v <= 1,
  cursorFxSize: (v) => typeof v === 'number' && v >= 0.5 && v <= 2,
  forceDedicatedGpu: isBool,
  ownedGpuPrefs: (v) =>
    Array.isArray(v) && v.length <= 50 && v.every((o) => o && isStr(o.path, 400) && (o.prev === null || isStr(o.prev, 200))),
  ownedFlags: (v) => Array.isArray(v) && v.length <= 400 && v.every((k) => FLAG_KEY_RE.test(k)),
};
// Changed only by dedicated handlers (login, file pickers, flag writer), never directly by the renderer.
const RENDERER_LOCKED = new Set(['accounts', 'modFont', 'deathSound', 'charSounds', 'ownedFlags', 'emoteTheme', 'cursorPreset', 'ownedGpuPrefs', 'menuIcons', 'musicHotkeys', 'musicPadButton', 'launcherPadButton', 'musicPlayerPos', 'designVersion']);

const configPath = () => path.join(app.getPath('userData'), 'config.json');
let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    for (const [k, check] of Object.entries(VALIDATORS)) if (k in raw && check(raw[k])) config[k] = raw[k];
    // 3.2 redesign: first start with themes -> show the theme's own colours (Mignon pastel).
    if (!('theme' in raw)) config.accent = 'auto';
    // 3.12: the "show Stellar" shortcut is on by default for existing users too
    if (!('launcher' in (raw.musicHotkeys || {}))) config.musicHotkeys = { ...config.musicHotkeys, launcher: 'Ctrl+Shift+S' };
    // 3.6: themes reduced to Sombre / Clair / Système + 3 styles; map the old ones.
    if (!(raw.designVersion >= 36)) {
      const old = { light: 'light', pastel: 'sakura', neon: 'neon', galaxy: 'galaxy' }[raw.theme];
      Object.assign(config, { theme: old || 'dark', designVersion: 36 });
    }
  } catch {
    /* first run or unreadable file: keep defaults */
  }
  if (!config.accounts.some((a) => a.id === config.activeAccountId)) config.activeAccountId = config.accounts[0]?.id ?? null;
  // The Escape-menu key icons feature was removed (Roblox draws those keys as text): this makes
  // the next apply restore the original icon files for anyone who had set them.
  config.menuIcons = { leave: null, reset: null, escape: null };
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configPath());
}

const activeAccount = () => config.accounts.find((a) => a.id === config.activeAccountId) || null;
const publicConfig = () => ({ ...config, accounts: config.accounts.map(({ id, name, displayName }) => ({ id, name, displayName })) });
const modsDir = () => path.join(app.getPath('userData'), 'mods');

// ---------- Roblox install detection ----------
const versionsDir = () => path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Versions');

/** Version folders containing the player, newest first. */
function playerDirs() {
  let entries;
  try {
    entries = fs.readdirSync(versionsDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(versionsDir(), e.name))
    .filter((d) => fs.existsSync(path.join(d, 'RobloxPlayerBeta.exe')))
    .map((d) => ({ d, t: fs.statSync(path.join(d, 'RobloxPlayerBeta.exe')).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.d);
}

// ---------- FastFlags (ClientAppSettings.json) ----------
// Only flags Stellar wrote (config.ownedFlags) are touched; anything else in the file is preserved.
// Precedence: profile < individual settings < toggles < custom flags editor.
function flagsFromConfig(c) {
  // No FPS flag: Roblox now rejects DFIntTaskSchedulerTargetFps ("Denied local configuration"),
  // the FPS cap lives in Roblox's own settings (read by robloxUserSettings()).
  const f = { ...PROFILES[c.graphicsProfile] };
  if (c.msaa > 0) f.FIntDebugForceMSAASamples = c.msaa;
  if (c.renderer === 'd3d11') f.FFlagDebugGraphicsPreferD3D11 = true;
  if (c.renderer === 'vulkan') f.FFlagDebugGraphicsPreferVulkan = true;
  if (c.textureQuality >= 0) {
    f.DFFlagTextureQualityOverrideEnabled = true;
    f.DFIntTextureQualityOverride = c.textureQuality;
  }
  if (c.noShadows) f.FIntRenderShadowIntensity = 0;
  if (c.noPostFx) f.FFlagDisablePostFx = true;
  if (c.noGrass) Object.assign(f, { FIntFRMMinGrassDistance: 0, FIntFRMMaxGrassDistance: 0 });
  return Object.assign(f, c.customFlags);
}

// Keys Stellar has ever managed by default, so files written by older versions get cleaned too.
const LEGACY_FLAGS = [
  'DFIntTaskSchedulerTargetFps',
  'FIntDebugForceMSAASamples',
  'FFlagDebugGraphicsPreferD3D11',
  'FFlagDebugGraphicsPreferVulkan',
  'DFFlagTextureQualityOverrideEnabled',
  'DFIntTextureQualityOverride',
];

function applyFlags(dirs) {
  const flags = flagsFromConfig(config);
  const owned = new Set([...LEGACY_FLAGS, ...config.ownedFlags]);
  for (const dir of dirs) {
    const settingsDir = path.join(dir, 'ClientSettings');
    const file = path.join(settingsDir, 'ClientAppSettings.json');
    let current = {};
    if (fs.existsSync(file)) {
      try {
        current = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // Don't destroy a file we can't parse: keep a backup before rewriting.
        fs.copyFileSync(file, file + '.orbit-backup');
      }
    }
    for (const k of owned) delete current[k];
    Object.assign(current, flags);
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(current, null, 2));
  }
  config.ownedFlags = Object.keys(flags);
  saveConfig();
}

/**
 * Writes FastFlags and mods into every installed Roblox version. Runs one at a time
 * (quick successive clicks queue up instead of writing the same files concurrently).
 * `force` re-applies everything, even sections recorded as already up to date.
 */
let applyChain = Promise.resolve();
function applyAll({ force = false } = {}) {
  const queuedAt = Date.now();
  const run = applyChain.then(async () => {
    const startedAt = Date.now();
    if (process.env.ORBIT_DEBUG) console.log(`[apply] start at ${Date.now() % 100000} (queued ${startedAt - queuedAt} ms)`);
    const dirs = playerDirs();
    const errors = [];
    try {
      applyFlags(dirs);
    } catch (e) {
      errors.push(`FastFlags : ${e.message}`);
    }
    for (const dir of dirs) errors.push(...(await mods.applyMods(dir, config, modsDir(), { force })));
    if (process.env.ORBIT_DEBUG) console.log(`[apply] done at ${Date.now() % 100000} in ${Date.now() - startedAt} ms`, errors);
    return { versions: dirs.length, errors };
  });
  applyChain = run.catch(() => {});
  return run;
}

// ---------- Multi-instance ----------
// Roblox closes extra clients by checking a named singleton. Holding that name open
// from a helper process before Roblox starts lets several clients run side by side.
let mutexProc = null;

function setMultiInstance(on) {
  if (!isWin) return false;
  if (on && !mutexProc) {
    const script =
      "$m=New-Object System.Threading.Mutex($true,'ROBLOX_singletonMutex');" +
      "$e=New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,'ROBLOX_singletonEvent');" +
      '[void][Console]::In.ReadLine()';
    mutexProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const proc = mutexProc;
    proc.on('exit', () => {
      if (mutexProc === proc) mutexProc = null;
    });
  } else if (!on && mutexProc) {
    mutexProc.stdin.end();
    mutexProc.kill();
    mutexProc = null;
  }
  return !!mutexProc;
}

// ---------- GPU: dedicated graphics card for Roblox ----------
// Uses Windows' own per-app setting (Settings > Display > Graphics), which is keyed by the
// exe path. Roblox's path changes with every update, so it is re-synced at each launch.
// Stellar only touches entries it created, and restores any previous value when turned off.
const GPU_PREF_KEY = process.env.ORBIT_GPU_PREF_KEY || 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const HIGH_PERF = 'GpuPreference=2;';

const run = (cmd, args, timeout = 8000) =>
  new Promise((res) => execFile(cmd, args, { windowsHide: true, timeout }, (err, out) => res(err ? null : String(out))));

async function regGet(name) {
  const out = await run('reg', ['query', GPU_PREF_KEY, '/v', name]);
  const m = out && out.match(/REG_SZ\s+(.*)/);
  return m ? m[1].trim() : null;
}
const regSet = (name, value) => run('reg', ['add', GPU_PREF_KEY, '/v', name, '/t', 'REG_SZ', '/d', value, '/f']);
const regDelete = (name) => run('reg', ['delete', GPU_PREF_KEY, '/v', name, '/f']);

async function syncGpuPreference() {
  if (!isWin) return;
  let owned = [...config.ownedGpuPrefs];
  if (config.forceDedicatedGpu) {
    for (const dir of playerDirs()) {
      const exe = path.join(dir, 'RobloxPlayerBeta.exe');
      if (owned.some((o) => o.path === exe)) continue;
      const prev = await regGet(exe);
      if (prev === HIGH_PERF) continue; // already set by the user: not ours to manage
      if ((await regSet(exe, HIGH_PERF)) !== null) owned.push({ path: exe, prev });
    }
    // entries for Roblox versions that were deleted by an update
    for (const o of owned.filter((x) => !fs.existsSync(x.path))) await regDelete(o.path);
    owned = owned.filter((x) => fs.existsSync(x.path));
  } else {
    for (const o of owned) (o.prev ? await regSet(o.path, o.prev) : await regDelete(o.path));
    owned = [];
  }
  config.ownedGpuPrefs = owned;
  saveConfig();
}

let adaptersCache = null;
async function gpuStatus() {
  if (!adaptersCache) {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name']);
    adaptersCache = (out || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const hasNvidia = adaptersCache.some((n) => /nvidia/i.test(n));
  const running = await listInstances();
  let robloxOnNvidia = null;
  if (hasNvidia && running.length) {
    const smi = await run('nvidia-smi', []);
    if (smi !== null) robloxOnNvidia = running.some((r) => new RegExp(`\\b${r.pid}\\b[^\\n]*RobloxPlayerBeta`).test(smi));
  }
  return { adapters: adaptersCache, hasNvidia, robloxRunning: running.length > 0, robloxOnNvidia, forced: config.forceDedicatedGpu };
}

// ---------- Keyboard sounds ----------
// A global key listener so sounds play while typing in Roblox. Only the *kind* of key
// (space / enter / backspace / other) and up/down are forwarded — never which key it was.
let mainWindow = null;
let keyHook = null;
const keysDown = new Set();

function keyKind(code, K) {
  if (code === K.Space) return 'space';
  if (code === K.Enter || code === K.NumpadEnter) return 'enter';
  if (code === K.Backspace) return 'back';
  return 'key';
}

// Which app is in the foreground: a small PowerShell helper prints the foreground
// process name whenever it changes, so sounds can be limited to the Roblox window.
let focusProc = null;
let robloxFocused = false;

function setFocusWatcher(on) {
  if (!isWin) return;
  if (on && !focusProc) {
    const w = watchForeground((name) => {
      robloxFocused = name === 'RobloxPlayerBeta';
      updateFx();
    });
    focusProc = w.proc;
    w.proc.on('exit', () => {
      if (focusProc === w.proc) focusProc = null;
    });
  } else if (!on && focusProc) {
    focusProc.kill();
    focusProc = null;
    robloxFocused = false;
    updateFx();
  }
}

const syncFocusWatcher = () => setFocusWatcher((!!keyHook && config.keySoundsRobloxOnly) || !!config.cursorFx || config.musicPopup);

// ---------- Music (Windows media session: Spotify, Deezer, browser…) ----------
let mediaHelper = null;
let musicState = { app: '', label: '', title: '', artist: '', album: '', status: 'none', thumb: null };
let musicWin = null;
let musicHideTimer = null;

function startMusic() {
  if (!isWin || mediaHelper) return;
  mediaHelper = media.startMedia((s) => {
    const trackChanged = !!s.title && (s.title !== musicState.title || s.artist !== musicState.artist);
    musicState = { ...s, label: media.appLabel(s.app) };
    mainWindow?.webContents.send('music:update', musicState);
    sendPlayerState();
    if (trackChanged && config.musicPopup && robloxFocused && !playerWin?.isVisible()) showMusicPopup();
  }, onPadButton);
  const proc = mediaHelper.proc;
  proc.on('exit', () => {
    if (mediaHelper?.proc === proc) mediaHelper = null;
  });
}

/** Small "now playing" card over the game (top right), click-through, gone after 4 s. */
function showMusicPopup() {
  if (!musicState.title) return;
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const W = 380, H = 96;
  if (!musicWin) {
    musicWin = new BrowserWindow({
      width: W, height: H, transparent: true, frame: false, show: false, focusable: false, skipTaskbar: true,
      resizable: false, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload-overlay.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    musicWin.setIgnoreMouseEvents(true);
    musicWin.on('closed', () => (musicWin = null));
    musicWin.loadFile(path.join(__dirname, 'renderer', 'music-popup.html'));
  }
  musicWin.setBounds({ x: d.bounds.x + d.bounds.width - W - 24, y: d.bounds.y + 24, width: W, height: H });
  musicWin.setAlwaysOnTop(true, 'screen-saver');
  const send = () => musicWin?.webContents.send('music:popup', { ...musicState, theme: { dark: 'console', system: 'console', sakura: 'pastel' }[config.theme] || config.theme });
  if (musicWin.webContents.isLoading()) musicWin.webContents.once('did-finish-load', send);
  else send();
  musicWin.showInactive();
  clearTimeout(musicHideTimer);
  musicHideTimer = setTimeout(() => musicWin?.hide(), 4000);
}

// ---------- pinned music player (stays over the game until closed) ----------
let playerWin = null;
let padLearn = null; // resolve() while Stellar waits for "press a controller button"

function sendPlayerState() {
  if (playerWin && !playerWin.webContents.isLoading()) playerWin.webContents.send('music:popup', musicState);
}
function showPlayer(show = true) {
  if (!show) {
    playerWin?.hide();
    return false;
  }
  startMusic();
  const W = 470, H = 150;
  if (!playerWin) {
    const d = screen.getPrimaryDisplay().workArea;
    const pos = config.musicPlayerPos || { x: d.x + d.width - W - 24, y: d.y + 24 };
    playerWin = new BrowserWindow({
      x: pos.x, y: pos.y, width: W, height: H, transparent: true, frame: false, show: false, focusable: false, skipTaskbar: true,
      resizable: false, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload-overlay.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    playerWin.on('closed', () => (playerWin = null));
    playerWin.on('moved', () => {
      const [x, y] = playerWin.getPosition();
      config.musicPlayerPos = { x, y };
      saveConfig();
    });
    playerWin.webContents.on('did-finish-load', () => playerWin?.webContents.send('music:popup', musicState));
    playerWin.loadFile(path.join(__dirname, 'renderer', 'music-player.html'));
  }
  playerWin.setAlwaysOnTop(true, 'screen-saver');
  playerWin.showInactive();
  sendPlayerState();
  return true;
}
const togglePlayer = () => showPlayer(!playerWin?.isVisible());

function onPadButton(index) {
  if (padLearn) {
    const done = padLearn;
    padLearn = null;
    return done(index);
  }
  if (config.launcherPadButton !== null && index === config.launcherPadButton) return toggleLauncher();
  if (config.musicPadButton !== null && index === config.musicPadButton) togglePlayer();
}

// Show / hide Stellar from anywhere (even in game), like Steam's button.
function toggleLauncher() {
  const win = mainWindow;
  if (!win) return;
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
    win.minimize();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  // a short "always on top" wins against a game that holds the foreground
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  win.moveTop();
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  }, 400);
}

ipcMain.handle('music:player', (_e, action) => {
  if (action === 'show') return showPlayer(true);
  if (action === 'hide') return showPlayer(false);
  return togglePlayer();
});
ipcMain.handle('music:learnPad', (_e, target = 'music') => {
  const key = target === 'launcher' ? 'launcherPadButton' : 'musicPadButton';
  startMusic();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      padLearn = null;
      resolve(null);
    }, 10000);
    padLearn = (index) => {
      clearTimeout(timer);
      config[key] = index;
      saveConfig();
      resolve(index);
    };
  });
});
ipcMain.handle('music:clearPad', (_e, target = 'music') => {
  config[target === 'launcher' ? 'launcherPadButton' : 'musicPadButton'] = null;
  saveConfig();
  return publicConfig();
});

function musicAction(action) {
  if (action === 'show') return showMusicPopup();
  if (action === 'player') return togglePlayer();
  if (action === 'launcher') return toggleLauncher();
  mediaHelper?.command(action);
  // feedback in game after play/pause/skip
  if (['toggle', 'next', 'prev'].includes(action) && robloxFocused) setTimeout(showMusicPopup, 900);
}

/** (Re)registers every music hotkey; returns the actions whose shortcut could not be taken. */
function registerMusicHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [action, accel] of Object.entries(config.musicHotkeys)) {
    if (!accel) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(accel, () => musicAction(action));
    } catch {
      ok = false;
    }
    if (!ok) failed.push(action);
  }
  return failed;
}

// ---------- Cursor effects overlay ----------
// A transparent, click-through, always-on-top window over the display, shown only while
// Roblox is the foreground app. It draws a particle trail behind the mouse; nothing touches Roblox.
let fxWin = null;
let fxTimer = null;
let fxDisplayId = null;
const fxHistory = [];

const fxOptions = () => ({ effect: config.cursorFx, density: config.cursorFxDensity, size: config.cursorFxSize });

function ensureFxWindow() {
  if (fxWin) return fxWin;
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  fxDisplayId = d.id;
  fxWin = new BrowserWindow({
    ...d.bounds,
    transparent: true,
    frame: false,
    show: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  fxWin.setIgnoreMouseEvents(true);
  fxWin.setAlwaysOnTop(true, 'screen-saver');
  fxWin.webContents.on('did-finish-load', () => fxWin?.webContents.send('fx:options', fxOptions()));
  fxWin.on('closed', () => (fxWin = null));
  fxWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  return fxWin;
}

function fxTick() {
  if (!fxWin) return;
  const p = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(p);
  if (d.id !== fxDisplayId) {
    fxDisplayId = d.id;
    fxWin.setBounds(d.bounds);
    fxWin.webContents.send('fx:reset');
  }
  const prev = fxHistory[fxHistory.length - 1];
  if (prev && prev.x === p.x && prev.y === p.y) return;
  fxHistory.push(p);
  if (fxHistory.length > 3) fxHistory.shift();
  // Mouse lock (first person, shift lock, right-click camera): Roblox keeps snapping the
  // hidden cursor back to the same point (A -> B -> A). Don't draw a trail there.
  const twoAgo = fxHistory.length === 3 ? fxHistory[0] : null;
  if (twoAgo && twoAgo.x === p.x && twoAgo.y === p.y) {
    fxWin.webContents.send('fx:reset');
    return;
  }
  fxWin.webContents.send('fx:cursor', { x: p.x - d.bounds.x, y: p.y - d.bounds.y });
}

function updateFx() {
  if (config.cursorFx && robloxFocused) {
    const w = ensureFxWindow();
    if (!w.isVisible()) {
      w.showInactive();
      w.setAlwaysOnTop(true, 'screen-saver');
      w.webContents.send('fx:reset');
      fxHistory.length = 0;
    }
    if (!fxTimer) fxTimer = setInterval(fxTick, 16);
  } else {
    clearInterval(fxTimer);
    fxTimer = null;
    if (fxWin?.isVisible()) fxWin.hide();
  }
}

function setKeySounds(on) {
  if (on && !keyHook) {
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      // Movement / jump / sprint keys (physical positions, so ZQSD on AZERTY too): held all game long.
      const GAME_KEYS = new Set(
        ['W', 'A', 'S', 'D', 'Space', 'Shift', 'ShiftRight', 'Ctrl', 'CtrlRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
          .map((k) => UiohookKey[k])
          .filter((k) => k !== undefined)
      );
      const send = (type, e) => {
        if (config.keySoundsRobloxOnly && !robloxFocused) return; // typing in another app
        if (config.keyIgnoreGame && GAME_KEYS.has(e.keycode)) return;
        mainWindow?.webContents.send('keysound', { type, kind: keyKind(e.keycode, UiohookKey) });
      };
      uIOhook.on('keydown', (e) => {
        if (keysDown.has(e.keycode)) return; // ignore auto-repeat while held
        keysDown.add(e.keycode);
        send('down', e);
      });
      uIOhook.on('keyup', (e) => {
        keysDown.delete(e.keycode);
        send('up', e);
      });
      uIOhook.start();
      keyHook = uIOhook;
    } catch (err) {
      console.error('Keyboard hook unavailable:', err);
      return false;
    }
  } else if (!on && keyHook) {
    keyHook.removeAllListeners();
    keyHook.stop();
    keyHook = null;
    keysDown.clear();
  }
  syncFocusWatcher();
  return !!keyHook;
}

// ---------- Running clients ----------
// Roblox sometimes leaves RobloxPlayerBeta.exe processes behind with no window (closed or stuck
// clients, the updater stage). Only processes with a real window count as "clients".
const windowCache = { key: '', at: 0, visible: new Set() };

function visiblePids(pids) {
  const key = pids.slice().sort().join(',');
  if (key === windowCache.key && Date.now() - windowCache.at < 3000) return Promise.resolve(windowCache.visible);
  return new Promise((resolve) => {
    const ps = `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { if ($_.MainWindowHandle -ne 0) { $_.Id } }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) return resolve(new Set(pids)); // can't tell: count them all
      const visible = new Set(String(out).split(/\r?\n/).map(Number).filter(Boolean));
      Object.assign(windowCache, { key, at: Date.now(), visible });
      resolve(visible);
    });
  });
}

/** Roblox clients with a window (what the user sees as "open"). */
async function listInstances() {
  const all = await listProcesses();
  if (!all.length) return [];
  const visible = await visiblePids(all.map((p) => p.pid));
  return all.filter((p) => visible.has(p.pid));
}

/** Every RobloxPlayerBeta.exe process, including hidden leftovers. */
function listProcesses() {
  return new Promise((resolve) => {
    if (!isWin) return resolve([]);
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq RobloxPlayerBeta.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true },
      (err, out) => {
        if (err) return resolve([]);
        const rows = out.split(/\r?\n/).filter((l) => l.startsWith('"RobloxPlayerBeta.exe"'));
        resolve(
          rows.map((l) => {
            const c = l.slice(1, -1).split('","');
            // Memory column is locale-formatted ("3 332 000 Ko"): keep digits only (KB).
            return { pid: Number(c[1]), memoryMB: Math.round(Number(c[4].replace(/\D/g, '')) / 1024) };
          })
        );
      }
    );
  });
}

// ---------- Playtime (rebuilt from Roblox's logs: every game counts) ----------
// Stored in playtime.json so the history outlives Roblox's own log clean-up.
const playtimePath = () => path.join(app.getPath('userData'), 'playtime.json');
let playStore = null;
let lastScan = 0;

function loadPlayStore() {
  if (playStore) return playStore;
  try {
    const raw = JSON.parse(fs.readFileSync(playtimePath(), 'utf8'));
    playStore = raw.logs ? raw : { logs: {}, names: {} }; // older format (Stellar launches only) is replaced
  } catch {
    playStore = { logs: {}, names: {} };
  }
  return playStore;
}

let scanInFlight = null;
function refreshPlaytime(force = false) {
  // concurrent callers share the scan in progress instead of getting a half-filled store
  if (scanInFlight) return scanInFlight;
  if (!force && Date.now() - lastScan < 15000) return Promise.resolve(loadPlayStore());
  scanInFlight = doRefreshPlaytime().finally(() => (scanInFlight = null));
  return scanInFlight;
}

async function doRefreshPlaytime() {
  const store = loadPlayStore();
  lastScan = Date.now();
  const running = (await listInstances()).length > 0;
  playtime.scan(store, running);
  // fetch names of games we don't know yet
  const unknown = [...new Set(Object.values(store.logs).flatMap((l) => l.segs.map((s) => s[0])))].filter((u) => !store.names[u]).slice(0, 50);
  if (unknown.length) {
    try {
      const r = await fetch(`https://games.roblox.com/v1/games?universeIds=${unknown.join(',')}`, { signal: AbortSignal.timeout(10000) });
      for (const g of (await r.json()).data || []) store.names[g.id] = String(g.name).slice(0, 200);
    } catch {
      /* names come next time */
    }
  }
  try {
    fs.writeFileSync(playtimePath(), JSON.stringify(store));
  } catch {
    /* disk issue: keep in memory */
  }
  store.running = running;
  return store;
}
setInterval(() => refreshPlaytime(true).catch(() => {}), 60000);

// ---------- IPC ----------
ipcMain.handle('music:state', () => {
  startMusic();
  return musicState;
});
ipcMain.handle('music:cmd', (_e, cmd) => {
  if (!['toggle', 'next', 'prev', 'volup', 'voldown', 'mute'].includes(cmd)) throw new Error('Commande inconnue');
  startMusic();
  mediaHelper?.command(cmd);
});
ipcMain.handle('music:testPopup', () => {
  if (!musicState.title) throw new Error('Aucune musique détectée : lance Spotify, Deezer ou une vidéo.');
  showMusicPopup();
});
ipcMain.handle('music:setHotkey', (_e, action, accel) => {
  if (!MUSIC_ACTIONS.includes(action) || typeof accel !== 'string' || accel.length > 60 || (accel && !/^[A-Za-z0-9+]+$/.test(accel))) {
    throw new Error('Raccourci invalide');
  }
  const previous = { ...config.musicHotkeys };
  const next = { ...config.musicHotkeys };
  for (const k of MUSIC_ACTIONS) if (accel && next[k] === accel) next[k] = ''; // one shortcut = one action
  next[action] = accel;
  config.musicHotkeys = next;
  const failed = registerMusicHotkeys();
  if (failed.includes(action)) {
    config.musicHotkeys = previous;
    registerMusicHotkeys();
    throw new Error('Ce raccourci est déjà utilisé par Windows ou une autre appli : choisis-en un autre.');
  }
  saveConfig();
  return publicConfig();
});

ipcMain.handle('playtime:get', async () => {
  const store = await refreshPlaytime();
  return playtime.summarize(store, store.running);
});
ipcMain.handle('config:get', () => publicConfig());

ipcMain.handle('config:set', async (_e, partial) => {
  for (const [k, v] of Object.entries(partial || {})) {
    if (RENDERER_LOCKED.has(k) || !VALIDATORS[k] || !VALIDATORS[k](v)) throw new Error(`Valeur invalide pour ${k}`);
  }
  if ('activeAccountId' in partial && !config.accounts.some((a) => a.id === partial.activeAccountId)) {
    throw new Error('Compte inconnu');
  }
  Object.assign(config, partial);
  if ('cursorStyle' in partial && partial.cursorStyle !== 'custom') config.cursorPreset = null;
  saveConfig();
  if ('multiInstance' in partial) setMultiInstance(config.multiInstance);
  if ('closeOnLeave' in partial) syncLeaveWatcher();
  if ('forceDedicatedGpu' in partial) await syncGpuPreference();
  if ('keySoundsRobloxOnly' in partial || 'cursorFx' in partial || 'musicPopup' in partial) syncFocusWatcher();
  if (['cursorFx', 'cursorFxDensity', 'cursorFxSize'].some((k) => k in partial)) {
    fxWin?.webContents.send('fx:options', fxOptions());
    updateFx();
  }
  if ('keySounds' in partial && setKeySounds(config.keySounds) !== config.keySounds) {
    config.keySounds = false;
    saveConfig();
    throw new Error("Impossible d'écouter le clavier sur ce PC");
  }
  return publicConfig();
});

ipcMain.handle('accounts:login', async (e) => {
  const acc = await accounts.login(BrowserWindow.fromWebContents(e.sender));
  const previous = config.accounts.find((a) => a.id === acc.id);
  if (previous) await accounts.logout(previous); // re-login of the same account: drop the old session
  config.accounts = [...config.accounts.filter((a) => a.id !== acc.id), acc];
  config.activeAccountId = acc.id;
  saveConfig();
  return publicConfig();
});

ipcMain.handle('accounts:remove', async (_e, id) => {
  const acc = config.accounts.find((a) => a.id === id);
  if (!acc) return publicConfig();
  await accounts.logout(acc);
  config.accounts = config.accounts.filter((a) => a.id !== id);
  if (config.activeAccountId === id) config.activeAccountId = config.accounts[0]?.id ?? null;
  saveConfig();
  return publicConfig();
});

ipcMain.handle('flags:apply', (_e, opts) => applyAll({ force: !!opts?.force }));

ipcMain.handle('gpu:status', () => gpuStatus());

const NVIDIA_APP = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVIDIA App', 'CEF', 'NVIDIA App.exe');
ipcMain.handle('gpu:hasNvidiaApp', () => fs.existsSync(NVIDIA_APP));
ipcMain.handle('gpu:openNvidiaApp', async () => {
  if (!fs.existsSync(NVIDIA_APP)) throw new Error("L'appli NVIDIA n'est pas installée");
  const err = await shell.openPath(NVIDIA_APP);
  if (err) throw new Error(err);
});

ipcMain.handle('flags:preview', () => flagsFromConfig(config));

// ---------- mods: file pickers ----------
async function pickFile(e, title, filters, defaultPath) {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title, filters, defaultPath, properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
}

// ---------- fonts: built-in list (Roblox + Windows fonts already on the PC) + the user's library ----------
const ROBLOX_FONTS = [
  ['fredoka', 'Fredoka One', 'FredokaOne-Regular.ttf'],
  ['luckiest', 'Luckiest Guy', 'LuckiestGuy-Regular.ttf'],
  ['patrick', 'Patrick Hand', 'PatrickHand-Regular.ttf'],
  ['indie', 'Indie Flower', 'IndieFlower-Regular.ttf'],
  ['kalam', 'Kalam', 'Kalam-Regular.ttf'],
  ['comicneue', 'Comic Neue', 'ComicNeue-Angular-Bold.ttf'],
  ['pixel', 'Press Start 2P (pixel)', 'PressStart2P-Regular.ttf'],
  ['marker', 'Permanent Marker', 'PermanentMarker-Regular.ttf'],
  ['amatic', 'Amatic SC', 'AmaticSC-Bold.ttf'],
  ['bangers', 'Bangers', 'Bangers-Regular.ttf'],
  ['creepster', 'Creepster', 'Creepster-Regular.ttf'],
  ['special', 'Special Elite', 'SpecialElite-Regular.ttf'],
  ['grenze', 'Grenze Gotisch', 'GrenzeGotisch-Bold.ttf'],
  ['nunito', 'Nunito', 'Nunito-Regular.ttf'],
  ['montserrat', 'Montserrat Bold', 'Montserrat-Bold.ttf'],
];
const WINDOWS_FONTS = [
  ['comic', 'Comic Sans MS', 'comic.ttf'],
  ['inkfree', 'Ink Free', 'Inkfree.ttf'],
  ['segoeprint', 'Segoe Print', 'segoepr.ttf'],
  ['segoescript', 'Segoe Script', 'segoesc.ttf'],
  ['bradley', 'Bradley Hand', 'BRADHITC.TTF'],
  ['jokerman', 'Jokerman', 'JOKERMAN.TTF'],
  ['chiller', 'Chiller', 'CHILLER.TTF'],
  ['bahnschrift', 'Bahnschrift', 'bahnschrift.ttf'],
  ['impact', 'Impact', 'impact.ttf'],
  ['georgia', 'Georgia', 'georgia.ttf'],
];
const fontLibDir = () => path.join(modsDir(), 'fonts');

function fontCatalog() {
  const list = [];
  const ver = playerDirs()[0];
  if (ver) {
    for (const [id, name, file] of ROBLOX_FONTS) {
      const p = path.join(ver, 'content', 'fonts', file);
      if (fs.existsSync(p)) list.push({ id: `rbx:${id}`, name, group: 'Polices Roblox', path: p });
    }
  }
  for (const [id, name, file] of WINDOWS_FONTS) {
    const p = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', file);
    if (fs.existsSync(p)) list.push({ id: `win:${id}`, name, group: 'Polices Windows', path: p });
  }
  if (fs.existsSync(fontLibDir())) {
    for (const f of fs.readdirSync(fontLibDir()).filter((n) => /\.(ttf|otf)$/i.test(n))) {
      list.push({ id: `user:${f}`, name: f.replace(/\.(ttf|otf)$/i, ''), group: 'Mes polices', path: path.join(fontLibDir(), f) });
    }
  }
  return list;
}
const findFont = (id) => {
  const f = fontCatalog().find((x) => x.id === id);
  if (!f) throw new Error('Police introuvable');
  return f;
};

function useFont(f) {
  const ext = path.extname(f.path).slice(1).toLowerCase();
  fs.mkdirSync(modsDir(), { recursive: true });
  for (const x of ['ttf', 'otf']) fs.rmSync(path.join(modsDir(), `font.${x}`), { force: true });
  fs.copyFileSync(f.path, path.join(modsDir(), `font.${ext}`));
  config.modFont = { id: f.id, name: f.name.slice(0, 200), ext };
  saveConfig();
}

// ---------- keyboard sounds: the user's own sound files ----------
const keySoundDir = () => path.join(modsDir(), 'keysounds');

ipcMain.handle('keys:list', () =>
  fs.existsSync(keySoundDir())
    ? fs.readdirSync(keySoundDir()).filter((f) => USER_SOUND_RE.test(`user:${f}`)).map((f) => ({ id: `user:${f}`, name: f.replace(/\.\w+$/, '') }))
    : []
);

ipcMain.handle('keys:bytes', (_e, id) => {
  if (!USER_SOUND_RE.test(String(id))) throw new Error('Son invalide');
  return fs.readFileSync(path.join(keySoundDir(), String(id).slice(5)));
});

ipcMain.handle('keys:import', async (e) => {
  const file = await pickFile(e, 'Ajouter un son de touche', [{ name: 'Sons', extensions: ['wav', 'mp3', 'ogg'] }]);
  if (!file) return publicConfig();
  if (fs.statSync(file).size > 3 * 1024 * 1024) throw new Error('Son trop lourd (3 Mo max, un son de touche est court)');
  const ext = path.extname(file).slice(1).toLowerCase();
  const safe = path.basename(file, path.extname(file)).replace(/[^\w\- ]+/g, '_').slice(0, 60) || 'son';
  fs.mkdirSync(keySoundDir(), { recursive: true });
  fs.copyFileSync(file, path.join(keySoundDir(), `${safe}.${ext}`));
  config.keySoundProfile = `user:${safe}.${ext}`;
  saveConfig();
  return publicConfig();
});

ipcMain.handle('keys:remove', (_e, id) => {
  if (!USER_SOUND_RE.test(String(id))) throw new Error('Son invalide');
  fs.rmSync(path.join(keySoundDir(), String(id).slice(5)), { force: true });
  if (config.keySoundProfile === id) config.keySoundProfile = 'creamy';
  saveConfig();
  return publicConfig();
});

ipcMain.handle('mods:fontList', () => fontCatalog().map(({ id, name, group }) => ({ id, name, group })));

ipcMain.handle('mods:fontBytes', (_e, id) => fs.readFileSync(findFont(String(id)).path));

ipcMain.handle('mods:useFont', (_e, id) => {
  useFont(findFont(String(id)));
  return publicConfig();
});

// Adds a font file to the user's library (kept across sessions) and selects it.
ipcMain.handle('mods:pickFont', async (e) => {
  const file = await pickFile(e, 'Ajouter une police', [{ name: 'Polices', extensions: ['ttf', 'otf'] }], 'C:\\Windows\\Fonts');
  if (!file) return publicConfig();
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!['ttf', 'otf'].includes(ext)) throw new Error('Police .ttf ou .otf attendue');
  if (fs.statSync(file).size > 30 * 1024 * 1024) throw new Error('Police trop lourde (30 Mo max)');
  const safe = path.basename(file, path.extname(file)).replace(/[^\w\- ]+/g, '_').slice(0, 60) || 'police';
  fs.mkdirSync(fontLibDir(), { recursive: true });
  const dest = path.join(fontLibDir(), `${safe}.${ext}`);
  fs.copyFileSync(file, dest);
  useFont({ id: `user:${safe}.${ext}`, name: safe, path: dest });
  return publicConfig();
});

ipcMain.handle('mods:removeFont', (_e, id) => {
  const f = findFont(String(id));
  if (!f.id.startsWith('user:')) throw new Error('Seules tes polices ajoutées peuvent être supprimées');
  fs.rmSync(f.path, { force: true });
  if (config.modFont?.id === f.id) config.modFont = null;
  saveConfig();
  return publicConfig();
});

ipcMain.handle('mods:clearFont', () => {
  config.modFont = null;
  saveConfig();
  return publicConfig();
});

ipcMain.handle('mods:fontData', () => {
  if (!config.modFont) return null;
  const f = path.join(modsDir(), `font.${config.modFont.ext}`);
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
});

// Effect cursors and wheel themes are drawn by the renderer and sent as PNG bytes.
ipcMain.handle('mods:setCursorImage', (_e, bytes, presetId) => {
  if (!isImageBytes(bytes) || !isPresetId(presetId)) throw new Error('Curseur invalide');
  mods.importCursor(bytes, modsDir());
  config.cursorStyle = 'custom';
  config.cursorPreset = presetId;
  saveConfig();
  return publicConfig();
});

// baseBytes: the theme / own wheel (cut to a circle), or null for stickers only.
// stickerBytes: the sticker layer drawn on top (square, not cut), or null for none.
ipcMain.handle('mods:setEmoteImage', (_e, baseBytes, themeId, stickerBytes = null) => {
  if (!isPresetId(themeId) || !themeId) throw new Error('Thème invalide');
  if ((baseBytes && !isImageBytes(baseBytes)) || (stickerBytes && !isImageBytes(stickerBytes)) || (!baseBytes && !stickerBytes)) {
    throw new Error('Image invalide');
  }
  if (baseBytes) mods.importEmoteImage(baseBytes, modsDir());
  else fs.rmSync(path.join(modsDir(), 'emote-wheel.png'), { force: true });
  if (stickerBytes) mods.importStickerLayer(stickerBytes, modsDir());
  else fs.rmSync(path.join(modsDir(), 'emote-stickers.png'), { force: true });
  // Downloaded wheels usually draw their own separators; keep the user's choice when only stickers changed.
  if (themeId !== config.emoteTheme) config.emoteHideLines = themeId === 'custom';
  config.emoteTheme = themeId;
  saveConfig();
  return publicConfig();
});

// Returns the bytes of a user-picked image; the renderer decodes it (WebP/GIF included) and re-encodes to PNG.
ipcMain.handle('mods:pickImageFile', async (e, title) => {
  const file = await pickFile(e, String(title || 'Choisir une image').slice(0, 80), [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]);
  if (!file) return null;
  if (fs.statSync(file).size > 12 * 1024 * 1024) throw new Error('Image trop lourde (12 Mo max)');
  return fs.readFileSync(file);
});

// ---- wheel stickers: layout kept in a file so the editor can re-open and change it ----
const stickersFile = () => path.join(modsDir(), 'emote-stickers.json');
const isSticker = (s) =>
  s && ['emoji', 'image'].includes(s.kind) &&
  (s.kind === 'emoji' ? isStr(s.value, 16) : typeof s.value === 'string' && s.value.startsWith('data:image/png;base64,') && s.value.length <= 600000) &&
  [s.x, s.y].every((n) => typeof n === 'number' && n >= 0 && n <= 1) &&
  typeof s.size === 'number' && s.size >= 0.02 && s.size <= 1 && typeof s.rot === 'number' && Number.isFinite(s.rot);

ipcMain.handle('mods:getStickers', () => {
  try {
    const list = JSON.parse(fs.readFileSync(stickersFile(), 'utf8'));
    return Array.isArray(list) ? list.filter(isSticker) : [];
  } catch {
    return [];
  }
});

ipcMain.handle('mods:saveStickers', (_e, list) => {
  if (!Array.isArray(list) || list.length > 60 || !list.every(isSticker)) throw new Error('Stickers invalides');
  fs.mkdirSync(modsDir(), { recursive: true });
  fs.writeFileSync(stickersFile(), JSON.stringify(list));
  return true;
});

// The user's own wheel image is kept untouched so stickers can be re-applied over it.
ipcMain.handle('mods:saveEmoteBase', (_e, bytes) => {
  if (!isImageBytes(bytes)) throw new Error('Image invalide');
  fs.mkdirSync(modsDir(), { recursive: true });
  fs.writeFileSync(path.join(modsDir(), 'emote-base.png'), Buffer.from(bytes));
  return true;
});
ipcMain.handle('mods:emoteBase', () => {
  const f = path.join(modsDir(), 'emote-base.png');
  if (fs.existsSync(f)) return fs.readFileSync(f);
  // wheels imported before stickers existed: the applied image is the user's own wheel
  const legacy = path.join(modsDir(), 'emote-wheel.png');
  return config.emoteTheme === 'custom' && fs.existsSync(legacy) ? fs.readFileSync(legacy) : null;
});

ipcMain.handle('mods:wheelLines', () => mods.wheelLines(config, playerDirs()[0]));

ipcMain.handle('mods:clearEmoteImage', () => {
  config.emoteTheme = null;
  saveConfig();
  return publicConfig();
});

ipcMain.handle('mods:pickDeath', async (e) => {
  const file = await pickFile(e, 'Choisir un son de mort', [{ name: 'Son Ogg Vorbis', extensions: ['ogg'] }]);
  if (!file) return publicConfig();
  if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('Son trop lourd (5 Mo max)');
  fs.mkdirSync(modsDir(), { recursive: true });
  fs.copyFileSync(file, path.join(modsDir(), 'death.ogg'));
  config.deathSound = true;
  saveConfig();
  return publicConfig();
});

ipcMain.handle('mods:oofDeath', () => {
  config.deathSound = 'oof';
  saveConfig();
  return publicConfig();
});

const checkSlot = (slot) => {
  if (!mods.CHAR_SOUND_SLOTS.includes(slot)) throw new Error('Son inconnu');
  return slot;
};
ipcMain.handle('mods:pickCharSound', async (e, slot) => {
  checkSlot(slot);
  const file = await pickFile(e, 'Choisir un son', [{ name: 'Sons', extensions: ['mp3', 'ogg', 'wav'] }]);
  if (!file) return publicConfig();
  if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('Son trop lourd (5 Mo max)');
  fs.mkdirSync(modsDir(), { recursive: true });
  fs.copyFileSync(file, mods.charSoundFile(modsDir(), slot));
  config.charSounds = { ...config.charSounds, [slot]: 'custom' };
  saveConfig();
  return publicConfig();
});
ipcMain.handle('mods:setCharSound', (_e, slot, mode) => {
  checkSlot(slot);
  const next = { ...config.charSounds };
  if (mode === 'mute') next[slot] = 'mute';
  else delete next[slot];
  config.charSounds = next;
  saveConfig();
  return publicConfig();
});

ipcMain.handle('mods:clearDeath', () => {
  config.deathSound = false;
  saveConfig();
  return publicConfig();
});

// Previews are recomputed only when something they depend on changed.
let previewCache = { key: null, value: null };
ipcMain.handle('mods:previews', () => {
  const ver = playerDirs()[0];
  const mt = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
  const key = JSON.stringify([ver, config.cursorColor, config.emoteTheme, config.emoteColor, config.emoteHideLines, config.emoteOpacity,
    mt(path.join(modsDir(), 'cursor.png')), mt(path.join(modsDir(), 'emote-wheel.png')), mt(path.join(modsDir(), 'emote-stickers.png'))]);
  if (previewCache.key !== key) previewCache = { key, value: mods.previews(config, modsDir(), ver) };
  return previewCache.value;
});

/** Reads the player's in-game settings that Roblox saves itself (FPS cap, graphics level). */
function robloxUserSettings() {
  try {
    const xml = fs.readFileSync(path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'GlobalBasicSettings_13.xml'), 'utf8');
    const num = (name) => {
      const m = xml.match(new RegExp(`<(?:int|token) name="${name}">(-?\\d+)<`));
      return m ? Number(m[1]) : null;
    };
    return { framerateCap: num('FramerateCap'), qualityLevel: num('SavedQualityLevel') };
  } catch {
    return { framerateCap: null, qualityLevel: null };
  }
}

ipcMain.handle('roblox:status', async () => {
  const dirs = playerDirs();
  return {
    installed: dirs.length > 0,
    version: dirs[0] ? path.basename(dirs[0]) : null,
    path: dirs[0] || null,
    running: (await listInstances()).length,
    multiInstanceActive: !!mutexProc,
    ...robloxUserSettings(),
  };
});

ipcMain.handle('roblox:launch', async (e, { placeId, gameInstanceId, followUserId, accountId, universeId, gameName } = {}) => {
  if (placeId != null && !/^\d{1,20}$/.test(String(placeId))) throw new Error('placeId invalide');
  if (gameInstanceId && !/^[0-9a-f-]{36}$/i.test(gameInstanceId)) throw new Error('Serveur invalide');
  if (followUserId != null && !Number.isSafeInteger(followUserId)) throw new Error('Joueur invalide');
  if (placeId == null && followUserId == null) throw new Error('Rien à lancer');
  if (!playerDirs().length) throw new Error("Roblox n'est pas installé");

  const account = accountId != null ? config.accounts.find((a) => a.id === accountId) : activeAccount();
  await applyAll();
  if (config.forceDedicatedGpu || config.ownedGpuPrefs.length) await syncGpuPreference();
  if (config.multiInstance) setMultiInstance(true);

  let uri;
  if (account) {
    uri = await accounts.launchUri(account, { placeId, gameInstanceId, followUserId });
  } else {
    // No account in Stellar: let the Roblox app use whatever account it is signed in with.
    if (placeId == null) throw new Error('Connecte un compte pour rejoindre un ami');
    uri = `roblox://experiences/start?placeId=${placeId}` + (gameInstanceId ? `&gameInstanceId=${gameInstanceId}` : '');
  }
  await shell.openExternal(uri);
  if (Number.isSafeInteger(universeId) && isStr(gameName, 200)) loadPlayStore().names[universeId] ||= gameName;
  // with the launch screen on, the renderer minimizes once the animation is over
  if (config.minimizeOnLaunch && config.launchFx === false) BrowserWindow.fromWebContents(e.sender)?.minimize();
  return true;
});

ipcMain.handle('instances:list', async () => {
  const all = await listProcesses();
  const visible = all.length ? await visiblePids(all.map((p) => p.pid)) : new Set();
  return all.map((p) => ({ ...p, background: !visible.has(p.pid) }));
});

// ---------- "leave a game -> close Roblox and come back to Stellar" ----------
// Roblox writes "setStage: (stage:UGCGame)" in its log when a game starts and another stage
// (LuaApp, the Roblox home) when the player leaves it. We watch the tail of recent player logs.
const leave = { timer: null, stages: new Map(), windows: null };
const LEAVE_LOG_RE = /_Player_.*_last\.log$/i;

function lastStage(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const all = [...buf.toString('utf8').matchAll(/setStage: \(stage:(\w+)\)/g)];
    return all.length ? all[all.length - 1][1] : null;
  } finally {
    fs.closeSync(fd);
  }
}

async function checkGameLeft() {
  const dir = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'logs');
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => LEAVE_LOG_RE.test(n));
  } catch {
    return;
  }
  let left = false;
  for (const n of names) {
    const file = path.join(dir, n);
    let stage;
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > 3 * 60e3) continue;
      stage = lastStage(file);
    } catch {
      continue;
    }
    const prev = leave.stages.get(file);
    leave.stages.set(file, stage);
    if (prev === 'UGCGame' && stage && stage !== 'UGCGame') left = true;
  }
  // Alt+F4 / closing the window: Roblox writes nothing, but its window disappears.
  const windows = (await listInstances()).length;
  const windowClosed = leave.windows !== null && windows < leave.windows;
  leave.windows = windows;
  if (left) {
    await onGameLeft();
    windowCache.key = '';
    leave.windows = (await listInstances()).length;
  } else if (windowClosed) {
    bringStellarBack(true);
  }
}

// ---------- launch screen helpers ----------
// Is a player log written after `since` already in a game (stage UGCGame)?
ipcMain.handle('launch:progress', async (_e, since) => {
  const dir = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'logs');
  let inGame = false;
  let started = false;
  let joined = false;
  let lastWrite = 0;
  let size = 0;
  try {
    for (const n of fs.readdirSync(dir).filter((x) => LEAVE_LOG_RE.test(x))) {
      const file = path.join(dir, n);
      const st = fs.statSync(file);
      if (st.mtimeMs < Number(since) - 2000) continue;
      started = true;
      lastWrite = Math.max(lastWrite, st.mtimeMs);
      size += st.size;
      // "Joining game … / game_join_loadtime": connected to the server, the world is downloading
      if (!joined) {
        const fd = fs.openSync(file, 'r');
        try {
          const len = Math.min(st.size, 512 * 1024);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, st.size - len);
          joined = /game_join_loadtime|! Joining game/.test(buf.toString('utf8'));
        } finally {
          fs.closeSync(fd);
        }
      }
      // "setStage: UGCGame": the game is drawn (Roblox's own loading screen may still be on)
      if (lastStage(file) === 'UGCGame') inGame = true;
    }
  } catch {
    /* no logs yet */
  }
  const running = await listInstances();
  return { started, joined, inGame, windows: running.length, lastWrite, size, now: Date.now() };
});

// Keep Stellar above Roblox while the launch screen plays, then hand the screen to Roblox.
ipcMain.handle('launch:hold', (e, on) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  if (on) {
    win.setAlwaysOnTop(true, 'screen-saver');
    return true;
  }
  win.setAlwaysOnTop(false);
  return true;
});
ipcMain.handle('launch:focusRoblox', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.setAlwaysOnTop(false);
  const running = await listInstances();
  const target = running[running.length - 1];
  let ok = false;
  if (target) {
    ok = await new Promise((resolve) =>
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject WScript.Shell).AppActivate(${Number(target.pid)})`],
        { windowsHide: true, timeout: 6000 },
        (err, out) => resolve(!err && /True/i.test(String(out)))
      )
    );
  }
  // if Windows refused to switch, getting Stellar out of the way still reveals Roblox
  if ((!ok && target) || config.minimizeOnLaunch) win?.minimize();
  return ok;
});

async function onGameLeft() {
  const running = await listInstances();
  // With several clients open we can't tell which one left: only bring Stellar back.
  if (running.length === 1) {
    try {
      process.kill(running[0].pid);
    } catch {
      /* already closed */
    }
  }
  bringStellarBack(running.length === 1);
}

function bringStellarBack(closed) {
  const win = mainWindow;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(false);
  win.show();
  win.focus();
  win.webContents.send('roblox:left', { closed });
}

function syncLeaveWatcher() {
  clearInterval(leave.timer);
  leave.timer = null;
  leave.stages.clear();
  leave.windows = null;
  if (config.closeOnLeave) leave.timer = setInterval(() => checkGameLeft().catch(() => {}), 2000);
}

ipcMain.handle('instances:kill', async (_e, pid) => {
  const running = await listProcesses();
  const targets = pid === 'all' ? running.map((r) => r.pid) : running.some((r) => r.pid === pid) ? [pid] : [];
  windowCache.key = '';
  for (const p of targets) {
    try {
      process.kill(p);
    } catch {
      /* already gone */
    }
  }
  return targets.length;
});

// Roblox CDN files (3D models, textures) for the item viewer: text or a data: URL.
ipcMain.handle('cdn:get', async (_e, url, as = 'text') => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.rbxcdn\.com$/i.test(u.hostname)) throw new Error('Hôte non autorisé');
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error('Fichier trop lourd');
  if (as === 'dataurl') return `data:${res.headers.get('content-type') || 'image/png'};base64,${buf.toString('base64')}`;
  return buf.toString('utf8');
});

// Public market data (limiteds' values) from Rolimons, read-only.
ipcMain.handle('rolimons:items', async () => {
  const res = await fetch('https://www.rolimons.com/itemapi/itemdetails', { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});

ipcMain.handle('api', async (_e, { url, method = 'GET', body, auth = false, accountId } = {}) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !accounts.isRobloxHost(u.hostname)) throw new Error('Hôte non autorisé');
  if (!['GET', 'POST'].includes(method)) throw new Error('Méthode non autorisée');
  let res;
  if (auth) {
    const account = accountId != null ? config.accounts.find((a) => a.id === accountId) : activeAccount();
    if (!account) throw new Error('Aucun compte connecté');
    res = await (await accounts.clientFor(account)).request(u.toString(), { method, body });
  } else {
    res = await fetch(u, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});

ipcMain.handle('open:url', (_e, url) => {
  const u = new URL(url);
  const okHost =
    accounts.isRobloxHost(u.hostname) || ['www.rolimons.com', 'rolimons.com', 'www.paypal.com', 'paypal.me', 'www.paypal.me'].includes(u.hostname);
  if (u.protocol !== 'https:' || !okHost) throw new Error('Lien non autorisé');
  return shell.openExternal(u.toString());
});

ipcMain.handle('open:robloxFolder', () => shell.openPath(versionsDir()));

ipcMain.on('win', (e, action) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
  else if (action === 'restore') {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

// ---------- App lifecycle ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 1120,
    minHeight: 680,
    frame: false,
    show: false,
    title: 'Stellar',
    backgroundColor: '#07080f',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keyboard sounds must play while Stellar is minimised
    },
  });
  mainWindow = win;
  win.on('closed', () => (mainWindow = null));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.getParentWindow());
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(() => {
    loadConfig();
    if (config.multiInstance) setMultiInstance(true);
    createWindow();
    if (config.keySounds) setKeySounds(true);
    syncFocusWatcher(); // also needed for cursor effects and the music popup
    startMusic();
    registerMusicHotkeys();
    syncLeaveWatcher();
    // Bring Roblox's files in line with the config shortly after startup (cheap when nothing changed).
    setTimeout(() => applyAll().catch(() => {}), 4000);
    if (config.forceDedicatedGpu) syncGpuPreference(); // a Roblox update may have created a new exe path
  });
  app.on('before-quit', () => {
    globalShortcut.unregisterAll();
    mediaHelper?.stop();
    musicWin?.destroy();
    playerWin?.destroy();
    setMultiInstance(false);
    setKeySounds(false);
    setFocusWatcher(false);
    clearInterval(leave.timer);
    fxWin?.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
