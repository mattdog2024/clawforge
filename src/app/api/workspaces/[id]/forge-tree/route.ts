import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath, discoverForgeConfigFiles, ensureWorkspaceDir, getProjectPath, GLOBAL_WORKSPACE_ID } from '@/lib/workspace-fs'
import fs from 'fs'
import path from 'path'

const FORGE_SUBDIRS = ['memory', 'agents', 'skills']

interface ForgeTreeEntry {
  name: string
  type: 'file' | 'folder'
}

// GET /api/workspaces/[id]/forge-tree — list files inside .claude/ subdirectories + config files
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // For non-global workspaces, check if project folder still exists
    if (id !== GLOBAL_WORKSPACE_ID) {
      try {
        const projectPath = getProjectPath(id)
        if (!fs.existsSync(projectPath)) {
          return NextResponse.json({ memory: [], agents: [], skills: [], configFiles: [] })
        }
      } catch {
        return NextResponse.json({ memory: [], agents: [], skills: [], configFiles: [] })
      }
    }
    // Ensure .claude/ directory with default structure exists before reading
    ensureWorkspaceDir(id)
    const forgePath = getWorkspacePath(id)
    const result: Record<string, ForgeTreeEntry[]> = {}

    for (const dir of FORGE_SUBDIRS) {
      const dirPath = path.join(forgePath, dir)
      if (!fs.existsSync(dirPath)) {
        result[dir] = []
        continue
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(e => ({
          name: e.name,
          type: (e.isDirectory() ? 'folder' : 'file') as 'file' | 'folder',
        }))
      result[dir] = entries
    }

    // Also return dynamically discovered .md config files from .claude/ root
    const configFiles = discoverForgeConfigFiles(id)

    return NextResponse.json({ ...result, configFiles })
  } catch {
    return NextResponse.json({ memory: [], agents: [], skills: [], configFiles: [] })
  }
}
