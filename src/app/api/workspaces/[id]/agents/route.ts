import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath } from '@/lib/workspace-fs'
import { parseFrontmatter } from '@/lib/sdk/frontmatter'
import fs from 'fs'
import path from 'path'

// GET /api/workspaces/[id]/agents — list sub-agents from .claude/agents/*.md
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const forgePath = getWorkspacePath(id)
    const agentsDir = path.join(forgePath, 'agents')
    if (!fs.existsSync(agentsDir)) return NextResponse.json([])

    const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))
    const agents = files.map(file => {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8')
      const filename = path.basename(file, '.md')
      const { frontmatter } = parseFrontmatter(content)

      return {
        id: filename,
        filename: file,
        name: frontmatter.name || filename,
        description: frontmatter.description || '',
        model: frontmatter.model || 'inherit',
        enabled: frontmatter.enabled !== false,
        disallowedTools: frontmatter.disallowedTools || [],
      }
    })

    return NextResponse.json(agents)
  } catch {
    return NextResponse.json([])
  }
}

// POST /api/workspaces/[id]/agents — create new sub-agent .md file
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const name = body.name || 'new-agent'
  const filename = `${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.md`

  try {
    const forgePath = getWorkspacePath(id)
    const agentsDir = path.join(forgePath, 'agents')
    if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true })

    const filePath = path.join(agentsDir, filename)
    if (fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Agent file already exists' }, { status: 409 })
    }

    const content = `---
name: ${name}
description: ${body.description || ''}
model: inherit
enabled: true
---

You are ${name}. Complete the delegated task concisely.
`
    fs.writeFileSync(filePath, content, 'utf-8')

    return NextResponse.json({
      id: path.basename(filename, '.md'),
      filename,
      name,
      description: body.description || '',
      model: 'inherit',
      enabled: true,
    }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
