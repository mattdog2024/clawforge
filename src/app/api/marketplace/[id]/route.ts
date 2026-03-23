import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTemplatePath } from '@/lib/marketplace-fs'
import fs from 'fs'

// PATCH /api/marketplace/[id] — rename template
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = body.name as string | undefined
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  db.prepare("UPDATE marketplace_templates SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id)

  const updated = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  return NextResponse.json(updated)
}

// DELETE /api/marketplace/[id] — remove template
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  // Remove template directory from disk
  const templateDir = getTemplatePath(id)
  if (fs.existsSync(templateDir)) {
    fs.rmSync(templateDir, { recursive: true, force: true })
  }

  // Remove from database
  db.prepare('DELETE FROM marketplace_templates WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
