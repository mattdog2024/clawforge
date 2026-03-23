'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Shared settings hook with cross-instance sync.
 * Multiple useSettings() instances (e.g. AppLayout + SettingsView) stay in sync
 * via a custom DOM event dispatched on every update.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      setSettings(data)
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  // Sync settings across multiple useSettings() instances via custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, string>>).detail
      if (detail) setSettings((prev) => ({ ...prev, ...detail }))
    }
    window.addEventListener('forge:settings-changed', handler)
    return () => window.removeEventListener('forge:settings-changed', handler)
  }, [])

  const updateSettings = useCallback(async (updates: Record<string, string>) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(`Failed to update settings: ${res.status}`)
    setSettings((prev) => ({ ...prev, ...updates }))
    // Notify other useSettings instances in the same window
    window.dispatchEvent(new CustomEvent('forge:settings-changed', { detail: updates }))
  }, [])

  const get = useCallback((key: string, defaultValue = '') => {
    return settings[key] ?? defaultValue
  }, [settings])

  return { settings, loading, get, updateSettings, refreshSettings: fetchSettings }
}
