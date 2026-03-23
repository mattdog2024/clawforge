'use client'

import { useState, useEffect, useCallback } from 'react'
import type { McpServer } from '@/lib/types'

interface DbMcpServer {
  id: string
  name: string
  protocol: string
  config: string
  enabled: number
  status: string
  created_at: string
  updated_at: string
}

function mapServer(row: DbMcpServer): McpServer {
  let config: Record<string, string> = {}
  try { config = JSON.parse(row.config) } catch { /* empty */ }

  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as McpServer['protocol'],
    config,
    enabled: row.enabled === 1,
    status: row.status as McpServer['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useMcpServers() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp')
      const data = (await res.json()) as DbMcpServer[]
      setServers(data.map(mapServer))
    } catch {
      // Silently ignore — fetch may fail on initial Electron load before server is ready
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchServers() }, [fetchServers])

  const createServer = useCallback(async (opts: { name: string; protocol: string; config?: Record<string, string> }) => {
    const res = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    const data = mapServer(await res.json())
    setServers((prev) => [data, ...prev])
    return data
  }, [])

  const updateServer = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/mcp/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const data = mapServer(await res.json())
    setServers((prev) => prev.map((s) => (s.id === id ? data : s)))
    return data
  }, [])

  const deleteServer = useCallback(async (id: string) => {
    await fetch(`/api/mcp/${id}`, { method: 'DELETE' })
    setServers((prev) => prev.filter((s) => s.id !== id))
  }, [])

  return { servers, loading, createServer, updateServer, deleteServer, refreshServers: fetchServers }
}
