import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { clearSessionAllowances } from '@/lib/sdk/permission-bridge'

// GET /api/sessions/:id
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(session)
}

// PATCH /api/sessions/:id — update title, model, etc.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const db = getDb()

  const fields: string[] = []
  const values: unknown[] = []

  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title) }
  if (body.model !== undefined) { fields.push('model = ?'); values.push(body.model) }
  if (body.workspace !== undefined) { fields.push('workspace = ?'); values.push(body.workspace) }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status) }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  fields.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  return NextResponse.json(session)
}

// DELETE /api/sessions/:id
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  clearSessionAllowances(id)
  return NextResponse.json({ ok: true })
}
