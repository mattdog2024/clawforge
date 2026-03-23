import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath } from '@/lib/workspace-fs'
import fs from 'fs'
import path from 'path'

type RouteParams = { params: Promise<{ id: string; filename: string }> }

function validateFilename(filename: string): string | null {
  const name = filename.endsWith('.md') ? filename : `${filename}.md`
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
    return null
  }
  return name
}

// GET — read sub-agent file content
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id, filename } = await params
  const safeFilename = validateFilename(filename)
  if (!safeFilename) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })

  try {
    const filePath = path.join(getWorkspacePath(id), 'agents', safeFilename)
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return NextResponse.json({ filename: safeFilename, content })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PUT — write full sub-agent file content
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id, filename } = await params
  const safeFilename = validateFilename(filename)
  if (!safeFilename) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  const body = await req.json()
  if (typeof body.content !== 'string') return NextResponse.json({ error: 'content must be a string' }, { status: 400 })

  try {
    const filePath = path.join(getWorkspacePath(id), 'agents', safeFilename)
    fs.writeFileSync(filePath, body.content, 'utf-8')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Format a value for YAML frontmatter (handles arrays and strings)
function formatFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${value.join(', ')}]`
  }
  return String(value)
}

// PATCH — update a specific frontmatter field (e.g., model, disallowedTools)
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id, filename } = await params
  const safeFilename = validateFilename(filename)
  if (!safeFilename) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  const updates = await req.json() as Record<string, unknown>

  try {
    const filePath = path.join(getWorkspacePath(id), 'agents', safeFilename)
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let content = fs.readFileSync(filePath, 'utf-8')
    const trimmed = content.trim()

    if (trimmed.startsWith('---')) {
      const endIdx = trimmed.indexOf('---', 3)
      if (endIdx !== -1) {
        const yamlBlock = trimmed.slice(3, endIdx)
        const body = trimmed.slice(endIdx + 3)
        const lines = yamlBlock.split('\n')

        for (const [key, value] of Object.entries(updates)) {
          const formatted = formatFrontmatterValue(value)
          // Find existing line for this key
          const lineIdx = lines.findIndex(l => l.trim().startsWith(`${key}:`))
          if (lineIdx !== -1) {
            // Remove any subsequent YAML list lines (e.g., "- item" lines for disallowedTools)
            let removeCount = 0
            for (let j = lineIdx + 1; j < lines.length; j++) {
              if (lines[j].trim().startsWith('- ')) {
                removeCount++
              } else {
                break
              }
            }
            lines.splice(lineIdx, 1 + removeCount, `${key}: ${formatted}`)
          } else {
            lines.push(`${key}: ${formatted}`)
          }
        }

        content = `---\n${lines.join('\n')}\n---${body}`
      }
    } else {
      // No frontmatter exists — create one
      const fmLines = Object.entries(updates).map(([k, v]) => `${k}: ${formatFrontmatterValue(v)}`)
      content = `---\n${fmLines.join('\n')}\n---\n\n${trimmed}`
    }

    fs.writeFileSync(filePath, content, 'utf-8')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// DELETE — delete sub-agent file
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id, filename } = await params
  const safeFilename = validateFilename(filename)
  if (!safeFilename) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })

  try {
    const filePath = path.join(getWorkspacePath(id), 'agents', safeFilename)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
