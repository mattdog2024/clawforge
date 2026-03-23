import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { testMcpServer } from '@/lib/mcp-test'
import crypto from 'crypto'

export async function GET() {
  const db = getDb()
  const servers = db.prepare('SELECT * FROM mcp_servers ORDER BY updated_at DESC').all()
  return NextResponse.json(servers)
}

export async function POST(req: Request) {
  const body = await req.json()
  const id = crypto.randomUUID()
  const name = body.name || 'New Server'
  const protocol = body.protocol || 'stdio'
  const configObj = body.config || {}
  const config = JSON.stringify(configObj)

  const db = getDb()
  db.prepare(
    'INSERT INTO mcp_servers (id, name, protocol, config) VALUES (?, ?, ?, ?)'
  ).run(id, name, protocol, config)

  // Auto-test connection after creation
  const status = await testMcpServer(protocol, configObj)
  db.prepare('UPDATE mcp_servers SET status = ? WHERE id = ?').run(status, id)

  const server = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id)
  return NextResponse.json(server, { status: 201 })
}
