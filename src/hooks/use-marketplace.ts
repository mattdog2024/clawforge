'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MarketplaceTemplate } from '@/lib/types'

interface DbTemplate {
  id: string
  name: string
  created_at: string
  updated_at: string
}

function mapTemplate(row: DbTemplate): MarketplaceTemplate {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useMarketplace() {
  const [templates, setTemplates] = useState<MarketplaceTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/marketplace')
      const data = (await res.json()) as DbTemplate[]
      setTemplates(data.map(mapTemplate))
    } catch (err) {
      console.error('Failed to fetch marketplace templates:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const createTemplate = useCallback(async (name: string) => {
    const res = await fetch('/api/marketplace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(`Failed to create template: ${res.status}`)
    const data = mapTemplate(await res.json())
    setTemplates((prev) => [data, ...prev])
    return data
  }, [])

  const renameTemplate = useCallback(async (id: string, name: string) => {
    const res = await fetch(`/api/marketplace/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(`Failed to rename template: ${res.status}`)
    const data = mapTemplate(await res.json())
    setTemplates((prev) => prev.map((t) => (t.id === id ? data : t)))
    return data
  }, [])

  const deleteTemplate = useCallback(async (id: string) => {
    const res = await fetch(`/api/marketplace/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`Failed to delete template: ${res.status}`)
    setTemplates((prev) => prev.filter((t) => t.id !== id))
    if (selectedTemplateId === id) setSelectedTemplateId(null)
  }, [selectedTemplateId])

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) || null

  return {
    templates,
    loading,
    selectedTemplateId,
    selectedTemplate,
    setSelectedTemplateId,
    createTemplate,
    renameTemplate,
    deleteTemplate,
    refreshTemplates: fetchTemplates,
  }
}
