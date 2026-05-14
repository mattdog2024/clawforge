import { build } from 'esbuild'
import { readdirSync, lstatSync, readlinkSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

// Step 1: Build electron main + preload with esbuild
async function buildElectron() {
  const shared = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    external: ['electron'],
    sourcemap: true,
    minify: false,
  }

  await build({
    ...shared,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.js',
    format: 'cjs',
  })

  await build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.js',
    format: 'cjs',
  })

  console.log('Electron main + preload built')
}

// Step 2: Resolve symlinks in .next/standalone
// electron-builder cannot package symlinks — replace them with real file copies
function resolveSymlinks(dir) {
  let resolved = 0
  function walk(d) {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(d, entry.name)
      try {
        const stat = lstatSync(fullPath)
        if (stat.isSymbolicLink()) {
          const realPath = resolve(d, readlinkSync(fullPath))
          rmSync(fullPath, { force: true })
          try {
            const realStat = lstatSync(realPath)
            if (realStat.isDirectory()) {
              cpSync(realPath, fullPath, { recursive: true })
            } else {
              cpSync(realPath, fullPath)
            }
            resolved++
          } catch {
            // Target doesn't exist, just remove the dangling symlink
          }
        } else if (stat.isDirectory()) {
          walk(fullPath)
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }
  walk(dir)
  console.log(`Resolved ${resolved} symlinks in standalone`)
}

// Step 3: Copy templates/ to .next/standalone/ for production server access
function copyTemplates(standaloneDir) {
  const src = join(process.cwd(), 'templates')
  const dest = join(standaloneDir, 'templates')
  try {
    lstatSync(src)
    cpSync(src, dest, { recursive: true })
    console.log('Copied templates/ to standalone')
  } catch {
    console.log('No templates/ directory found — skipping')
  }
}

function findStandaloneAppRoot(standaloneDir) {
  const directServer = join(standaloneDir, 'server.js')
  if (existsSync(directServer)) return standaloneDir

  const queue = [standaloneDir]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (!dir) continue

    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      const fullPath = join(dir, entry.name)
      if (existsSync(join(fullPath, 'server.js'))) return fullPath
      queue.push(fullPath)
    }
  }

  throw new Error(`Could not find standalone server.js under ${standaloneDir}`)
}

// Step 3a: Copy runtime assets into the actual standalone app root.
function copyRuntimeAssets(standaloneDir) {
  const appDir = findStandaloneAppRoot(standaloneDir)
  if (!existsSync(appDir)) return

  const staticSrc = join(process.cwd(), '.next', 'static')
  const staticDest = join(appDir, '.next', 'static')
  if (existsSync(staticSrc)) {
    rmSync(staticDest, { recursive: true, force: true })
    cpSync(staticSrc, staticDest, { recursive: true })
    console.log('Copied .next/static to standalone app root')
  } else {
    console.log('No .next/static directory found — skipping')
  }

  const publicSrc = join(process.cwd(), 'public')
  const publicDest = join(appDir, 'public')
  if (existsSync(publicSrc)) {
    rmSync(publicDest, { recursive: true, force: true })
    cpSync(publicSrc, publicDest, { recursive: true })
    console.log('Copied public/ to standalone app root')
  } else {
    console.log('No public/ directory found — skipping')
  }
}

// Step 3b: Fix pnpm hoisting gaps in standalone node_modules.
function fixPnpmHoisting(standaloneDir) {
  const nodeModules = join(standaloneDir, 'node_modules')
  const pnpmDir = join(nodeModules, '.pnpm')
  if (!existsSync(pnpmDir)) return

  let totalFixed = 0
  for (let pass = 0; pass < 5; pass++) {
    let fixed = 0
    const pnpmEntries = readdirSync(pnpmDir)

    for (const entry of pnpmEntries) {
      const entryModules = join(pnpmDir, entry, 'node_modules')
      if (!existsSync(entryModules)) continue

      let pkgs
      try { pkgs = readdirSync(entryModules) } catch { continue }

      for (const pkg of pkgs) {
        if (pkg === '.pnpm' || pkg === 'node_modules') continue

        if (pkg.startsWith('@')) {
          const scopeDir = join(entryModules, pkg)
          let scopedPkgs
          try { scopedPkgs = readdirSync(scopeDir) } catch { continue }
          for (const scopedPkg of scopedPkgs) {
            const topLevel = join(nodeModules, pkg, scopedPkg)
            if (existsSync(topLevel)) continue
            const source = join(scopeDir, scopedPkg)
            try {
              const stat = lstatSync(source)
              if (stat.isDirectory()) {
                mkdirSync(join(nodeModules, pkg), { recursive: true })
                cpSync(source, topLevel, { recursive: true })
                fixed++
              }
            } catch { /* skip */ }
          }
          continue
        }

        const topLevel = join(nodeModules, pkg)
        if (existsSync(topLevel)) continue

        const source = join(entryModules, pkg)
        try {
          const stat = lstatSync(source)
          if (stat.isDirectory()) {
            cpSync(source, topLevel, { recursive: true })
            fixed++
          }
        } catch { /* skip */ }
      }
    }

    totalFixed += fixed
    if (fixed === 0) break
  }

  if (totalFixed > 0) console.log(`Fixed ${totalFixed} pnpm hoisting gap(s)`)
}

// Step 4: Strip developer machine paths from standalone build output.
function stripDevPaths(standaloneDir) {
  const projectRoot = process.cwd()
  let replaced = 0

  for (const name of ['server.js']) {
    const fp = join(standaloneDir, name)
    try {
      const content = readFileSync(fp, 'utf-8')
      if (content.includes(projectRoot)) {
        writeFileSync(fp, content.replaceAll(projectRoot, '/app'), 'utf-8')
        replaced++
      }
    } catch { /* skip */ }
  }

  function walkAndStrip(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue
      const fullPath = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          walkAndStrip(fullPath)
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
          const content = readFileSync(fullPath, 'utf-8')
          if (content.includes(projectRoot)) {
            writeFileSync(fullPath, content.replaceAll(projectRoot, '/app'), 'utf-8')
            replaced++
          }
        }
      } catch { /* skip unreadable */ }
    }
  }

  walkAndStrip(join(standaloneDir, '.next'))
  console.log(`Stripped developer paths from ${replaced} file(s)`)
}

// Step 5: Remove .forge-data/ from standalone if it leaked in
function cleanForgeData(standaloneDir) {
  const forgeData = join(standaloneDir, '.forge-data')
  try {
    lstatSync(forgeData)
    rmSync(forgeData, { recursive: true, force: true })
    console.log('Removed .forge-data/ from standalone (privacy)')
  } catch { /* doesn't exist, good */ }
}

// Step 6: Download and bundle Node.js runtime for the packaged app.
// CRITICAL: This version MUST match the CI Node.js version (actions/setup-node).
// better-sqlite3 is compiled during `pnpm install` using the CI's Node.js.
// If the bundled runtime version differs, better-sqlite3 will fail to load
// at runtime with a NODE_MODULE_VERSION mismatch error.
//
// Currently:
//   CI:          Node.js v22 (setup-node)
//   Runtime:     Node.js v22.22.2 (bundled here)
//   Electron:    v40.8.0 (has its own Node.js v24, but standalone server
//                runs as a child process using the bundled runtime, NOT Electron's)
async function bundleNodeRuntime() {
  const NODE_VERSION = '22.22.2'
  const arch = process.arch  // arm64 or x64
  const isWin = process.platform === 'win32'
  const platform = process.platform === 'darwin' ? 'darwin' : isWin ? 'win' : 'linux'
  const ext = isWin ? 'zip' : 'tar.gz'
  const dirName = `node-v${NODE_VERSION}-${platform}-${arch}`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${dirName}.${ext}`
  const dest = join(process.cwd(), 'node-runtime')

  const nodeBin = isWin ? join(dest, 'node.exe') : join(dest, 'bin', 'node')

  // Verify existing bundle matches the required version
  if (existsSync(nodeBin)) {
    try {
      const ver = execSync(`"${nodeBin}" --version`, { encoding: 'utf-8' }).trim()
      if (ver === `v${NODE_VERSION}`) {
        console.log(`Node.js runtime already bundled (${ver})`)
        return
      }
      // Version mismatch — delete and re-download
      console.log(`Existing Node.js ${ver} does not match required v${NODE_VERSION} — removing and re-downloading`)
      rmSync(dest, { recursive: true, force: true })
    } catch {
      console.log('Existing node binary unusable — re-downloading')
      rmSync(dest, { recursive: true, force: true })
    }
  }

  console.log(`Downloading Node.js v${NODE_VERSION} (${platform}-${arch})...`)
  mkdirSync(dest, { recursive: true })

  const archive = join(process.cwd(), `node-runtime.${ext}`)

  if (isWin) {
    execSync(`curl -sL "${url}" -o "${archive}"`)
    execSync(`powershell -Command "Expand-Archive -Path '${archive}' -DestinationPath '${dest}' -Force"`)
    const nested = join(dest, dirName)
    if (existsSync(nested)) {
      for (const entry of readdirSync(nested)) {
        const src = join(nested, entry)
        const dst = join(dest, entry)
        cpSync(src, dst, { recursive: true })
      }
      rmSync(nested, { recursive: true, force: true })
    }
  } else {
    execSync(`curl -sL "${url}" -o "${archive}"`)
    execSync(`tar -xzf "${archive}" --strip-components=1 -C "${dest}"`)
  }
  rmSync(archive, { force: true })

  // Remove unnecessary files to reduce size
  for (const dir of ['include', 'share', 'lib']) {
    rmSync(join(dest, dir), { recursive: true, force: true })
  }

  if (isWin) {
    for (const entry of readdirSync(dest)) {
      if (entry === 'node.exe') continue
      const fp = join(dest, entry)
      try {
        const stat = lstatSync(fp)
        if (stat.isFile() && entry !== 'node.exe') rmSync(fp, { force: true })
      } catch { /* skip */ }
    }
  } else {
    const binDir = join(dest, 'bin')
    if (existsSync(binDir)) {
      for (const entry of readdirSync(binDir)) {
        if (entry !== 'node') rmSync(join(binDir, entry), { force: true })
      }
    }
  }

  const finalVer = execSync(`"${nodeBin}" --version`, { encoding: 'utf-8' }).trim()
  console.log(`Node.js runtime bundled (${finalVer})`)

  // Warn if CI Node.js major.minor doesn't match bundled runtime
  const ciMajorMinor = process.version.replace('v', '').split('.').slice(0, 2).join('.')
  const bundledMajorMinor = NODE_VERSION.split('.').slice(0, 2).join('.')
  if (ciMajorMinor !== bundledMajorMinor) {
    console.warn('')
    console.warn('WARNING: CI Node.js version (%s) does not match bundled runtime (v%s).', process.version, NODE_VERSION)
    console.warn('Native modules (e.g. better-sqlite3) compiled with %s will NOT work with v%s.', process.version, NODE_VERSION)
    console.warn('Update your CI workflow to use Node.js v%s via actions/setup-node, OR', NODE_VERSION)
    console.warn('update NODE_VERSION in this file to match your CI Node.js version.')
    console.warn('')
  }
}

// Step 3c: Ensure serverExternalPackages have all transitive dependencies.
function ensureExternalDeps(standaloneDir) {
  const standaloneNM = join(standaloneDir, 'node_modules')
  const projectNM = join(process.cwd(), 'node_modules')
  let copied = 0

  function ensurePkg(pkgName, depth = 0) {
    if (depth > 5) return
    const dest = join(standaloneNM, pkgName)
    const src = join(projectNM, pkgName)

    if (!existsSync(dest) && existsSync(src)) {
      try {
        const parentDir = join(dest, '..')
        mkdirSync(parentDir, { recursive: true })
        cpSync(src, dest, { recursive: true })
        copied++
      } catch { return }
    }

    const pkgJsonPath = join(dest, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
      for (const dep of Object.keys(pkg.dependencies || {})) {
        ensurePkg(dep, depth + 1)
      }
    } catch { /* skip */ }
  }

  const externals = ['@larksuiteoapi/node-sdk']
  for (const ext of externals) {
    ensurePkg(ext)
  }

  if (copied > 0) console.log(`Copied ${copied} missing transitive dep(s) for external packages`)
}

// Step 3d: Ensure the `next` framework package is present in standalone/node_modules.
function ensureFrameworkInStandalone(standaloneDir) {
  const standaloneNM = join(standaloneDir, 'node_modules')
  const projectNM = join(process.cwd(), 'node_modules')
  let copied = 0

  const required = ['next']

  for (const pkg of required) {
    const dest = join(standaloneNM, pkg)
    const src = join(projectNM, pkg)

    if (!existsSync(dest) && existsSync(src)) {
      try {
        mkdirSync(join(dest, '..'), { recursive: true })
        cpSync(src, dest, { recursive: true })
        copied++
        console.log(`  Copied ${pkg} to standalone/node_modules`)
      } catch (e) {
        console.log(`  Warning: could not copy ${pkg}: ${e.message}`)
      }
    }
  }

  if (copied > 0) {
    fixPnpmHoisting(standaloneDir)
  }

  if (copied > 0) console.log(`Ensured ${copied} framework package(s) in standalone`)
}

// Main
await buildElectron()
await bundleNodeRuntime()

const standaloneDir = join(process.cwd(), '.next', 'standalone')
try {
  lstatSync(standaloneDir)
  resolveSymlinks(standaloneDir)
  fixPnpmHoisting(standaloneDir)
  ensureFrameworkInStandalone(standaloneDir)
  ensureExternalDeps(standaloneDir)
  resolveSymlinks(standaloneDir)
  cleanForgeData(standaloneDir)
  copyTemplates(standaloneDir)
  copyRuntimeAssets(standaloneDir)
  stripDevPaths(standaloneDir)
  const appDir = findStandaloneAppRoot(standaloneDir)
  resolveSymlinks(appDir)
  fixPnpmHoisting(appDir)
  resolveSymlinks(appDir)
} catch {
  console.log('No .next/standalone found — skipping standalone processing (dev build?)')
}
