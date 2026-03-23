const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context

  // Only sign on macOS
  if (electronPlatformName !== 'darwin') {
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  console.log(`\n🔏 after-sign: ${appPath}`)

  // Check if we have a real Developer ID signature
  const hasRealCert = process.env.CSC_LINK || process.env.CSC_NAME
  if (hasRealCert) {
    console.log('🔐 Developer ID certificate detected — verifying signature...')
    try {
      execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, { stdio: 'inherit' })
      console.log('✅ Developer ID signature verified')
    } catch {
      console.warn('⚠️  Developer ID signature verification failed')
    }
    return
  }

  // Check if electron-builder already applied a real signature
  try {
    const sigInfo = execSync(`codesign -d --verbose=2 "${appPath}" 2>&1`, { encoding: 'utf8' })
    if (sigInfo.includes('Developer ID')) {
      console.log('🔐 Developer ID signature found — skipping ad-hoc signing')
      return
    }
  } catch {
    // No signature found, proceed with ad-hoc
  }

  console.log('🔧 No Developer ID — applying ad-hoc signature...')

  // Sign inside-out: native binaries → frameworks → helpers → main app
  const contentsPath = path.join(appPath, 'Contents')

  // 1. Sign native binaries (.node, .dylib)
  signGlob(contentsPath, ['.node', '.dylib', '.so'])

  // 2. Sign frameworks
  const frameworksPath = path.join(contentsPath, 'Frameworks')
  if (fs.existsSync(frameworksPath)) {
    const entries = fs.readdirSync(frameworksPath)

    // Sign .framework bundles
    for (const entry of entries) {
      const full = path.join(frameworksPath, entry)
      if (entry.endsWith('.framework')) {
        adHocSign(full)
      }
    }

    // Sign helper .app bundles
    for (const entry of entries) {
      const full = path.join(frameworksPath, entry)
      if (entry.endsWith('.app')) {
        adHocSign(full)
      }
    }
  }

  // 3. Sign main app
  adHocSign(appPath)

  // 4. Verify
  try {
    execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' })
    console.log('✅ Ad-hoc signature verified')
  } catch {
    console.warn('⚠️  Ad-hoc signature verification failed (may still work)')
  }
}

function adHocSign(target) {
  try {
    execSync(`codesign --force --sign - "${target}"`, { stdio: 'pipe' })
  } catch (e) {
    console.warn(`  ⚠️  Could not sign: ${path.basename(target)}`)
  }
}

function signGlob(dir, extensions) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      signGlob(full, extensions)
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      adHocSign(full)
    }
  }
}
