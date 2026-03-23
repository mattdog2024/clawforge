import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import nodePath from 'path'
import { getProjectPath, getWorkspacePath, GLOBAL_WORKSPACE_ID } from '@/lib/workspace-fs'

// POST /api/workspaces/[id]/fs/import — import files from absolute paths (Finder paste/drop)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await req.json()
  const { sourcePaths, destinationFolder } = body as {
    sourcePaths?: string[]  // Absolute paths from OS
    destinationFolder?: string  // Relative path within project (or within .claude/ for global)
  }

  if (!sourcePaths?.length || !destinationFolder) {
    return NextResponse.json({ error: 'sourcePaths and destinationFolder required' }, { status: 400 })
  }

  try {
    // Global workspace: resolve relative to ~/.claude/; project: relative to project root
    const root = id === GLOBAL_WORKSPACE_ID ? getWorkspacePath(id) : getProjectPath(id)
    const dstDir = nodePath.resolve(root, destinationFolder)

    // Safety: destination must be within root
    if (!dstDir.startsWith(root)) {
      return NextResponse.json({ error: 'path traversal not allowed' }, { status: 400 })
    }

    fs.mkdirSync(dstDir, { recursive: true })

    const imported: string[] = []
    for (const srcPath of sourcePaths) {
      if (!fs.existsSync(srcPath)) continue

      const basename = nodePath.basename(srcPath)
      const dest = nodePath.join(dstDir, basename)

      // Avoid overwriting: append (copy) suffix if exists
      let finalDest = dest
      if (fs.existsSync(dest)) {
        const ext = nodePath.extname(basename)
        const nameNoExt = nodePath.basename(basename, ext)
        let counter = 1
        while (fs.existsSync(finalDest)) {
          finalDest = nodePath.join(dstDir, `${nameNoExt} (${counter})${ext}`)
          counter++
        }
      }

      fs.cpSync(srcPath, finalDest, { recursive: true })
      imported.push(nodePath.basename(finalDest))
    }

    return NextResponse.json({ ok: true, imported }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
