'use strict';
// Console-style home (game tiles, hero, activity cards) + gamepad navigation.
// Loaded after app.js and chat.js; shares their globals.

const cx = { list: [], sel: 0, tag: '', fallback: false, pt: { games: {} }, music: {} };

// ---------- tiles ----------
function renderTiles(list, tag = '', fallback = false) {
  list = list.filter((g) => g && g.universeId).slice(0, 10);
  if (!list.length) return;
  // a real "continue" list always wins over the trending fallback
  if (fallback && cx.list.length && !cx.fallback) return;
  // same games as shown: keep the DOM (and the controller focus) as it is
  if (!fallback === !cx.fallback && list.map((g) => g.universeId).join() === cx.list.map((g) => g.universeId).join()) return;
  const keep = cx.list[cx.sel]?.universeId;
  cx.list = list;
  cx.tag = tag;
  cx.fallback = fallback;
  const at = list.findIndex((g) => g.universeId === keep);
  cx.sel = at >= 0 ? at : 0;
  const box = $('#cxTiles');
  box.innerHTML =
    list
      .map((g, i) => {
        gameRegistry.set(String(g.universeId), g);
        return `<button class="cx-tile" type="button" data-cxi="${i}" aria-label="${esc(g.name)}">
          <img data-uid="${g.universeId}" src="${iconCache.get(String(g.universeId)) || BLANK}" alt="" />
          <span class="cx-tile-name">${esc(g.name)}</span></button>`;
      })
      .join('') + `<button class="cx-tile cx-all" type="button" data-goto="discover">Tous les jeux</button>`;
  loadGameIcons(box);
  selectTile(cx.sel, true);
}

function selectTile(i, force = false) {
  if (!cx.list[i] || (i === cx.sel && !force)) return;
  cx.sel = i;
  $$('#cxTiles .cx-tile').forEach((t) => t.classList.toggle('sel', Number(t.dataset.cxi) === i));
  const g = cx.list[i];
  renderHero(g, cx.tag || 'À la une').then(() => renderHeroMeta(g));
  renderHeroMeta(g);
  renderCards();
}

const cxGame = () => cx.list[cx.sel] || null;
const friendsIn = (g) => (g ? friendsList.filter((f) => f.state === 'ingame' && Number(f.universeId) === Number(g.universeId)) : []);

function renderHeroMeta(g) {
  if (g !== cxGame()) return;
  const parts = [];
  const fr = friendsIn(g);
  if (fr.length) parts.push(`<span class="cx-live">${fr.length} ami${fr.length > 1 ? 's' : ''} ${fr.length > 1 ? 'jouent' : 'joue'} maintenant</span>`);
  if (Number.isFinite(g.playerCount)) parts.push(`<span>${fmt(g.playerCount)} joueurs</span>`);
  const sec = cx.pt.games?.[g.universeId]?.seconds;
  if (sec) parts.push(`<span>${fmtDuration(sec)} de jeu</span>`);
  $('#heroMeta').innerHTML = parts.join('<i>·</i>') || '<span>Prêt quand tu l\'es</span>';
}

$('#cxTiles').addEventListener('click', (e) => {
  const t = e.target.closest('[data-cxi]');
  if (!t) return;
  const i = Number(t.dataset.cxi);
  if (i === cx.sel && e.detail >= 2) return play(cxGame());
  selectTile(i);
});
$('#cxTiles').addEventListener('dblclick', (e) => {
  const t = e.target.closest('[data-cxi]');
  if (t && cxGame()) play(cxGame());
});
// keyboard / gamepad focus on a tile selects it, like a console
$('#cxTiles').addEventListener('focusin', (e) => {
  const t = e.target.closest('[data-cxi]');
  if (t) selectTile(Number(t.dataset.cxi));
});

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) showView(go.dataset.goto);
});

// ---------- activity cards ----------
const MUSIC_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const MUSIC_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>';

function renderCards() {
  const g = cxGame();
  const box = $('#cxCards');
  if (!g) return (box.innerHTML = '');
  const fr = friendsIn(g);
  const sec = cx.pt.games?.[g.universeId]?.seconds || 0;
  const m = cx.music;
  const playing = m.status === 'Playing';
  box.innerHTML = `
    <div class="cx-card">
      <div class="cx-card-label">Amis dans ce jeu</div>
      ${fr.length
        ? `<div class="cx-faces">${fr.slice(0, 6).map((f) => `<img class="avatar" src="${headCache.get(String(f.id)) || BLANK}" alt="" title="${esc(friendName(f))}" />`).join('')}</div>
           <button class="cx-card-btn" type="button" data-cxjoin="${fr[0].id}">Rejoindre ${esc(friendName(fr[0]))}</button>`
        : `<div class="cx-card-big">0</div><div class="cx-card-sub">${activeAccount() ? `${friendsList.filter((f) => f.state !== 'offline').length} amis en ligne` : 'Connecte-toi pour voir tes amis'}</div>`}
    </div>
    <div class="cx-card">
      <div class="cx-card-label">Ton temps de jeu</div>
      <div class="cx-card-big">${sec ? fmtDuration(sec) : '—'}</div>
      <div class="cx-card-sub">${sec ? 'sur ce jeu' : 'Pas encore joué avec Stellar'}</div>
    </div>
    <div class="cx-card">
      <div class="cx-card-label">Serveurs</div>
      <div class="cx-card-mid">Meilleur ping, petit serveur, serveur d'un ami</div>
      <button class="cx-card-btn" type="button" data-cxservers="${g.universeId}">Choisir un serveur</button>
    </div>
    <div class="cx-card cx-music">
      <div class="cx-cover" id="cxCover"></div>
      <div class="cx-music-meta">
        <div class="cx-card-label">${m.title ? esc(m.label || 'En écoute') : 'Musique'}</div>
        <div class="cx-music-title">${esc(m.title || 'Rien en lecture')}</div>
        <div class="cx-card-sub">${esc(m.title ? m.artist || '' : 'Lance Spotify ou Deezer')}</div>
      </div>
      ${m.title ? `<button class="cx-round" type="button" data-cxmusic="toggle" aria-label="Lecture / pause">${playing ? MUSIC_PAUSE : MUSIC_PLAY}</button>` : ''}
    </div>`;
  if (m.thumb) setCover($('#cxCover'), m.thumb);
}

$('#cxCards').addEventListener('click', (e) => {
  const j = e.target.closest('[data-cxjoin]');
  if (j) {
    const f = friendsList.find((x) => x.id === Number(j.dataset.cxjoin));
    if (f) joinFriend(f);
    return;
  }
  const s = e.target.closest('[data-cxservers]');
  if (s) return openGame(s.dataset.cxservers);
  const mu = e.target.closest('[data-cxmusic]');
  if (mu) orbit.music.cmd(mu.dataset.cxmusic).catch(() => {});
});

orbit.music.onUpdate((s) => {
  cx.music = s || {};
  if ($('#view-home').classList.contains('active')) renderCards();
});
orbit.music.state().then((s) => (cx.music = s || {})).catch(() => {});

// ---------- top bar: clock, friends online, playtime refresh ----------
function cxTick() {
  const d = new Date();
  $('#cxClock').textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const online = friendsList.filter((f) => f.state !== 'offline').length;
  $('#cxFriends').textContent = activeAccount() ? `${online} ami${online > 1 ? 's' : ''} en ligne` : '';
}
async function cxRefresh() {
  cxTick();
  if (document.hidden || !$('#view-home').classList.contains('active')) return;
  try {
    cx.pt = await orbit.playtime();
  } catch {
    /* keep the last value */
  }
  const g = cxGame();
  if (g && !document.activeElement?.closest?.('#cxCards')) {
    renderHeroMeta(g);
    renderCards();
  }
}
cxTick();
setInterval(cxTick, 10000);
setInterval(cxRefresh, 15000);
setTimeout(cxRefresh, 3000);

// =====================================================================
// Gamepad (PS4 / PS5 / Xbox via the standard mapping)
// ✕/A validate · ○/B back · △/Y details · □/X search · L1/R1 pages · D-pad/left stick move
// =====================================================================
const PAD = { A: 0, B: 1, X: 2, Y: 3, L1: 4, R1: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const pad = { raf: 0, prev: [], repeatAt: 0, dir: null, active: false };
// only the buttons shown in the bar (some can be hidden in the settings)
const NAV_ORDER = () => $$('.sidebar .nav-item').filter((n) => !n.hidden).map((n) => n.dataset.view);

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), .game-card';
function visible(el) {
  if (el.disabled || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
}
function scope() {
  if (!$('#gameModal').hidden) return $('#gameModal');
  if (!$('#itemModal').hidden) return $('#itemModal');
  const sticker = $('#stickerModal');
  if (sticker && !sticker.hidden) return sticker;
  return document.body;
}
function candidates() {
  const root = scope();
  return $$(FOCUSABLE, root).filter((el) => {
    if (!visible(el)) return false;
    // inside the shell, only the rail and the active view
    if (root === document.body && el.closest('.content') && !el.closest('.view.active')) return false;
    return !el.closest('.titlebar');
  });
}

function padFocus(el) {
  if (!el) return;
  if (el !== document.activeElement) Sfx.play('move');
  if (!el.matches('button, a, input, select, textarea') && !el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  if (el.dataset.cxi != null) selectTile(Number(el.dataset.cxi));
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function move(dir) {
  noteActivity();
  const list = candidates();
  const cur = document.activeElement && list.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) return padFocus(defaultFocus(list));
  // the tile row behaves like a console shelf: left / right go to the neighbour tile
  if (cur.closest('#cxTiles') && (dir === 'left' || dir === 'right')) {
    const tiles = $$('#cxTiles .cx-tile');
    const next = tiles[tiles.indexOf(cur) + (dir === 'right' ? 1 : -1)];
    if (next) padFocus(next);
    return;
  }
  if (cur.closest('#cxTiles')) return padFocus(dir === 'down' ? $('#heroPlay') : $('.cx-tab.active'));
  if (cur.closest('.cx-tabs') && dir === 'down') return padFocus($('#cxTiles .cx-tile.sel'));
  if (cur.closest('.cx-actions') && dir === 'up') return padFocus($('#cxTiles .cx-tile.sel'));
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    let main;
    let side;
    if (dir === 'left') [main, side] = [-dx, dy];
    else if (dir === 'right') [main, side] = [dx, dy];
    else if (dir === 'up') [main, side] = [-dy, dx];
    else [main, side] = [dy, dx];
    if (main <= 4) continue;
    const score = main + Math.abs(side) * 2.2;
    if (score < bestScore) [best, bestScore] = [el, score];
  }
  if (best) padFocus(best);
  else if (dir === 'down' || dir === 'up') $('#content').scrollBy({ top: dir === 'down' ? 300 : -300, behavior: 'smooth' });
}

function defaultFocus(list) {
  const home = $('#view-home').classList.contains('active') && $('#cxTiles .cx-tile.sel');
  if (home && list.includes(home)) return home;
  const inPage = list.filter((el) => el.closest('.view.active, .modal'));
  return inPage.find((el) => !el.matches('input, textarea, select')) || inPage[0] || list[0];
}

function back() {
  Sfx.play('back');
  if (!$('#gameModal').hidden) return closeModal();
  if (!$('#itemModal').hidden) return closeItem();
  const sticker = $('#stickerModal');
  if (sticker && !sticker.hidden) return sticker.querySelector('[data-sticker-close]')?.click();
  if (!$('#accountMenu').hidden) return ($('#accountMenu').hidden = true);
  if (document.activeElement?.matches('input, textarea')) return document.activeElement.blur();
  if (!$('#view-home').classList.contains('active')) {
    showView('home');
    setTimeout(() => padFocus($('#cxTiles .cx-tile.sel')), 60);
  }
}

// L1 / R1 walk through the buttons of the bar: the bar opens with its labels, the highlight moves
// button by button, and the page opens once you stop on one (or right away with ✕/A).
let railPick = null;
let railTimer = 0;
function switchPage(step) {
  const order = NAV_ORDER();
  if (!order.length) return;
  const from = railPick ?? $('.sidebar .nav-item.active')?.dataset.view ?? 'home';
  railPick = order[(order.indexOf(from) + step + order.length) % order.length];
  const btn = $(`.sidebar .nav-item[data-view="${railPick}"]`);
  Sfx.play('move', true);
  btn?.focus({ preventScroll: true });
  btn?.scrollIntoView({ block: 'nearest' });
  // open the bar with its labels and light the picked button (works even before the window has focus)
  $('.sidebar').classList.add('rail-open');
  $$('.sidebar .nav-item').forEach((n) => n.classList.toggle('pad-pick', n === btn));
  clearTimeout(railTimer);
  railTimer = setTimeout(() => {
    const view = railPick;
    railPick = null;
    closeRailPick();
    Sfx.play('page');
    showView(view);
    setTimeout(() => padFocus(defaultFocus(candidates().filter((el) => !el.closest('.sidebar')))), 80);
  }, 650);
}

function press(btn) {
  noteActivity();
  const skipBtn = document.querySelector('.tp-skip');
  if (btn === PAD.A && skipBtn && !skipBtn.hidden) return skipBtn.click();
  if (btn === PAD.A && railPick) {
    // ✕/A while walking the bar: open that page now
    clearTimeout(railTimer);
    const view = railPick;
    railPick = null;
    closeRailPick();
    Sfx.play('page');
    showView(view);
    return;
  }
  if (btn === PAD.B && railPick) {
    clearTimeout(railTimer);
    railPick = null;
    return closeRailPick();
  }
  const el = document.activeElement;
  if (btn === PAD.A) {
    if (el && el !== document.body && candidates().includes(el)) {
      if (el.matches('input[type="checkbox"], input[type="radio"]')) el.click();
      else if (el.matches('input, textarea')) el.focus();
      else el.click();
    } else padFocus(defaultFocus(candidates()));
  } else if (btn === PAD.B) back();
  else if (btn === PAD.Y) {
    const g = $('#view-home').classList.contains('active') ? cxGame() : null;
    const card = el?.closest?.('.game-card');
    if (card) openGame(card.dataset.uid);
    else if (g) openGame(g.universeId);
  } else if (btn === PAD.X) {
    showView('home');
    $('#quickSearchInput').focus();
  } else if (btn === PAD.L1) switchPage(-1);
  else if (btn === PAD.R1) switchPage(1);
  else if (btn === PAD.START) showView('settings');
}

function stickDir(gp) {
  const [x, y] = [gp.axes[0] || 0, gp.axes[1] || 0];
  const b = (i) => gp.buttons[i]?.pressed;
  if (b(PAD.UP) || y < -0.6) return 'up';
  if (b(PAD.DOWN) || y > 0.6) return 'down';
  if (b(PAD.LEFT) || x < -0.6) return 'left';
  if (b(PAD.RIGHT) || x > 0.6) return 'right';
  return null;
}

function padLoop(t) {
  pad.raf = 0;
  const gps = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  if (!gps.length) return;
  pad.raf = requestAnimationFrame(padLoop);
  if (!document.hasFocus()) return; // Roblox (or another app) has the controller
  const gp = gps.find((g) => g.mapping === 'standard') || gps[0];
  const now = [...gp.buttons].map((b) => b.pressed);
  const toggleBtn = config.padCursorButton ?? 8;
  if (now[toggleBtn] && !pad.prev[toggleBtn]) {
    usePad();
    setFreeCursor(!pad.free);
  }
  if (pad.free) {
    freeCursorStep(gp, now);
    pad.prev = now;
    return;
  }
  for (const btn of [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.L1, PAD.R1, PAD.START]) {
    if (now[btn] && !pad.prev[btn]) {
      usePad();
      press(btn);
    }
  }
  pad.prev = now;
  // right stick scrolls the page
  const ry = gp.axes[3] || 0;
  if (Math.abs(ry) > 0.25) $('#content').scrollBy({ top: ry * 18 });
  const dir = stickDir(gp);
  if (!dir) {
    pad.dir = null;
    return;
  }
  if (dir !== pad.dir) {
    pad.dir = dir;
    pad.repeatAt = t + 380;
    usePad();
    move(dir);
  } else if (t >= pad.repeatAt) {
    pad.repeatAt = t + 120;
    move(dir);
  }
}

function usePad() {
  if (pad.active) return;
  pad.active = true;
  document.body.classList.add('pad');
}
// Mouse use hides the controller focus ring again.
document.addEventListener('mousemove', () => {
  if (!pad.active) return;
  pad.active = false;
  document.body.classList.remove('pad');
});

function startPad() {
  if (!pad.raf) pad.raf = requestAnimationFrame(padLoop);
}
window.addEventListener('gamepadconnected', (e) => {
  toast(`Manette connectée : ${/054c|dualsense|dualshock|wireless controller/i.test(e.gamepad.id) ? 'PlayStation' : /xbox|xinput|045e/i.test(e.gamepad.id) ? 'Xbox' : 'manette'} 🎮`, 'ok');
  usePad();
  startPad();
  setTimeout(() => padFocus(defaultFocus(candidates())), 50);
});
window.addEventListener('gamepaddisconnected', () => toast('Manette déconnectée'));
window.addEventListener('focus', startPad);
startPad();

// Normalised lengths let the rail icons 'draw themselves' on hover.
$$('.sidebar .ic > *').forEach((el) => el.setAttribute('pathLength', '1'));

// Rail labels (shown when the side menu slides open).
$$('.sidebar .nav-item').forEach((n) => {
  if (n.querySelector('.nav-label')) return;
  const s = document.createElement('span');
  s.className = 'nav-label';
  s.textContent = n.dataset.label || '';
  n.append(s);
});

// Plain links in pages (data-goto-url) open in the browser.
document.addEventListener('click', (e) => {
  const u = e.target.closest('[data-goto-url]');
  if (u) orbit.openUrl(u.dataset.gotoUrl).catch(() => {});
});

// ---------------- free cursor (controller as a mouse) ----------------
// A configurable button (Share / View by default) toggles a cursor moved with the left stick:
// ✕/A clicks under it, the right stick scrolls what is under it, ○/B still goes back.
const freeCur = { x: innerWidth / 2, y: innerHeight / 2, el: null, hover: null };

function setFreeCursor(on) {
  pad.free = on;
  if (on) {
    if (!freeCur.el) {
      freeCur.el = document.createElement('div');
      freeCur.el.className = 'pad-cursor';
      document.body.append(freeCur.el);
    }
    freeCur.el.hidden = false;
    document.activeElement?.blur?.();
    placeFreeCursor();
    toast('Curseur libre activé', 'ok');
  } else {
    if (freeCur.el) freeCur.el.hidden = true;
    freeCur.hover?.classList.remove('pad-hover');
    freeCur.hover = null;
  }
  Sfx.play(on ? 'select' : 'back', true);
}

function placeFreeCursor() {
  freeCur.x = Math.max(0, Math.min(innerWidth - 2, freeCur.x));
  freeCur.y = Math.max(0, Math.min(innerHeight - 2, freeCur.y));
  freeCur.el.style.transform = `translate(${freeCur.x}px, ${freeCur.y}px)`;
  const under = document.elementFromPoint(freeCur.x, freeCur.y);
  const hit = under?.closest('button, a, input, select, textarea, label, [data-goto], .game-card, .item-open, [tabindex]') || null;
  if (hit !== freeCur.hover) {
    freeCur.hover?.classList.remove('pad-hover');
    hit?.classList.add('pad-hover');
    freeCur.hover = hit;
    if (hit) Sfx.play('hover');
  }
}

function freeClick() {
  const under = document.elementFromPoint(freeCur.x, freeCur.y);
  if (!under) return;
  const target = under.closest('button, a, input, select, textarea, label, [data-goto], .game-card, [tabindex]') || under;
  if (target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select')) return target.focus();
  target.click();
}

function scrollableAt(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
  }
  return $('#content');
}

function freeCursorStep(gp, now) {
  const dead = (v) => (Math.abs(v) < 0.14 ? 0 : v);
  const lx = dead(gp.axes[0] || 0);
  const ly = dead(gp.axes[1] || 0);
  const speed = 16 * (config.padCursorSpeed || 1);
  const mag = Math.min(1, Math.hypot(lx, ly));
  if (mag) {
    const k = (speed * Math.pow(mag, 1.7)) / mag;
    freeCur.x += lx * k;
    freeCur.y += ly * k;
  }
  if (now[PAD.LEFT]) freeCur.x -= 4;
  if (now[PAD.RIGHT]) freeCur.x += 4;
  if (now[PAD.UP]) freeCur.y -= 4;
  if (now[PAD.DOWN]) freeCur.y += 4;
  if (mag || now[PAD.LEFT] || now[PAD.RIGHT] || now[PAD.UP] || now[PAD.DOWN]) {
    noteActivity();
    placeFreeCursor();
  }
  const ry = dead(gp.axes[3] || 0);
  if (ry) scrollableAt(document.elementFromPoint(freeCur.x, freeCur.y)).scrollBy({ top: ry * 22 });
  if (now[PAD.A] && !pad.prev[PAD.A]) {
    noteActivity();
    freeClick();
  }
  if (now[PAD.B] && !pad.prev[PAD.B]) press(PAD.B);
}

// leaving free mode when the real mouse is used
document.addEventListener('mousemove', (e) => {
  if (pad.free && e.isTrusted && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) setFreeCursor(false);
});

function closeRailPick() {
  $('.sidebar').classList.remove('rail-open');
  $$('.sidebar .nav-item.pad-pick').forEach((n) => n.classList.remove('pad-pick'));
  document.activeElement?.closest?.(".sidebar") && document.activeElement.blur();
}
