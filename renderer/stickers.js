'use strict';
// Stickers for the emote wheel: drawing and wheel composition (base theme/image + stickers).
// Sticker = { kind: 'emoji'|'image', value, x, y (0..1 of the wheel), size (0..1 of the wheel), rot (radians) }.

const OrbitStickers = (() => {
  const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const EMOJIS = [
    '🌸', '💖', '🎀', '⭐', '✨', '🐾', '🐱', '🐰', '🐻', '🐶', '🦄', '🦋', '🍓', '🍒', '🧸', '🌈',
    '☁️', '🌙', '💫', '🍭', '🍬', '🎵', '👑', '💎', '🔥', '❄️', '🍀', '🌷', '💜', '🖤', '🤍', '💕',
    '😺', '🐣', '🍰', '🧁', '🍩', '🎮', '⚡', '💀', '👻', '🕸️', '🌻', '🍑', '🥺', '😈', '🫶', '🌟',
  ];

  const images = new Map(); // data URL -> HTMLImageElement
  function imageFor(src) {
    if (!images.has(src)) {
      const img = new Image();
      img.src = src;
      images.set(src, img);
    }
    return images.get(src);
  }
  const ready = (list) =>
    Promise.all(list.filter((s) => s.kind === 'image').map((s) => {
      const img = imageFor(s.value);
      return img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; });
    }));

  function draw(ctx, st, S) {
    const size = st.size * S;
    ctx.save();
    ctx.translate(st.x * S, st.y * S);
    ctx.rotate(st.rot);
    if (st.kind === 'emoji') {
      ctx.font = `${size}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.value, 0, size * 0.05);
    } else {
      const img = imageFor(st.value);
      if (img.complete && img.naturalWidth) {
        const r = img.naturalWidth / img.naturalHeight;
        const w = r >= 1 ? size : size * r, h = r >= 1 ? size / r : size;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
    }
    ctx.restore();
  }

  /** Draws a square image (any size) centre-cropped into an S×S canvas context. */
  function drawCover(ctx, img, S) {
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
  }

  /**
   * Full wheel image: base (built-in theme id, 'custom' bitmap, or nothing) + stickers.
   * `customBase` is an ImageBitmap of the user's own wheel when baseId === 'custom'.
   */
  async function compose(baseId, stickers, customBase, S = 1200) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const theme = OrbitArt.themes.find((t) => t.id === baseId);
    if (theme) ctx.drawImage(OrbitArt.drawTheme(theme, S), 0, 0);
    else if (baseId === 'custom' && customBase) drawCover(ctx, customBase, S);
    await ready(stickers);
    for (const st of stickers) draw(ctx, st, S);
    return c;
  }

  /** Downscales an image file (bytes) to a PNG data URL of at most `max` px, for image stickers. */
  async function toStickerDataUrl(bytes, max = 256) {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  /** Renders an emoji or image to a square PNG (for the menu icons). */
  async function iconPng(kind, value, size = 96) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    await ready([{ kind, value }]);
    draw(c.getContext('2d'), { kind, value, x: 0.5, y: 0.5, size: 0.86, rot: 0 }, size);
    return OrbitArt.toPngBytes(c);
  }

  /** The sticker layer alone: transparent square, stickers anywhere (corners included). */
  async function composeStickers(stickers, S = 1200) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    await ready(stickers);
    const ctx = c.getContext('2d');
    for (const st of stickers) draw(ctx, st, S);
    return c;
  }

  return { EMOJIS, draw, compose, composeStickers, drawCover, toStickerDataUrl, iconPng, ready };
})();
