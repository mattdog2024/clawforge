import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const db = getDb()
  const { searchParams } = new URL(req.url)
  const taskId = searchParams.get('task_id')
  const workspaceId = searchParams.get('workspace_id')
  const rawLimit = parseInt(searchParams.get('limit') || '20', 10)
  const limit = Math.min(Math.max(rawLimit || 20, 1), 500)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)
  const typeFilter = searchParams.get('type') // 'heartbeat' | 'cron'
  const statusFilter = searchParams.get('status') // 'ok' | 'alert' | 'error'

  if (taskId) {
    const rows = db.prepare('SELECT * FROM task_executions WHERE task_id = ? ORDER BY executed_at DESC LIMIT ? OFFSET ?').all(taskId, limit, offset)
    return NextResponse.json(rows)
  }

  // Build WHERE clauses for workspace + type + status filters
  const conditions: string[] = []
  const params: unknown[] = []

  if (workspaceId) {
    conditions.push('(ct.workspace_id = ? OR ct.is_heartbeat = 1)')
    params.push(workspaceId)
  }
  if (typeFilter === 'heartbeat') {
    conditions.push('ct.is_heartbeat = 1')
  } else if (typeFilter === 'cron') {
    conditions.push('ct.is_heartbeat = 0')
  }
  if (statusFilter && ['ok', 'alert', 'error'].includes(statusFilter)) {
    conditions.push('te.status = ?')
    params.push(statusFilter)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit, offset)

  const rows = db.prepare(`
    SELECT te.* FROM task_executions te
    INNER JOIN cron_tasks ct ON ct.id = te.task_id
    ${whereClause}
    ORDER BY te.executed_at DESC LIMIT ? OFFSET ?
  `).all(...params)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const db = getDb()
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.task_id || typeof body.task_id !== 'string') {
    return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  }

  const id = crypto.randomUUID()

  db.prepare(`
    INSERT INTO task_executions (id, task_id, task_name, result, status, session_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, body.task_id, body.task_name || '', body.result || '', body.status || 'ok', body.session_id || '')

  // Update last_run on the task
  if (body.task_id) {
    db.prepare("UPDATE cron_tasks SET last_run_at = datetime('now'), last_run_result = ?, updated_at = datetime('now') WHERE id = ?")
      .run(body.result || '', body.task_id)
  }

  const created = db.prepare('SELECT * FROM task_executions WHERE id = ?').get(id)
  return NextResponse.json(created, { status: 201 })
}
