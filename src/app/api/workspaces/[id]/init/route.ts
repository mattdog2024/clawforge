import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getWorkspacePath, initializeWorkspaceDir } from '@/lib/workspace-fs'

/**
 * POST /api/workspaces/:id/init — Scaffold default .claude/ files for a workspace.
 * Only creates files that don't already exist.
 * Returns a list of created and skipped files.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const forgePath = getWorkspacePath(id)
    const existed = fs.existsSync(forgePath)

    // Snapshot existing files before init
    const existingFiles = existed
      ? new Set(fs.readdirSync(forgePath).filter(f => f.endsWith('.md')))
      : new Set<string>()

    // Run full initialization (creates dirs + default files if missing)
    initializeWorkspaceDir(id)

    // Determine which files were newly created
    const allFiles = fs.readdirSync(forgePath).filter(f => f.endsWith('.md'))
    const created = allFiles.filter(f => !existingFiles.has(f))
    const skipped = allFiles.filter(f => existingFiles.has(f))

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      message: created.length > 0
        ? `Created ${created.length} file(s): ${created.join(', ')}`
        : 'All config files already exist.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to initialize workspace'
    return NextResponse.json({ ok: false, message: msg }, { status: 500 })
  }
}
