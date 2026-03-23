'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ImChannel } from '@/lib/types'

interface DbImChannel {
  id: string
  type: string
  enabled: number
  status: string
  credentials: string
  dm_policy: string
  group_policy: string
  trigger_mode: string
  group_whitelist: string
  sender_whitelist: string
  created_at: string
  updated_at: string
}

function mapChannel(row: DbImChannel): ImChannel {
  let credentials: Record<string, string> = {}
  let groupWhitelist: string[] = []
  let senderWhitelist: string[] = []
  try { credentials = JSON.parse(row.credentials) } catch { /* empty */ }
  try { groupWhitelist = JSON.parse(row.group_whitelist) } catch { /* empty */ }
  try { senderWhitelist = JSON.parse(row.sender_whitelist) } catch { /* empty */ }

  return {
    id: row.id,
    type: row.type as ImChannel['type'],
    enabled: row.enabled === 1,
    status: row.status as ImChannel['status'],
    credentials,
    dmPolicy: row.dm_policy as ImChannel['dmPolicy'],
    groupPolicy: row.group_policy as ImChannel['groupPolicy'],
    triggerMode: row.trigger_mode as ImChannel['triggerMode'],
    groupWhitelist,
    senderWhitelist,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useImChannels() {
  const [channels, setChannels] = useState<ImChannel[]>([])
  const [loading, setLoading] = useState(true)

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/im-channels')
      const data = (await res.json()) as DbImChannel[]
      setChannels(data.map(mapChannel))
    } catch (err) {
      console.error('Failed to fetch IM channels:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchChannels() }, [fetchChannels])

  const updateChannel = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/im-channels/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(`Failed to update channel: ${res.status}`)
    const data = mapChannel(await res.json())
    setChannels((prev) => prev.map((c) => (c.id === id ? data : c)))
    return data
  }, [])

  return { channels, loading, updateChannel, refreshChannels: fetchChannels }
}
