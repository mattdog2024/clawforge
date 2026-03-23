/**
 * Single source of truth for the Forge data directory path.
 *
 * Data directory: ~/.forge/ (database + uploads)
 * Config directory: ~/.claude/ (SDK + Forge config files — NOT managed here)
 */

import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * Get the Forge data directory path.
 * Priority:
 *   1. FORGE_DATA_DIR environment variable (set by Electron main process in production)
 *   2. ~/.forge/ (default, works in both dev and prod)
 *
 * Auto-creates the directory if it doesn't exist.
 */
export function getForgeDataDir(): string {
  const dataDir = process.env.FORGE_DATA_DIR || path.join(os.homedir(), '.forge')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

/**
 * Get the uploads directory path inside the Forge data directory.
 * Auto-creates the directory if it doesn't exist.
 */
export function getUploadsDir(): string {
  const uploadsDir = path.join(getForgeDataDir(), 'uploads')
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true })
  }
  return uploadsDir
}

/** Track whether migration has been attempted (once per process) */
let migrationAttempted = false

/**
 * Migrate data from old .forge-data/ directory to new ~/.forge/ location.
 * Called once during db initialization. Safe to call multiple times (idempotent).
 *
 * Migration logic:
 *   1. If ~/.forge/forge.db exists and is non-empty → no migration needed
 *   2. If process.cwd()/.forge-data/forge.db exists → copy DB files + uploads to ~/.forge/
 *   3. Neither exists → fresh install, nothing to migrate
 */
export function migrateFromOldDataDir(): void {
  if (migrationAttempted) return
  migrationAttempted = true

  const newDataDir = getForgeDataDir()
  const newDbPath = path.join(newDataDir, 'forge.db')

  // If new location already has a real (non-empty) database, skip migration
  if (fs.existsSync(newDbPath) && fs.statSync(newDbPath).size > 0) {
    return
  }

  // Try to find old data at process.cwd()/.forge-data/
  const oldDataDir = path.join(process.cwd(), '.forge-data')
  const oldDbPath = path.join(oldDataDir, 'forge.db')

  if (!fs.existsSync(oldDbPath) || fs.statSync(oldDbPath).size === 0) {
    return // Nothing to migrate
  }

  console.log(`[forge] Migrating data from ${oldDataDir} to ${newDataDir}`)

  // Copy database files (forge.db, forge.db-shm, forge.db-wal)
  for (const suffix of ['', '-shm', '-wal']) {
    const src = path.join(oldDataDir, `forge.db${suffix}`)
    const dest = path.join(newDataDir, `forge.db${suffix}`)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest)
    }
  }

  // Copy uploads directory if it exists
  const oldUploads = path.join(oldDataDir, 'uploads')
  if (fs.existsSync(oldUploads)) {
    const newUploads = path.join(newDataDir, 'uploads')
    if (!fs.existsSync(newUploads)) {
      fs.mkdirSync(newUploads, { recursive: true })
    }
    try {
      const files = fs.readdirSync(oldUploads)
      for (const file of files) {
        const srcFile = path.join(oldUploads, file)
        const destFile = path.join(newUploads, file)
        if (fs.statSync(srcFile).isFile() && !fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile)
        }
      }
    } catch (err) { console.warn('[forge] Upload migration error:', err) }
  }

  console.log(`[forge] Migration complete`)
}
