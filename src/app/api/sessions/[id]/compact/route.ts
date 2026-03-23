import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import crypto from 'crypto'

/**
 * POST /api/sessions/:id/compact — Compact session by replacing all messages
 * with a single summary message containing the conversation overview.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const session = db.prepare('SELECT id, title FROM sessions WHERE id = ?').get(id) as { id: string; title: string } | undefined
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const messages = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(id) as { role: string; content: string }[]

  if (messages.length === 0) {
    return NextResponse.json({ ok: true, compacted: 0 })
  }

  // Build a compact summary of the conversation
  const turns = messages.length
  let userMsgCount = 0
  let assistantMsgCount = 0
  const topics: string[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      userMsgCount++
      // Extract first line of user messages as topic hints
      const firstLine = msg.content.slice(0, 100).split('\n')[0].trim()
      if (firstLine && topics.length < 5) {
        topics.push(firstLine)
      }
    } else {
      assistantMsgCount++
    }
  }

  const summary = [
    `[Conversation compacted: ${turns} messages (${userMsgCount} user, ${assistantMsgCount} assistant)]`,
    '',
    topics.length > 0 ? `Topics discussed:\n${topics.map(t => `- ${t}`).join('\n')}` : '',
    '',
    'Previous context has been compacted to save memory. You may continue the conversation.',
  ].filter(Boolean).join('\n')

  const summaryContent = JSON.stringify([{ type: 'text', text: summary }])

  // Replace all messages with the summary
  const deleteAndInsert = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    db.prepare(
      'INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
    ).run(crypto.randomUUID(), id, 'assistant', summaryContent)
  })
  deleteAndInsert()

  return NextResponse.json({ ok: true, compacted: turns })
}
