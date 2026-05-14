import { build } from 'esbuild'
import { readdirSync, lstatSync, readlinkSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs'
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
// pnpm uses a strict node_modules layout where dependencies are nested in .pnpm/.
// Node.js require() can't resolve them from the top-level. Scan .pnpm/ and create
// top-level copies for any packages that aren't already hoisted.
// Runs multiple passes to catch transitive dependencies (e.g. protobufjs → @protobufjs/*).
function fixPnpmHoisting(standaloneDir) {
  const nodeModules = join(standaloneDir, 'node_modules')
  const pnpmDir = join(nodeModules, '.pnpm')
  if (!existsSync(pnpmDir)) return

  let totalFixed = 0
  // Multiple passes: each pass may hoist packages whose sub-deps need hoisting next pass
  for (let pass = 0; pass < 5; pass++) {
    let fixed = 0
    const pnpmEntries = readdirSync(pnpmDir)

    for (const entry of pnpmEntries) {
      const entryModules = join(pnpmDir, entry, 'node_modules')
      if (!existsSync(entryModules)) continue

      let pkgs
      try { pkgs = readdirSync(entryModules) } catch { continue }

      for (const pkg of pkgs) {
        // Skip .pnpm internal references and already-hoisted packages
        if (pkg === '.pnpm' || pkg === 'node_modules') continue

        // Handle scoped packages (@scope/name): check inside the scope dir
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
        if (existsSync(topLevel)) continue  // Already hoisted

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
    if (fixed === 0) break  // No more gaps found
  }

  if (totalFixed > 0) console.log(`Fixed ${totalFixed} pnpm hoisting gap(s)`)
}

// Step 4: Strip developer machine paths from standalone build output.
// Next.js embeds the build machine's absolute path in compiled output
// (server.js, required-server-files.json, route bundles in .next/server/).
// Replace with /app to prevent privacy leaks.
// CRITICAL: Skip node_modules/ entirely — replacing paths there breaks module resolution.
function stripDevPaths(standaloneDir) {
  const projectRoot = process.cwd()
  let replaced = 0

  // Strip top-level server.js
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

  // Strip .next/ directory recursively (compiled route bundles, metadata)
  // but NEVER touch node_modules/
  function walkAndStrip(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue  // CRITICAL: skip node_modules
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
// CRITICAL: This version MUST match the Node.js version used by CI to compile
// native modules (e.g. better-sqlite3). Mismatched versions cause
// NODE_MODULE_VERSION errors and all API routes return 500.
//
// Electron 40.x embeds Node.js v24.x. CI uses setup-node with v24.
// If you change the CI Node.js version, update this to match.
async function bundleNodeRuntime() {
  const NODE_VERSION = '24.14.0'
  const arch = process.arch  // arm64 or x64
  const isWin = process.platform === 'win32'
  const platform = process.platform === 'darwin' ? 'darwin' : isWin ? 'win' : 'linux'
  const ext = isWin ? 'zip' : 'tar.gz'
  const dirName = `node-v${NODE_VERSION}-${platform}-${arch}`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${dirName}.${ext}`
  const dest = join(process.cwd(), 'node-runtime')

  // Node binary path differs by platform
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
      console.log(`Existing Node.js ${ver} does not match required ${NODE_VERSION} — re-downloading`)
      rmSync(dest, { recursive: true, force: true })
    } catch {
      // Corrupted or unusable — re-download
      console.log('Existing node binary unusable — re-downloading')
      rmSync(dest, { recursive: true, force: true })
    }
  }

  console.log(`Downloading Node.js ${NODE_VERSION} (${platform}-${arch})...`)
  mkdirSync(dest, { recursive: true })

  const archive = join(process.cwd(), `node-runtime.${ext}`)

  if (isWin) {
    // Windows: download zip, extract with PowerShell
    execSync(`curl -sL "${url}" -o "${archive}"`)
    execSync(`powershell -Command "Expand-Archive -Path '${archive}' -DestinationPath '${dest}' -Force"`)
    // Move files from nested dir to dest root
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
    // macOS/Linux: download tar.gz, extract with tar
    execSync(`curl -sL "${url}" -o "${archive}"`)
    execSync(`tar -xzf "${archive}" --strip-components=1 -C "${dest}"`)
  }
  rmSync(archive, { force: true })

  // Remove unnecessary files to reduce size
  for (const dir of ['include', 'share', 'lib']) {
    rmSync(join(dest, dir), { recursive: true, force: true })
  }

  if (isWin) {
    // Windows: keep only node.exe from root, remove npm/npx
    for (const entry of readdirSync(dest)) {
      if (entry === 'node.exe') continue
      const fp = join(dest, entry)
      try {
        const stat = lstatSync(fp)
        if (stat.isFile() && entry !== 'node.exe') rmSync(fp, { force: true })
      } catch { /* skip */ }
    }
  } else {
    // Unix: keep only bin/node
    const binDir = join(dest, 'bin')
    if (existsSync(binDir)) {
      for (const entry of readdirSync(binDir)) {
        if (entry !== 'node') rmSync(join(binDir, entry), { force: true })
      }
    }
  }

  // Verify the downloaded binary works
  const finalVer = execSync(`"${nodeBin}" --version`, { encoding: 'utf-8' }).trim()
  console.log(`Node.js runtime bundled (${finalVer})`)

  // Warn if CI Node.js version doesn't match
  const ciVer = process.version
  if (ciVer.replace('v', '').split('.').slice(0, 2).join('.') !== NODE_VERSION.split('.').slice(0, 2).join('.')) {
    console.warn(``)
    console.warn(`WARNING: CI Node.js version (${ciVer}) does not match bundled runtime (${finalVer}).`)
    console.warn(`Native modules (e.g. better-sqlite3) compiled with ${ciVer} will NOT work with ${finalVer}.`)
    console.warn(`Update your CI workflow to use Node.js ${NODE_VERSION} via actions/setup-node.`)
    console.warn(``)
  }
}

// Step 3c: Ensure serverExternalPackages have all transitive dependencies.
// When Next.js externalizes a package, it lands in standalone/node_modules but
// its transitive deps may be missing (they weren't traced by webpack).
// Copy any missing deps from the project's node_modules.
function ensureExternalDeps(standaloneDir) {
  const standaloneNM = join(standaloneDir, 'node_modules')
  const projectNM = join(process.cwd(), 'node_modules')
  let copied = 0

  function ensurePkg(pkgName, depth = 0) {
    if (depth > 5) return
    const dest = join(standaloneNM, pkgName)
    const src = join(projectNM, pkgName)

    // Copy if missing in standalone but exists in project
    if (!existsSync(dest) && existsSync(src)) {
      try {
        const parentDir = join(dest, '..')
        mkdirSync(parentDir, { recursive: true })
        cpSync(src, dest, { recursive: true })
        copied++
      } catch { return }
    }

    // Recurse into this package's dependencies
    const pkgJsonPath = join(dest, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
      for (const dep of Object.keys(pkg.dependencies || {})) {
        ensurePkg(dep, depth + 1)
      }
    } catch { /* skip */ }
  }

  // Start from known external packages that have runtime deps
  const externals = ['@larksuiteoapi/node-sdk']
  for (const ext of externals) {
    ensurePkg(ext)
  }

  if (copied > 0) console.log(`Copied ${copied} missing transitive dep(s) for external packages`)
}

// Step 3d: Ensure the `next` framework package is present in standalone/node_modules.
// Next.js standalone output does NOT include the `next` package itself in node_modules —
// it inlines the runtime into .next/server/ but server.js still does require('next').
// Copy it from the project's node_modules if missing.
function ensureFrameworkInStandalone(standaloneDir) {
  const standaloneNM = join(standaloneDir, 'node_modules')
  const projectNM = join(process.cwd(), 'node_modules')
  let copied = 0

  // Packages that Next.js server.js requires but standalone doesn't include
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

  // Also copy transitive deps of `next` that standalone might need
  // (e.g., next/dist/server/require-hook.js loads these at runtime)
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
  resolveSymlinks(standaloneDir)  // Second pass: resolve symlinks introduced by ensureExternalDeps
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
