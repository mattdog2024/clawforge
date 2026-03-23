import { NextRequest, NextResponse } from 'next/server'
import { readWorkspaceFile, writeWorkspaceFile } from '@/lib/workspace-fs'

// GET /api/workspaces/[id]/files?name=CLAUDE.md
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const filename = req.nextUrl.searchParams.get('name')
  if (!filename) return NextResponse.json({ error: 'name query param required' }, { status: 400 })

  // Prevent path traversal
  if (filename.includes('..')) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })

  const content = readWorkspaceFile(id, filename)
  if (content === null) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  return NextResponse.json({ filename, content })
}

// PUT /api/workspaces/[id]/files
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { name?: string; content?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'name and content required' }, { status: 400 })
  }

  if (body.name.includes('..')) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })

  writeWorkspaceFile(id, body.name, body.content)
  return NextResponse.json({ ok: true })
}
