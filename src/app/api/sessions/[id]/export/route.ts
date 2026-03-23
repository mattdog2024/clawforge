import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(id) as Record<string, unknown>[]

  const exportMessages = messages.map((m) => {
    const role = String(m.role)
    if (role === 'assistant') {
      // Assistant messages store content as JSON array of blocks
      let blocks: unknown[] = []
      try { blocks = JSON.parse(String(m.content)) } catch { /* plain text fallback */ }
      return { id: m.id, role, blocks, created_at: m.created_at }
    }
    // User messages store content as plain text
    return { id: m.id, role, text: m.content, created_at: m.created_at }
  })

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    version: '1.0',
    session: { id: session.id, title: session.title, workspace: session.workspace, model: session.model, created_at: session.created_at },
    messages: exportMessages,
  })
}
