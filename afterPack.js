// afterPack.js
// electron-builder afterPack hook (CommonJS)
// Injects Next.js standalone (with node_modules) and Node.js runtime
// into the packaged app before NSIS installer is created.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context;

  console.log('[afterPack] ========================================');
  console.log('[afterPack] Hook started');
  console.log('[afterPack] appOutDir:', appOutDir);
  console.log('[afterPack] platform:', electronPlatformName, 'arch:', arch);
  console.log('[afterPack] cwd:', process.cwd());
  console.log('[afterPack] ========================================');

  if (electronPlatformName !== 'win32' || arch !== 'x64') {
    console.log('[afterPack] Skipping non-win32/x64 target');
    return;
  }

  // ---------------------------------------------------------------
  // Step 1: Find and inject standalone-stage
  // ---------------------------------------------------------------
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

  console.log('[afterPack] Copying standalone to:', standaloneDest);

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
      // robocopy exits with codes > 0 for various reasons; check result manually
    }
  } else {
    cpSyncRecursive(standaloneStage, standaloneDest);
  }

  // ---------------------------------------------------------------
  // Step 2: Copy node-runtime manually (NOT via extraResources)
  //
  // electron-builder's extraResources can interfere with the bundled
  // node.exe — it may get replaced by Electron's internal Node.js.
  // By copying it here in afterPack, we ensure the correct version
  // is placed AFTER electron-builder has finished its resource processing.
  // ---------------------------------------------------------------
  const nodeRuntimeSrc = path.join(process.cwd(), 'node-runtime');
  const nodeRuntimeDest = path.join(resourcesDir, 'node-runtime');

  if (!fs.existsSync(nodeRuntimeSrc)) {
    console.error('[afterPack] node-runtime NOT FOUND at:', nodeRuntimeSrc);
    console.error('[afterPack] cwd contents:', fs.readdirSync(process.cwd()).join(', '));
    throw new Error('node-runtime not found');
  }

  // Verify the source node.exe version BEFORE copying
  const srcNodeExe = path.join(nodeRuntimeSrc, 'node.exe');
  if (!fs.existsSync(srcNodeExe)) {
    throw new Error('node-runtime/node.exe not found at: ' + srcNodeExe);
  }

  const nodeVer = execSync('"' + srcNodeExe + '" --version', { encoding: 'utf-8' }).trim();
  console.log('[afterPack] Source node.exe version:', nodeVer);

  // Ensure the destination is clean (electron-builder may have put something there)
  if (fs.existsSync(nodeRuntimeDest)) {
    fs.rmSync(nodeRuntimeDest, { recursive: true, force: true });
  }
  fs.mkdirSync(nodeRuntimeDest, { recursive: true });

  // Copy node.exe
  const destNodeExe = path.join(nodeRuntimeDest, 'node.exe');
  fs.copyFileSync(srcNodeExe, destNodeExe);

  // Verify the copied node.exe version
  const destNodeVer = execSync('"' + destNodeExe + '" --version', { encoding: 'utf-8' }).trim();
  console.log('[afterPack] Destination node.exe version:', destNodeVer);

  if (nodeVer !== destNodeVer) {
    throw new Error('node.exe version mismatch after copy: ' + nodeVer + ' vs ' + destNodeVer);
  }

  // ---------------------------------------------------------------
  // Step 3: Verify better-sqlite3 .node file is present
  // ---------------------------------------------------------------
  const sqliteNodePath = findFile(standaloneDest, 'better_sqlite3.node');
  if (sqliteNodePath) {
    console.log('[afterPack] better_sqlite3.node found at:', sqliteNodePath);
  } else {
    console.warn('[afterPack] WARNING: better_sqlite3.node NOT FOUND in standalone');
  }

  // ---------------------------------------------------------------
  // Final verification
  // ---------------------------------------------------------------
  if (!fs.existsSync(path.join(standaloneDest, 'server.js'))) {
    throw new Error('server.js missing after injection');
  }
  if (!fs.existsSync(path.join(standaloneDest, 'node_modules', 'next', 'package.json'))) {
    throw new Error('next missing after injection');
  }

  const nmPackages = fs.readdirSync(path.join(standaloneDest, 'node_modules'))
    .filter(function(n) { try { return fs.statSync(path.join(standaloneDest, 'node_modules', n)).isDirectory(); } catch(e) { return false; } });

  console.log('[afterPack] SUCCESS - server.js OK, next OK, ' + nmPackages.length + ' packages');
  console.log('[afterPack] node.exe version:', destNodeVer);
}

function findFile(dir, filename) {
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return null; }
  for (var i = 0; i < entries.length; i++) {
    var full = path.join(dir, entries[i].name);
    if (entries[i].isFile() && entries[i].name === filename) return full;
    if (entries[i].isDirectory()) {
      var result = findFile(full, filename);
      if (result) return result;
    }
  }
  return null;
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

// Export for electron-builder (both CJS and ESM patterns)
module.exports = afterPack;
module.exports.default = afterPack;
