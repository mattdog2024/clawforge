import { NextRequest, NextResponse } from 'next/server'
import { getProjectPath } from '@/lib/workspace-fs'
import fs from 'fs'
import path from 'path'

function validatePath(projectRoot: string, filePath: string): string | null {
  if (!filePath || filePath.includes('..') || path.isAbsolute(filePath)) return null
  const full = path.resolve(projectRoot, filePath)
  if (!full.startsWith(path.resolve(projectRoot) + path.sep)) return null
  return full
}

// GET /api/workspaces/[id]/project-files?path=src/main.ts
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const filePath = req.nextUrl.searchParams.get('path')
  if (!filePath) return NextResponse.json({ error: 'path query param required' }, { status: 400 })

  const projectRoot = getProjectPath(id)
  const fullPath = validatePath(projectRoot, filePath)
  if (!fullPath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  try {
    const content = fs.readFileSync(fullPath, 'utf-8')
    return NextResponse.json({ path: filePath, content })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}

// PUT /api/workspaces/[id]/project-files
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { path?: string; content?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.path || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'path and content required' }, { status: 400 })
  }

  const projectRoot = getProjectPath(id)
  const fullPath = validatePath(projectRoot, body.path)
  if (!fullPath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  try {
    fs.writeFileSync(fullPath, body.content, 'utf-8')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Write failed' }, { status: 500 })
  }
}
