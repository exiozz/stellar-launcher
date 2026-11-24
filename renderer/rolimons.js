'use strict';
// Catalogue › Limiteds: every limited item with its Rolimons RAP / value / demand / trend.
// Data comes from Rolimons' public item API (read-only). Loaded after app.js.

const ROLI_DEMAND = { 0: 'Terrible', 1: 'Faible', 2: 'Normale', 3: 'Forte', 4: 'Énorme' };
const ROLI_TREND = { 0: 'En baisse', 1: 'Instable', 2: 'Stable', 3: 'En hausse', 4: 'Fluctue' };
const roli = { items: null, at: 0, sort: 'value', q: '', shown: 60, loading: null };

async function loadRolimons() {
  if (roli.items && Date.now() - roli.at < 5 * 60e3) return roli.items;
  if (roli.loading) return roli.loading;
  roli.loading = (async () => {
    const r = await orbit.rolimons();
    if (!r?.success || !r.items) throw new Error('Rolimons indisponible');
    roli.items = Object.entries(r.items).map(([id, a]) => ({
      id: Number(id),
      name: String(a[0] || ''),
      acronym: String(a[1] || ''),
      rap: Number(a[2]) || 0,
      value: Number(a[3]),
      demandId: Number(a[5]),
      demand: ROLI_DEMAND[a[5]] || '',
      trend: ROLI_TREND[a[6]] || '',
      projected: a[7] === 1,
      hyped: a[8] === 1,
      rare: a[9] === 1,
    }));
    roli.byId = new Map(roli.items.map((x) => [x.id, x]));
    roli.at = Date.now();
    return roli.items;
  })().finally(() => (roli.loading = null));
  return roli.loading;
}
// used by the item window
const roliItem = (id) => roli.byId?.get(Number(id)) || null;

const worth = (x) => (x.value > 0 ? x.value : x.rap);

async function renderLimiteds(reset = true) {
  const grid = $('#roliGrid');
  if (reset) roli.shown = 60;
  if (!roli.items) grid.innerHTML = Array.from({ length: 12 }, () => '<div class="skeleton" style="aspect-ratio:.78"></div>').join('');
  try {
    await loadRolimons();
  } catch (e) {
    grid.innerHTML = `<div class="empty">Impossible de charger Rolimons (${esc(errMsg(e))}).</div>`;
    return;
  }
  const q = roli.q.toLowerCase();
  let list = roli.items.filter((x) => !q || x.name.toLowerCase().includes(q) || x.acronym.toLowerCase() === q);
  const by = {
    value: (a, b) => worth(b) - worth(a),
    rap: (a, b) => b.rap - a.rap,
    demand: (a, b) => b.demandId - a.demandId || worth(b) - worth(a),
    name: (a, b) => a.name.localeCompare(b.name),
  }[roli.sort];
  list.sort(by);
  $('#roliCount').textContent = `${full.format(list.length)} limiteds`;
  const page = list.slice(0, roli.shown);
  grid.innerHTML =
    page
      .map(
        (x) => `<div class="item-card roli-card" data-item="${x.id}" data-type="Asset">
      <button class="item-open" type="button" title="${esc(x.name)}">
        <div class="item-thumb">${x.rare ? '<span class="item-tag">Rare</span>' : x.projected ? '<span class="item-tag warn">Projeté</span>' : ''}<img data-thumb="Asset:${x.id}" src="${BLANK}" alt="" /></div>
        <div class="item-name">${esc(x.name)}</div>
        <div class="item-creator">${esc(x.acronym || (x.trend ? `Tendance : ${x.trend}` : ''))}</div>
        <div class="item-price"><i class="robux"></i>${full.format(worth(x))}</div>
        <div class="roli-meta">${x.value > 0 ? `<span>RAP ${fmt(x.rap)}</span>` : ''}${x.demand ? `<span class="d${x.demandId}">${esc(x.demand)}</span>` : ''}</div>
      </button>
    </div>`
      )
      .join('') || '<div class="empty">Aucun limited trouvé.</div>';
  $('#roliMore').hidden = list.length <= roli.shown;
  loadItemThumbs(
    grid,
    page.map((x) => ({ id: x.id, itemType: 'Asset' }))
  );
}

$('#roliSearch').addEventListener('input', (e) => {
  roli.q = e.target.value.trim();
  clearTimeout(roli.t);
  roli.t = setTimeout(() => renderLimiteds(true), 250);
});
$('#roliSort').addEventListener('change', (e) => {
  roli.sort = e.target.value;
  renderLimiteds(true);
});
$('#roliMore').addEventListener('click', () => {
  roli.shown += 60;
  renderLimiteds(false);
});
$('#roliSite').addEventListener('click', () => orbit.openUrl('https://www.rolimons.com/catalog'));
$('.roli-search').addEventListener('submit', (e) => e.preventDefault());
