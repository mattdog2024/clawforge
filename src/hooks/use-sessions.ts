'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Session, SessionStatus } from '@/lib/types'

interface DbSession {
  id: string
  title: string
  workspace: string
  model: string
  permission_mode: string
  status: string
  created_at: string
  updated_at: string
}

function mapSession(row: DbSession): Session {
  return {
    id: row.id,
    title: row.title,
    workspace: row.workspace,
    model: row.model,
    permissionMode: row.permission_mode || '',
    status: (row.status as Session['status']) || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      const data = (await res.json()) as DbSession[]
      setSessions(data.map(mapSession))
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const createSession = useCallback(async (opts?: { title?: string; model?: string; workspace?: string }) => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    })
    const data = mapSession(await res.json())
    setSessions((prev) => [data, ...prev])
    return data
  }, [])

  const updateSession = useCallback(async (id: string, updates: { title?: string; model?: string; status?: SessionStatus }) => {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const data = mapSession(await res.json())
    setSessions((prev) => prev.map((s) => (s.id === id ? data : s)))
    return data
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    setSessions((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const refreshSessions = fetchSessions

  return { sessions, loading, createSession, updateSession, deleteSession, refreshSessions }
}
