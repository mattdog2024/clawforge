import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// POST /api/data/clear — clear all user data (sessions, messages, memories, tasks)
export async function POST(req: NextRequest) {
  let body: { confirm?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.confirm) {
    return NextResponse.json({ error: 'Must pass { confirm: true }' }, { status: 400 })
  }

  const db = getDb()

  // Clear data tables (keep schema, settings, workspaces, api_providers)
  db.exec(`
    DELETE FROM messages;
    DELETE FROM sessions;
    DELETE FROM task_executions;
    DELETE FROM cron_tasks;
    DELETE FROM im_channels;
    DELETE FROM mcp_servers;
    DELETE FROM hooks;
    DELETE FROM agent_skills;
    DELETE FROM agents;
    DELETE FROM skills;
  `)

  return NextResponse.json({ ok: true, cleared: true })
}
