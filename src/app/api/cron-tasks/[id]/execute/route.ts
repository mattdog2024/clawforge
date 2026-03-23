import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import crypto from 'crypto'
import { executeTask } from '@/lib/cron/executor'
import type { CronTaskRow } from '@/lib/types'

/**
 * POST /api/cron-tasks/[id]/execute
 * Triggers immediate execution of a task (e.g. "Check Now" for heartbeat).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const task = db.prepare('SELECT * FROM cron_tasks WHERE id = ?').get(id) as CronTaskRow | undefined
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const startTime = new Date().toISOString()

  try {
    const { status, result, sessionId } = await executeTask(task)

    // Record execution
    const execId = crypto.randomUUID()
    db.prepare(
      'INSERT INTO task_executions (id, task_id, task_name, result, status, session_id, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(execId, task.id, task.name, result, status, sessionId || '', startTime)

    // Update task last run
    db.prepare(
      "UPDATE cron_tasks SET last_run_at = ?, last_run_result = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(startTime, result.slice(0, 200), task.id)

    return NextResponse.json({ status, result: result.slice(0, 500), sessionId })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ status: 'error', result: errorMsg }, { status: 500 })
  }
}
