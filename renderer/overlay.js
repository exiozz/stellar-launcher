'use strict';
// Cursor-effects overlay: receives mouse positions from the main process and draws the trail.
let options = { effect: 'sakura', density: 0.6, size: 1 };
const trail = OrbitFx.create(document.getElementById('fx'), () => options);

orbitOverlay.onOptions((o) => {
  options = o;
  trail.reset();
});
orbitOverlay.onCursor(({ x, y }) => trail.move(x, y));
orbitOverlay.onReset(() => trail.reset());
