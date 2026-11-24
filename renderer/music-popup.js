'use strict';
// In-game "now playing" card (shown by the main process over Roblox).
const $ = (id) => document.getElementById(id);
orbitOverlay.onMusic((s) => {
  document.body.dataset.theme = s.theme || '';
  $('src').textContent = s.label || 'Musique';
  $('title').textContent = s.title || '';
  $('artist').textContent = s.artist || '';
  $('state').textContent = s.status === 'Playing' ? '▶' : s.status === 'Paused' ? '⏸' : '';
  const cover = $('cover');
  cover.textContent = '';
  if (s.thumb) {
    const img = document.createElement('img');
    img.className = 'cover';
    img.src = s.thumb;
    cover.replaceWith(img);
    img.id = 'cover';
  } else if (cover.tagName === 'IMG') {
    const div = document.createElement('div');
    div.className = 'cover';
    div.id = 'cover';
    div.textContent = '🎵';
    cover.replaceWith(div);
  } else {
    cover.textContent = '🎵';
  }
  const card = $('card');
  card.classList.remove('on');
  requestAnimationFrame(() => card.classList.add('on'));
});
