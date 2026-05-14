// afterPack.js
// electron-builder afterPack hook - injects standalone into packaged app

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context;

  if (electronPlatformName !== 'win32' || arch !== 'x64') {
    console.log(`[afterPack] Skipping platform: ${electronPlatformName}/${arch}`);
    return;
  }

  const resourcesDir = path.join(appOutDir, 'resources');
  const standaloneStage = path.join(process.cwd(), 'standalone-stage');
  const standaloneDest = path.join(resourcesDir, 'standalone');

  console.log(`[afterPack] appOutDir: ${appOutDir}`);
  console.log(`[afterPack] Injecting standalone into resources/standalone ...`);

  if (!fs.existsSync(standaloneStage)) {
    throw new Error('standalone-stage directory not found at ' + standaloneStage);
  }

  if (!fs.existsSync(path.join(standaloneStage, 'server.js'))) {
    throw new Error('standalone-stage/server.js not found');
  }
  if (!fs.existsSync(path.join(standaloneStage, 'node_modules', 'next', 'package.json'))) {
    throw new Error('standalone-stage/node_modules/next/package.json not found');
  }

  if (process.platform === 'win32') {
    execSync(`robocopy "${standaloneStage}" "${standaloneDest}" /E /NFL /NDL /NJH /NJS /NP`, {
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    });
  } else {
    cpSyncRecursive(standaloneStage, standaloneDest);
  }

  if (!fs.existsSync(path.join(standaloneDest, 'server.js'))) {
    throw new Error('server.js not found after injection');
  }
  if (!fs.existsSync(path.join(standaloneDest, 'node_modules', 'next', 'package.json'))) {
    throw new Error('node_modules/next not found after injection');
  }

  const nmDir = path.join(standaloneDest, 'node_modules');
  const packages = fs.readdirSync(nmDir).filter(name => {
    try { return fs.statSync(path.join(nmDir, name)).isDirectory(); }
    catch { return false; }
  });

  console.log(`[afterPack] Injection successful: ${packages.length} packages, server.js OK, next OK`);
};

function cpSyncRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      cpSyncRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
