import { NextRequest, NextResponse } from 'next/server'
import { readWorkspaceFile, writeWorkspaceFile } from '@/lib/workspace-fs'
import { getDb } from '@/lib/db'

// Default stub content from initializeWorkspaceDir — used to detect "empty" files
const STUB_PREFIXES = [
  '# Instructions\n\nYou are a helpful AI coding assistant.',
  '# User Profile\n\nUser preferences and context.',
]

/**
 * Check if a workspace file has real user content (not just the default stub).
 * Returns true if the file has been customized by the user or /init.
 */
function hasUserContent(workspaceId: string, filename: string): boolean {
  const content = readWorkspaceFile(workspaceId, filename)
  if (!content || !content.trim()) return false
  // If the content matches a known stub prefix, it's not real user content
  for (const prefix of STUB_PREFIXES) {
    if (content.trim().startsWith(prefix.trim())) return false
  }
  // File has content that doesn't match any known stub — user has customized it
  return true
}

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
  const skipped: string[] = []

  // Generate USER.md — only if the file is empty or stub (don't overwrite user's content)
  if (!hasUserContent(workspaceId, 'USER.md')) {
    const userLines = ['# User Profile', '']
    if (name) userLines.push(`- Name: ${name}`)
    if (role) userLines.push(`- Role: ${role}`)
    if (style) userLines.push(`- Preferred response style: ${style}`)
    userLines.push('', '---', '', 'This file was auto-generated during onboarding. Feel free to edit it.')
    writeWorkspaceFile(workspaceId, 'USER.md', userLines.join('\n'))
  } else {
    skipped.push('USER.md')
  }

  // Generate CLAUDE.md — only if the file is empty or stub (don't overwrite user's content)
  if (!hasUserContent(workspaceId, 'CLAUDE.md')) {
    const claudeLines = [
      '# Instructions',
      '',
      'You are Forge, a local AI agent assistant.',
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
  } else {
    skipped.push('CLAUDE.md')
  }

  return NextResponse.json({ ok: true, skipped })
}
