// Playtime rebuilt from Roblox's own logs, so every game counts — launched from Stellar,
// from the Roblox app, via a friend, or while Stellar was closed.
// Each Player log has "game_join_loadtime … universeid:N" when a game is joined and
// "setStage: (stage:X)" when the app enters (UGCGame) or leaves a game.
const fs = require('fs');
const path = require('path');

const logsDir = () => path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'logs');
const JOIN_RE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z),.*game_join_loadtime: placeid:\d+.*?universeid:(\d+)/;
const STAGE_RE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z),.*setStage: \(stage:(\w+)\)/;
const TS_RE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z),/;
const KEEP_MS = 60 * 86400e3;

/** Local calendar day "YYYY-MM-DD" (the user's clock, not UTC). */
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Game segments [universeId, startMs, endMs|null] found in one log's text. endMs null = still going. */
function parseLog(text) {
  const segs = [];
  let cur = null;
  let lastTs = 0;
  for (const line of text.split('\n')) {
    const ts = TS_RE.exec(line);
    if (!ts) continue;
    lastTs = Date.parse(ts[1]);
    const j = JOIN_RE.exec(line);
    if (j) {
      if (cur) segs.push([cur[0], cur[1], lastTs]);
      cur = [Number(j[2]), lastTs];
      continue;
    }
    const st = STAGE_RE.exec(line);
    if (st && cur && st[2] !== 'UGCGame') {
      segs.push([cur[0], cur[1], lastTs]); // left the game (back to the Roblox home)
      cur = null;
    }
  }
  if (cur) segs.push([cur[0], cur[1], null]);
  return { segs, lastTs };
}

/**
 * Updates `store` ({ logs: {name: {final, segs}}, names: {uni: name} }) from the logs folder.
 * The newest log is "live" while Roblox runs: its open segment ends now. Others are final and read once.
 */
function scan(store, robloxRunning, now = Date.now()) {
  store.logs ||= {};
  store.names ||= {};
  let files = [];
  try {
    files = fs.readdirSync(logsDir())
      .filter((n) => /_Player_.*\.log$/i.test(n) && !/crash/i.test(n))
      .map((n) => ({ n, t: fs.statSync(path.join(logsDir(), n)).mtimeMs }))
      .filter((f) => now - f.t < KEEP_MS)
      .sort((a, b) => b.t - a.t);
  } catch {
    return store;
  }
  files.forEach(({ n, t }, i) => {
    const live = i === 0 && robloxRunning;
    if (store.logs[n]?.final) return;
    let text;
    try {
      text = fs.readFileSync(path.join(logsDir(), n), 'utf8');
    } catch {
      return;
    }
    const { segs, lastTs } = parseLog(text);
    const end = live ? now : Math.max(lastTs, 0) || t;
    store.logs[n] = { final: !live, segs: segs.map(([u, s, e]) => [u, s, e ?? end]).filter(([, s, e]) => e > s) };
  });
  for (const [n, l] of Object.entries(store.logs)) {
    if (!l.segs.length || now - Math.max(...l.segs.map((s) => s[2])) > KEEP_MS) delete store.logs[n];
  }
  return store;
}

/** Totals for the UI: per game, per local day, and the game being played right now. */
function summarize(store, robloxRunning, now = Date.now()) {
  const games = {};
  const days = {};
  let live = null;
  for (const l of Object.values(store.logs || {})) {
    for (const [u, s, e] of l.segs) {
      const g = (games[u] ||= { name: store.names?.[u] || 'Jeu Roblox', seconds: 0, sessions: 0, last: 0 });
      g.seconds += Math.round((e - s) / 1000);
      g.sessions += 1;
      g.last = Math.max(g.last, e);
      // split across midnight so each day gets its real share
      let a = s;
      while (a < e) {
        const next = new Date(a);
        next.setHours(24, 0, 0, 0);
        const b = Math.min(e, next.getTime());
        days[dayKey(a)] = (days[dayKey(a)] || 0) + Math.round((b - a) / 1000);
        a = b;
      }
      if (!l.final && robloxRunning && now - e < 60e3) live = { universeId: u, name: g.name, seconds: Math.round((e - s) / 1000) };
    }
  }
  return { games, days, live };
}

module.exports = { scan, summarize, parseLog, dayKey };
