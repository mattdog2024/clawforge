import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTemplatePath } from '@/lib/marketplace-fs'
import crypto from 'crypto'
import fs from 'fs'

// GET /api/marketplace — list all templates
export async function GET() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM marketplace_templates ORDER BY updated_at DESC').all() as {
    id: string; name: string; created_at: string; updated_at: string
  }[]

  return NextResponse.json(rows)
}

// POST /api/marketplace — create a new empty template
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = body.name as string | undefined
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const db = getDb()
  const id = crypto.randomUUID()

  // Create the template directory on disk
  const templateDir = getTemplatePath(id)
  fs.mkdirSync(templateDir, { recursive: true })

  // Insert into database
  db.prepare('INSERT INTO marketplace_templates (id, name) VALUES (?, ?)').run(id, name)

  const created = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  return NextResponse.json(created, { status: 201 })
}
