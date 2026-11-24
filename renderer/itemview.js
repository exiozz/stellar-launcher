'use strict';
// Item window: 3D preview (Viewer3D), price, Rolimons value, "Essayer" and "Voir sur Roblox".
// Loaded after app.js; shares its globals.

const iv = { item: null };
const ANIM_TYPES = new Set([24, 48, 49, 50, 51, 52, 53, 54, 55, 56, 61]); // animations & emotes: no mesh

function openItem(card) {
  const it = {
    id: Number(card.dataset.item),
    type: card.dataset.type,
    assetType: Number(card.querySelector('[data-assettype]')?.dataset.assettype || card.dataset.assettype) || null,
    name: card.querySelector('.item-name')?.textContent.trim() || '',
    creator: card.querySelector('.item-creator')?.textContent.trim() || '',
    priceHtml: card.querySelector('.item-price')?.innerHTML || '',
    thumb: card.querySelector('img')?.src || '',
  };
  iv.item = it;
  $('#ivName').textContent = it.name;
  $('#ivCreator').textContent = it.creator ? `par ${it.creator}` : '';
  $('#ivPrice').innerHTML = it.priceHtml;
  $('#ivType').textContent = it.type === 'Bundle' ? 'Pack' : ANIM_TYPES.has(it.assetType) ? 'Emote / animation' : 'Objet';
  $('#ivTry').hidden = it.type !== 'Asset' || ANIM_TYPES.has(it.assetType);
  $('#ivRoli').innerHTML = roliLine(it.id);
  const img = $('#ivImg');
  img.src = it.thumb || BLANK;
  img.hidden = false;
  $('#ivHint').textContent = '';
  $('#itemModal').hidden = false;
  setTimeout(() => $('#ivOpen').focus(), 30);

  // 3D for meshes and clothing; emotes and packs keep their picture
  if (it.type !== 'Asset' || ANIM_TYPES.has(it.assetType)) {
    $('#ivHint').textContent = it.type === 'Asset' ? 'Les emotes se voient en jeu : aperçu en image.' : '';
    return;
  }
  if (!activeAccount()) {
    $('#ivHint').textContent = 'Connecte-toi pour voir l’objet en 3D.';
    return;
  }
  $('#ivHint').textContent = 'Chargement de la 3D…';
  const want = it;
  window.Viewer3D?.show($('#ivStage'), it.id)
    .then((ok) => {
      if (iv.item !== want) return;
      if (ok) {
        img.hidden = true;
        $('#ivHint').textContent = 'Fais glisser pour tourner · molette pour zoomer';
      } else $('#ivHint').textContent = 'Pas de 3D pour cet objet.';
    })
    .catch((e) => iv.item === want && ($('#ivHint').textContent = `Pas de 3D : ${errMsg(e)}`));
}

function closeItem() {
  $('#itemModal').hidden = true;
  iv.item = null;
  window.Viewer3D?.dispose();
}

// Rolimons value line, when the item is a limited (see rolimons.js).
function roliLine(id) {
  const r = typeof roliItem === 'function' ? roliItem(id) : null;
  if (!r) return '';
  return `<span class="roli-chip">RAP ${fmt(r.rap)}</span>${r.value > 0 ? `<span class="roli-chip">Valeur ${fmt(r.value)}</span>` : ''}${r.demand ? `<span class="roli-chip">Demande : ${esc(r.demand)}</span>` : ''}`;
}

$('#itemModal').addEventListener('click', (e) => {
  if (e.target.closest('[data-itemclose]')) closeItem();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#itemModal').hidden) closeItem();
});
$('#ivOpen').addEventListener('click', () => {
  const it = iv.item;
  if (it) orbit.openUrl(`https://www.roblox.com/${it.type === 'Bundle' ? 'bundles' : 'catalog'}/${it.id}`);
});
$('#ivTry').addEventListener('click', () => {
  const it = iv.item;
  if (!it) return;
  closeItem();
  tryOn({ id: it.id, name: it.name, assetType: it.assetType });
});
