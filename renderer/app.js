'use strict';

// ================= helpers =================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('fr-FR');
const fmt = (n) => (Number.isFinite(n) ? compact.format(n) : '—');
const pct = (up, down) => (up + down > 0 ? Math.round((up / (up + down)) * 100) + ' %' : '—');
const safeImg = (u) => (typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//i.test(u) ? u : '');
const errMsg = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const sessionId = crypto.randomUUID();
const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const CHEV_SVG = '<svg class="chev" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4000);
}

let config = {};
let status = {};
const activeAccount = () => (config.accounts || []).find((a) => a.id === config.activeAccountId) || null;

// ================= thumbnails =================
const iconCache = new Map(); // universeId -> url
const headCache = new Map(); // userId -> url

async function batchThumbs(cache, ids, urlFor, size = 100) {
  const missing = [...new Set(ids.map(String))].filter((id) => !cache.has(id));
  await Promise.all(
    chunk(missing, size).map(async (part) => {
      try {
        const r = await orbit.api(urlFor(part.join(',')));
        for (const t of r.data || []) cache.set(String(t.targetId), safeImg(t.imageUrl));
      } catch {
        /* thumbnails are cosmetic */
      }
    })
  );
}

const loadHeadshots = (ids) =>
  batchThumbs(headCache, ids, (list) => `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${list}&size=150x150&format=Png&isCircular=false`);

async function loadGameIcons(root) {
  const imgs = $$('img[data-uid]', root).filter((i) => !i.dataset.done);
  await batchThumbs(
    iconCache,
    imgs.map((i) => i.dataset.uid),
    (list) => `https://thumbnails.roblox.com/v1/games/icons?universeIds=${list}&size=256x256&format=Png&isCircular=false`,
    50
  );
  for (const img of imgs) {
    const src = iconCache.get(img.dataset.uid);
    if (src) img.src = src;
    img.dataset.done = '1';
  }
}

function fillHeadshots(root) {
  for (const img of $$('img[data-head]', root)) {
    const src = headCache.get(img.dataset.head);
    if (src) img.src = src;
  }
}

async function wideThumb(universeId) {
  try {
    const r = await orbit.api(
      `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&size=768x432&format=Png&countPerUniverse=1`
    );
    return safeImg(r.data?.[0]?.thumbnails?.[0]?.imageUrl);
  } catch {
    return '';
  }
}

// ================= game cards =================
const gameRegistry = new Map(); // universeId -> minimal game ref seen in lists

function gameCard(g) {
  gameRegistry.set(String(g.universeId), g);
  const meta = [];
  if (Number.isFinite(g.playerCount)) meta.push(`<span class="live">${fmt(g.playerCount)}</span>`);
  if (Number.isFinite(g.up)) meta.push(`<span>👍 ${pct(g.up, g.down)}</span>`);
  return `<button class="game-card" data-uid="${esc(g.universeId)}" title="${esc(g.name)}">
    <div class="game-thumb"><img data-uid="${esc(g.universeId)}" src="${BLANK}" alt="" /><span class="play-hint">${PLAY_SVG}</span></div>
    <div class="game-name">${esc(g.name)}</div>
    <div class="game-meta">${meta.join('')}</div>
  </button>`;
}

function renderRow(title, games, note = '') {
  if (!games.length) return '';
  return `<div class="row"><div class="row-head"><h3>${esc(title)}</h3><span class="muted">${esc(note)}</span></div>
    <div class="row-scroll">${games.map(gameCard).join('')}</div></div>`;
}

const fromExplore = (g) => ({
  universeId: g.universeId,
  placeId: g.rootPlaceId,
  name: g.name,
  playerCount: g.playerCount,
  up: g.totalUpVotes,
  down: g.totalDownVotes,
});

// ================= launching =================
async function play(game, serverId) {
  const fx = teleportFx(game);
  try {
    await orbit.launch({ placeId: game.placeId, gameInstanceId: serverId, universeId: Number(game.universeId), gameName: game.name });
    const acc = activeAccount();
    toast(`Lancement de ${game.name}${acc ? ` avec ${acc.displayName}` : ''}…`, 'ok');
    const ref = { universeId: game.universeId, placeId: game.placeId, name: game.name };
    const recent = [ref, ...(config.recent || []).filter((r) => r.universeId !== ref.universeId)].slice(0, 12);
    config = await orbit.setConfig({ recent });
    renderHomeLocal();
    setTimeout(updateStatus, 4000);
  } catch (e) {
    fx?.cancel();
    toast(errMsg(e), 'error');
  }
}

async function joinFriend(f) {
  const fx = teleportFx({ name: f.location || `le serveur de ${f.displayName}`, universeId: f.universeId });
  try {
    await orbit.launch({ followUserId: f.id });
    toast(`Connexion au serveur de ${f.displayName}…`, 'ok');
    setTimeout(updateStatus, 4000);
  } catch (e) {
    fx?.cancel();
    toast(errMsg(e), 'error');
  }
}

// ================= status =================
async function updateStatus() {
  try {
    status = await orbit.status();
  } catch {
    return;
  }
  $('#fpsChip .fps-num').textContent = status.framerateCap ?? '—';
  $('#robloxSettings').innerHTML = `
    <dt>FPS max</dt><dd>${status.framerateCap ?? 'inconnu'}</dd>
    <dt>Qualité graphique</dt><dd>${status.qualityLevel ? `${status.qualityLevel} / 10` : 'automatique'}</dd>`;
  $('#robloxState').textContent = status.installed ? `Roblox prêt · ${status.version}` : 'Roblox non installé';
  $('#titleStatus').innerHTML = `
    <span><i class="dot ${status.installed ? 'on' : ''}"></i>${status.installed ? 'Roblox détecté' : 'Roblox introuvable'}</span>
    <span>${status.running} client${status.running > 1 ? 's' : ''} en cours</span>`;
  const badge = $('#instBadge');
  badge.hidden = !status.running;
  badge.textContent = status.running;
  $('#installInfo').innerHTML = status.installed
    ? `<dt>Version</dt><dd>${esc(status.version)}</dd><dt>Dossier</dt><dd title="${esc(status.path)}">${esc(status.path)}</dd>`
    : `<dt>État</dt><dd>Roblox n'est pas installé sur ce PC.</dd>`;
}

// ================= accounts =================
const accountData = new Map(); // accountId -> { robux, expired }

async function refreshAccountData(acc) {
  try {
    const r = await orbit.api(`https://economy.roblox.com/v1/users/${acc.id}/currency`, { auth: true, accountId: acc.id });
    accountData.set(acc.id, { robux: r.robux, expired: false });
  } catch (e) {
    accountData.set(acc.id, { robux: null, expired: /expirée/i.test(errMsg(e)) });
  }
}

function robuxHtml(acc) {
  const d = accountData.get(acc.id);
  if (d?.expired) return '<span class="expired">Session expirée</span>';
  return `<i class="robux"></i>${d?.robux != null ? full.format(d.robux) : '—'}`;
}

function renderAccountBox() {
  const box = $('#accountBox');
  const acc = activeAccount();
  if (!acc) {
    box.className = 'account login';
    box.innerHTML = '<svg class="login-ic" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-6 7-6s6.2 2.4 7 6"/></svg><span class="login-txt">Se connecter</span>';
    box.setAttribute('aria-label', 'Se connecter avec Roblox');
    return;
  }
  box.className = 'account';
  box.innerHTML = `<img class="avatar" data-head="${acc.id}" src="${headCache.get(String(acc.id)) || BLANK}" alt="" />
    <span class="who"><b>${esc(acc.displayName)}</b><span class="robux-line">${robuxHtml(acc)}</span></span>${CHEV_SVG}`;
}

function renderAccountMenu() {
  const items = (config.accounts || [])
    .map(
      (a) => `<button class="menu-item" role="menuitem" data-switch="${a.id}">
        <img class="avatar" data-head="${a.id}" src="${headCache.get(String(a.id)) || BLANK}" alt="" />
        <span>${esc(a.displayName)} <span class="muted">@${esc(a.name)}</span></span>
        ${a.id === config.activeAccountId ? '<svg class="check" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>' : ''}
      </button>`
    )
    .join('');
  $('#accountMenu').innerHTML = `${items}<div class="menu-sep"></div>
    <button class="menu-item" role="menuitem" data-menu="add">${PLUS_SVG}Ajouter un compte</button>
    <button class="menu-item" role="menuitem" data-menu="manage"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>Gérer les comptes</button>`;
}

function renderAccountsPage() {
  const cards = (config.accounts || [])
    .map((a) => {
      const active = a.id === config.activeAccountId;
      return `<div class="acct-card ${active ? 'active' : ''}">
        ${active ? '<span class="active-tag">Actif</span>' : ''}
        <img class="avatar" data-head="${a.id}" src="${headCache.get(String(a.id)) || BLANK}" alt="" />
        <b>${esc(a.displayName)}</b><span class="muted">@${esc(a.name)}</span>
        <span class="acct-robux">${robuxHtml(a)}</span>
        <div class="acct-actions">
          ${active ? '' : `<button class="btn small" data-use="${a.id}">Utiliser</button>`}
          ${accountData.get(a.id)?.expired ? `<button class="btn small" data-relogin="${a.id}">Reconnecter</button>` : ''}
          <button class="btn danger small" data-remove="${a.id}">Retirer</button>
        </div>
      </div>`;
    })
    .join('');
  $('#accountsGrid').innerHTML =
    cards + `<button class="acct-card add" data-menu="add">${PLUS_SVG}<b>Ajouter un compte</b><span>Connexion via roblox.com</span></button>`;
}

async function onAccountsChanged() {
  const accs = config.accounts || [];
  await loadHeadshots(accs.map((a) => a.id));
  renderAccountBox();
  renderAccountMenu();
  renderAccountsPage();
  await Promise.all(accs.map(refreshAccountData));
  renderAccountBox();
  renderAccountsPage();
  renderGreeting();
  loadFriends();
  renderAccountFavorites();
}

async function login() {
  try {
    config = await orbit.login();
    toast(`Connecté en tant que ${activeAccount().displayName}`, 'ok');
    onAccountsChanged();
  } catch (e) {
    const m = errMsg(e);
    if (!/annulée/i.test(m)) toast(m, 'error');
  }
}

async function switchAccount(id) {
  config = await orbit.setConfig({ activeAccountId: id });
  toast(`Compte actif : ${activeAccount().displayName}`, 'ok');
  onAccountsChanged();
}

async function removeAccount(id) {
  const acc = config.accounts.find((a) => a.id === id);
  if (!acc || !confirm(`Retirer ${acc.displayName} de Stellar ? Le compte sera déconnecté.`)) return;
  config = await orbit.removeAccount(id);
  accountData.delete(id);
  toast(`${acc.displayName} retiré`, 'ok');
  onAccountsChanged();
}

$('#accountBox').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!activeAccount()) return login();
  const m = $('#accountMenu');
  m.hidden = !m.hidden;
  if (!m.hidden) fillHeadshots(m);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.account-wrap')) $('#accountMenu').hidden = true;
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-switch],[data-menu],[data-use],[data-remove],[data-relogin]');
  if (!t) return;
  $('#accountMenu').hidden = true;
  if (t.dataset.switch) switchAccount(Number(t.dataset.switch));
  else if (t.dataset.use) switchAccount(Number(t.dataset.use));
  else if (t.dataset.remove) removeAccount(Number(t.dataset.remove));
  else if (t.dataset.relogin || t.dataset.menu === 'add') login();
  else if (t.dataset.menu === 'manage') showView('accounts');
});
$('#addAccount').addEventListener('click', login);

// ================= friends =================
let friendsTimer = null;
let friendsList = [];
const PRESENCE = { 0: 'offline', 1: 'online', 2: 'ingame', 3: 'studio' };

async function loadFriends() {
  clearTimeout(friendsTimer);
  const box = $('#friendsList');
  const acc = activeAccount();
  if (!acc) {
    $('#friendsCount').textContent = '';
    box.innerHTML = `<div class="rail-empty">Connecte ton compte Roblox pour voir tes amis en ligne et les rejoindre en un clic.
      <br /><button class="btn primary small" data-menu="add">Se connecter</button></div>`;
    return;
  }
  if (!friendsList.length) box.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton" style="height:46px;margin:3px 0"></div>').join('');
  try {
    const r = await orbit.api(`https://friends.roblox.com/v1/users/${acc.id}/friends`, { auth: true });
    let friends = (r.data || []).map((f) => ({ id: f.id, name: f.name, displayName: f.displayName }));
    const ids = friends.map((f) => f.id);

    // Newer API versions omit names: fill them in.
    if (friends.some((f) => !f.name)) {
      const names = new Map();
      for (const part of chunk(ids, 100)) {
        const u = await orbit.api('https://users.roblox.com/v1/users', { method: 'POST', body: { userIds: part, excludeBannedUsers: false } });
        for (const x of u.data || []) names.set(x.id, x);
      }
      friends = friends.map((f) => ({ ...f, name: names.get(f.id)?.name || f.name, displayName: names.get(f.id)?.displayName || f.displayName }));
    }

    const presence = new Map();
    for (const part of chunk(ids, 50)) {
      const p = await orbit.api('https://presence.roblox.com/v1/presence/users', { method: 'POST', body: { userIds: part }, auth: true });
      for (const x of p.userPresences || []) presence.set(x.userId, x);
    }
    const previous = new Map(friendsList.map((f) => [f.id, f]));
    friendsList = friends.map((f) => {
      const p = presence.get(f.id) || {};
      return {
        ...f,
        state: PRESENCE[p.userPresenceType] || 'offline',
        location: p.lastLocation,
        placeId: p.rootPlaceId || p.placeId,
        universeId: p.universeId,
        lastOnline: p.lastOnline ? Date.parse(p.lastOnline) : 0,
      };
    });
    await loadHeadshots(ids.slice(0, 300));
    if (previous.size) notifyFavoriteChanges(previous);
    renderFriends();
    renderHomeFriends();
    loadFriendRequests();
    if ($('#view-friends').classList.contains('active')) renderFriendsPage();
  } catch (e) {
    box.innerHTML = `<div class="rail-empty">${esc(errMsg(e))}</div>`;
  }
  friendsTimer = setTimeout(loadFriends, 30000);
}

function friendRow(f) {
  const loc =
    f.state === 'ingame' ? `<div class="floc ingame">${esc(f.location || 'En jeu')}</div>`
    : f.state === 'studio' ? `<div class="floc">Dans Studio</div>`
    : f.state === 'online' ? `<div class="floc">En ligne</div>`
    : `<div class="floc">@${esc(f.name)}</div>`;
  return `<div class="friend ${f.state === 'offline' ? 'offline' : ''}" tabindex="0" data-friend="${f.id}">
    <span class="pic"><img class="avatar" data-head="${f.id}" src="${headCache.get(String(f.id)) || BLANK}" alt="" /><i class="status ${f.state}"></i></span>
    <span class="fmeta"><div class="fname">${esc(friendName(f))}</div>${loc}</span>
    ${f.state === 'ingame' ? `<button class="btn primary small join" data-join="${f.id}">Rejoindre</button>` : ''}
  </div>`;
}

const STATE_ORDER = { ingame: 0, online: 1, studio: 2, offline: 3 };
const isFav = (id) => (config.favoriteFriends || []).includes(id);
// A local nickname (set in Stellar) wins over the Roblox display name.
const friendName = (f) => config.friendNicknames?.[f.id] || f.displayName || f.name || '';

function renderFriends() {
  const sorted = [...friendsList].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || friendName(a).localeCompare(friendName(b)));
  const favs = sorted.filter((f) => isFav(f.id));
  const online = sorted.filter((f) => !isFav(f.id) && f.state !== 'offline');
  const offline = sorted.filter((f) => !isFav(f.id) && f.state === 'offline');
  $('#friendsCount').textContent = `${sorted.filter((f) => f.state !== 'offline').length} en ligne`;
  const section = (title, list, max = 60) => (list.length ? `<div class="rail-section">${title} — ${list.length}</div>${list.slice(0, max).map(friendRow).join('')}` : '');
  $('#friendsList').innerHTML = friendsList.length
    ? section('★ Favoris', favs) + section('En ligne', online) + section('Hors ligne', offline)
    : '<div class="rail-empty">Aucun ami pour le moment.</div>';
}

/** Windows notification when a ★ favorite friend comes online or starts a game. */
function notifyFavoriteChanges(previous) {
  if (!config.notifyFavorites || !('Notification' in window)) return;
  for (const f of friendsList) {
    const before = previous.get(f.id);
    if (!isFav(f.id) || !before || before.state === f.state) continue;
    let body = null;
    if (f.state === 'ingame' && before.state !== 'ingame') body = `joue à ${f.location || 'un jeu'}`;
    else if (f.state === 'online' && before.state === 'offline') body = 'vient de se connecter';
    if (!body) continue;
    const n = new Notification(`★ ${friendName(f)}`, { body, icon: headCache.get(String(f.id)) || undefined, silent: false });
    n.onclick = () => {
      orbit.win('restore');
      showView('friends');
    };
  }
}

// ================= home: friends playing + playtime =================
function renderHomeFriends() {
  const box = $('#homeFriends');
  if (!box) return;
  const playing = friendsList.filter((f) => f.state === 'ingame' && f.universeId);
  if (!playing.length) {
    box.innerHTML = activeAccount()
      ? '<div class="row-head"><h3>Tes amis jouent à</h3></div><div class="empty" style="padding:22px">Aucun ami en jeu pour le moment.</div>'
      : '';
    return;
  }
  const games = new Map();
  for (const f of playing) {
    if (!games.has(f.universeId)) games.set(f.universeId, { universeId: f.universeId, placeId: f.placeId, name: f.location || 'Jeu', friends: [] });
    games.get(f.universeId).friends.push(f);
  }
  const list = [...games.values()].sort((a, b) => b.friends.length - a.friends.length || favFirst(b) - favFirst(a)).slice(0, 8);
  for (const g of list) if (g.placeId) gameRegistry.set(String(g.universeId), { universeId: g.universeId, placeId: g.placeId, name: g.name });
  box.innerHTML = `<div class="row-head"><h3>Tes amis jouent à</h3><span class="muted">${playing.length} en jeu</span></div>
    <div class="fp-list">${list
      .map(
        (g) => `<div class="fp-card" data-gameuid="${g.universeId}">
        <img class="fp-icon" data-uid="${g.universeId}" src="${iconCache.get(String(g.universeId)) || BLANK}" alt="" />
        <div class="fp-meta">
          <div class="fp-game">${esc(g.name)}</div>
          <div class="fp-faces">${g.friends.slice(0, 5).map((f) => `<img src="${headCache.get(String(f.id)) || BLANK}" alt="" title="${esc(friendName(f))}" />`).join('')}</div>
          <div class="fp-names">${esc(g.friends.map(friendName).join(', '))}</div>
        </div>
        <button class="btn primary small" data-join="${g.friends[0].id}">Rejoindre</button>
      </div>`
      )
      .join('')}</div>`;
  loadGameIcons(box);
}
const favFirst = (g) => g.friends.some((f) => isFav(f.id));

$('#homeRows').addEventListener('click', (e) => {
  const j = e.target.closest('.fp-card [data-join]');
  if (!j) {
    const card = e.target.closest('.fp-card');
    if (card) openGame(card.dataset.gameuid);
    return;
  }
  e.stopPropagation();
  const f = friendsList.find((x) => x.id === Number(j.dataset.join));
  if (f) joinFriend(f);
});

const fmtDuration = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : `${Math.max(1, Math.round(s / 60))} min`);

async function renderPlaytime() {
  const box = $('#homePlaytime');
  if (!box) return;
  const p = await orbit.playtime();
  // local calendar days (same keys as playtime.js), the game in progress is already included
  const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: localKey(d), label: d.toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 2) });
  }
  const secs = days.map((d) => p.days[d.key] || 0);
  const week = secs.reduce((a, b) => a + b, 0);
  const max = Math.max(...secs, 1);
  const top = Object.entries(p.games).sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 4);
  const topMax = top[0]?.[1].seconds || 1;
  box.innerHTML = `<div class="pt-card">
    <div class="muted small-note">Temps de jeu cette semaine</div>
    <div class="pt-total">${week ? fmtDuration(week) : '0 min'}</div>
    ${p.live ? `<div class="pt-live">● En jeu : ${esc(p.live.name)} (${fmtDuration(p.live.seconds)})</div>` : ''}
    <div class="pt-week">${secs.map((s) => `<div style="height:${Math.round((s / max) * 100)}%" title="${fmtDuration(s)}"></div>`).join('')}</div>
    <div class="pt-days">${days.map((d) => `<span>${esc(d.label)}</span>`).join('')}</div>
    ${top.length ? `<div class="pt-games">${top.map(([, g]) => `<div class="pt-game"><span>${esc(g.name)}</span><span class="muted">${fmtDuration(g.seconds)}</span><div class="bar"><i style="width:${Math.round((g.seconds / topMax) * 100)}%"></i></div></div>`).join('')}</div>` : '<p class="muted small-note" style="margin:12px 0 0">Lance un jeu depuis Stellar pour suivre ton temps de jeu.</p>'}
  </div>`;
}
setInterval(() => $('#view-home').classList.contains('active') && renderPlaytime(), 60000);

// ================= friends page =================
let friendTab = 'all';
let friendRequests = [];

function lastSeen(ts) {
  if (!ts) return 'Hors ligne';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 60) return `Vu il y a ${Math.max(1, min)} min`;
  if (min < 1440) return `Vu il y a ${Math.round(min / 60)} h`;
  const d = Math.round(min / 1440);
  return d < 60 ? `Vu il y a ${d} j` : `Vu le ${new Date(ts).toLocaleDateString('fr-FR')}`;
}

async function loadFriendRequests() {
  if (!activeAccount()) return;
  try {
    const r = await orbit.api('https://friends.roblox.com/v1/my/friends/requests?limit=50&sortOrder=Desc', { auth: true });
    let reqs = (r.data || []).map((x) => ({ id: x.id, name: x.name, displayName: x.displayName }));
    if (reqs.some((x) => !x.name)) {
      const u = await orbit.api('https://users.roblox.com/v1/users', { method: 'POST', body: { userIds: reqs.map((x) => x.id), excludeBannedUsers: false } });
      const byId = new Map((u.data || []).map((x) => [x.id, x]));
      reqs = reqs.map((x) => ({ ...x, name: byId.get(x.id)?.name || x.name, displayName: byId.get(x.id)?.displayName || x.displayName }));
    }
    friendRequests = reqs;
    await loadHeadshots(reqs.map((x) => x.id));
  } catch {
    friendRequests = [];
  }
  const n = friendRequests.length;
  $('#requestBadge').hidden = !n;
  $('#requestBadge').textContent = n;
  $('#requestCount').textContent = n || '';
  if ($('#view-friends').classList.contains('active') && friendTab === 'requests') renderFriendsPage();
}

function sortFriends(list) {
  const by = config.friendSort || 'status';
  const name = (a, b) => friendName(a).localeCompare(friendName(b));
  const cmp = {
    status: (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || name(a, b),
    favorites: (a, b) => isFav(b.id) - isFav(a.id) || STATE_ORDER[a.state] - STATE_ORDER[b.state] || name(a, b),
    // online now first, then most recently seen
    recent: (a, b) => (b.state !== 'offline') - (a.state !== 'offline') || b.lastOnline - a.lastOnline,
    az: name,
    za: (a, b) => name(b, a),
  }[by];
  return [...list].sort(cmp);
}

function friendCard(f) {
  const status =
    f.state === 'ingame' ? `<span class="fstate ingame">🎮 ${esc(f.location || 'En jeu')}</span>`
    : f.state === 'online' ? '<span class="fstate online">En ligne</span>'
    : f.state === 'studio' ? '<span class="fstate studio">Dans Studio</span>'
    : `<span class="fstate">${esc(lastSeen(f.lastOnline))}</span>`;
  return `<div class="fcard ${f.state}" data-fid="${f.id}">
    <button class="fav-star ${isFav(f.id) ? 'on' : ''}" data-favtoggle="${f.id}" title="${isFav(f.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">★</button>
    <span class="pic"><img class="avatar" data-head="${f.id}" src="${headCache.get(String(f.id)) || BLANK}" alt="" /><i class="status ${f.state}"></i></span>
    <div class="fcard-name-row"><div class="fcard-name">${esc(friendName(f))}</div><button class="rename" data-rename="${f.id}" title="Donner un surnom">✏️</button></div>
    <div class="muted fcard-user">${config.friendNicknames?.[f.id] ? `${esc(f.displayName || f.name)} · ` : ''}@${esc(f.name)}</div>
    ${status}
    <div class="fcard-actions">
      ${f.state === 'ingame' ? `<button class="btn primary small" data-join="${f.id}">Rejoindre</button>` : ''}
      <button class="btn small" data-chatwith="${f.id}">Message</button>
      <button class="btn small" data-fprofile="${esc(f.name)}">Profil</button>
      <button class="btn ghost small icon-only" data-unfriend="${f.id}" title="Retirer des amis">✕</button>
    </div>
  </div>`;
}

function requestCard(r) {
  return `<div class="fcard" data-fid="${r.id}">
    <span class="pic"><img class="avatar" data-head="${r.id}" src="${headCache.get(String(r.id)) || BLANK}" alt="" /></span>
    <div class="fcard-name">${esc(r.displayName || r.name)}</div>
    <div class="muted fcard-user">@${esc(r.name)}</div>
    <span class="fstate">Veut être ton ami</span>
    <div class="fcard-actions">
      <button class="btn primary small" data-accept="${r.id}">Accepter</button>
      <button class="btn ghost small" data-decline="${r.id}">Refuser</button>
    </div>
  </div>`;
}

function renderFriendsPage() {
  $$('#friendTabs .chip').forEach((c) => c.classList.toggle('active', c.dataset.ftab === friendTab));
  $('#friendSort').value = config.friendSort || 'status';
  $('#friendSort').hidden = friendTab === 'requests';
  const grid = $('#friendGrid');
  if (!activeAccount()) {
    $('#friendSummary').textContent = '';
    grid.innerHTML = '<div class="empty">Connecte ton compte Roblox pour gérer tes amis.<br /><br /><button class="btn primary small" data-menu="add">Se connecter</button></div>';
    return;
  }
  const q = $('#friendSearch').value.trim().toLowerCase();
  const match = (f) => !q || friendName(f).toLowerCase().includes(q) || (f.name || '').toLowerCase().includes(q);
  if (friendTab === 'requests') {
    const list = friendRequests.filter(match);
    $('#friendSummary').textContent = `${friendRequests.length} demande${friendRequests.length > 1 ? 's' : ''} reçue${friendRequests.length > 1 ? 's' : ''}`;
    grid.innerHTML = list.length ? list.map(requestCard).join('') : '<div class="empty">Aucune demande d\'ami.</div>';
    return;
  }
  const filters = { all: () => true, online: (f) => f.state !== 'offline', ingame: (f) => f.state === 'ingame', fav: (f) => isFav(f.id) };
  const list = sortFriends(friendsList.filter(filters[friendTab]).filter(match));
  const online = friendsList.filter((f) => f.state !== 'offline').length;
  $('#friendSummary').textContent = `${friendsList.length} amis · ${online} en ligne · ${friendsList.filter((f) => f.state === 'ingame').length} en jeu · ${(config.favoriteFriends || []).filter((id) => friendsList.some((f) => f.id === id)).length} favoris`;
  grid.innerHTML = list.length
    ? list.map(friendCard).join('')
    : `<div class="empty">${friendTab === 'fav' ? 'Pas encore de favoris : clique sur ★ sur un ami.' : q ? `Aucun ami pour « ${esc(q)} ».` : 'Personne ici pour le moment.'}</div>`;
}

async function toggleFavoriteFriend(id) {
  const favs = config.favoriteFriends || [];
  config = await orbit.setConfig({ favoriteFriends: favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id] });
  renderFriends();
  renderFriendsPage();
}

async function friendAction(url, okMsg) {
  try {
    await orbit.api(url, { method: 'POST', body: {}, auth: true });
    toast(okMsg, 'ok');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
  await loadFriends();
  await loadFriendRequests();
  renderFriendsPage();
}

/** Turns a friend's name into a text field to set a local nickname (empty = remove). */
function startRename(id) {
  const card = $(`#friendGrid .fcard[data-fid="${id}"]`);
  const f = friendsList.find((x) => x.id === id);
  if (!card || !f) return;
  const row = card.querySelector('.fcard-name-row');
  row.innerHTML = `<input class="rename-input" maxlength="40" placeholder="${esc(f.displayName || f.name)}" value="${esc(config.friendNicknames?.[id] || '')}" aria-label="Surnom" />`;
  const input = row.querySelector('input');
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save) {
      const nick = input.value.trim().slice(0, 40);
      const all = { ...(config.friendNicknames || {}) };
      if (nick && nick !== (f.displayName || f.name)) all[id] = nick;
      else delete all[id];
      try {
        config = await orbit.setConfig({ friendNicknames: all });
        if (nick) toast(`${f.displayName || f.name} s'appelle maintenant « ${nick} » dans Stellar`, 'ok');
      } catch (err) {
        toast(errMsg(err), 'error');
      }
      renderFriends();
      renderHomeFriends();
    }
    renderFriendsPage();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') finish(true);
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

$('#friendGrid').addEventListener('click', (e) => {
  const rn = e.target.closest('[data-rename]');
  if (rn) return startRename(Number(rn.dataset.rename));
  const t = e.target.closest('[data-favtoggle],[data-fprofile],[data-unfriend],[data-accept],[data-decline],[data-join]');
  if (!t) return;
  if (t.dataset.favtoggle) return toggleFavoriteFriend(Number(t.dataset.favtoggle));
  if (t.dataset.fprofile) return showPlayer(t.dataset.fprofile);
  if (t.dataset.join) {
    const f = friendsList.find((x) => x.id === Number(t.dataset.join));
    return f && joinFriend(f);
  }
  if (t.dataset.accept) return friendAction(`https://friends.roblox.com/v1/users/${t.dataset.accept}/accept-friend-request`, 'Demande acceptée 🎉');
  if (t.dataset.decline) return friendAction(`https://friends.roblox.com/v1/users/${t.dataset.decline}/decline-friend-request`, 'Demande refusée');
  if (t.dataset.unfriend) {
    const f = friendsList.find((x) => x.id === Number(t.dataset.unfriend));
    if (f && confirm(`Retirer ${friendName(f)} (@${f.name}) de tes amis Roblox ?`)) {
      friendAction(`https://friends.roblox.com/v1/users/${f.id}/unfriend`, `${friendName(f)} n'est plus dans tes amis`);
    }
  }
});
$('#friendTabs').addEventListener('click', (e) => {
  const c = e.target.closest('[data-ftab]');
  if (!c) return;
  friendTab = c.dataset.ftab;
  renderFriendsPage();
});
$('#friendSort').addEventListener('change', async (e) => {
  config = await orbit.setConfig({ friendSort: e.target.value });
  renderFriendsPage();
});
$('#friendSearch').addEventListener('input', renderFriendsPage);
$('#friendSearchForm').addEventListener('submit', (e) => e.preventDefault());

$('#friendsList').addEventListener('click', (e) => {
  const j = e.target.closest('[data-join]');
  if (j) {
    e.stopPropagation();
    const f = friendsList.find((x) => x.id === Number(j.dataset.join));
    if (f) joinFriend(f);
    return;
  }
  const row = e.target.closest('[data-friend]');
  if (!row) return;
  const f = friendsList.find((x) => x.id === Number(row.dataset.friend));
  if (f) showPlayer(f.name);
});

// ================= home =================
let exploreSorts = null;

async function getSorts() {
  if (exploreSorts) return exploreSorts;
  const r = await orbit.api(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${sessionId}`);
  exploreSorts = Object.fromEntries(r.sorts.filter((s) => s.contentType === 'Games' && s.games?.length).map((s) => [s.sortId, s]));
  return exploreSorts;
}

function renderGreeting() {
  /* console home: no greeting line */
}

let heroGame = null;

async function renderHero(game, tag) {
  heroGame = game;
  gameRegistry.set(String(game.universeId), game);
  $('#heroTag').textContent = tag;
  $('#heroTitle').textContent = game.name;
  $('#heroMeta').innerHTML = Number.isFinite(game.playerCount)
    ? `<span class="live">${fmt(game.playerCount)} joueurs</span>${Number.isFinite(game.up) ? `<span>👍 ${pct(game.up, game.down)}</span>` : ''}`
    : '<span>Reprends là où tu t\'es arrêté</span>';
  const bg = $('#heroBg');
  bg.classList.remove('loaded');
  const src = await wideThumb(game.universeId);
  if (src && heroGame === game) {
    bg.onload = () => bg.classList.add('loaded');
    bg.src = src;
  }
}

function renderHomeLocal() {
  $('#homeLocal').innerHTML = '<div id="homeContinue"></div>' + renderRow('Favoris Stellar', config.favorites || []);
  loadGameIcons($('#homeLocal'));
  renderSideGames('#quickFavs', config.favorites || [], 'Ajoute un jeu en favori avec ☆.');
  renderContinue();
}

// Discord-style side column: compact game lists.
function renderSideGames(sel, list, empty) {
  const box = $(sel);
  if (!box) return;
  box.innerHTML = list.length
    ? list.slice(0, 8).map((g) => `<button class="side-game" data-sideuid="${g.universeId}" title="${esc(g.name)}"><img data-uid="${g.universeId}" src="${iconCache.get(String(g.universeId)) || BLANK}" alt="" /><span>${esc(g.name)}</span></button>`).join('')
    : `<div class="side-empty">${esc(empty)}</div>`;
  loadGameIcons(box);
}
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-sideuid]');
  if (g) return openGame(g.dataset.sideuid);
  const c = e.target.closest('[data-chatwith]');
  if (c) {
    showView('messages');
    chatWith(c.dataset.chatwith);
  }
});

/** Roblox account's "Continue" row (needs login): [{universeId, placeId, name}] in Roblox's order. */
async function accountContinue() {
  if (!activeAccount()) return [];
  try {
    const r = await orbit.api('https://apis.roblox.com/discovery-api/omni-recommendation', {
      method: 'POST',
      body: { pageType: 'Home', sessionId },
      auth: true,
    });
    const sort = (r.sorts || []).find((s) => /continu|recent|récemment/i.test(`${s.topic} ${s.topicLayoutData?.title || ''}`));
    const meta = r.contentMetadata?.Game || {};
    return (sort?.recommendationList || [])
      .filter((x) => x.contentType === 'Game')
      .map((x) => ({ universeId: Number(x.contentId), placeId: meta[x.contentId]?.rootPlaceId, name: meta[x.contentId]?.name, playerCount: meta[x.contentId]?.playerCount }));
  } catch {
    return [];
  }
}

/** "Continue playing": Roblox account row + games found in Roblox's logs + games launched from Stellar. */
async function renderContinue() {
  const box = $('#homeContinue');
  if (!box) return;
  const [fromAccount, pt] = await Promise.all([accountContinue(), orbit.playtime().catch(() => ({ games: {} }))]);
  const fromLogs = Object.entries(pt.games)
    .sort((a, b) => b[1].last - a[1].last)
    .map(([u, g]) => ({ universeId: Number(u), name: g.name }));
  const seen = new Set();
  let list = [...fromAccount, ...fromLogs, ...(config.recent || [])].filter((g) => g.universeId && !seen.has(g.universeId) && seen.add(g.universeId)).slice(0, 20);
  // fill in names / place ids we don't have yet
  const missing = list.filter((g) => !g.placeId || !g.name || g.name === 'Jeu Roblox').map((g) => g.universeId);
  if (missing.length) {
    try {
      const r = await orbit.api(`https://games.roblox.com/v1/games?universeIds=${missing.join(',')}`);
      const byId = new Map((r.data || []).map((g) => [g.id, g]));
      list = list.map((g) => (byId.has(g.universeId) ? { ...g, placeId: g.placeId || byId.get(g.universeId).rootPlaceId, name: byId.get(g.universeId).name, playerCount: byId.get(g.universeId).playing } : g));
    } catch {
      /* keep what we have */
    }
  }
  list = list.filter((g) => g.placeId && g.name);
  renderSideGames('#quickGames', list, 'Tes derniers jeux apparaîtront ici.');
  if ($('#homeContinue') !== box) return;
  renderTiles(list, 'Reprendre');
}

async function renderAccountFavorites() {
  const box = $('#homeAccount');
  const acc = activeAccount();
  if (!box) return;
  if (!acc) return (box.innerHTML = '');
  try {
    const r = await orbit.api(`https://games.roblox.com/v2/users/${acc.id}/favorite/games?limit=25`);
    const games = (r.data || []).map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id, name: g.name })).filter((g) => g.placeId);
    box.innerHTML = renderRow(`Favoris de ${acc.displayName}`, games);
    loadGameIcons(box);
  } catch {
    box.innerHTML = '';
  }
}

function skeletonRow() {
  const cells = Array.from({ length: 7 }, () => '<div class="skeleton" style="aspect-ratio:1"></div>').join('');
  return `<div class="row"><div class="row-head"><div class="skeleton" style="width:160px;height:20px"></div></div><div class="row-scroll">${cells}</div></div>`;
}

async function renderHome() {
  $('#homeRows').innerHTML = `<div id="homeLocal"></div><div id="homeAccount"></div><div id="homeRemote">${skeletonRow()}${skeletonRow()}</div>`;
  renderGreeting();
  renderHomeFriends();
  renderPlaytime();
  renderHomeLocal();
  renderAccountFavorites();
  if (config.recent?.[0]) renderHero(config.recent[0], 'Reprendre');
  try {
    const sorts = await getSorts();
    const order = ['top-trending', 'top-playing-now', 'up-and-coming', 'fun-with-friends', 'top-revisited'];
    const ids = [...order.filter((id) => sorts[id]), ...Object.keys(sorts).filter((id) => !order.includes(id))];
    $('#homeRemote').innerHTML = ids
      .map((id) => renderRow(sorts[id].sortDisplayName, sorts[id].games.slice(0, 30).map(fromExplore)))
      .join('');
    loadGameIcons($('#homeRemote'));
    if (!config.recent?.[0]) {
      const first = sorts['top-trending'] || sorts[ids[0]];
      renderTiles(first.games.slice(0, 8).map(fromExplore), first.sortDisplayName, true);
    }
  } catch (e) {
    $('#homeRemote').innerHTML = `<div class="empty">Impossible de charger les jeux (${esc(errMsg(e))}).</div>`;
  }
}

$('#heroPlay').addEventListener('click', () => heroGame && play(heroGame));
$('#heroInfo').addEventListener('click', () => heroGame && openGame(heroGame.universeId));
$('#quickSearch').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#discoverInput').value = $('#quickSearchInput').value;
  showView('discover');
  $('#discoverForm').requestSubmit();
});
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    showView('home');
    $('#quickSearchInput').focus();
  }
});

// ================= discover =================
let discoverLoaded = false;

async function showSort(sortId) {
  const grid = $('#discoverGrid');
  $$('#discoverSorts .chip').forEach((c) => c.classList.toggle('active', c.dataset.sort === sortId));
  const sorts = await getSorts();
  grid.innerHTML = sorts[sortId].games.map(fromExplore).map(gameCard).join('');
  loadGameIcons(grid);
}

async function discoverDefault() {
  discoverLoaded = true;
  const grid = $('#discoverGrid');
  grid.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    const sorts = await getSorts();
    $('#discoverSorts').innerHTML = Object.values(sorts)
      .map((s) => `<button class="chip" data-sort="${esc(s.sortId)}">${esc(s.sortDisplayName)}</button>`)
      .join('');
    showSort(sorts['top-playing-now'] ? 'top-playing-now' : Object.keys(sorts)[0]);
  } catch (e) {
    grid.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
  }
}

$('#discoverSorts').addEventListener('click', (e) => {
  const c = e.target.closest('[data-sort]');
  if (c) showSort(c.dataset.sort);
});

$('#discoverForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = $('#discoverInput').value.trim();
  const grid = $('#discoverGrid');
  if (!q) return discoverDefault();
  const placeMatch = q.match(/roblox\.com\/games\/(\d+)/i) || q.match(/^(\d{3,20})$/);
  if (placeMatch) {
    try {
      const r = await orbit.api(`https://apis.roblox.com/universes/v1/places/${placeMatch[1]}/universe`);
      if (!r.universeId) throw new Error('Place introuvable');
      return openGame(r.universeId);
    } catch (e) {
      return toast(errMsg(e), 'error');
    }
  }
  $$('#discoverSorts .chip').forEach((c) => c.classList.remove('active'));
  grid.innerHTML = '<div class="empty">Recherche…</div>';
  try {
    const r = await orbit.api(
      `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${sessionId}&pageType=all`
    );
    const games = (r.searchResults || [])
      .filter((g) => g.contentGroupType === 'Game')
      .flatMap((g) => g.contents)
      .map(fromExplore);
    grid.innerHTML = games.length ? games.map(gameCard).join('') : `<div class="empty">Aucun jeu pour « ${esc(q)} ».</div>`;
    loadGameIcons(grid);
  } catch (e) {
    grid.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
  }
});

// ================= game modal =================
let currentGame = null;

async function openGame(universeId) {
  const modal = $('#gameModal');
  const hint = gameRegistry.get(String(universeId));
  modal.hidden = false;
  currentGame = hint ? { ...hint } : { universeId: Number(universeId), name: 'Chargement…' };
  $('#gmName').textContent = currentGame.name;
  $('#gmCreator').textContent = '';
  $('#gmStats').innerHTML = '';
  $('#gmDesc').textContent = '';
  $('#gmServers').innerHTML = '';
  $('#gmIcon').src = iconCache.get(String(universeId)) || BLANK;
  $('#gmBanner').src = BLANK;
  const acc = activeAccount();
  $('#gmAs').textContent = acc ? `Lancement avec ${acc.displayName} (@${acc.name})` : "Lancement avec le compte de l'appli Roblox";
  $('#gmPlay').disabled = !currentGame.placeId;
  syncFav();

  try {
    const [info, votes, icon, banner] = await Promise.all([
      orbit.api(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
      orbit.api(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`).catch(() => null),
      orbit.api(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`).catch(() => null),
      wideThumb(universeId),
    ]);
    const g = info.data?.[0];
    if (!g) throw new Error('Jeu introuvable');
    if (currentGame?.universeId !== g.id) return; // modal closed or another game opened meanwhile
    const v = votes?.data?.[0] || {};
    currentGame = { universeId: g.id, placeId: g.rootPlaceId, name: g.name };
    gameRegistry.set(String(g.id), currentGame);
    $('#gmName').textContent = g.name;
    $('#gmCreator').textContent = `par ${g.creator?.name || 'inconnu'}${g.genre && g.genre !== 'All' ? ' · ' + g.genre : ''}`;
    $('#gmStats').innerHTML = `
      <div><b>${fmt(g.playing)}</b>en ligne</div>
      <div><b>${fmt(g.visits)}</b>visites</div>
      <div><b>${pct(v.upVotes || 0, v.downVotes || 0)}</b>j'aime</div>
      <div><b>${fmt(g.favoritedCount)}</b>favoris</div>
      <div><b>${esc(g.maxPlayers)}</b>joueurs / serveur</div>`;
    $('#gmDesc').textContent = g.description || '';
    const src = safeImg(icon?.data?.[0]?.imageUrl);
    if (src) $('#gmIcon').src = src;
    if (banner) $('#gmBanner').src = banner;
    $('#gmPlay').disabled = false;
    syncFav();
    loadServers();
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

let currentServers = [];
const SERVER_SORTS = {
  full: (a, b) => b.playing - a.playing,
  empty: (a, b) => a.playing - b.playing,
  ping: (a, b) => (a.ping ?? 9999) - (b.ping ?? 9999),
};

function renderServers() {
  const box = $('#gmServers');
  const list = [...currentServers].sort(SERVER_SORTS[$('#gmServerSort').value] || SERVER_SORTS.full).slice(0, 40);
  $('#gmBestPing').disabled = $('#gmEmptiest').disabled = !currentServers.length;
  box.innerHTML = list.length
    ? list
        .map(
          (s) => `<div class="server">
        <div class="bar"><i style="width:${Math.min(100, Math.round((s.playing / s.maxPlayers) * 100))}%"></i></div>
        <span>${esc(s.playing)} / ${esc(s.maxPlayers)} joueurs</span>
        <span class="muted">${Number.isFinite(s.ping) ? esc(s.ping) + ' ms' : '—'}</span>
        <span class="muted">${Number.isFinite(s.fps) ? Math.round(s.fps) + ' FPS' : '—'}</span>
        <button class="btn small" data-server="${esc(s.id)}">Rejoindre</button>
      </div>`
        )
        .join('')
    : '<div class="empty">Aucun serveur public avec de la place.</div>';
}

async function loadServers() {
  const box = $('#gmServers');
  const game = currentGame;
  currentServers = [];
  box.innerHTML = '<div class="empty">Chargement des serveurs…</div>';
  try {
    // Roblox lists servers by player count: fetch the fullest and the emptiest 100, then merge.
    const url = (order) => `https://games.roblox.com/v1/games/${game.placeId}/servers/Public?limit=100&excludeFullGames=true&sortOrder=${order}`;
    const pages = await Promise.all([orbit.api(url('Desc')), orbit.api(url('Asc')).catch(() => ({ data: [] }))]);
    if (game !== currentGame) return;
    const byId = new Map(pages.flatMap((p) => p.data || []).map((s) => [s.id, s]));
    currentServers = [...byId.values()].filter((s) => s.playing < s.maxPlayers);
    renderServers();
  } catch (e) {
    box.innerHTML = `<div class="empty">Serveurs indisponibles (${esc(errMsg(e))}).</div>`;
  }
}

function joinPicked(pick, label) {
  if (!currentGame || !currentServers.length) return;
  const s = [...currentServers].sort(pick)[0];
  toast(`${label} : ${s.playing}/${s.maxPlayers} joueurs${Number.isFinite(s.ping) ? `, ${s.ping} ms` : ''}`, 'ok');
  play(currentGame, s.id);
}
$('#gmServerSort').addEventListener('change', renderServers);
$('#gmBestPing').addEventListener('click', () => joinPicked(SERVER_SORTS.ping, 'Serveur au meilleur ping'));
$('#gmEmptiest').addEventListener('click', () => joinPicked(SERVER_SORTS.empty, 'Serveur le plus vide'));

function syncFav() {
  const on = (config.favorites || []).some((f) => f.universeId === currentGame?.universeId);
  $('#gmFav').classList.toggle('on', on);
  $('#gmFav').disabled = !currentGame?.placeId;
}

function closeModal() {
  $('#gameModal').hidden = true;
  currentGame = null;
}

$('#gmPlay').addEventListener('click', () => currentGame?.placeId && play(currentGame));
$('#gmRefresh').addEventListener('click', () => currentGame?.placeId && loadServers());
$('#gmWeb').addEventListener('click', () => currentGame?.placeId && orbit.openUrl(`https://www.roblox.com/games/${currentGame.placeId}`));
$('#gmServers').addEventListener('click', (e) => {
  const b = e.target.closest('[data-server]');
  if (b && currentGame) play(currentGame, b.dataset.server);
});
$('#gmFav').addEventListener('click', async () => {
  if (!currentGame?.placeId) return;
  const ref = { universeId: currentGame.universeId, placeId: currentGame.placeId, name: currentGame.name };
  const favs = config.favorites || [];
  const has = favs.some((f) => f.universeId === ref.universeId);
  config = await orbit.setConfig({ favorites: has ? favs.filter((f) => f.universeId !== ref.universeId) : [ref, ...favs] });
  syncFav();
  renderHomeLocal();
  toast(has ? 'Retiré des favoris' : 'Ajouté aux favoris', 'ok');
});
$$('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#gameModal').hidden) closeModal();
  $('#accountMenu').hidden = true;
});

document.addEventListener('click', (e) => {
  const card = e.target.closest('.game-card');
  if (card) openGame(card.dataset.uid);
});

// ================= catalog =================
const cat = { category: 1, sort: 1, keyword: '', cursor: null, loaded: false };

function itemPrice(it) {
  if (it.priceStatus === 'Off Sale' || (it.price == null && it.lowestPrice == null)) return '<span class="offsale">Hors vente</span>';
  const p = it.lowestPrice ?? it.price;
  if (!p) return '<span class="free">Gratuit</span>';
  return `<i class="robux"></i>${full.format(p)}`;
}

async function searchCatalog(reset) {
  const grid = $('#catalogGrid');
  const more = $('#catalogMore');
  cat.loaded = true;
  if (reset) {
    cat.cursor = null;
    grid.innerHTML = Array.from({ length: 12 }, () => '<div class="skeleton" style="aspect-ratio:.78"></div>').join('');
  }
  more.disabled = true;
  try {
    const params = new URLSearchParams({ Category: cat.category, SortType: cat.sort, Limit: 30 });
    if (cat.keyword) params.set('Keyword', cat.keyword);
    if (cat.cursor) params.set('Cursor', cat.cursor);
    const r = await orbit.api(`https://catalog.roblox.com/v2/search/items/details?${params}`);
    const items = r.data || [];
    cat.cursor = r.nextPageCursor;
    const html = items.map(itemCard).join('');
    if (reset) grid.innerHTML = html || '<div class="empty">Aucun objet trouvé.</div>';
    else grid.insertAdjacentHTML('beforeend', html);
    more.hidden = !cat.cursor;
    loadItemThumbs(grid, items);
  } catch (e) {
    if (reset) grid.innerHTML = `<div class="empty">Catalogue indisponible (${esc(errMsg(e))}).</div>`;
    else toast(errMsg(e), 'error');
  } finally {
    more.disabled = false;
  }
}

function itemCard(it) {
  const limited = (it.itemRestrictions || []).some((x) => /limited|collectible/i.test(x));
  const tryable = it.itemType === 'Asset';
  return `<div class="item-card" data-item="${esc(it.id)}" data-type="${esc(it.itemType)}" data-assettype="${esc(it.assetType ?? '')}">
    <button class="item-open" type="button" title="Voir sur Roblox : ${esc(it.name)}">
      <div class="item-thumb">${limited ? '<span class="item-tag">Limité</span>' : ''}<img data-thumb="${esc(it.itemType)}:${esc(it.id)}" src="${BLANK}" alt="" /></div>
      <div class="item-name">${esc(it.name)}</div>
      <div class="item-creator">${esc(it.creatorName)}</div>
      <div class="item-price">${itemPrice(it)}</div>
    </button>
    ${tryable ? `<button class="item-try" type="button" data-tryon="${esc(it.id)}" data-name="${esc(it.name)}" data-assettype="${esc(it.assetType ?? '')}">Essayer</button>` : ''}
  </div>`;
}

async function loadItemThumbs(root, items) {
  const assets = items.filter((i) => i.itemType === 'Asset').map((i) => i.id);
  const bundles = items.filter((i) => i.itemType === 'Bundle').map((i) => i.id);
  const reqs = [];
  if (assets.length)
    reqs.push(orbit.api(`https://thumbnails.roblox.com/v1/assets?assetIds=${assets.join(',')}&size=150x150&format=Png`).then((r) => ['Asset', r]));
  if (bundles.length)
    reqs.push(orbit.api(`https://thumbnails.roblox.com/v1/bundles/thumbnails?bundleIds=${bundles.join(',')}&size=150x150&format=Png`).then((r) => ['Bundle', r]));
  for (const res of await Promise.allSettled(reqs)) {
    if (res.status !== 'fulfilled') continue;
    const [type, r] = res.value;
    for (const t of r.data || []) {
      const img = root.querySelector(`img[data-thumb="${type}:${t.targetId}"]`);
      const src = safeImg(t.imageUrl);
      if (img && src) img.src = src;
    }
  }
}

$('#catalogForm').addEventListener('submit', (e) => {
  e.preventDefault();
  cat.keyword = $('#catalogInput').value.trim();
  searchCatalog(true);
});
$('#catalogCats').addEventListener('click', (e) => {
  const c = e.target.closest('[data-cat]');
  if (!c) return;
  $$('#catalogCats .chip').forEach((x) => x.classList.toggle('active', x === c));
  cat.category = Number(c.dataset.cat);
  searchCatalog(true);
});
$('#catalogSort').addEventListener('change', (e) => {
  cat.sort = Number(e.target.value);
  searchCatalog(true);
});
$('#catalogMore').addEventListener('click', () => searchCatalog(false));
document.addEventListener('click', (e) => {
  const tr = e.target.closest('[data-tryon]');
  if (tr) return tryOn({ id: Number(tr.dataset.tryon), name: tr.dataset.name, assetType: Number(tr.dataset.assettype) || null });
  const it = e.target.closest('.item-open') && e.target.closest('.item-card[data-item]');
  if (it) openItem(it);
});

// ================= players =================
function showPlayer(name) {
  showView('players');
  $('#playerInput').value = name;
  $('#playerForm').requestSubmit();
}

$('#playerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#playerInput').value.trim();
  const box = $('#playerResult');
  if (!name) return;
  box.innerHTML = '<div class="empty">Recherche…</div>';
  try {
    const found = await orbit.api('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      body: { usernames: [name], excludeBannedUsers: true },
    });
    const u = found.data?.[0];
    if (!u) {
      box.innerHTML = `<div class="empty">Aucun joueur nommé « ${esc(name)} ».</div>`;
      return;
    }
    const opt = (p) => p.catch(() => null);
    const [info, friends, followers, following, avatar, favs, created] = await Promise.all([
      opt(orbit.api(`https://users.roblox.com/v1/users/${u.id}`)),
      opt(orbit.api(`https://friends.roblox.com/v1/users/${u.id}/friends/count`)),
      opt(orbit.api(`https://friends.roblox.com/v1/users/${u.id}/followers/count`)),
      opt(orbit.api(`https://friends.roblox.com/v1/users/${u.id}/followings/count`)),
      opt(orbit.api(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${u.id}&size=420x420&format=Png&isCircular=false`)),
      opt(orbit.api(`https://games.roblox.com/v2/users/${u.id}/favorite/games?limit=10`)),
      opt(orbit.api(`https://games.roblox.com/v2/users/${u.id}/games?accessFilter=Public&limit=10`)),
    ]);
    const toRef = (g) => ({ universeId: g.id, placeId: g.rootPlace?.id, name: g.name });
    const joined = info?.created ? new Date(info.created).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' }) : '—';
    const friend = friendsList.find((f) => f.id === u.id);
    const av = safeImg(avatar?.data?.[0]?.imageUrl);
    box.innerHTML = `
      <div class="profile">
        <div class="profile-avatar">${av ? `<img src="${esc(av)}" alt="Avatar de ${esc(u.name)}" />` : ''}</div>
        <div>
          <h2>${esc(u.displayName)} ${u.hasVerifiedBadge ? '<svg class="verified" viewBox="0 0 24 24"><path d="m8 12 3 3 5-6"/><circle cx="12" cy="12" r="9"/></svg>' : ''}</h2>
          <p class="muted">@${esc(u.name)} · inscrit en ${esc(joined)}${friend ? ' · ton ami' : ''}</p>
          <div class="profile-stats">
            <div><b>${fmt(friends?.count)}</b><span>amis</span></div>
            <div><b>${fmt(followers?.count)}</b><span>abonnés</span></div>
            <div><b>${fmt(following?.count)}</b><span>abonnements</span></div>
          </div>
          <p class="profile-desc">${esc(info?.description || '')}</p>
          <div class="hero-actions">
            ${friend?.state === 'ingame' ? `<button class="btn primary" data-join="${u.id}" id="profileJoin">${PLAY_SVG}Rejoindre</button>` : ''}
            ${activeAccount() && !friend && u.id !== activeAccount().id ? `<button class="btn" id="profileAddFriend">+ Ajouter en ami</button>` : ''}
            <button class="btn ghost" id="openProfile">Voir le profil sur roblox.com</button>
          </div>
        </div>
      </div>
      <div style="margin-top:28px">
        ${renderRow('Jeux favoris', (favs?.data || []).map(toRef).filter((g) => g.placeId))}
        ${renderRow('Jeux créés', (created?.data || []).map(toRef).filter((g) => g.placeId))}
      </div>`;
    $('#openProfile').addEventListener('click', () => orbit.openUrl(`https://www.roblox.com/users/${u.id}/profile`));
    $('#profileJoin')?.addEventListener('click', () => joinFriend(friend));
    $('#profileAddFriend')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        await orbit.api(`https://friends.roblox.com/v1/users/${u.id}/request-friendship`, {
          method: 'POST',
          body: { friendshipOriginSourceType: 'PlayerSearch' },
          auth: true,
        });
        toast(`Demande d'ami envoyée à ${u.displayName}`, 'ok');
      } catch (err) {
        // Roblox sometimes requires a captcha for friend requests: send it from the website then.
        toast(/HTTP 403/.test(errMsg(err)) ? 'Roblox demande une vérification : envoie la demande depuis son profil sur roblox.com.' : errMsg(err), 'error');
        ev.currentTarget.disabled = false;
      }
    });
    loadGameIcons(box);
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(errMsg(err))}</div>`;
  }
});

// ================= instances =================
let instTimer = null;

async function refreshInstances() {
  const all = await orbit.instances();
  const list = all.filter((p) => !p.background);
  const ghosts = all.filter((p) => p.background);
  $('#instCount').textContent = `(${list.length})`;
  $('#killAll').disabled = !all.length;
  $('#instList').innerHTML =
    (list.length
      ? list
          .map(
            (p, i) => `<div class="inst"><span class="pulse"></span>
          <div class="grow"><b>Client #${i + 1}</b> <span class="muted">· PID ${esc(p.pid)} · ${full.format(p.memoryMB)} Mo</span></div>
          <button class="btn danger small" data-kill="${esc(p.pid)}">Fermer</button></div>`
          )
          .join('')
      : '<div class="empty">Aucun client Roblox ouvert.</div>') +
    (ghosts.length
      ? `<div class="inst ghost"><div class="grow"><b>${ghosts.length} processus Roblox en arrière-plan</b> <span class="muted">· sans fenêtre, restes de jeux fermés · ${full.format(ghosts.reduce((s, p) => s + p.memoryMB, 0))} Mo</span></div>
          <button class="btn small" data-killghosts="${ghosts.map((p) => p.pid).join(',')}">Nettoyer</button></div>`
      : '');
}

$('#instList').addEventListener('click', async (e) => {
  const g = e.target.closest('[data-killghosts]');
  if (g) {
    for (const pid of g.dataset.killghosts.split(',').map(Number)) await orbit.kill(pid);
    toast('Processus en arrière-plan fermés', 'ok');
    return setTimeout(() => (refreshInstances(), updateStatus()), 500);
  }
  const b = e.target.closest('[data-kill]');
  if (!b) return;
  await orbit.kill(Number(b.dataset.kill));
  setTimeout(refreshInstances, 500);
});
$('#killAll').addEventListener('click', async () => {
  const n = await orbit.kill('all');
  toast(`${n} client${n > 1 ? 's' : ''} fermé${n > 1 ? 's' : ''}`, 'ok');
  setTimeout(() => (refreshInstances(), updateStatus()), 600);
});
$('#openFolder').addEventListener('click', () => orbit.openRobloxFolder());
$('#multiToggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  config = await orbit.setConfig({ multiInstance: on });
  if (on && status.running) toast('Ferme les clients déjà ouverts pour que le multi-instance fonctionne.', 'error');
  else toast(on ? 'Multi-instance activé' : 'Multi-instance désactivé', 'ok');
  updateStatus();
});

// ================= settings =================
let applyTimer = null;

/** Writes FastFlags + mods into Roblox now, and reports the outcome. */
async function applyNow(quiet = false, force = false) {
  try {
    const r = await orbit.applyFlags({ force });
    if (r.errors.length) toast(`Certains réglages n'ont pas pu être appliqués : ${r.errors[0]}`, 'error');
    else if (!quiet) toast(r.versions ? 'Appliqué — relance Roblox pour voir les changements.' : 'Enregistré — appliqué au prochain lancement.', 'ok');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

function scheduleApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applyNow, 500);
}

async function saveSettings(partial) {
  try {
    config = await orbit.setConfig(partial);
    scheduleApply();
    bindSettings();
    updateStatus();
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

$('#profiles').addEventListener('click', (e) => {
  const p = e.target.closest('[data-profile]');
  if (p) saveSettings({ graphicsProfile: p.dataset.profile });
});
for (const id of ['noShadows', 'noPostFx', 'noGrass']) {
  $('#' + id).addEventListener('change', (e) => saveSettings({ [id]: e.target.checked }));
}

$('#flagsEditor').addEventListener('input', (e) => e.target.classList.remove('invalid'));
$('#saveFlags').addEventListener('click', async () => {
  const box = $('#flagsEditor');
  let parsed;
  try {
    parsed = box.value.trim() ? JSON.parse(box.value) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Il faut un objet JSON { "NomDuFlag": valeur }');
  } catch (err) {
    box.classList.add('invalid');
    return toast(`JSON invalide : ${err.message}`, 'error');
  }
  await saveSettings({ customFlags: parsed });
  if ($('#flagsPreview').hidden === false) showFlagsPreview();
});
async function showFlagsPreview() {
  const pre = $('#flagsPreview');
  pre.textContent = JSON.stringify(await orbit.previewFlags(), null, 2);
  pre.hidden = false;
}
$('#showFlags').addEventListener('click', () => ($('#flagsPreview').hidden ? showFlagsPreview() : ($('#flagsPreview').hidden = true)));

// ================= mods =================
let modsPreviewTimer = null;

const PLUS_IMG_SVG = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>';

/** Builds the effect-cursor and wheel-theme tiles once (they are drawn locally with canvas). */
function buildModTiles() {
  if ($('#fxCursorGrid').childElementCount) return;
  $('#fxCursorGrid').innerHTML = OrbitArt.cursors
    .map((c) => `<button class="mod-tile" data-fx="${c.id}"><span class="checker"><canvas width="64" height="64"></canvas></span><b>${esc(c.name)}</b></button>`)
    .join('');
  $('#themeGrid').innerHTML =
    `<button class="theme-tile" data-theme=""><span class="theme-thumb dashed">✕</span><b>Aucun</b></button>` +
    OrbitArt.themes.map((t) => `<button class="theme-tile" data-theme="${t.id}"><span class="theme-thumb"></span><b>${esc(t.name)}</b></button>`).join('') +
    `<button class="theme-tile" data-theme="custom"><span class="theme-thumb dashed">${PLUS_IMG_SVG}</span><b>Mon image…</b></button>`;
  for (const t of OrbitArt.themes) {
    $(`#themeGrid [data-theme="${t.id}"] .theme-thumb`).append(OrbitArt.drawTheme(t, 176));
  }
}

let fxPreviewColor = null;
function drawFxPreviews() {
  if (fxPreviewColor === config.cursorColor) return; // only redraw when the colour changed
  fxPreviewColor = config.cursorColor;
  for (const c of OrbitArt.cursors) OrbitArt.drawCursor(c, config.cursorColor, $(`#fxCursorGrid [data-fx="${c.id}"] canvas`));
}

async function renderMods() {
  buildModTiles();
  const fx = config.cursorStyle === 'custom' ? config.cursorPreset : null;
  $$('#cursorGrid .mod-tile').forEach((t) => t.classList.toggle('active', t.dataset.cursor === config.cursorStyle && !fx));
  $$('#fxCursorGrid .mod-tile').forEach((t) => t.classList.toggle('active', t.dataset.fx === fx));
  $$('#themeGrid .theme-tile').forEach((t) => t.classList.toggle('active', (t.dataset.theme || null) === currentWheelBase()));
  $('#emoteHideLines').checked = config.emoteHideLines;
  $('#emoteHideLines').disabled = !config.emoteTheme;
  $('#emoteOpacity').value = Math.round(config.emoteOpacity * 100);
  $('#emoteOpacity').disabled = !config.emoteTheme;
  $('#emoteOpacityOut').textContent = `${Math.round(config.emoteOpacity * 100)} %`;
  $('#cursorColor').value = config.cursorColor;
  drawFxPreviews();
  $$('#emoteSwatches .swatch').forEach((s) => s.classList.toggle('active', (s.dataset.emote || null) === config.emoteColor));
  $('#emoteColor').value = config.emoteColor || '#8b7bff';
  $('#fontName').textContent = config.modFont ? `Police : ${config.modFont.name}` : 'Police de Roblox';
  $('#deathStatus').textContent = config.deathSound === 'oof' ? 'Le « oof » classique de Roblox.' : config.deathSound ? 'Son personnalisé activé.' : 'Son de Roblox par défaut.';
  renderCharSounds();

  const p = await orbit.mods.previews();
  $$('#cursorGrid .mod-tile').forEach((t) => {
    const src = p.cursors[t.dataset.cursor];
    const img = t.querySelector('img');
    if (src) img.src = src;
    else img.removeAttribute('src');
  });
  if (p.emote) $('#emoteRing').src = p.emote.ring;
  renderFontPreview();
}

async function renderFontPreview() {
  const el = $('#fontPreview');
  el.style.fontFamily = '';
  if (!config.modFont) return;
  try {
    const data = await orbit.mods.fontData();
    if (!data) return;
    const face = new FontFace('OrbitModFont', data);
    await face.load();
    document.fonts.add(face);
    el.style.fontFamily = 'OrbitModFont';
  } catch {
    /* preview only */
  }
}

async function modChange(fn, msg) {
  try {
    config = await fn();
    renderMods();
    scheduleApply();
    if (msg) toast(msg, 'ok');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

/** Lets the user pick any image; decoded here so WebP/GIF work too, then sent as PNG. Returns null if cancelled. */
async function pickImageAsPng(title) {
  const bytes = await orbit.mods.pickImageFile(title);
  if (!bytes) return null;
  try {
    return await OrbitArt.reencode(bytes);
  } catch {
    throw new Error('Image illisible (PNG, JPG, WebP ou GIF attendu)');
  }
}

async function setFxCursor(id) {
  const preset = OrbitArt.cursors.find((c) => c.id === id);
  const bytes = await OrbitArt.toPngBytes(OrbitArt.drawCursor(preset, config.cursorColor));
  return orbit.mods.setCursorImage(bytes, id);
}

$('#cursorGrid').addEventListener('click', (e) => {
  const t = e.target.closest('[data-cursor]');
  if (!t) return;
  if (t.dataset.cursor === 'custom') {
    return modChange(async () => {
      const png = await pickImageAsPng('Choisir une image de curseur');
      return png ? orbit.mods.setCursorImage(png, null) : config;
    });
  }
  modChange(() => orbit.setConfig({ cursorStyle: t.dataset.cursor }));
});
$('#fxCursorGrid').addEventListener('click', (e) => {
  const t = e.target.closest('[data-fx]');
  if (t) modChange(() => setFxCursor(t.dataset.fx));
});
$('#cursorColor').addEventListener('input', (e) => {
  clearTimeout(modsPreviewTimer);
  modsPreviewTimer = setTimeout(async () => {
    const fx = config.cursorStyle === 'custom' ? config.cursorPreset : null;
    if (fx) {
      return modChange(async () => {
        config = await orbit.setConfig({ cursorColor: e.target.value });
        return setFxCursor(fx);
      });
    }
    const style = ['default', 'custom'].includes(config.cursorStyle) ? 'dot' : config.cursorStyle;
    modChange(() => orbit.setConfig({ cursorColor: e.target.value, cursorStyle: style }));
  }, 250);
});
// ---- wheel = base (theme / own image / nothing) + stickers on top ----
const currentWheelBase = () => (config.emoteTheme === 'stickers' ? null : config.emoteTheme);

async function customWheelBase() {
  const b = await orbit.mods.emoteBase();
  return b ? createImageBitmap(new Blob([b])) : null;
}

/** Re-renders the wheel (base layer + separate sticker layer on top) and applies it. */
async function applyWheel(baseId) {
  const stickers = await orbit.mods.getStickers();
  if (!baseId && !stickers.length) return orbit.mods.clearEmoteImage();
  const base = baseId ? await OrbitStickers.compose(baseId, [], baseId === 'custom' ? await customWheelBase() : null) : null;
  const layer = stickers.length ? await OrbitStickers.composeStickers(stickers) : null;
  return orbit.mods.setEmoteImage(
    base ? await OrbitArt.toPngBytes(base) : null,
    baseId || 'stickers',
    layer ? await OrbitArt.toPngBytes(layer) : null
  );
}

$('#themeGrid').addEventListener('click', (e) => {
  const t = e.target.closest('[data-theme]');
  if (!t) return;
  const id = t.dataset.theme;
  if (!id) return modChange(() => applyWheel(null));
  if (id === 'custom') {
    return modChange(async () => {
      const png = await pickImageAsPng('Choisir une image de roue des emotes');
      if (!png) return config;
      await orbit.mods.saveEmoteBase(png);
      return applyWheel('custom');
    }, null);
  }
  const theme = OrbitArt.themes.find((x) => x.id === id);
  modChange(() => applyWheel(id), `Thème « ${theme.name} » choisi`);
});

// ---- sticker editor ----
const ed = { list: [], sel: -1, base: null, lines: null, drag: null, S: 1040 };
const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

async function openStickerEditor() {
  ed.list = await orbit.mods.getStickers();
  ed.sel = -1;
  const baseId = currentWheelBase();
  ed.base = baseId ? await OrbitStickers.compose(baseId, [], baseId === 'custom' ? await customWheelBase() : null, ed.S) : null;
  const showLines = !(baseId && config.emoteHideLines);
  const linesUrl = showLines ? await orbit.mods.wheelLines() : null;
  ed.lines = linesUrl ? await loadImg(linesUrl) : null;
  const cv = $('#stickerCanvas');
  cv.width = cv.height = ed.S;
  if (!$('#stickerPalette').childElementCount) {
    $('#stickerPalette').innerHTML = OrbitStickers.EMOJIS.map((s) => `<button class="sticker-btn" data-sticker="${s}">${s}</button>`).join('');
  }
  $('#stickerModal').hidden = false;
  await OrbitStickers.ready(ed.list);
  drawEditor();
}

function drawEditor() {
  const S = ed.S, cv = $('#stickerCanvas'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  // game-like backdrop + Roblox's own dark disc
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#6f8fb0'); g.addColorStop(1, '#2a3340');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // the visible square: corners outside the wheel are usable too
  ctx.save();
  ctx.setLineDash([10, 10]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.strokeRect(3, 3, S - 6, S - 6);
  ctx.restore();
  // Roblox's dark disc, then the theme at its opacity (cut to the circle), then the separators
  ctx.save();
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = config.emoteOpacity ?? 0.9;
  if (ed.base) ctx.drawImage(ed.base, 0, 0);
  ctx.globalAlpha = 1;
  ctx.restore();
  if (ed.lines) ctx.drawImage(ed.lines, 0, 0, S, S);
  // stickers: on top of everything, full opacity, anywhere in the square (same as in game)
  for (const s of ed.list) OrbitStickers.draw(ctx, s, S);
  const st = ed.list[ed.sel];
  if (st) {
    ctx.save();
    ctx.setLineDash([12, 8]); ctx.lineWidth = 4; ctx.strokeStyle = '#4fd1ff';
    ctx.beginPath(); ctx.arc(st.x * S, st.y * S, (st.size * S) / 2 + 10, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  $('#stickerSize').disabled = $('#stickerRot').disabled = $('#stickerDelete').disabled = !st;
  if (st) {
    $('#stickerSize').value = Math.round(st.size * 100);
    $('#stickerRot').value = Math.round((st.rot * 180) / Math.PI);
  }
}

function addSticker(kind, value, size = 0.12) {
  ed.list.push({ kind, value, x: 0.5 + (Math.random() - 0.5) * 0.1, y: 0.16 + Math.random() * 0.06, size, rot: 0 });
  ed.sel = ed.list.length - 1;
  OrbitStickers.ready(ed.list).then(drawEditor);
}

const edPoint = (e) => {
  const r = $('#stickerCanvas').getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
};

$('#stickerCanvas').addEventListener('pointerdown', (e) => {
  const p = edPoint(e);
  ed.sel = -1;
  for (let i = ed.list.length - 1; i >= 0; i--) {
    const s = ed.list[i];
    if (Math.hypot(p.x - s.x, p.y - s.y) <= s.size / 2 + 0.01) {
      ed.sel = i;
      ed.drag = { dx: p.x - s.x, dy: p.y - s.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      break;
    }
  }
  drawEditor();
});
$('#stickerCanvas').addEventListener('pointermove', (e) => {
  const s = ed.list[ed.sel];
  if (!ed.drag || !s) return;
  const p = edPoint(e);
  s.x = Math.min(1, Math.max(0, p.x - ed.drag.dx));
  s.y = Math.min(1, Math.max(0, p.y - ed.drag.dy));
  drawEditor();
});
$('#stickerCanvas').addEventListener('pointerup', () => (ed.drag = null));
$('#stickerCanvas').addEventListener('wheel', (e) => {
  const s = ed.list[ed.sel];
  if (!s) return;
  e.preventDefault();
  s.size = Math.min(0.6, Math.max(0.03, s.size * (e.deltaY < 0 ? 1.08 : 0.92)));
  drawEditor();
}, { passive: false });
$('#stickerPalette').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sticker]');
  if (b) addSticker('emoji', b.dataset.sticker);
});
$('#stickerImage').addEventListener('click', async () => {
  try {
    const bytes = await orbit.mods.pickImageFile('Choisir une image de sticker');
    if (bytes) addSticker('image', await OrbitStickers.toStickerDataUrl(bytes), 0.18);
  } catch {
    toast('Image illisible (PNG, JPG, WebP ou GIF attendu)', 'error');
  }
});
$('#stickerSize').addEventListener('input', (e) => {
  const s = ed.list[ed.sel];
  if (s) { s.size = Number(e.target.value) / 100; drawEditor(); }
});
$('#stickerRot').addEventListener('input', (e) => {
  const s = ed.list[ed.sel];
  if (s) { s.rot = (Number(e.target.value) * Math.PI) / 180; drawEditor(); }
});
function deleteSelectedSticker() {
  if (ed.sel < 0) return;
  ed.list.splice(ed.sel, 1);
  ed.sel = -1;
  drawEditor();
}
$('#stickerDelete').addEventListener('click', deleteSelectedSticker);
$('#stickerClear').addEventListener('click', () => { ed.list = []; ed.sel = -1; drawEditor(); });
document.addEventListener('keydown', (e) => {
  if ($('#stickerModal').hidden) return;
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedSticker();
  if (e.key === 'Escape') $('#stickerModal').hidden = true;
});
$$('[data-sticker-close]').forEach((b) => b.addEventListener('click', () => ($('#stickerModal').hidden = true)));
$('#openStickers').addEventListener('click', openStickerEditor);
$('#stickerSave').addEventListener('click', async () => {
  try {
    await orbit.mods.saveStickers(ed.list);
  } catch (e) {
    return toast(errMsg(e), 'error');
  }
  $('#stickerModal').hidden = true;
  modChange(() => applyWheel(currentWheelBase()), ed.list.length ? 'Stickers enregistrés : relance Roblox pour les voir.' : 'Stickers retirés');
});


$('#emoteHideLines').addEventListener('change', (e) => modChange(() => orbit.setConfig({ emoteHideLines: e.target.checked })));
$('#emoteOpacity').addEventListener('input', (e) => ($('#emoteOpacityOut').textContent = `${e.target.value} %`));
$('#emoteOpacity').addEventListener('change', (e) => modChange(() => orbit.setConfig({ emoteOpacity: Number(e.target.value) / 100 })));
$('#emoteSwatches').addEventListener('click', (e) => {
  const s = e.target.closest('[data-emote]');
  if (s) modChange(() => orbit.setConfig({ emoteColor: s.dataset.emote || null }));
});
$('#emoteColor').addEventListener('input', (e) => {
  clearTimeout(modsPreviewTimer);
  modsPreviewTimer = setTimeout(() => modChange(() => orbit.setConfig({ emoteColor: e.target.value })), 250);
});
// ---- font list: Roblox + Windows fonts already on the PC, plus the user's own (saved) ----
const loadedFonts = new Map(); // font id -> CSS family name

async function loadFontFace(id) {
  if (loadedFonts.has(id)) return loadedFonts.get(id);
  const family = `OrbitF${loadedFonts.size}`;
  loadedFonts.set(id, family);
  try {
    const face = new FontFace(family, await orbit.mods.fontBytes(id));
    await face.load();
    document.fonts.add(face);
  } catch {
    /* preview only */
  }
  return family;
}

let fontListKey = null;
async function renderFontList() {
  const list = await orbit.mods.fontList();
  // Rebuild only when the list or the selected font changed (the tiles load fonts, which is costly).
  const key = JSON.stringify([list.map((f) => f.id), config.modFont?.id || (config.modFont ? 'legacy' : '')]);
  if (key === fontListKey) return;
  fontListKey = key;
  const groups = [...new Set(list.map((f) => f.group))];
  const active = config.modFont?.id || (config.modFont ? 'legacy' : '');
  const tile = (f) => `<button class="font-tile ${f.id === active ? 'active' : ''}" data-font="${esc(f.id)}" title="${esc(f.name)}">
      <span class="font-sample" data-family-for="${esc(f.id)}">Aa Salut !</span><b>${esc(f.name)}</b>
      ${f.id.startsWith('user:') ? `<span class="font-remove" data-remove-font="${esc(f.id)}" title="Supprimer" role="button">×</span>` : ''}
    </button>`;
  $('#fontList').innerHTML =
    `<div class="sub-label">Par défaut</div><div class="font-grid"><button class="font-tile ${active ? '' : 'active'}" data-font=""><span class="font-sample">Aa Salut !</span><b>Police de Roblox</b></button></div>` +
    groups.map((g) => `<div class="sub-label">${esc(g)}</div><div class="font-grid">${list.filter((f) => f.group === g).map(tile).join('')}</div>`).join('');
  for (const f of list) {
    loadFontFace(f.id).then((family) => {
      const el = $(`#fontList [data-family-for="${CSS.escape(f.id)}"]`);
      if (el) el.style.fontFamily = `${family}, sans-serif`;
    });
  }
}

$('#fontList').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove-font]');
  if (rm) {
    e.stopPropagation();
    return modChange(() => orbit.mods.removeFont(rm.dataset.removeFont), 'Police supprimée').then(renderFontList);
  }
  const t = e.target.closest('[data-font]');
  if (!t) return;
  const id = t.dataset.font;
  modChange(() => (id ? orbit.mods.useFont(id) : orbit.mods.clearFont())).then(renderFontList);
});
$('#pickFont').addEventListener('click', () => modChange(orbit.mods.pickFont, 'Police ajoutée à ta liste').then(renderFontList));
$('#pickDeath').addEventListener('click', () => modChange(orbit.mods.pickDeath));
$('#clearDeath').addEventListener('click', () => modChange(orbit.mods.clearDeath, 'Son de mort par défaut rétabli'));
$('#oofDeath').addEventListener('click', () => modChange(orbit.mods.oofDeath, 'Oof classique activé'));

const CHAR_SOUND_LABELS = [
  ['jump', 'Saut', '🦘'],
  ['land', 'Atterrissage', '🪂'],
  ['steps', 'Pas', '👟'],
  ['falling', 'Chute', '🌀'],
  ['getup', 'Se relever', '🧍'],
  ['swim', 'Nage', '🏊'],
  ['splash', "Plouf dans l'eau", '💦'],
  ['explosion', 'Explosion', '💥'],
];
function renderCharSounds() {
  const cs = config.charSounds || {};
  $('#charSounds').innerHTML = CHAR_SOUND_LABELS.map(([id, name, icon]) => {
    const mode = cs[id] || 'default';
    const opt = (m, label) => `<button class="chip ${mode === m ? 'active' : ''}" data-csound="${id}" data-mode="${m}">${label}</button>`;
    return `<div class="sound-slot"><span class="sound-ico">${icon}</span><b>${name}</b><span class="chips">${opt('default', 'Défaut')}${opt('mute', 'Muet')}${opt('custom', mode === 'custom' ? 'Mon son ✓' : 'Mon son…')}</span></div>`;
  }).join('');
}
$('#charSounds').addEventListener('click', (e) => {
  const b = e.target.closest('[data-csound]');
  if (!b) return;
  const slot = b.dataset.csound;
  if (b.dataset.mode === 'custom') modChange(() => orbit.mods.pickCharSound(slot));
  else modChange(() => orbit.mods.setCharSound(slot, b.dataset.mode));
});
$('#applyMods').addEventListener('click', () => applyNow(false, true));

// ================= filters / GPU =================
async function renderGpu() {
  $('#gpuState').className = 'gpu-state';
  $('#gpuState').textContent = 'Vérification…';
  try {
    const g = await orbit.gpuStatus();
    $('#gpuList').textContent = g.adapters.length ? g.adapters.join(' + ') : 'Carte graphique non détectée';
    $('#gpuForceRow').hidden = !g.hasNvidia;
    $('#nvidiaGuide').hidden = !g.hasNvidia;
    $('#otherGuide').hidden = g.hasNvidia;
    $('#gpuForce').checked = g.forced;
    const st = $('#gpuState');
    if (!g.hasNvidia) st.textContent = '';
    else if (!g.robloxRunning) st.textContent = 'Lance Roblox puis clique sur « Vérifier » pour voir quelle carte il utilise.';
    else if (g.robloxOnNvidia) { st.classList.add('ok'); st.textContent = '✓ Roblox tourne sur ta carte NVIDIA.'; }
    else if (g.robloxOnNvidia === false) { st.classList.add('warn'); st.textContent = '⚠ Roblox tourne sur la puce Intel : active l\'option ci-dessous puis relance Roblox.'; }
    else st.textContent = 'Impossible de vérifier (outil NVIDIA indisponible).';
  } catch (e) {
    $('#gpuState').textContent = errMsg(e);
  }
}

$('#gpuCheck').addEventListener('click', renderGpu);
$('#openNvidia').addEventListener('click', () => orbit.openNvidiaApp().catch((e) => toast(errMsg(e), 'error')));
orbit.hasNvidiaApp().then((has) => ($('#openNvidia').hidden = !has));
$('#gpuForce').addEventListener('change', async (e) => {
  try {
    config = await orbit.setConfig({ forceDedicatedGpu: e.target.checked });
    toast(e.target.checked ? 'Roblox utilisera la carte NVIDIA (relance Roblox).' : 'Réglage Windows d\'origine rétabli.', 'ok');
  } catch (err) {
    toast(errMsg(err), 'error');
  }
  renderGpu();
});

// ================= music (Windows media session) =================
const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4h3v16H7zM14 4h3v16h-3z"/></svg>';
const NOTE_ICON = '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const MUSIC_ACTIONS = [
  ['launcher', 'Afficher / cacher Stellar'],
  ['toggle', 'Lecture / pause'],
  ['next', 'Chanson suivante'],
  ['prev', 'Chanson précédente'],
  ['show', 'Afficher le titre en jeu'],
  ['player', 'Ouvrir / fermer le lecteur'],
  ['volup', 'Volume +'],
  ['voldown', 'Volume −'],
];
let music = { title: '', status: 'none' };
let recordingAction = null;

function setCover(el, thumb) {
  el.innerHTML = thumb ? `<img src="${thumb}" alt="" />` : NOTE_ICON;
}

function renderMusic(s) {
  music = s || music;
  const has = !!music.title;
  const playing = music.status === 'Playing';
  $('#musicTitle').textContent = has ? music.title : 'Aucune musique détectée';
  $('#musicArtist').textContent = has ? music.artist || '' : 'Lance Spotify, Deezer ou une vidéo.';
  $('#musicSrc').textContent = has ? `${music.label}${playing ? ' · en lecture' : music.status === 'Paused' ? ' · en pause' : ''}` : '';
  setCover($('#musicCover'), music.thumb);
  $('#musicToggle').innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  $('#miniPlayer').hidden = !has;
  if (has) {
    $('#miniTitle').textContent = music.title;
    $('#miniArtist').textContent = music.artist || music.label;
    setCover($('#miniCover'), music.thumb);
    $('#miniToggle').innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  }
}

const prettyAccel = (a) => a.split('+').map((k) => (k === 'Super' ? 'Win' : k.startsWith('num') ? 'Pavé ' + k.slice(3) : k)).join(' + ');

function renderHotkeys() {
  const hk = config.musicHotkeys || {};
  $('#musicHotkeys').innerHTML = MUSIC_ACTIONS.map(
    ([id, label]) => `<div class="hotkey">
      <span>${esc(label)}</span>
      <button class="hk-btn ${recordingAction === id ? 'recording' : ''}" data-hk="${id}">${recordingAction === id ? 'Appuie sur ta combinaison…' : hk[id] ? `<kbd>${esc(prettyAccel(hk[id]))}</kbd>` : '<span class="muted">Définir</span>'}</button>
      ${hk[id] ? `<button class="hk-clear" data-hkclear="${id}" title="Retirer" aria-label="Retirer le raccourci">×</button>` : '<span></span>'}
    </div>`
  ).join('');
  $('#musicPopup').checked = config.musicPopup;
}

/** Keyboard event -> Electron accelerator ("Ctrl+Alt+P"). Plain letters need a modifier (they're used in game). */
function accelFrom(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const c = e.code;
  let key = null;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(c)) key = c;
  else if (/^Numpad\d$/.test(c)) key = 'num' + c.slice(6);
  else key = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', MediaPlayPause: 'MediaPlayPause', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack' }[c] || null;
  if (!key) return null; // only a modifier so far
  if (!mods.length && !/^F\d+$/.test(key) && !key.startsWith('Media')) return 'NEED_MOD';
  return [...mods, key].join('+');
}

async function saveHotkey(action, accel) {
  try {
    config = await orbit.music.setHotkey(action, accel);
    if (accel) toast(`${prettyAccel(accel)} → ${MUSIC_ACTIONS.find((a) => a[0] === action)[1]}`, 'ok');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
  recordingAction = null;
  renderHotkeys();
}

document.addEventListener(
  'keydown',
  (e) => {
    if (!recordingAction) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      recordingAction = null;
      return renderHotkeys();
    }
    if (e.key === 'Backspace' || e.key === 'Delete') return saveHotkey(recordingAction, '');
    const a = accelFrom(e);
    if (a === 'NEED_MOD') return toast('Ajoute Ctrl, Alt ou Maj (une lettre seule bloquerait la touche en jeu), ou utilise une touche F1–F12.', 'error');
    if (a) saveHotkey(recordingAction, a);
  },
  true
);

$('#musicHotkeys').addEventListener('click', (e) => {
  const clear = e.target.closest('[data-hkclear]');
  if (clear) return saveHotkey(clear.dataset.hkclear, '');
  const b = e.target.closest('[data-hk]');
  if (!b) return;
  recordingAction = recordingAction === b.dataset.hk ? null : b.dataset.hk;
  renderHotkeys();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mcmd]');
  if (b) orbit.music.cmd(b.dataset.mcmd).catch((err) => toast(errMsg(err), 'error'));
});
$('#musicPopup').addEventListener('change', async (e) => {
  config = await orbit.setConfig({ musicPopup: e.target.checked });
});
$('#musicTestPopup').addEventListener('click', () => orbit.music.testPopup().then(() => toast('Regarde en haut à droite de ton écran 👀', 'ok')).catch((err) => toast(errMsg(err), 'error')));
orbit.music.onUpdate(renderMusic);

// ================= keyboard sounds =================
async function ensureCustomSound() {
  const id = config.keySoundProfile;
  if (!String(id).startsWith('user:')) return;
  try {
    await KeySounds.loadCustom(id, await orbit.keys.bytes(id));
  } catch {
    toast('Ce son ne peut pas être lu (WAV, MP3 ou OGG attendu).', 'error');
  }
}

async function renderKeySounds() {
  const userSounds = await orbit.keys.list();
  const chip = (id, name, removable) =>
    `<button class="chip ${id === config.keySoundProfile ? 'active' : ''}" data-keyprofile="${esc(id)}">${esc(name)}${removable ? ` <span class="chip-x" data-keyremove="${esc(id)}" title="Supprimer">×</span>` : ''}</button>`;
  $('#keyProfiles').innerHTML =
    Object.entries(KeySounds.PROFILES).map(([id, p]) => chip(id, p.name, false)).join('') +
    userSounds.map((s) => chip(s.id, `🎵 ${s.name}`, true)).join('') +
    `<button class="chip" data-keyimport="1">+ Importer un son…</button>`;
  $('#keyIgnoreGame').checked = config.keyIgnoreGame;
  $('#keySounds').checked = config.keySounds;
  $('#keyVolume').value = Math.round(config.keySoundVolume * 100);
  $('#keyVolumeOut').textContent = `${Math.round(config.keySoundVolume * 100)} %`;
  $('#keyRobloxOnly').checked = config.keySoundsRobloxOnly;
}

async function setKeyConfig(partial) {
  try {
    config = await orbit.setConfig(partial);
  } catch (e) {
    toast(errMsg(e), 'error');
    config = await orbit.getConfig();
  }
  renderKeySounds();
}

orbit.onKeySound(({ type, kind }) => {
  if (!config.keySounds) return; // the "Roblox window only" filter is applied in the main process
  KeySounds.play({ profile: config.keySoundProfile, volume: config.keySoundVolume, kind, up: type === 'up' });
});

$('#keySounds').addEventListener('change', (e) => setKeyConfig({ keySounds: e.target.checked }));
$('#keyRobloxOnly').addEventListener('change', (e) => setKeyConfig({ keySoundsRobloxOnly: e.target.checked }));
$('#keyProfiles').addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-keyremove]');
  if (rm) {
    e.stopPropagation();
    config = await orbit.keys.remove(rm.dataset.keyremove);
    return renderKeySounds();
  }
  if (e.target.closest('[data-keyimport]')) {
    try {
      config = await orbit.keys.import();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
    await ensureCustomSound();
    await renderKeySounds();
    return KeySounds.demo(config.keySoundProfile, config.keySoundVolume);
  }
  const c = e.target.closest('[data-keyprofile]');
  if (!c) return;
  await setKeyConfig({ keySoundProfile: c.dataset.keyprofile });
  await ensureCustomSound();
  KeySounds.demo(config.keySoundProfile, config.keySoundVolume);
});
$('#keyIgnoreGame').addEventListener('change', (e) => setKeyConfig({ keyIgnoreGame: e.target.checked }));

// ================= cursor trail (overlay) =================
let trailPreview = null;

function renderTrail() {
  $('#trailChips').innerHTML =
    `<button class="chip ${config.cursorFx ? '' : 'active'}" data-trail="">Aucune</button>` +
    Object.entries(OrbitFx.EFFECTS)
      .map(([id, fx]) => `<button class="chip ${id === config.cursorFx ? 'active' : ''}" data-trail="${id}">${esc(fx.name)}</button>`)
      .join('');
  $('#trailDensity').value = Math.round(config.cursorFxDensity * 100);
  $('#trailDensityOut').textContent = `${Math.round(config.cursorFxDensity * 100)} %`;
  $('#trailSize').value = Math.round(config.cursorFxSize * 100);
  $('#trailSizeOut').textContent = `${Math.round(config.cursorFxSize * 100)} %`;
  if (!trailPreview) {
    const cv = $('#trailPreview');
    trailPreview = OrbitFx.create(cv, () => ({ effect: config.cursorFx || 'sakura', density: config.cursorFxDensity, size: config.cursorFxSize }));
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      trailPreview.move(e.clientX - r.left, e.clientY - r.top);
    });
    cv.addEventListener('pointerleave', () => trailPreview.reset());
  }
  trailPreview.resize();
}

async function setTrail(partial) {
  try {
    config = await orbit.setConfig(partial);
  } catch (e) {
    toast(errMsg(e), 'error');
  }
  renderTrail();
}

$('#trailChips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-trail]');
  if (c) setTrail({ cursorFx: c.dataset.trail || null }).then(() => c.dataset.trail && toast('Traînée activée : lance Roblox et bouge la souris.', 'ok'));
});
$('#trailDensity').addEventListener('input', (e) => ($('#trailDensityOut').textContent = `${e.target.value} %`));
$('#trailDensity').addEventListener('change', (e) => setTrail({ cursorFxDensity: Number(e.target.value) / 100 }));
$('#trailSize').addEventListener('input', (e) => ($('#trailSizeOut').textContent = `${e.target.value} %`));
$('#trailSize').addEventListener('change', (e) => setTrail({ cursorFxSize: Number(e.target.value) / 100 }));
$('#keyVolume').addEventListener('input', (e) => ($('#keyVolumeOut').textContent = `${e.target.value} %`));
$('#keyVolume').addEventListener('change', (e) => setKeyConfig({ keySoundVolume: Number(e.target.value) / 100 }));
$('#keyTest').addEventListener('click', () => KeySounds.demo(config.keySoundProfile, config.keySoundVolume));

// Themes: [id, name, sidebar, content, card, accent] — the colours only feed the mini previews;
// the real palettes live in styles.css (:root[data-theme=…]).
// Themes: [id, name, sidebar, content, card, accent] — colours only feed the mini previews.
const THEMES = [
  ['dark', 'Sombre', '#070a14', '#0d1220', '#1a2035', '#7c6cff'],
  ['light', 'Clair', '#eef0f6', '#ffffff', '#e4e7f0', '#6d5dfc'],
  ['system', 'Système', '#070a14', '#ffffff', '#1a2035', '#7c6cff'],
  ['neon', 'Néon', '#050507', '#09090e', '#161621', '#00e5ff'],
  ['sakura', 'Sakura', '#fbeef6', '#fff8fc', '#fde3f0', '#ff7eb6'],
  ['galaxy', 'Galaxie', '#0b0a1f', '#1a1640', '#2a2558', '#a78bfa'],
];
// Theme id -> stylesheet palette ("system" follows Windows light/dark).
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function cssTheme(id) {
  if (id === 'system') return systemDark.matches ? 'console' : 'light';
  return { dark: 'console', sakura: 'pastel' }[id] || id;
}
systemDark.addEventListener('change', () => config.theme === 'system' && applyAccent());

function applyAccent() {
  const theme = config.theme || 'dark';
  const a = config.accent || 'auto';
  document.documentElement.dataset.theme = cssTheme(theme);
  if (a === 'auto') delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = a;
  $$('#accentSwatches [data-accent]').forEach((s) => s.classList.toggle('active', s.dataset.accent === a));
  if (!$('#themeCards').childElementCount) {
    $('#themeCards').innerHTML = THEMES.map(
      ([id, name, side, content, card, accent]) => `<button class="theme-card" data-theme-id="${id}">
        <span class="theme-mini" style="background:${side}">
          <i style="background:${card}"></i>
          <i style="background:${content};padding:6px;gap:4px;align-content:start">
            <i style="height:8px;width:60%;background:${accent};border-radius:3px"></i>
            <i style="height:18px;background:${card};border-radius:4px"></i>
            <i style="height:8px;width:40%;background:${card};border-radius:3px"></i>
          </i>
        </span>
        <b>${esc(name)}</b>
      </button>`
    ).join('');
  }
  $$('#themeCards [data-theme-id]').forEach((c) => c.classList.toggle('active', c.dataset.themeId === theme));
}
$('#themeCards').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-theme-id]');
  if (!c) return;
  config = await orbit.setConfig({ theme: c.dataset.themeId });
  applyAccent();
});
$('#accentSwatches').addEventListener('click', async (e) => {
  const s = e.target.closest('[data-accent]');
  if (!s) return;
  config = await orbit.setConfig({ accent: s.dataset.accent });
  applyAccent();
});
$('#soundPacks').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pack]');
  if (!b) return;
  config = await orbit.setConfig({ uiSoundPack: b.dataset.pack });
  Sfx.setPack(config.uiSoundPack);
  $$('#soundPacks [data-pack]').forEach((x) => x.classList.toggle('active', x === b));
  Sfx.play('select', true);
  setTimeout(() => Sfx.play('move', true), 380);
});
$('#uiSounds').addEventListener('change', async (e) => {
  config = await orbit.setConfig({ uiSounds: e.target.checked });
  Sfx.setEnabled(config.uiSounds);
  if (config.uiSounds) Sfx.play('select');
});
$('#notifyFavorites').addEventListener('change', async (e) => {
  config = await orbit.setConfig({ notifyFavorites: e.target.checked });
});

function bindSettings() {
  applyAccent();
  $('#notifyFavorites').checked = config.notifyFavorites;
  $('#uiSounds').checked = config.uiSounds !== false;
  $$('#soundPacks [data-pack]').forEach((b) => b.classList.toggle('active', b.dataset.pack === (config.uiSoundPack || 'soft')));
  $('#renderer').value = config.renderer;
  $('#msaa').value = String(config.msaa);
  $('#textureQuality').value = String(config.textureQuality);
  $('#minimizeOnLaunch').checked = config.minimizeOnLaunch;
  $('#closeOnLeave').checked = !!config.closeOnLeave;
  $('#launchFx').checked = config.launchFx !== false;
  $('#padCursorButton').value = String(config.padCursorButton ?? 8);
  $('#padCursorSpeed').value = config.padCursorSpeed || 1;
  $('#padCursorSpeedOut').textContent = `×${Number(config.padCursorSpeed || 1).toFixed(1)}`;
  $('#stellarSound').checked = config.stellarSound !== false;
  $('#menuMusic').checked = config.menuMusic === true;
  $('#idleEnabled').checked = config.idleEnabled !== false;
  $('#idleSound').checked = config.idleSound !== false;
  $('#idleMinutes').value = config.idleMinutes || 5;
  $('#idleMinutesOut').textContent = `${config.idleMinutes || 5} min`;
  $$('#idleSource [data-src]').forEach((b) => b.classList.toggle('active', b.dataset.src === (config.idleSource || 'recent')));
  $('#multiToggle').checked = config.multiInstance;
  $$('#profiles .profile-card').forEach((c) => c.classList.toggle('active', c.dataset.profile === config.graphicsProfile));
  $('#noShadows').checked = config.noShadows;
  $('#noPostFx').checked = config.noPostFx;
  $('#noGrass').checked = config.noGrass;
  const editor = $('#flagsEditor');
  if (document.activeElement !== editor) {
    editor.value = Object.keys(config.customFlags || {}).length ? JSON.stringify(config.customFlags, null, 2) : '';
  }
}

$('#renderer').addEventListener('change', (e) => saveSettings({ renderer: e.target.value }));
$('#msaa').addEventListener('change', (e) => saveSettings({ msaa: Number(e.target.value) }));
$('#textureQuality').addEventListener('change', (e) => saveSettings({ textureQuality: Number(e.target.value) }));
$('#minimizeOnLaunch').addEventListener('change', (e) => saveSettings({ minimizeOnLaunch: e.target.checked }));
$('#closeOnLeave').addEventListener('change', (e) => saveSettings({ closeOnLeave: e.target.checked }));
$('#launchFx').addEventListener('change', (e) => saveSettings({ launchFx: e.target.checked }));
$('#padCursorButton').addEventListener('change', (e) => saveSettings({ padCursorButton: Number(e.target.value) }));
$('#padCursorSpeed').addEventListener('input', (e) => ($('#padCursorSpeedOut').textContent = `×${Number(e.target.value).toFixed(1)}`));
$('#padCursorSpeed').addEventListener('change', (e) => saveSettings({ padCursorSpeed: Number(e.target.value) }));
$('#stellarSound').addEventListener('change', (e) => saveSettings({ stellarSound: e.target.checked }));
$('#menuMusic').addEventListener('change', async (e) => {
  await saveSettings({ menuMusic: e.target.checked });
  syncAmbience();
});
$('#idleEnabled').addEventListener('change', (e) => saveSettings({ idleEnabled: e.target.checked }));
$('#idleSound').addEventListener('change', (e) => saveSettings({ idleSound: e.target.checked }));
$('#idleMinutes').addEventListener('input', (e) => ($('#idleMinutesOut').textContent = `${e.target.value} min`));
$('#idleMinutes').addEventListener('change', (e) => saveSettings({ idleMinutes: Number(e.target.value) }));
$('#idleSource').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-src]');
  if (!b) return;
  await saveSettings({ idleSource: b.dataset.src });
  $$('#idleSource [data-src]').forEach((x) => x.classList.toggle('active', x === b));
});
$('#playSignature').addEventListener('click', () => {
  const was = config.stellarSound;
  config.stellarSound = true;
  StellarSound.signature();
  config.stellarSound = was;
});
$('#previewIdle').addEventListener('click', () => openScreensaver(true));
orbit.onGameLeft((d) => {
  showView('home');
  toast(d?.closed ? 'Partie terminée : Roblox fermé' : 'Partie terminée', 'ok');
});

// ================= navigation =================
function showView(name) {
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $('#content').scrollTop = 0;
  clearInterval(instTimer);
  setTimeout(() => window.syncAmbience?.(), 0);
  if (name === 'messages') openMessages();
  else closeMessages();
  if (name === 'discover' && !discoverLoaded) discoverDefault();
  if (name === 'catalog' && !cat.loaded) searchCatalog(true);
  if (name === 'accounts') renderAccountsPage();
  if (name === 'filters') renderGpu();
  if (name === 'friends') renderFriendsPage();
  if (name === 'news') renderNews();
  if (name === 'trading') openTrading();
  if (name === 'community') openCommunity();
  if (name === 'mods') {
    // Let the page appear first, then fill it in (keeps the click instant).
    requestAnimationFrame(() =>
      setTimeout(() => {
        renderMods();
        renderHotkeys();
        renderTrail();
        renderFontList();
        renderKeySounds();
      }, 0)
    );
  }
  if (name === 'instances') {
    refreshInstances();
    instTimer = setInterval(refreshInstances, 3000);
  }
}

$$('.nav-item').forEach((n) => n.addEventListener('click', () => showView(n.dataset.view)));
$$('[data-win]').forEach((b) => b.addEventListener('click', () => orbit.win(b.dataset.win)));

// ================= boot =================
(async () => {
  // later scripts (chat, console, extras…) must be loaded before boot uses their functions
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  config = await orbit.getConfig();
  applyNav();
  Sfx.setEnabled(config.uiSounds !== false);
  Sfx.setPack(config.uiSoundPack || 'soft');
  StellarSound.signature();
  orbit.music.state().then(renderMusic).catch(() => {});
  ensureCustomSound();
  bindSettings();
  updateStatus();
  setInterval(updateStatus, 5000);
  renderHome();
  onAccountsChanged();
  // Prepare the Mods page thumbnails in the background once the app is idle.
  setTimeout(() => (window.requestIdleCallback || setTimeout)(() => buildModTiles()), 5000);
})();
