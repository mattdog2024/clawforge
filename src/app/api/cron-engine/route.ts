import { NextRequest, NextResponse } from 'next/server'
import { getCronEngine } from '@/lib/cron/engine'

// GET — check engine status
export async function GET() {
  const engine = getCronEngine()
  return NextResponse.json({ running: engine.isRunning() })
}

// POST — start or stop the engine
export async function POST(req: NextRequest) {
  let body: { action?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const action = body.action
  if (action !== 'start' && action !== 'stop') {
    return NextResponse.json({ error: 'action must be "start" or "stop"' }, { status: 400 })
  }

  const engine = getCronEngine()

  if (action === 'start') {
    engine.start()
    return NextResponse.json({ running: true })
  } else {
    engine.stop()
    return NextResponse.json({ running: false })
  }
}
