import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET /api/sessions/:id/messages
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const messages = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(id)
  return NextResponse.json(messages)
}
