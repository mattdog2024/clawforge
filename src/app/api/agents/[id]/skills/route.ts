import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET /api/agents/:id/skills — list bound skill IDs
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const rows = db.prepare('SELECT skill_id FROM agent_skills WHERE agent_id = ?').all(id) as { skill_id: string }[]
  return NextResponse.json(rows.map((r) => r.skill_id))
}

// PUT /api/agents/:id/skills — replace all bound skills
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const skillIds = Array.isArray(body.skill_ids) ? body.skill_ids as string[] : []

  const db = getDb()
  const deleteAll = db.prepare('DELETE FROM agent_skills WHERE agent_id = ?')
  const insert = db.prepare('INSERT INTO agent_skills (agent_id, skill_id) VALUES (?, ?)')

  db.transaction(() => {
    deleteAll.run(id)
    for (const skillId of skillIds) {
      insert.run(id, skillId)
    }
  })()

  return NextResponse.json({ ok: true })
}
