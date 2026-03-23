import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const skillIds = (db.prepare('SELECT skill_id FROM agent_skills WHERE agent_id = ?').all(id) as { skill_id: string }[]).map((r) => r.skill_id)
  return NextResponse.json({ ...agent, skill_ids: skillIds })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const db = getDb()

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name) }
  if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description) }
  if (body.model !== undefined) { fields.push('model = ?'); values.push(body.model) }
  if (body.permission_mode !== undefined) { fields.push('permission_mode = ?'); values.push(body.permission_mode) }
  if (body.is_main !== undefined) { fields.push('is_main = ?'); values.push(body.is_main ? 1 : 0) }
  if (body.parent_id !== undefined) { fields.push('parent_id = ?'); values.push(body.parent_id) }
  if (body.enabled !== undefined) { fields.push('enabled = ?'); values.push(body.enabled ? 1 : 0) }
  if (body.instructions !== undefined) { fields.push('instructions = ?'); values.push(body.instructions) }
  if (body.soul !== undefined) { fields.push('soul = ?'); values.push(body.soul) }
  if (body.identity !== undefined) { fields.push('identity = ?'); values.push(body.identity) }
  if (body.tools_config !== undefined) {
    fields.push('tools_config = ?')
    values.push(typeof body.tools_config === 'string' ? body.tools_config : JSON.stringify(body.tools_config))
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  fields.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown>
  const skillIds = (db.prepare('SELECT skill_id FROM agent_skills WHERE agent_id = ?').all(id) as { skill_id: string }[]).map((r) => r.skill_id)
  return NextResponse.json({ ...agent, skill_ids: skillIds })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
