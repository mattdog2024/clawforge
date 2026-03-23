import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getTemplatePath } from '@/lib/marketplace-fs'
import fs from 'fs'
import nodePath from 'path'

// GET /api/marketplace/[id]/files?name=path/to/file — read file content
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const filename = req.nextUrl.searchParams.get('name')
  if (!filename) return NextResponse.json({ error: 'name query param required' }, { status: 400 })

  // Prevent path traversal
  if (filename.includes('..')) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })

  const templateDir = getTemplatePath(id)
  const filePath = nodePath.join(templateDir, filename)

  // Safety: must be within template directory
  if (!filePath.startsWith(templateDir + nodePath.sep)) {
    return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  return NextResponse.json({ filename, content })
}

// PUT /api/marketplace/[id]/files — write file content
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  let body: { name?: string; content?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'name and content required' }, { status: 400 })
  }

  if (body.name.includes('..')) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })

  const templateDir = getTemplatePath(id)
  const filePath = nodePath.join(templateDir, body.name)

  // Safety: must be within template directory
  if (!filePath.startsWith(templateDir + nodePath.sep)) {
    return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })
  }

  // Ensure parent directory exists
  fs.mkdirSync(nodePath.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, body.content, 'utf-8')

  // Update template's updated_at
  db.prepare("UPDATE marketplace_templates SET updated_at = datetime('now') WHERE id = ?").run(id)

  return NextResponse.json({ ok: true })
}
