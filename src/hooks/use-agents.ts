'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Agent } from '@/lib/types'

interface DbAgent {
  id: string
  name: string
  description: string
  model: string
  permission_mode: string
  is_main: number
  parent_id: string | null
  enabled: number
  instructions: string
  soul: string
  identity: string
  tools_config: string
  skill_ids: string[]
  created_at: string
  updated_at: string
}

function mapAgent(row: DbAgent): Agent {
  let toolsConfig: Record<string, boolean> = {}
  try { toolsConfig = JSON.parse(row.tools_config) } catch { /* empty */ }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    model: row.model,
    permissionMode: row.permission_mode as 'confirm' | 'full',
    isMain: row.is_main === 1,
    parentId: row.parent_id,
    enabled: row.enabled === 1,
    instructions: row.instructions,
    soul: row.soul,
    identity: row.identity,
    toolsConfig,
    skillIds: row.skill_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      const data = (await res.json()) as DbAgent[]
      setAgents(data.map(mapAgent))
    } catch (err) {
      console.error('Failed to fetch agents:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  const createAgent = useCallback(async (opts?: { name?: string; is_main?: boolean }) => {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    })
    const data = mapAgent(await res.json())
    setAgents((prev) => [data, ...prev])
    return data
  }, [])

  const updateAgent = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/agents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const data = mapAgent(await res.json())
    setAgents((prev) => prev.map((a) => (a.id === id ? data : a)))
    return data
  }, [])

  const deleteAgent = useCallback(async (id: string) => {
    await fetch(`/api/agents/${id}`, { method: 'DELETE' })
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const updateAgentSkills = useCallback(async (agentId: string, skillIds: string[]) => {
    await fetch(`/api/agents/${agentId}/skills`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_ids: skillIds }),
    })
    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, skillIds } : a)))
  }, [])

  return { agents, loading, createAgent, updateAgent, deleteAgent, updateAgentSkills, refreshAgents: fetchAgents }
}
