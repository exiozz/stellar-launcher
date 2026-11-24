// Roblox accounts: login through the official roblox.com page, authenticated API
// calls and authenticated game launches. The session cookie never leaves this
// (main) process: the renderer only ever sees account ids and names.
const { BrowserWindow, session } = require('electron');
const crypto = require('crypto');

const isRobloxHost = (h) => h === 'roblox.com' || h.endsWith('.roblox.com');
const partitionFor = (key) => `persist:acct-${key}`;
const PARTITION_RE = /^persist:acct-[0-9a-f-]{36}$/;

class SessionExpiredError extends Error {
  constructor() {
    super('Session expirée — reconnecte ce compte');
  }
}

function useChromeUserAgent(ses) {
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|orbit-launcher|stellar-launcher|Orbit|Stellar)\/\S+/g, ''));
}

async function getCookie(partition) {
  const [c] = await session.fromPartition(partition).cookies.get({ url: 'https://www.roblox.com', name: '.ROBLOSECURITY' });
  return c?.value || null;
}

/** Minimal authenticated client: adds the cookie and handles Roblox's CSRF handshake. */
class RobloxClient {
  constructor(cookie) {
    this.cookie = cookie;
    this.csrf = null;
  }

  async request(url, { method = 'GET', body, headers = {} } = {}) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !isRobloxHost(u.hostname)) throw new Error('Hôte non autorisé');
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(u, {
        method,
        headers: {
          Cookie: `.ROBLOSECURITY=${this.cookie}`,
          Referer: 'https://www.roblox.com/',
          Origin: 'https://www.roblox.com',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const token = res.headers.get('x-csrf-token');
      if (res.status === 403 && token && token !== this.csrf && attempt === 0) {
        this.csrf = token;
        continue;
      }
      if (res.status === 401) throw new SessionExpiredError();
      return res;
    }
  }
}

const clients = new Map(); // partition -> RobloxClient

async function clientFor(account) {
  const cookie = await getCookie(account.partition);
  if (!cookie) throw new SessionExpiredError();
  let c = clients.get(account.partition);
  if (!c || c.cookie !== cookie) {
    c = new RobloxClient(cookie);
    clients.set(account.partition, c);
  }
  return c;
}

/** Opens roblox.com/login in an isolated session; resolves with the account once logged in. */
function login(parent) {
  return new Promise((resolve, reject) => {
    const partition = partitionFor(crypto.randomUUID());
    const ses = session.fromPartition(partition);
    useChromeUserAgent(ses);

    const win = new BrowserWindow({
      parent,
      modal: true,
      width: 520,
      height: 760,
      title: 'Connexion à Roblox',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });

    let finished = false;
    const onCookie = async (_e, cookie, _cause, removed) => {
      if (finished || removed || cookie.name !== '.ROBLOSECURITY') return;
      try {
        const res = await new RobloxClient(cookie.value).request('https://users.roblox.com/v1/users/authenticated');
        if (!res.ok) return;
        const me = await res.json();
        finished = true;
        ses.cookies.removeListener('changed', onCookie);
        resolve({ id: me.id, name: me.name, displayName: me.displayName, partition });
        if (!win.isDestroyed()) win.close();
      } catch {
        /* not fully logged in yet (e.g. 2-step verification pending) */
      }
    };
    ses.cookies.on('changed', onCookie);

    win.on('closed', () => {
      if (finished) return;
      ses.cookies.removeListener('changed', onCookie);
      ses.clearStorageData();
      reject(new Error('Connexion annulée'));
    });
    // Keep the top-level page on roblox.com (captcha providers load in sub-frames).
    win.webContents.on('will-navigate', (e, url) => {
      if (!isRobloxHost(new URL(url).hostname)) e.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadURL('https://www.roblox.com/login');
  });
}

/** Signs the session out on Roblox's side and wipes it locally. */
async function logout(account) {
  try {
    const c = await clientFor(account);
    await c.request('https://auth.roblox.com/v2/logout', { method: 'POST', body: {} });
  } catch {
    /* already expired: local wipe is enough */
  }
  clients.delete(account.partition);
  await session.fromPartition(account.partition).clearStorageData();
}

/** Builds the roblox-player: URI the website uses, with a one-time auth ticket. */
async function launchUri(account, { placeId, gameInstanceId, followUserId }) {
  const c = await clientFor(account);
  const res = await c.request('https://auth.roblox.com/v1/authentication-ticket', {
    method: 'POST',
    body: {},
    headers: { RBXAuthenticationNegotiation: '1' },
  });
  const ticket = res.headers.get('rbx-authentication-ticket');
  if (!ticket) throw new Error(`Roblox a refusé le lancement (HTTP ${res.status})`);

  const browserTrackerId = String(Date.now()) + String(crypto.randomInt(100, 999));
  const p = new URLSearchParams({ browserTrackerId, isPlayTogetherGame: 'false', joinAttemptId: crypto.randomUUID() });
  if (followUserId) {
    p.set('request', 'RequestFollowUser');
    p.set('userId', String(followUserId));
    p.set('joinAttemptOrigin', 'JoinUser');
  } else if (gameInstanceId) {
    p.set('request', 'RequestGameJob');
    p.set('placeId', String(placeId));
    p.set('gameId', gameInstanceId);
    p.set('joinAttemptOrigin', 'PlayButton');
  } else {
    p.set('request', 'RequestGame');
    p.set('placeId', String(placeId));
    p.set('joinAttemptOrigin', 'PlayButton');
  }
  const placeLauncherUrl = `https://www.roblox.com/Game/PlaceLauncher.ashx?${p}`;
  return (
    `roblox-player:1+launchmode:play+gameinfo:${ticket}+launchtime:${Date.now()}` +
    `+placelauncherurl:${encodeURIComponent(placeLauncherUrl)}+browsertrackerid:${browserTrackerId}` +
    `+robloxLocale:fr_fr+gameLocale:fr_fr+channel:+LaunchExp:InApp`
  );
}

module.exports = { login, logout, launchUri, clientFor, isRobloxHost, PARTITION_RE, SessionExpiredError };
