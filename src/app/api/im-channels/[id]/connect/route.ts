import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getBridgeManager } from '@/lib/im/bridge-manager'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { action?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const action = body.action
  if (action !== 'connect' && action !== 'disconnect') {
    return NextResponse.json({ error: 'action must be "connect" or "disconnect"' }, { status: 400 })
  }

  // Validate channel exists
  const db = getDb()
  const channel = db.prepare('SELECT * FROM im_channels WHERE id = ?').get(id) as { id: string; enabled: number } | undefined
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const manager = getBridgeManager()

  try {
    if (action === 'connect') {
      if (!channel.enabled) {
        return NextResponse.json({ error: 'Channel is disabled. Enable it first.' }, { status: 400 })
      }
      await manager.startAdapter(id)
      return NextResponse.json({ status: 'connected' })
    } else {
      await manager.stopAdapter(id)
      return NextResponse.json({ status: 'disconnected' })
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: errorMsg }, { status: 500 })
  }
}

// GET returns the current bridge state
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const manager = getBridgeManager()
  const state = manager.getState(id)
  return NextResponse.json(state || { channelId: id, status: 'disconnected' })
}
