import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const row = db.prepare('SELECT * FROM im_channels WHERE id = ?').get(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const body = await req.json()

  const allowedFields = ['enabled', 'status', 'credentials', 'dm_policy', 'group_policy', 'trigger_mode', 'group_whitelist', 'sender_whitelist']
  const sets: string[] = []
  const values: unknown[] = []

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      let val = body[field]
      if (typeof val === 'object') val = JSON.stringify(val)
      if (typeof val === 'boolean') val = val ? 1 : 0
      sets.push(`${field} = ?`)
      values.push(val)
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  sets.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE im_channels SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  const updated = db.prepare('SELECT * FROM im_channels WHERE id = ?').get(id)
  return NextResponse.json(updated)
}
