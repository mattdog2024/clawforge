import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { testMcpServer } from '@/lib/mcp-test'

/**
 * POST /api/mcp/:id/test — Test MCP server connection.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const server = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as {
    id: string
    protocol: string
    config: string
    name: string
  } | undefined

  if (!server) {
    return NextResponse.json({ ok: false, error: 'Server not found' }, { status: 404 })
  }

  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(server.config)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid server config' })
  }

  const status = await testMcpServer(server.protocol, config)
  db.prepare('UPDATE mcp_servers SET status = ? WHERE id = ?').run(status, id)

  if (status === 'connected') {
    return NextResponse.json({ ok: true, message: 'Connected' })
  }
  return NextResponse.json({ ok: false, error: 'Connection test failed' })
}
