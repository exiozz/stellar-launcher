'use strict';
// Catalogue › Mon avatar: build a look from the items you own, try catalogue items on,
// load your outfits, pick a skin colour, then save it to your Roblox avatar.
// Loaded after app.js; shares its globals. Nothing is sent to Roblox until "Enregistrer".

const AV = 'https://avatar.roblox.com/';
const AV_TABS = [
  ['worn', 'Ma tenue', null],
  ['hats', 'Chapeaux', [8]],
  ['hair', 'Cheveux', [41]],
  ['faces', 'Visages', [18, 79]],
  ['acc', 'Accessoires', [42, 43, 44, 45, 46, 47]],
  ['tops', 'Hauts', [2, 11, 64, 65, 67, 68]],
  ['bottoms', 'Bas', [12, 66, 69, 72]],
  ['shoes', 'Chaussures', [70, 71]],
  ['outfits', 'Tenues', null],
  ['skin', 'Peau', null],
];
// Only one of each of these can be worn: a new one replaces the old.
const SINGLE_TYPES = new Set([2, 11, 12, 17, 18, 79, 27, 28, 29, 30, 31]);
const SKINS = ['#F8D9C4', '#EAB892', '#CC8E69', '#A16E4D', '#7C5039', '#4A2F21', '#F5CD30', '#A3A2A5', '#1B2A35', '#C4281C', '#0D69AC', '#6E99CA', '#4B974B', '#FF98DC'];

const av = { tab: 'worn', saved: null, draft: null, skin: null, inv: new Map(), outfits: null, previewSeq: 0, loaded: false };

const avCall = (path, body) => orbit.api(AV + path, body ? { method: 'POST', body, auth: true } : { auth: true });
const typeIdOf = (a) => Number(a.assetType?.id ?? a.assetType ?? a.assetTypeId ?? 0);

// ---------- tabs between Boutique and Mon avatar ----------
$('.cat-tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-cattab]');
  if (t) showCatTab(t.dataset.cattab);
});
function showCatTab(name) {
  $$('.cat-tabs [data-cattab]').forEach((b) => b.classList.toggle('active', b.dataset.cattab === name));
  $('#catShop').hidden = name !== 'shop';
  $('#catAvatar').hidden = name !== 'avatar';
  $('#catLimiteds').hidden = name !== 'limiteds';
  if (name === 'limiteds') renderLimiteds(true);
  $('#catalogForm').hidden = name !== 'shop';
  if (name === 'avatar') openAvatar();
}

// ---------- load the current avatar ----------
async function openAvatar() {
  const acc = activeAccount();
  renderAvTabs();
  if (!acc) {
    $('#avGrid').innerHTML = `<div class="empty">Connecte ton compte Roblox pour créer ton skin.<br /><br /><button class="btn primary small" data-menu="add">Se connecter</button></div>`;
    $('#avState').textContent = '';
    $('#avPreview').removeAttribute('src');
    return;
  }
  if (av.loaded && av.accountId === acc.id) return renderAvGrid();
  av.accountId = acc.id;
  $('#avGrid').innerHTML = '<div class="empty">Chargement de ton avatar…</div>';
  try {
    const cur = await avCall('v1/avatar');
    av.saved = { assets: (cur.assets || []).map(cleanAsset), type: cur.playerAvatarType || 'R15', scales: cur.scales || null };
    av.draft = av.saved.assets.map((x) => ({ ...x }));
    av.skin = null;
    av.inv.clear();
    av.outfits = null;
    av.loaded = true;
    await showSavedThumb();
    renderAvGrid();
    syncAvButtons();
  } catch (e) {
    $('#avGrid').innerHTML = `<div class="empty">Impossible de charger ton avatar (${esc(errMsg(e))}).</div>`;
  }
}
const cleanAsset = (a) => ({ id: Number(a.id ?? a.assetId), name: a.name ?? a.assetName ?? '', assetType: typeIdOf(a), ...(a.meta ? { meta: a.meta } : {}) });

async function showSavedThumb() {
  const acc = activeAccount();
  try {
    const r = await orbit.api(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${acc.id}&size=420x420&format=Png&isCircular=false`);
    const src = safeImg(r.data?.[0]?.imageUrl);
    if (src) $('#avPreview').src = src;
  } catch {
    /* preview is cosmetic */
  }
}

// ---------- tabs & grids ----------
function renderAvTabs() {
  $('#avTabs').innerHTML = AV_TABS.map(([id, label]) => `<button class="chip ${id === av.tab ? 'active' : ''}" type="button" data-avtab="${id}">${label}</button>`).join('');
}
$('#avTabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-avtab]');
  if (!t) return;
  av.tab = t.dataset.avtab;
  renderAvTabs();
  renderAvGrid();
});

const isWorn = (id) => av.draft?.some((a) => a.id === Number(id));

function itemTile(a) {
  return `<button class="av-item ${isWorn(a.id) ? 'on' : ''}" type="button" data-avitem="${a.id}" data-avtype="${a.assetType || ''}" data-avname="${esc(a.name)}" title="${esc(a.name)}">
    <img data-thumb="Asset:${a.id}" src="${BLANK}" alt="" />
    <span>${esc(a.name)}</span>
    <i class="av-check" aria-hidden="true">✓</i>
  </button>`;
}

async function renderAvGrid() {
  const grid = $('#avGrid');
  if (!av.loaded) return;
  const tab = AV_TABS.find((t) => t[0] === av.tab);
  if (av.tab === 'worn') {
    grid.innerHTML = av.draft.length
      ? av.draft.map(itemTile).join('')
      : '<div class="empty">Ton avatar ne porte rien. Choisis des objets dans les autres onglets.</div>';
    return loadItemThumbs(grid, av.draft.map((a) => ({ id: a.id, itemType: 'Asset' })));
  }
  if (av.tab === 'skin') {
    grid.innerHTML = `<div class="av-skins">${SKINS.map((c) => `<button class="av-skin ${av.skin === c ? 'on' : ''}" type="button" data-skin="${c}" style="background:${c}" aria-label="Couleur ${c}"></button>`).join('')}</div>
      <p class="muted small-note">La couleur s'applique à tout le corps.</p>`;
    return;
  }
  if (av.tab === 'outfits') return renderOutfits();
  // owned items of these asset types
  const key = tab[0];
  if (!av.inv.has(key)) {
    grid.innerHTML = '<div class="empty">Chargement de tes objets…</div>';
    try {
      av.inv.set(key, await loadOwned(tab[2]));
    } catch (e) {
      grid.innerHTML = `<div class="empty">Impossible de charger tes objets (${esc(errMsg(e))}).</div>`;
      return;
    }
    if (av.tab !== key) return;
  }
  const items = av.inv.get(key);
  grid.innerHTML = items.length
    ? items.map(itemTile).join('')
    : `<div class="empty">Tu n'as pas encore d'objet ici. Trouve-en dans la Boutique et clique sur « Essayer ».</div>`;
  loadItemThumbs(grid, items.map((a) => ({ id: a.id, itemType: 'Asset' })));
}

async function loadOwned(typeIds) {
  const acc = activeAccount();
  const out = [];
  for (const t of typeIds) {
    let cursor = '';
    for (let page = 0; page < 3; page++) {
      const r = await orbit.api(`https://inventory.roblox.com/v2/users/${acc.id}/inventory/${t}?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { auth: true });
      for (const x of r.data || []) out.push({ id: Number(x.assetId ?? x.id), name: x.assetName ?? x.name ?? '', assetType: t });
      cursor = r.nextPageCursor;
      if (!cursor) break;
    }
  }
  const seen = new Set();
  return out.filter((a) => a.id && !seen.has(a.id) && seen.add(a.id));
}

async function renderOutfits() {
  const grid = $('#avGrid');
  const acc = activeAccount();
  if (!av.outfits) {
    grid.innerHTML = '<div class="empty">Chargement de tes tenues…</div>';
    try {
      const r = await avCall(`v2/avatar/users/${acc.id}/outfits?page=1&itemsPerPage=50&outfitType=Avatar`);
      av.outfits = (r.data || []).map((o) => ({ id: Number(o.id), name: o.name || 'Tenue' }));
    } catch (e) {
      grid.innerHTML = `<div class="empty">Impossible de charger tes tenues (${esc(errMsg(e))}).</div>`;
      return;
    }
  }
  if (av.tab !== 'outfits') return;
  grid.innerHTML = av.outfits.length
    ? av.outfits.map((o) => `<button class="av-item" type="button" data-outfit="${o.id}" title="${esc(o.name)}"><img data-outfitthumb="${o.id}" src="${BLANK}" alt="" /><span>${esc(o.name)}</span></button>`).join('')
    : '<div class="empty">Aucune tenue enregistrée sur ton compte Roblox.</div>';
  if (!av.outfits.length) return;
  try {
    const r = await orbit.api(`https://thumbnails.roblox.com/v1/users/outfits?userOutfitIds=${av.outfits.map((o) => o.id).join(',')}&size=150x150&format=Png&isCircular=false`);
    for (const t of r.data || []) {
      const img = grid.querySelector(`img[data-outfitthumb="${t.targetId}"]`);
      const src = safeImg(t.imageUrl);
      if (img && src) img.src = src;
    }
  } catch {
    /* thumbnails are cosmetic */
  }
}

// ---------- editing the draft ----------
$('#avGrid').addEventListener('click', async (e) => {
  const it = e.target.closest('[data-avitem]');
  if (it) return toggleItem({ id: Number(it.dataset.avitem), name: it.dataset.avname, assetType: Number(it.dataset.avtype) || null });
  const sk = e.target.closest('[data-skin]');
  if (sk) {
    av.skin = sk.dataset.skin;
    renderAvGrid();
    return changed();
  }
  const of = e.target.closest('[data-outfit]');
  if (of) {
    try {
      const d = await avCall(`v3/outfits/${of.dataset.outfit}/details`);
      av.draft = (d.assets || []).map(cleanAsset);
      if (d.bodyColor3s?.headColor3) av.skin = '#' + d.bodyColor3s.headColor3;
      toast(`Tenue « ${d.name || ''} » chargée`, 'ok');
      changed();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  }
});

function toggleItem(a) {
  if (isWorn(a.id)) av.draft = av.draft.filter((x) => x.id !== a.id);
  else {
    if (a.assetType && SINGLE_TYPES.has(a.assetType)) av.draft = av.draft.filter((x) => x.assetType !== a.assetType);
    av.draft.push(a);
  }
  renderAvGrid();
  changed();
}

/** Called from the Boutique: preview a catalogue item on your avatar. */
async function tryOn(a) {
  if (!activeAccount()) return toast('Connecte-toi pour essayer des objets', 'error');
  showView('catalog');
  showCatTab('avatar');
  await openAvatar();
  if (!isWorn(a.id)) toggleItem(a);
  toast(`« ${a.name} » essayé : aperçu seulement, il faut l'avoir pour l'enregistrer`, 'ok');
}

const sameDraft = () => !av.skin && JSON.stringify(av.draft.map((a) => a.id).sort()) === JSON.stringify(av.saved.assets.map((a) => a.id).sort());

function syncAvButtons() {
  const dirty = av.loaded && !sameDraft();
  $('#avSave').disabled = !dirty;
  $('#avReset').disabled = !dirty;
  $('#avState').textContent = dirty ? 'Aperçu : pas encore enregistré' : 'Ton avatar Roblox';
}

let previewTimer = null;
function changed() {
  syncAvButtons();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 350);
}

// Live preview of the draft (Roblox renders it; nothing is saved).
async function renderPreview() {
  if (sameDraft()) return showSavedThumb();
  const seq = ++av.previewSeq;
  $('#avLoading').hidden = false;
  const colors = av.skin ? Object.fromEntries(['headColor', 'torsoColor', 'rightArmColor', 'leftArmColor', 'rightLegColor', 'leftLegColor'].map((k) => [k, av.skin])) : undefined;
  const body = {
    thumbnailConfig: { thumbnailId: 3, thumbnailType: '2dWebp', size: '420x420' },
    avatarDefinition: {
      assets: av.draft.map((a) => ({ id: a.id, ...(a.meta ? { meta: a.meta } : {}) })),
      ...(colors ? { bodyColors: colors } : {}),
      ...(av.saved.scales ? { scales: av.saved.scales } : {}),
      playerAvatarType: { playerAvatarType: av.saved.type },
    },
  };
  try {
    for (let i = 0; i < 8 && seq === av.previewSeq; i++) {
      const r = await avCall('v1/avatar/render', body);
      const src = safeImg(r.imageUrl);
      if (r.state === 'Completed' && src) {
        if (seq === av.previewSeq) $('#avPreview').src = src;
        break;
      }
      await new Promise((res) => setTimeout(res, 1200));
    }
  } catch {
    if (seq === av.previewSeq) $('#avState').textContent = "Aperçu indisponible : enregistre pour voir le résultat";
  } finally {
    if (seq === av.previewSeq) $('#avLoading').hidden = true;
  }
}

$('#avReset').addEventListener('click', () => {
  av.draft = av.saved.assets.map((x) => ({ ...x }));
  av.skin = null;
  renderAvGrid();
  syncAvButtons();
  showSavedThumb();
});

$('#avSave').addEventListener('click', async () => {
  const btn = $('#avSave');
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  try {
    const r = await avCall('v2/avatar/set-wearing-assets', { assets: av.draft.map((a) => ({ id: a.id, ...(a.meta ? { meta: a.meta } : {}) })) });
    const invalid = (r.invalidAssetIds || []).map(Number);
    if (av.skin) {
      const hex = av.skin.replace('#', '');
      await avCall('v2/avatar/set-body-colors', { headColor3: hex, torsoColor3: hex, rightArmColor3: hex, leftArmColor3: hex, rightLegColor3: hex, leftLegColor3: hex });
    }
    await avCall('v1/avatar/redraw-thumbnail', {}).catch(() => {});
    av.loaded = false;
    await openAvatar();
    toast(invalid.length ? `Avatar enregistré, sauf ${invalid.length} objet${invalid.length > 1 ? 's' : ''} que tu ne possèdes pas` : 'Avatar enregistré sur Roblox', invalid.length ? 'error' : 'ok');
    setTimeout(showSavedThumb, 3000);
  } catch (e) {
    toast(`Impossible d'enregistrer : ${errMsg(e)}`, 'error');
  } finally {
    btn.textContent = 'Enregistrer sur Roblox';
    syncAvButtons();
  }
});

// ---------- 3D view of your saved avatar ----------
let av3dOn = false;
async function setAv3d(on) {
  av3dOn = on;
  $('#av3d').setAttribute('aria-pressed', String(on));
  $('#av3d').classList.toggle('on', on);
  $('#av3dHint').textContent = '';
  if (!on) {
    window.Viewer3D?.dispose();
    $('#avPreview').hidden = false;
    return;
  }
  const acc = activeAccount();
  if (!acc) return setAv3d(false);
  $('#av3dHint').textContent = 'Chargement de la 3D…';
  try {
    const ok = await window.Viewer3D.show($('#avFrame'), { userId: acc.id });
    if (!av3dOn) return window.Viewer3D.dispose();
    if (ok) {
      $('#avPreview').hidden = true;
      $('#av3dHint').textContent = sameDraft() ? 'Fais glisser pour tourner' : 'La 3D montre ton avatar enregistré';
    }
  } catch (e) {
    $('#av3dHint').textContent = `Pas de 3D : ${errMsg(e)}`;
  }
}
$('#av3d').addEventListener('click', () => setAv3d(!av3dOn));
