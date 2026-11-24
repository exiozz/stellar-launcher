'use strict';
// Pinned music player shown over the game; stays until closed (button, hotkey or controller).
const $ = (id) => document.getElementById(id);
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
let playing = false;

// a little bar visualiser (decorative: Windows doesn't share the audio itself)
const viz = $('viz');
for (let i = 0; i < 34; i++) viz.append(document.createElement('i'));
setInterval(() => {
  for (const [i, bar] of [...viz.children].entries()) {
    const h = playing ? 15 + Math.abs(Math.sin(Date.now() / 260 + i * 0.7)) * 55 + Math.random() * 30 : 8;
    bar.style.height = `${Math.min(100, h)}%`;
  }
}, 180);

orbitOverlay.onMusic((s) => {
  playing = s.status === 'Playing';
  $('src').textContent = s.label || '';
  $('title').textContent = s.title || 'Aucune musique';
  $('artist').textContent = s.title ? s.artist || '' : 'Lance Spotify, Deezer ou une vidéo';
  $('pp').innerHTML = playing ? PAUSE : PLAY;
  const cover = $('cover');
  if (s.thumb) {
    const img = document.createElement('img');
    img.className = 'cover';
    img.id = 'cover';
    img.alt = '';
    img.src = s.thumb;
    cover.replaceWith(img);
  } else if (cover.tagName === 'IMG') {
    const div = document.createElement('div');
    div.className = 'cover';
    div.id = 'cover';
    div.textContent = '🎵';
    cover.replaceWith(div);
  }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (b) orbitOverlay.musicCmd(b.dataset.c);
});
$('close').addEventListener('click', () => orbitOverlay.closePlayer());
