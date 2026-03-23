import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { initializeWorkspaceDir } from '@/lib/workspace-fs'

export async function GET() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC').all() as {
    id: string; path: string; last_opened_at: string; created_at: string
  }[]

  // Add name derived from path + check if folder still exists on disk
  const result = rows.map(row => ({
    ...row,
    name: path.basename(row.path),
    exists: fs.existsSync(row.path),
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const db = getDb()
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.path || typeof body.path !== 'string') {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }

  const projectPath = body.path as string

  // Validate path exists and is a directory
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    return NextResponse.json({ error: 'Path does not exist or is not a directory' }, { status: 400 })
  }

  // Check if already registered
  const existing = db.prepare('SELECT * FROM workspaces WHERE path = ?').get(projectPath) as Record<string, unknown> | undefined
  if (existing) {
    // Update last_opened_at and return existing
    db.prepare("UPDATE workspaces SET last_opened_at = datetime('now') WHERE id = ?").run(existing.id)
    const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(existing.id) as Record<string, unknown>
    return NextResponse.json({ ...updated, name: path.basename(projectPath) })
  }

  const id = crypto.randomUUID()
  db.prepare(
    'INSERT INTO workspaces (id, path) VALUES (?, ?)'
  ).run(id, projectPath)

  // Initialize .claude/ directory with default files
  initializeWorkspaceDir(projectPath, true)

  const created = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Record<string, unknown>
  return NextResponse.json({ ...created, name: path.basename(projectPath) }, { status: 201 })
}
