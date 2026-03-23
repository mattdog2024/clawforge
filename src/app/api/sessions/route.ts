import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { runSessionCleanup } from '@/lib/session-cleanup'
import crypto from 'crypto'

// GET /api/sessions — list all sessions
export async function GET() {
  // Auto-clean expired sessions on app load (throttled: max once per hour)
  runSessionCleanup()

  const db = getDb()
  const sessions = db
    .prepare("SELECT id, title, workspace, model, status, created_at, updated_at FROM sessions WHERE status = 'active' ORDER BY updated_at DESC")
    .all()
  return NextResponse.json(sessions)
}

// POST /api/sessions — create a new session
export async function POST(req: Request) {
  const body = await req.json()
  const id = crypto.randomUUID()
  const title = body.title || 'New Session'
  const workspace = body.workspace || ''
  const model = body.model || 'claude-sonnet-4-6'

  const db = getDb()
  db.prepare(
    'INSERT INTO sessions (id, title, workspace, model) VALUES (?, ?, ?, ?)'
  ).run(id, title, workspace, model)

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  return NextResponse.json(session, { status: 201 })
}
