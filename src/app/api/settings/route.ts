import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getBridgeManager } from '@/lib/im/bridge-manager'
import { getCronEngine } from '@/lib/cron/engine'

// Eagerly initialize singletons on first settings load (app startup).
// This ensures IM Bridge auto-reconnects and Cron Engine auto-starts
// without waiting for the user to navigate to those specific pages.
let _initialized = false
function ensureServicesStarted() {
  if (_initialized) return
  _initialized = true
  // BridgeManager: auto-reconnects enabled IM channels
  try { getBridgeManager() } catch (err) { console.error('[Settings] BridgeManager init error:', err) }
  // CronEngine: auto-starts if there are enabled tasks
  try { getCronEngine() } catch (err) { console.error('[Settings] CronEngine init error:', err) }
}

// GET /api/settings
export async function GET() {
  ensureServicesStarted()
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const settings: Record<string, string> = {}
  for (const row of rows) {
    settings[row.key] = row.value
  }
  return NextResponse.json(settings)
}

// PUT /api/settings — upsert settings
export async function PUT(req: Request) {
  const body = await req.json() as Record<string, string>
  const db = getDb()

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  const transaction = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) {
      upsert.run(key, value)
    }
  })

  transaction(Object.entries(body))
  return NextResponse.json({ ok: true })
}
