import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import crypto from 'crypto'

export async function GET() {
  const db = getDb()
  const agents = db.prepare('SELECT * FROM agents ORDER BY is_main DESC, updated_at DESC').all() as Record<string, unknown>[]

  // Attach skill IDs to each agent
  const getSkills = db.prepare('SELECT skill_id FROM agent_skills WHERE agent_id = ?')
  const result = agents.map((agent) => ({
    ...agent,
    skill_ids: (getSkills.all(agent.id as string) as { skill_id: string }[]).map((r) => r.skill_id),
  }))

  return NextResponse.json(result)
}

export async function POST(req: Request) {
  const body = await req.json()
  const id = crypto.randomUUID()
  const name = body.name || 'New Agent'
  const description = body.description || ''
  const model = body.model || 'claude-sonnet-4-6'
  const permissionMode = body.permission_mode || 'confirm'
  const isMain = body.is_main ? 1 : 0
  const parentId = body.parent_id || null
  const instructions = body.instructions || ''
  const soul = body.soul || ''
  const identity = body.identity || ''
  const toolsConfig = typeof body.tools_config === 'string' ? body.tools_config : JSON.stringify(body.tools_config || {})

  const db = getDb()
  db.prepare(
    `INSERT INTO agents (id, name, description, model, permission_mode, is_main, parent_id, instructions, soul, identity, tools_config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, description, model, permissionMode, isMain, parentId, instructions, soul, identity, toolsConfig)

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown>
  return NextResponse.json({ ...agent, skill_ids: [] }, { status: 201 })
}
