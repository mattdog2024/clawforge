'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Workspace } from '@/lib/types'

interface DbWorkspace {
  id: string
  path: string
  name: string
  last_opened_at: string
  created_at: string
  exists?: boolean
}

function mapWorkspace(row: DbWorkspace): Workspace {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    exists: row.exists,
  }
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/workspaces')
      const data = (await res.json()) as DbWorkspace[]
      setWorkspaces(data.map(mapWorkspace))
    } catch (err) {
      console.error('Failed to fetch workspaces:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchWorkspaces() }, [fetchWorkspaces])

  const openProjectFolder = useCallback(async (folderPath: string) => {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    })
    if (!res.ok) throw new Error(`Failed to open project folder: ${res.status}`)
    const data = mapWorkspace(await res.json())
    setWorkspaces((prev) => {
      // If already exists, update in place; otherwise add
      const exists = prev.find(w => w.id === data.id)
      if (exists) return prev.map(w => w.id === data.id ? data : w)
      return [data, ...prev]
    })
    return data
  }, [])

  const removeProject = useCallback(async (id: string) => {
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`Failed to remove project: ${res.status}`)
    setWorkspaces((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const touchWorkspace = useCallback(async (id: string) => {
    await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  }, [])

  return { workspaces, loading, openProjectFolder, removeProject, touchWorkspace, refreshWorkspaces: fetchWorkspaces }
}
