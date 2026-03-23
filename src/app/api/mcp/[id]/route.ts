import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const server = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id)
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(server)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const db = getDb()

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name) }
  if (body.protocol !== undefined) { fields.push('protocol = ?'); values.push(body.protocol) }
  if (body.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(body.config)) }
  if (body.enabled !== undefined) { fields.push('enabled = ?'); values.push(body.enabled ? 1 : 0) }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status) }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  fields.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  const server = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id)
  return NextResponse.json(server)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
