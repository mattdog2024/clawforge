import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET /api/data/export — export sessions with messages
// Optional query param: ?workspace=<id> to filter by workspace (omit for all)
export async function GET(req: NextRequest) {
  const db = getDb()
  const workspace = req.nextUrl.searchParams.get('workspace')

  const sessions = workspace
    ? db.prepare('SELECT id, title, workspace, model, created_at, updated_at FROM sessions WHERE workspace = ? ORDER BY updated_at DESC').all(workspace) as Record<string, unknown>[]
    : db.prepare('SELECT id, title, workspace, model, created_at, updated_at FROM sessions ORDER BY updated_at DESC').all() as Record<string, unknown>[]

  const exportData = sessions.map((s) => {
    const messages = db.prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(String(s.id)) as Record<string, unknown>[]

    const exportMessages = messages.map((m) => {
      const role = String(m.role)
      if (role === 'assistant') {
        let blocks: unknown[] = []
        try { blocks = JSON.parse(String(m.content)) } catch { /* fallback */ }
        return { id: m.id, role, blocks, created_at: m.created_at }
      }
      return { id: m.id, role, text: m.content, created_at: m.created_at }
    })

    return { session: s, messages: exportMessages }
  })

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    version: '1.0',
    totalSessions: sessions.length,
    scope: workspace ? 'workspace' : 'all',
    data: exportData,
  })
}
