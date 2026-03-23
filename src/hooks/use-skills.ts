'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Skill } from '@/lib/types'

interface DbSkill {
  id: string
  name: string
  description: string
  scope: string
  enabled: number
  content: string
  created_at: string
  updated_at: string
}

function mapSkill(row: DbSkill): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scope: row.scope as 'workspace' | 'global',
    enabled: row.enabled === 1,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills')
      const data = (await res.json()) as DbSkill[]
      setSkills(data.map(mapSkill))
    } catch (err) {
      console.error('Failed to fetch skills:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSkills() }, [fetchSkills])

  const createSkill = useCallback(async (opts?: { name?: string; scope?: string }) => {
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    })
    const data = mapSkill(await res.json())
    setSkills((prev) => [data, ...prev])
    return data
  }, [])

  const updateSkill = useCallback(async (id: string, updates: Partial<{ name: string; description: string; scope: string; enabled: boolean; content: string }>) => {
    const res = await fetch(`/api/skills/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const data = mapSkill(await res.json())
    setSkills((prev) => prev.map((s) => (s.id === id ? data : s)))
    return data
  }, [])

  const deleteSkill = useCallback(async (id: string) => {
    await fetch(`/api/skills/${id}`, { method: 'DELETE' })
    setSkills((prev) => prev.filter((s) => s.id !== id))
  }, [])

  return { skills, loading, createSkill, updateSkill, deleteSkill, refreshSkills: fetchSkills }
}
