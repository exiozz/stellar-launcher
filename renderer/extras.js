'use strict';
// Nav bar settings (visible buttons + position) and the "teleport" launch animation.
// Loaded last; shares app.js globals.

// ---------------- top page tabs (Jeux / Découvrir / Catalogue / Nouveautés) ----------------
const PAGE_TABS = [
  ['home', 'Jeux'],
  ['discover', 'Découvrir'],
  ['catalog', 'Catalogue'],
  ['news', 'Nouveautés'],
];
// the home page has its own slot; the other pages get the same strip on top
for (const id of ['discover', 'catalog', 'news']) {
  const view = $(`#view-${id}`);
  if (view && !view.querySelector('[data-pagetabs]')) {
    const bar = document.createElement('div');
    bar.className = 'cx-tabs page-tabs';
    bar.dataset.pagetabs = id;
    view.prepend(bar);
  }
}
$$('[data-pagetabs]').forEach(
  (bar) => (bar.innerHTML = PAGE_TABS.map(([id, label]) => `<button class="cx-tab ${id === bar.dataset.pagetabs ? 'active' : ''}" type="button" data-goto="${id}">${label}</button>`).join(''))
);

// ---------------- nav bar ----------------
const NAV_LOCKED = new Set(['home', 'settings']);

function applyNav() {
  const hidden = new Set(config.navHidden || []);
  $$('.sidebar .nav-item').forEach((n) => (n.hidden = !NAV_LOCKED.has(n.dataset.view) && hidden.has(n.dataset.view)));
  document.documentElement.dataset.bar = config.barPosition || 'left';
  $$('#barPos [data-bar]').forEach((b) => b.classList.toggle('active', b.dataset.bar === (config.barPosition || 'left')));
  renderNavPicks();
  renderPadBtn();
  renderLauncherPad();
  syncNavTooltips();
}

function renderNavPicks() {
  const hidden = new Set(config.navHidden || []);
  $('#navPicks').innerHTML = $$('.sidebar .nav-item')
    .filter((n) => !NAV_LOCKED.has(n.dataset.view))
    .map(
      (n) => `<label class="nav-pick ${hidden.has(n.dataset.view) ? '' : 'on'}">
        <input type="checkbox" data-navpick="${n.dataset.view}" ${hidden.has(n.dataset.view) ? '' : 'checked'} />
        ${n.querySelector('svg')?.outerHTML || ''}<span>${esc(n.dataset.label)}</span></label>`
    )
    .join('');
}

$('#navPicks').addEventListener('change', async (e) => {
  const c = e.target.closest('[data-navpick]');
  if (!c) return;
  const hidden = new Set(config.navHidden || []);
  c.checked ? hidden.delete(c.dataset.navpick) : hidden.add(c.dataset.navpick);
  config = await orbit.setConfig({ navHidden: [...hidden] });
  applyNav();
});
$('#barPos').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-bar]');
  if (!b) return;
  config = await orbit.setConfig({ barPosition: b.dataset.bar });
  applyNav();
});
// horizontal bars have no room for labels: only there do the buttons get a tooltip
function syncNavTooltips() {
  const horizontal = ['top', 'bottom'].includes(config.barPosition);
  $$('.sidebar .nav-item').forEach((n) => (horizontal ? (n.title = n.dataset.label || '') : n.removeAttribute('title')));
}

// ---------------- launch screen ----------------
// The game's banner, a big ring with the loading %, "Passer" from 50 %, then a dive into the
// banner once Roblox's window is open (or after 30 s).
function teleportFx(game) {
  if (config.launchFx === false) return null;
  document.querySelector('.tp')?.remove();
  const el = document.createElement('div');
  el.className = 'tp';
  el.innerHTML = `<div class="tp-banner"></div><div class="tp-banner b2"></div><div class="tp-banner b3"></div>
    <canvas class="tp-warp"></canvas>
    <div class="tp-load">
      <div class="tp-dialwrap"><svg class="tp-dial" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="tp-track" cx="60" cy="60" r="52"/>
        <circle class="tp-bar" cx="60" cy="60" r="52" pathLength="100"/>
        <circle class="tp-spin" cx="60" cy="60" r="44" pathLength="100"/>
      </svg>
      <div class="tp-pct"><b>0</b><span>%</span></div></div>
      <div class="tp-name">${esc(game?.name || 'ton jeu')}</div>
      <div class="tp-step">Connexion à Roblox…</div>
      <button class="tp-skip" type="button" hidden>Passer</button>
    </div>
    <div class="tp-iris"></div>`;
  document.body.append(el);
  StellarSound.signature();

  const setBanner = (src) => el.querySelectorAll('.tp-banner').forEach((b) => (b.style.backgroundImage = `url("${src}")`));
  const heroSrc = heroGame && game && String(heroGame.universeId) === String(game.universeId) ? $('#heroBg').src : '';
  if (heroSrc && heroSrc.startsWith('https://')) setBanner(heroSrc);
  else if (game?.universeId) wideThumb(game.universeId).then((src) => src && setBanner(src));

  const pctEl = el.querySelector('.tp-pct b');
  const bar = el.querySelector('.tp-bar');
  const step = el.querySelector('.tp-step');
  const skip = el.querySelector('.tp-skip');
  const STEPS = [
    [0, 'Connexion à Roblox…'],
    [20, 'Préparation de tes mods…'],
    [40, 'Ouverture de Roblox…'],
    [55, 'Connexion au serveur…'],
    [75, 'Téléchargement du jeu…'],
    [92, 'Chargement du serveur…'],
  ];
  let pct = 0;
  // real milestones read from Roblox: its logs start (35 %), its window opens (60 %), you are in the game (100 %)
  let target = 30;
  let inGame = false;
  let drawnAt = 0; // when Roblox started drawing the game
  let logSize = -1; // Roblox's log keeps growing while it loads the map
  let grewAt = 0;
  let finished = false;
  const since = Date.now();
  const t0 = performance.now();
  orbit.launchHold(true).catch(() => {});

  const paint = () => {
    pctEl.textContent = Math.floor(pct);
    bar.style.strokeDasharray = `${pct} 100`;
    step.textContent = STEPS.filter(([at]) => pct >= at).pop()[1];
    if (pct >= 50 && skip.hidden) skip.hidden = false;
  };
  const progressTimer = setInterval(() => {
    const goal = inGame ? 100 : target;
    // ease towards the current milestone, creeping slowly while we wait for the next one
    const speed = inGame ? 5 : Math.max(0.04, (goal - pct) / 30);
    pct = Math.min(goal, pct + speed);
    paint();
    if (pct >= 100) dive();
    else if (performance.now() - t0 > 90000) inGame = true; // never stay stuck
  }, 60);

  const watch = setInterval(async () => {
    try {
      const p = await orbit.launchProgress(since);
      if (p.started) target = Math.max(target, 45);
      if (p.windows > 0) target = Math.max(target, 60);
      if (p.joined) target = Math.max(target, 85);
      if (p.inGame) {
        // the game is drawn, but Roblox is still loading the map behind its own loading screen:
        // wait until its log calms down (2 s without writing), 10 s at most
        target = Math.max(target, 99);
        drawnAt ||= p.now;
        if (p.size !== logSize) {
          logSize = p.size;
          grewAt = p.now;
        }
        const quiet = p.now - grewAt > 2000;
        if ((p.now - drawnAt > 2500 && quiet) || p.now - drawnAt > 10000) inGame = true;
      }
    } catch {
      /* keep the simulated progress */
    }
  }, 700);

  // warp-speed streaks for the dive
  const cv = el.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const W = (cv.width = innerWidth * devicePixelRatio);
  const H = (cv.height = innerHeight * devicePixelRatio);
  const stars = Array.from({ length: 380 }, () => ({ a: Math.random() * Math.PI * 2, d: Math.random() * 0.9 + 0.05, s: Math.random() * 0.6 + 0.4 }));
  let raf = 0;
  const warp = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (const st of stars) {
      const r0 = st.d * Math.hypot(W, H) * 0.55;
      st.d += 0.035 * st.s;
      if (st.d > 1) st.d = 0.03;
      const r1 = st.d * Math.hypot(W, H) * 0.55;
      ctx.strokeStyle = `hsla(${230 + st.s * 60}, 100%, ${75 + st.s * 20}%, ${0.35 + st.d * 0.6})`;
      ctx.lineWidth = (0.6 + st.d * 2.4) * devicePixelRatio;
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(st.a) * r0, H / 2 + Math.sin(st.a) * r0);
      ctx.lineTo(W / 2 + Math.cos(st.a) * r1, H / 2 + Math.sin(st.a) * r1);
      ctx.stroke();
    }
    raf = requestAnimationFrame(warp);
  };

  function stopTimers() {
    clearInterval(progressTimer);
    clearInterval(watch);
  }
  function remove() {
    cancelAnimationFrame(raf);
    el.classList.add('out');
    setTimeout(() => el.remove(), 380);
  }
  function dive() {
    if (finished) return;
    finished = true;
    stopTimers();
    pct = 100;
    paint();
    skip.hidden = true;
    Sfx.play('select', true);
    el.classList.add('dive');
    raf = requestAnimationFrame(warp);
    setTimeout(() => {
      remove();
      orbit.focusRoblox().catch(() => orbit.launchHold(false));
    }, 1500);
  }
  skip.addEventListener('click', () => {
    if (pct >= 50) dive();
  });
  return {
    cancel() {
      finished = true;
      stopTimers();
      orbit.launchHold(false).catch(() => {});
      remove();
    },
  };
}

// ---------------- menu ambience ----------------
function syncAmbience() {
  const on = config.menuMusic === true && !document.hidden && document.hasFocus() && ($('#view-home').classList.contains('active') || !!$('.ss'));
  StellarSound.ambience(on);
}
document.addEventListener('visibilitychange', syncAmbience);
window.addEventListener('focus', syncAmbience);
window.addEventListener('blur', syncAmbience);

// ---------------- screensaver ("veille") on the home page ----------------
let lastActivity = Date.now();
let ssGraceUntil = 0; // ignore the input that opened a preview
function noteActivity() {
  lastActivity = Date.now();
  if ($('.ss') && Date.now() > ssGraceUntil) closeScreensaver();
}
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, noteActivity, { passive: true, capture: true });

setInterval(() => {
  if (config.idleEnabled === false || $('.ss') || $('.tp')) return;
  if (!$('#view-home').classList.contains('active') || document.hidden || !document.hasFocus()) return;
  if (!$('#gameModal').hidden || !$('#itemModal').hidden) return;
  if (Date.now() - lastActivity >= (config.idleMinutes || 5) * 60e3) openScreensaver();
}, 5000);

async function screensaverGames() {
  const src = config.idleSource || 'recent';
  if (src === 'favorites' && config.favorites?.length) return config.favorites;
  if (src === 'trending') {
    try {
      const sorts = await getSorts();
      const s = sorts['top-trending'] || Object.values(sorts)[0];
      return s.games.slice(0, 12).map(fromExplore);
    } catch {
      /* fall back to recent games */
    }
  }
  return cx.list.length ? cx.list : config.recent || [];
}

async function openScreensaver(preview = false) {
  const games = (await screensaverGames()).filter((g) => g?.universeId).slice(0, 12);
  if (!games.length || $('.ss')) return;
  const el = document.createElement('div');
  el.className = 'ss';
  el.innerHTML = `<div class="ss-slide a"></div><div class="ss-slide b"></div><div class="ss-shade"></div>
    <div class="ss-info"><small id="ssTag">Stellar</small><b id="ssName"></b></div>
    <div class="ss-clock" id="ssClock"></div>
    <div class="ss-hint">Bouge la souris ou appuie sur une touche pour revenir</div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  if (config.idleSound !== false) StellarSound.signature();
  syncAmbience();
  if (config.idleSound !== false && config.menuMusic !== true) StellarSound.ambience(true);

  let i = 0;
  let front = el.querySelector('.ss-slide.a');
  let back = el.querySelector('.ss-slide.b');
  const tick = () => {
    $('#ssClock', el).textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };
  const next = async () => {
    const g = games[i++ % games.length];
    const src = await wideThumb(g.universeId);
    if (!el.isConnected) return;
    if (src) back.style.backgroundImage = `url("${src}")`;
    back.classList.remove('show');
    void back.offsetWidth; // restart the Ken Burns animation
    back.classList.add('show');
    front.classList.remove('show');
    [front, back] = [back, front];
    $('#ssName', el).textContent = g.name || '';
    $('#ssTag', el).textContent = 'Tes jeux · Stellar';
  };
  tick();
  next();
  el._timers = [setInterval(next, 7000), setInterval(tick, 10000)];
  // in preview mode (from the settings) ignore the click / mouse move that opened it
  ssGraceUntil = Date.now() + (preview ? 1500 : 0);
}

function closeScreensaver() {
  const el = $('.ss');
  if (!el) return;
  el._timers?.forEach(clearInterval);
  el.classList.remove('on');
  setTimeout(() => el.remove(), 500);
  StellarSound.ambience(false);
  setTimeout(syncAmbience, 50);
}

// ---------------- pinned music player: Stellar-side controls ----------------
function renderPadBtn() {
  const b = config.musicPadButton;
  $('#padBtnState').textContent = b === null || b === undefined ? 'Aucun bouton choisi.' : `Bouton n°${b + 1} de ta manette ouvre / ferme le lecteur, même en jeu.`;
  $('#padBtnClear').hidden = b === null || b === undefined;
}
$('#playerToggle').addEventListener('click', () => orbit.music.player('toggle'));
$('#padBtnLearn').addEventListener('click', async () => {
  const btn = $('#padBtnLearn');
  btn.disabled = true;
  btn.textContent = 'Appuie sur un bouton de ta manette…';
  try {
    const i = await orbit.music.learnPad();
    config = await orbit.getConfig();
    if (i === null) toast('Aucun bouton détecté. Vérifie que ta manette est branchée.', 'error');
    else toast(`Bouton n°${i + 1} choisi pour le lecteur`, 'ok');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Choisir un bouton';
    renderPadBtn();
  }
});
$('#padBtnClear').addEventListener('click', async () => {
  config = await orbit.music.clearPad();
  renderPadBtn();
});
renderPadBtn();

// ---------------- "Afficher Stellar" controller button ----------------
function renderLauncherPad() {
  const b = config.launcherPadButton;
  const key = config.musicHotkeys?.launcher ? prettyAccel(config.musicHotkeys.launcher) : 'aucun raccourci';
  $('#launcherPadState').textContent =
    b === null || b === undefined
      ? `Aucun bouton choisi. Au clavier : ${key} (modifiable dans Mods › Lecteur de musique › Raccourcis).`
      : `Bouton n°${b + 1} de ta manette, même en jeu. Au clavier : ${key}.`;
  $('#launcherPadClear').hidden = b === null || b === undefined;
}
$('#launcherPadLearn').addEventListener('click', async () => {
  const btn = $('#launcherPadLearn');
  btn.disabled = true;
  btn.textContent = 'Appuie sur un bouton de ta manette…';
  try {
    const i = await orbit.music.learnPad('launcher');
    config = await orbit.getConfig();
    if (i === null) toast('Aucun bouton détecté. Vérifie que ta manette est branchée.', 'error');
    else toast(`Bouton n°${i + 1} : il affiche Stellar, même en jeu`, 'ok');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Choisir un bouton';
    renderLauncherPad();
  }
});
$('#launcherPadClear').addEventListener('click', async () => {
  config = await orbit.music.clearPad('launcher');
  renderLauncherPad();
});
