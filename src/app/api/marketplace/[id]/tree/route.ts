import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { buildTemplateTree } from '@/lib/marketplace-fs'

// GET /api/marketplace/[id]/tree — return file tree for a template
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  try {
    const tree = buildTemplateTree(id)
    return NextResponse.json({ tree })
  } catch {
    return NextResponse.json({ tree: [] })
  }
}
