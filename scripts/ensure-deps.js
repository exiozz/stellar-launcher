// Runs before `npm start` / `npm run dist`: installs dependencies if node_modules is
// missing (e.g. after copying the project) and makes sure Electron's binary is downloaded.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const has = (p) => fs.existsSync(path.join(root, 'node_modules', p));

if (!has('electron/install.js') || !has('electron-builder')) {
  console.log('Dépendances manquantes : installation (npm install)…');
  execSync('npm install --no-fund --no-audit', { cwd: root, stdio: 'inherit' });
}
execSync(`node "${path.join(root, 'node_modules', 'electron', 'install.js')}"`, { cwd: root, stdio: 'inherit' });
