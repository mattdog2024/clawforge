// afterPack.js
// electron-builder afterPack hook (CommonJS)
// Injects Next.js standalone (with node_modules) into the packaged app
// before NSIS installer is created.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// electron-builder passes arch as a numeric enum (Arch):
//   ia32 = 0, x64 = 1, armv7l = 2, arm64 = 3, universal = 4
// Do NOT compare arch to the string 'x64' — it will always be false.
const Arch = { ia32: 0, x64: 1, armv7l: 2, arm64: 3, universal: 4 };

async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context;

  console.log('[afterPack] ========================================');
  console.log('[afterPack] Hook started');
  console.log('[afterPack] appOutDir:', appOutDir);
  console.log('[afterPack] platform:', electronPlatformName, 'arch:', arch, '(x64 =', Arch.x64, ')');
  console.log('[afterPack] cwd:', process.cwd());
  console.log('[afterPack] ========================================');

  // arch is a number (Arch enum), NOT a string — compare numerically
  if (electronPlatformName !== 'win32' || arch !== Arch.x64) {
    console.log('[afterPack] Skipping non-win32/x64 target (platform=' + electronPlatformName + ' arch=' + arch + ')');
    return;
  }

  let standaloneStage = path.join(process.cwd(), 'standalone-stage');
  if (!fs.existsSync(standaloneStage)) {
    const altPath = path.resolve(__dirname, '..', 'standalone-stage');
    if (fs.existsSync(altPath)) {
      standaloneStage = altPath;
    } else {
      console.error('[afterPack] standalone-stage NOT FOUND');
      console.error('[afterPack] Tried:', path.join(process.cwd(), 'standalone-stage'));
      console.error('[afterPack] Tried:', altPath);
      console.error('[afterPack] cwd contents:', fs.readdirSync(process.cwd()).join(', '));
      throw new Error('standalone-stage not found');
    }
  }
  console.log('[afterPack] standalone-stage:', standaloneStage);

  if (!fs.existsSync(path.join(standaloneStage, 'server.js'))) {
    throw new Error('server.js not found in standalone-stage');
  }
  if (!fs.existsSync(path.join(standaloneStage, 'node_modules', 'next', 'package.json'))) {
    throw new Error('node_modules/next not found in standalone-stage');
  }

  const resourcesDir = path.join(appOutDir, 'resources');
  const standaloneDest = path.join(resourcesDir, 'standalone');

  console.log('[afterPack] Copying to:', standaloneDest);

  if (!fs.existsSync(resourcesDir)) {
    throw new Error('resources dir not found: ' + resourcesDir);
  }

  if (process.platform === 'win32') {
    try {
      execSync(
        'robocopy "' + standaloneStage + '" "' + standaloneDest + '" /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1',
        { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (e) {
      // robocopy non-zero exit codes (1-7) are often OK (files copied successfully)
    }
  } else {
    cpSyncRecursive(standaloneStage, standaloneDest);
  }

  if (!fs.existsSync(path.join(standaloneDest, 'server.js'))) {
    throw new Error('server.js missing after injection');
  }
  if (!fs.existsSync(path.join(standaloneDest, 'node_modules', 'next', 'package.json'))) {
    throw new Error('next missing after injection');
  }

  const nmPackages = fs.readdirSync(path.join(standaloneDest, 'node_modules'))
    .filter(n => { try { return fs.statSync(path.join(standaloneDest, 'node_modules', n)).isDirectory(); } catch { return false; } });

  console.log('[afterPack] SUCCESS - server.js OK, next OK, ' + nmPackages.length + ' packages');
}

function cpSyncRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) cpSyncRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

module.exports = afterPack;
module.exports.default = afterPack;
