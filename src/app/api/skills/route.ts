import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import crypto from 'crypto'

export async function GET() {
  const db = getDb()
  const skills = db.prepare('SELECT * FROM skills ORDER BY updated_at DESC').all()
  return NextResponse.json(skills)
}

export async function POST(req: Request) {
  const body = await req.json()
  const id = crypto.randomUUID()
  const name = body.name || 'New Skill'
  const description = body.description || ''
  const scope = body.scope || 'workspace'
  const content = body.content || `---\ndescription: ${name}\n---\n\n# ${name}\n\nDescribe your skill here.\n`

  const db = getDb()
  db.prepare(
    'INSERT INTO skills (id, name, description, scope, content) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, description, scope, content)

  const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(id)
  return NextResponse.json(skill, { status: 201 })
}
