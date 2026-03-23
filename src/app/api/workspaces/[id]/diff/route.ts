import { NextRequest, NextResponse } from 'next/server'
import { getProjectPath } from '@/lib/workspace-fs'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'
import { execFileSync } from 'node:child_process'

/**
 * GET /api/workspaces/:id/diff — Run `git diff` in the workspace project directory.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const projectPath = getProjectPath(id)

    // Global workspace points to homedir — git diff doesn't make sense there
    if (id === GLOBAL_WORKSPACE_ID) {
      return NextResponse.json({ diff: '', message: 'Git diff is not available for the global workspace.' })
    }

    const diff = execFileSync('git', ['diff'], {
      cwd: projectPath,
      timeout: 10000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1MB
    })

    if (!diff.trim()) {
      return NextResponse.json({ diff: '', message: 'No uncommitted changes.' })
    }

    return NextResponse.json({ diff })
  } catch (err) {
    const raw = err instanceof Error ? err.message : ''
    // Provide user-friendly messages for common git errors
    let msg = 'Failed to run git diff.'
    if (raw.toLowerCase().includes('not a git repository')) {
      msg = 'Not a git repository.'
    } else if (raw.includes('ENOENT') || raw.includes('not found')) {
      msg = 'Git is not installed or project directory not found.'
    }
    return NextResponse.json({ diff: '', message: msg })
  }
}
