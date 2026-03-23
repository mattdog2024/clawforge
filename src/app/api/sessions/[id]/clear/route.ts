import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * POST /api/sessions/:id/clear — Delete all messages in a session.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
  return NextResponse.json({ ok: true })
}
