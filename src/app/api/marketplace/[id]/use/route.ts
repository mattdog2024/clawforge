import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { copyTemplateToProject } from '@/lib/marketplace-fs'
import crypto from 'crypto'
import fs from 'fs'

// POST /api/marketplace/[id]/use — create a project from template
// Body: { projectPath: string }
// Creates .claude/ from template, registers workspace, creates session, returns workspace + session IDs
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM marketplace_templates WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const projectPath = body.projectPath as string | undefined
  if (!projectPath || typeof projectPath !== 'string') {
    return NextResponse.json({ error: 'projectPath is required' }, { status: 400 })
  }

  try {
    // Ensure the project directory exists
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true })
    }

    if (!fs.statSync(projectPath).isDirectory()) {
      return NextResponse.json({ error: 'projectPath is not a directory' }, { status: 400 })
    }

    // Copy template files into projectPath/.claude/
    copyTemplateToProject(id, projectPath)

    // Check if workspace already exists for this path
    let workspace = db.prepare('SELECT * FROM workspaces WHERE path = ?').get(projectPath) as {
      id: string; path: string; last_opened_at: string; created_at: string
    } | undefined

    let workspaceId: string
    if (workspace) {
      // Update last_opened_at
      db.prepare("UPDATE workspaces SET last_opened_at = datetime('now') WHERE id = ?").run(workspace.id)
      workspaceId = workspace.id
    } else {
      // Register new workspace
      workspaceId = crypto.randomUUID()
      db.prepare('INSERT INTO workspaces (id, path) VALUES (?, ?)').run(workspaceId, projectPath)
    }

    // Create a new session for this workspace
    const sessionId = crypto.randomUUID()
    db.prepare(
      'INSERT INTO sessions (id, title, workspace) VALUES (?, ?, ?)'
    ).run(sessionId, 'New Session', workspaceId)

    return NextResponse.json({
      workspaceId,
      sessionId,
    }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
