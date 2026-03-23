import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath, getProjectPath, GLOBAL_WORKSPACE_ID } from '@/lib/workspace-fs'
import { parseFrontmatter } from '@/lib/sdk/frontmatter'
import fs from 'fs'
import path from 'path'

interface AgentTreeNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: AgentTreeNode[]
  /** Model from frontmatter (only for .md agent files) */
  model?: string
}

function buildAgentsTree(dirPath: string, basePath = '', maxDepth = 6, depth = 0): AgentTreeNode[] {
  if (depth >= maxDepth || !fs.existsSync(dirPath)) return []

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

  return entries.map(entry => {
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      return {
        name: entry.name,
        type: 'folder' as const,
        path: relPath,
        children: buildAgentsTree(path.join(dirPath, entry.name), relPath, maxDepth, depth + 1),
      }
    }
    const node: AgentTreeNode = { name: entry.name, type: 'file' as const, path: relPath }
    if (entry.name.endsWith('.md')) {
      try {
        const fileContent = fs.readFileSync(path.join(dirPath, entry.name), 'utf-8')
        const { frontmatter } = parseFrontmatter(fileContent)
        node.model = frontmatter.model || 'inherit'
      } catch {
        node.model = 'inherit'
      }
    }
    return node
  })
}

// GET /api/workspaces/[id]/agents-tree — full directory tree of .claude/agents/
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // Check if project folder still exists (skip for global workspace)
    if (id !== GLOBAL_WORKSPACE_ID) {
      try {
        const projectPath = getProjectPath(id)
        if (!fs.existsSync(projectPath)) return NextResponse.json({ tree: [] })
      } catch {
        return NextResponse.json({ tree: [] })
      }
    }
    const agentsDir = path.join(getWorkspacePath(id), 'agents')
    const tree = buildAgentsTree(agentsDir)
    return NextResponse.json({ tree })
  } catch {
    return NextResponse.json({ tree: [] })
  }
}
