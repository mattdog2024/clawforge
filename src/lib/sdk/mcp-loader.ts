/**
 * Load MCP server configurations from DB for the Claude Agent SDK.
 * Converts DB mcp_servers rows into SDK McpServerConfig records.
 */

import { getDb } from '@/lib/db'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'

interface McpServerRow {
  id: string
  name: string
  protocol: string
  config: string
  enabled: number
}

interface StdioConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
}

interface SseHttpConfig {
  url?: string
  headers?: Record<string, string>
}

/**
 * Load all enabled MCP servers from the DB and convert to SDK format.
 */
export function loadMcpServersFromDb(): Record<string, McpServerConfig> {
  const db = getDb()
  const rows = db.prepare(
    'SELECT id, name, protocol, config FROM mcp_servers WHERE enabled = 1'
  ).all() as McpServerRow[]

  const servers: Record<string, McpServerConfig> = {}

  for (const row of rows) {
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(row.config) } catch (err) { console.warn('[forge] Failed to parse MCP server config:', row.name, err); continue }

    switch (row.protocol) {
      case 'stdio': {
        const cfg = parsed as StdioConfig
        if (!cfg.command) continue
        servers[row.name] = {
          type: 'stdio',
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
        }
        break
      }
      case 'sse': {
        const cfg = parsed as SseHttpConfig
        if (!cfg.url) continue
        servers[row.name] = {
          type: 'sse',
          url: cfg.url,
          headers: cfg.headers,
        }
        break
      }
      case 'http': {
        const cfg = parsed as SseHttpConfig
        if (!cfg.url) continue
        servers[row.name] = {
          type: 'http',
          url: cfg.url,
          headers: cfg.headers,
        }
        break
      }
    }
  }

  return servers
}
