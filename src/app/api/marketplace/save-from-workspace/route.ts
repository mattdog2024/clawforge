import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { copyClaudeToTemplate } from '@/lib/marketplace-fs'
import crypto from 'crypto'

// POST /api/marketplace/save-from-workspace — create template from workspace's .claude/
// Body: { workspaceId: string, name: string }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const workspaceId = body.workspaceId as string | undefined
  const name = body.name as string | undefined

  if (!workspaceId || typeof workspaceId !== 'string') {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const db = getDb()

  // Look up the workspace to get its path
  const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as {
    id: string; path: string
  } | undefined

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  try {
    const templateId = crypto.randomUUID()

    // Copy .claude/ contents from workspace project path into template directory
    copyClaudeToTemplate(workspace.path, templateId)

    // Insert into database
    db.prepare('INSERT INTO marketplace_templates (id, name) VALUES (?, ?)').run(templateId, name)

    const created = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(templateId)
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
