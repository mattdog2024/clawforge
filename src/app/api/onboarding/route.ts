import { NextRequest, NextResponse } from 'next/server'
import { writeWorkspaceFile } from '@/lib/workspace-fs'
import { getDb } from '@/lib/db'

// POST /api/onboarding/generate — generate workspace context files from onboarding data
export async function POST(req: NextRequest) {
  let body: { name?: string; role?: string; style?: string; workspaceId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = getDb()

  // Use provided workspaceId, or fall back to most recently opened
  let workspaceId = body.workspaceId
  if (!workspaceId) {
    const recentWs = db.prepare('SELECT id FROM workspaces ORDER BY last_opened_at DESC LIMIT 1').get() as { id: string } | undefined
    workspaceId = recentWs?.id
  }

  if (!workspaceId) {
    return NextResponse.json({ error: 'No workspace available. Please open a project folder first.' }, { status: 400 })
  }

  const { name, role, style } = body

  // Generate USER.md
  const userLines = ['# User Profile', '']
  if (name) userLines.push(`- Name: ${name}`)
  if (role) userLines.push(`- Role: ${role}`)
  if (style) userLines.push(`- Preferred response style: ${style}`)
  userLines.push('', '---', '', 'This file was auto-generated during onboarding. Feel free to edit it.')
  writeWorkspaceFile(workspaceId, 'USER.md', userLines.join('\n'))

  // Generate CLAUDE.md — main instructions file (compatible with Claude Code SDK)
  const claudeLines = [
    '# Instructions',
    '',
    `You are Forge, a local AI agent assistant.`,
  ]
  if (name) claudeLines.push(`The user's name is ${name}.`)
  if (role) claudeLines.push(`They work as a ${role}.`)
  if (style) {
    const styleMap: Record<string, string> = {
      concise: 'For coding tasks, keep responses focused and direct. For writing and research, still provide thorough content.',
      detailed: 'Provide thorough explanations with examples and well-developed prose.',
      casual: 'Be friendly and conversational.',
      professional: 'Maintain a professional but natural tone.',
      balanced: 'Adapt response depth to the task: direct for coding, thorough for writing and research.',
    }
    claudeLines.push(styleMap[style] || '')
  }
  claudeLines.push('', '---', '', 'Edit this file to customize agent behavior.')
  writeWorkspaceFile(workspaceId, 'CLAUDE.md', claudeLines.join('\n'))

  return NextResponse.json({ ok: true })
}
