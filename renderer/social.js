'use strict';
// Trading (your Roblox trades, valued with Rolimons) and Communauté (your Roblox communities).
// Loaded after app.js and rolimons.js; shares their globals.

// =============================== Trading ===============================
const TRADE_TABS = [
  ['Inbound', 'Reçus'],
  ['Outbound', 'Envoyés'],
  ['Completed', 'Terminés'],
  ['Inactive', 'Inactifs'],
];
const tr = { tab: 'Inbound', open: null };
const TRADES = 'https://trades.roblox.com/v1/';

function renderTradeTabs() {
  $('#tradeTabs').innerHTML = TRADE_TABS.map(([id, l]) => `<button class="chip ${id === tr.tab ? 'active' : ''}" type="button" data-tradetab="${id}">${l}</button>`).join('');
}

async function openTrading() {
  renderTradeTabs();
  const box = $('#tradeList');
  $('#tradeDetail').innerHTML = '<div class="empty">Choisis un échange pour voir les objets et leur valeur.</div>';
  if (!activeAccount()) {
    box.innerHTML = '<div class="empty">Connecte ton compte Roblox pour voir tes échanges.<br /><br /><button class="btn primary small" data-menu="add">Se connecter</button></div>';
    return;
  }
  box.innerHTML = Array.from({ length: 5 }, () => '<div class="skeleton" style="height:58px;margin:4px 0"></div>').join('');
  loadRolimons().catch(() => {});
  try {
    const r = await orbit.api(`${TRADES}trades/${tr.tab}?limit=25&sortOrder=Desc`, { auth: true });
    const list = r.data || [];
    await loadHeadshots(list.map((t) => t.user?.id).filter(Boolean));
    box.innerHTML = list.length
      ? list
          .map(
            (t) => `<button class="trade-row ${String(t.id) === String(tr.open) ? 'active' : ''}" type="button" data-trade="${t.id}">
          <img class="avatar" src="${headCache.get(String(t.user?.id)) || BLANK}" alt="" />
          <span class="convo-meta"><span class="convo-name">${esc(t.user?.displayName || t.user?.name || 'Joueur')}</span>
          <span class="convo-last">${esc(t.status || '')} · ${new Date(t.created).toLocaleDateString('fr-FR')}</span></span>
        </button>`
          )
          .join('')
      : '<div class="empty">Aucun échange ici.</div>';
  } catch (e) {
    box.innerHTML = `<div class="empty">Impossible de charger les échanges (${esc(errMsg(e))}).</div>`;
  }
}

const assetWorth = (a) => {
  const r = roliItem(a.assetId);
  return r ? (r.value > 0 ? r.value : r.rap) : a.recentAveragePrice || 0;
};

async function openTrade(id) {
  tr.open = id;
  $$('#tradeList [data-trade]').forEach((b) => b.classList.toggle('active', b.dataset.trade === String(id)));
  const box = $('#tradeDetail');
  box.innerHTML = '<div class="empty">Chargement de l’échange…</div>';
  try {
    await loadRolimons().catch(() => {});
    const t = await orbit.api(`${TRADES}trades/${id}`, { auth: true });
    const me = activeAccount()?.id;
    const offers = t.offers || [];
    const mine = offers.find((o) => o.user?.id === me) || offers[0];
    const theirs = offers.find((o) => o !== mine) || offers[1];
    const side = (o, title) => {
      const items = o?.userAssets || [];
      const total = items.reduce((s, a) => s + assetWorth(a), 0);
      return {
        total,
        html: `<div class="trade-side"><div class="trade-side-head"><b>${title}</b><span>${full.format(total)} de valeur${o?.robux ? ` + ${full.format(o.robux)} R$` : ''}</span></div>
        <div class="trade-items">${items
          .map(
            (a) => `<div class="trade-item" title="${esc(a.name)}"><img data-thumb="Asset:${a.assetId}" src="${BLANK}" alt="" />
          <span>${esc(a.name)}</span><small>${full.format(assetWorth(a))}${a.serialNumber ? ` · n°${a.serialNumber}` : ''}</small></div>`
          )
          .join('') || '<div class="muted">Rien</div>'}</div></div>`,
      };
    };
    const a = side(mine, 'Tu donnes');
    const b = side(theirs, 'Tu reçois');
    const diff = b.total - a.total;
    const active = t.status === 'Open';
    box.innerHTML = `${a.html}${b.html}
      <div class="trade-verdict ${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? 'Tu gagnes' : 'Tu perds'} ${full.format(Math.abs(diff))} de valeur (Rolimons / RAP)</div>
      <div class="trade-actions">
        ${active && tr.tab === 'Inbound' ? `<button class="btn danger" type="button" data-tradedecline="${id}">Refuser</button>` : ''}
        ${active && tr.tab === 'Outbound' ? `<button class="btn danger" type="button" data-tradedecline="${id}">Annuler mon offre</button>` : ''}
        <button class="btn" type="button" data-tradeopen="${id}">Ouvrir sur Roblox</button>
      </div>
      <p class="muted small-note">Pour accepter ou faire une contre-offre, passe par Roblox (il peut demander une vérification).</p>`;
    loadItemThumbs(box, [...(mine?.userAssets || []), ...(theirs?.userAssets || [])].map((x) => ({ id: x.assetId, itemType: 'Asset' })));
  } catch (e) {
    box.innerHTML = `<div class="empty">Impossible d’ouvrir l’échange (${esc(errMsg(e))}).</div>`;
  }
}

$('#tradeTabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tradetab]');
  if (!t) return;
  tr.tab = t.dataset.tradetab;
  tr.open = null;
  openTrading();
});
$('#tradeList').addEventListener('click', (e) => {
  const t = e.target.closest('[data-trade]');
  if (t) openTrade(t.dataset.trade);
});
$('#tradeDetail').addEventListener('click', async (e) => {
  const d = e.target.closest('[data-tradedecline]');
  if (d) {
    if (!confirm('Refuser cet échange ?')) return;
    try {
      await orbit.api(`${TRADES}trades/${d.dataset.tradedecline}/decline`, { method: 'POST', body: {}, auth: true });
      toast('Échange refusé', 'ok');
      openTrading();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
    return;
  }
  if (e.target.closest('[data-tradeopen]')) orbit.openUrl('https://www.roblox.com/trades');
});

// =============================== Communauté ===============================
const com = { list: null, open: null };

async function openCommunity() {
  const box = $('#comList');
  const acc = activeAccount();
  if (!acc) {
    box.innerHTML = '<div class="empty">Connecte ton compte Roblox pour voir tes communautés.<br /><br /><button class="btn primary small" data-menu="add">Se connecter</button></div>';
    return;
  }
  if (!com.list) box.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:58px;margin:4px 0"></div>').join('');
  try {
    const r = await orbit.api(`https://groups.roblox.com/v2/users/${acc.id}/groups/roles`, { auth: true });
    com.list = (r.data || []).map((x) => ({ id: x.group.id, name: x.group.name, members: x.group.memberCount, role: x.role?.name || '' }));
    renderComList(com.list, box);
    if (!com.open && com.list[0]) openGroup(com.list[0].id);
  } catch (e) {
    box.innerHTML = `<div class="empty">Impossible de charger tes communautés (${esc(errMsg(e))}).</div>`;
  }
}

async function renderComList(list, box) {
  box.innerHTML = list.length
    ? list
        .map(
          (g) => `<button class="trade-row ${g.id === com.open ? 'active' : ''}" type="button" data-group="${g.id}">
        <img class="group-ic" data-groupicon="${g.id}" src="${BLANK}" alt="" />
        <span class="convo-meta"><span class="convo-name">${esc(g.name)}</span>
        <span class="convo-last">${g.role ? esc(g.role) + ' · ' : ''}${fmt(g.members)} membres</span></span>
      </button>`
        )
        .join('')
    : '<div class="empty">Tu n’es dans aucune communauté. Cherche-en une au-dessus.</div>';
  if (!list.length) return;
  try {
    const r = await orbit.api(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${list.map((g) => g.id).join(',')}&size=150x150&format=Png&isCircular=false`);
    for (const t of r.data || []) {
      const img = box.querySelector(`img[data-groupicon="${t.targetId}"]`);
      const src = safeImg(t.imageUrl);
      if (img && src) img.src = src;
    }
  } catch {
    /* icons are cosmetic */
  }
}

async function openGroup(id) {
  com.open = Number(id);
  $$('#comList [data-group], #comSearchResults [data-group]').forEach((b) => b.classList.toggle('active', Number(b.dataset.group) === com.open));
  const box = $('#comDetail');
  box.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    const [g, games] = await Promise.all([
      orbit.api(`https://groups.roblox.com/v1/groups/${com.open}`),
      orbit.api(`https://games.roblox.com/v2/groups/${com.open}/gamesV2?accessFilter=Public&limit=10&sortOrder=Desc`).catch(() => ({ data: [] })),
    ]);
    const list = (games.data || []).map((x) => ({ universeId: x.id, placeId: x.rootPlace?.id, name: x.name, playerCount: x.placeVisits ? undefined : undefined })).filter((x) => x.placeId);
    box.innerHTML = `<div class="com-head"><img class="group-ic big" data-groupicon="${g.id}" src="${BLANK}" alt="" />
        <div><h2>${esc(g.name)}</h2><div class="muted">${fmt(g.memberCount)} membres${g.owner ? ` · par ${esc(g.owner.displayName || g.owner.username)}` : ''}</div></div>
        <button class="btn" type="button" data-groupopen="${g.id}">Ouvrir sur Roblox</button></div>
      ${g.shout?.body ? `<div class="com-shout"><div class="cx-card-label">Annonce de ${esc(g.shout.poster?.displayName || g.shout.poster?.username || '')}</div><div>${esc(g.shout.body)}</div></div>` : ''}
      ${g.description ? `<p class="com-desc">${esc(g.description)}</p>` : ''}
      ${list.length ? renderRow('Jeux de la communauté', list) : ''}`;
    loadGameIcons(box);
    const r = await orbit.api(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${g.id}&size=150x150&format=Png&isCircular=false`).catch(() => null);
    const src = safeImg(r?.data?.[0]?.imageUrl);
    if (src) box.querySelector('[data-groupicon]').src = src;
  } catch (e) {
    box.innerHTML = `<div class="empty">Impossible d’ouvrir la communauté (${esc(errMsg(e))}).</div>`;
  }
}

$('#comList').addEventListener('click', (e) => {
  const g = e.target.closest('[data-group]');
  if (g) openGroup(g.dataset.group);
});
$('#comSearchResults').addEventListener('click', (e) => {
  const g = e.target.closest('[data-group]');
  if (g) openGroup(g.dataset.group);
});
$('#comDetail').addEventListener('click', (e) => {
  const o = e.target.closest('[data-groupopen]');
  if (o) orbit.openUrl(`https://www.roblox.com/communities/${o.dataset.groupopen}`);
});
$('#comSearch').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#comSearchInput').value.trim();
  const box = $('#comSearchResults');
  if (q.length < 2) return (box.innerHTML = '');
  box.innerHTML = '<div class="muted small-note">Recherche…</div>';
  try {
    const r = await orbit.api(`https://groups.roblox.com/v1/groups/search?keyword=${encodeURIComponent(q)}&limit=10&prioritizeExactMatch=true`);
    renderComList((r.data || []).map((g) => ({ id: g.id, name: g.name, members: g.memberCount, role: '' })), box);
  } catch (err) {
    box.innerHTML = `<div class="muted small-note">${esc(errMsg(err))}</div>`;
  }
});
