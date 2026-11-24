// 3D preview of a catalogue item, from Roblox's own 3D thumbnail (OBJ + MTL + textures).
// Exposes window.Viewer3D.show(container, assetId) -> Promise<boolean> (false = no 3D available).
import * as THREE from './vendor/three.module.min.js';
import { OBJLoader } from './vendor/OBJLoader.js';
import { MTLLoader } from './vendor/MTLLoader.js';
import { OrbitControls } from './vendor/OrbitControls.js';

// Where a 3D file lives: newer hashes ("30DAY-…") are on tr.rbxcdn.com, older ones on t0..t7
// (picked from the hash). We try the likely hosts in order.
// Roblox has moved these files around over the years, so we try every known place once and
// remember which one worked for the next files.
let goodPattern = null;
function hashUrls(hash) {
  if (/^https:\/\//.test(hash)) return [hash];
  const xor = (n) => {
    let i = 31;
    for (let k = 0; k < Math.min(n, hash.length); k++) i ^= hash.charCodeAt(k);
    return i % 8;
  };
  const list = [
    ['tr', `https://tr.rbxcdn.com/${hash}`],
    ['tr-nf', `https://tr.rbxcdn.com/${hash}/noFilter`],
    ['t32', `https://t${xor(32)}.rbxcdn.com/${hash}`],
    ['tall', `https://t${xor(hash.length)}.rbxcdn.com/${hash}`],
    ...Array.from({ length: 8 }, (_, n) => [`t${n}`, `https://t${n}.rbxcdn.com/${hash}`]),
  ];
  const seen = new Set();
  const uniq = list.filter(([, u]) => !seen.has(u) && seen.add(u));
  if (goodPattern) uniq.sort((a, b) => (b[0] === goodPattern) - (a[0] === goodPattern));
  return uniq;
}
async function cdn(hash, as, what) {
  const errors = [];
  for (const [pattern, url] of hashUrls(hash)) {
    try {
      const out = await window.orbit.cdnGet(url, as);
      goodPattern = pattern;
      return out;
    } catch (e) {
      errors.push(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }
  throw new Error(`Roblox refuse le fichier ${what} (${[...new Set(errors)].join(', ')})`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let current = null; // { renderer, raf, controls, ro }

function dispose() {
  if (!current) return;
  cancelAnimationFrame(current.raf);
  current.ro?.disconnect();
  current.controls.dispose();
  current.renderer.dispose();
  current.renderer.domElement.remove();
  current = null;
}

// target: a number (asset id) or { userId } for a player's avatar.
async function fetchMeta(target) {
  const url =
    typeof target === 'object' && target.userId
      ? `https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${Number(target.userId)}`
      : `https://thumbnails.roblox.com/v1/assets-thumbnail-3d?assetId=${Number(target)}`;
  for (let i = 0; i < 10; i++) {
    const short = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    let r;
    try {
      r = await window.orbit.api(url, { auth: true });
    } catch (e) {
      throw new Error(`l'API 3D de Roblox refuse (${short(e)})`);
    }
    if (r.state === 'Completed' && r.imageUrl) {
      let text;
      try {
        text = await window.orbit.cdnGet(r.imageUrl, 'text');
      } catch (e) {
        throw new Error(`description 3D refusée (${short(e)})`);
      }
      return JSON.parse(text);
    }
    if (r.state === 'Blocked' || r.state === 'Error') throw new Error('Roblox ne fournit pas de 3D pour cet objet');
    await wait(1200);
  }
  throw new Error('la 3D met trop de temps à arriver');
}

async function show(container, target) {
  dispose();
  const token = {};
  show.token = token;
  const meta = await fetchMeta(target);
  if (show.token !== token) return false;
  if (!meta?.obj || !meta?.mtl) throw new Error('modèle 3D incomplet');

  const [objText, mtlText, ...tex] = await Promise.all([
    cdn(meta.obj, 'text', 'du modèle'),
    cdn(meta.mtl, 'text', 'des matériaux'),
    ...(meta.textures || []).map((h) => cdn(h, 'dataurl', 'de texture')),
  ]);
  if (show.token !== token) return false;
  const texMap = Object.fromEntries((meta.textures || []).map((h, i) => [h, tex[i]]));

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => texMap[url.split('/').pop()] || url);
  const materials = new MTLLoader(manager).parse(mtlText, '');
  materials.preload();
  const obj = new OBJLoader(manager).setMaterials(materials).parse(objText);

  const w = container.clientWidth || 400;
  const h = container.clientHeight || 400;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  scene.add(obj);

  // frame the model from its bounding box
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const camera = new THREE.PerspectiveCamera(35, w / h, size / 100, size * 20);
  camera.position.copy(center).add(new THREE.Vector3(0, size * 0.15, size * 1.35));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 2.2;
  controls.enablePan = false;
  controls.update();

  const ro = new ResizeObserver(() => {
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  current = { renderer, controls, ro, raf: 0 };
  const tick = () => {
    if (!current) return;
    controls.update();
    renderer.render(scene, camera);
    current.raf = requestAnimationFrame(tick);
  };
  tick();
  return true;
}

window.Viewer3D = { show, dispose };
