import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getBridgeManager } from '@/lib/im/bridge-manager'

export async function GET() {
  // Ensure BridgeManager is initialized (triggers auto-reconnect on first call)
  getBridgeManager()

  const db = getDb()
  const rows = db.prepare('SELECT * FROM im_channels ORDER BY type').all()
  return NextResponse.json(rows)
}
