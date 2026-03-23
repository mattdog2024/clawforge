import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import path from 'path'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Update last_opened_at
  db.prepare("UPDATE workspaces SET last_opened_at = datetime('now') WHERE id = ?").run(id)

  const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as { path: string }
  return NextResponse.json({ ...updated, name: path.basename(updated.path) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  // Idempotent delete: succeed even if workspace doesn't exist in DB.
  // This avoids 404 errors when the user clicks "remove from list" for a workspace
  // that was already removed or whose folder is missing.
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)

  // Also clean up sessions referencing this workspace (optional cleanup)
  db.prepare('DELETE FROM sessions WHERE workspace = ?').run(id)

  return NextResponse.json({ ok: true })
}
